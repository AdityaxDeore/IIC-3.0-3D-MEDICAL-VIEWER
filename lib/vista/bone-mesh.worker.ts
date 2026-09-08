/// <reference lib="webworker" />
/**
 * Turns a medical volume into a bone surface mesh, off the main thread so the
 * viewer never drops a frame.
 *
 * Two input modes:
 *   - labels: a VISTA-3D segmentation, meshed by skeletal label id.
 *   - threshold: a raw CT/MRI volume, meshed by intensity (bone is bright in
 *     CT: HU >= ~300). No API, no GPU, works offline.
 *
 * Pipeline: crop to the bone bounding box -> downsample to a budget ->
 * signed field -> smooth -> Surface Nets -> world-space transform + tint.
 */
import { BONE_IDS, LESION_ID, boneTint } from './labels';
import { computeNormals, surfaceNets } from './surface-nets';

export interface BoneMeshRequest {
  data: ArrayBuffer;
  kind: 'u8' | 'i16' | 'u16' | 'i32' | 'f32';
  dims: [number, number, number];
  spacing: [number, number, number];
  /** Longest grid axis after downsampling. Lower = faster, coarser. */
  maxDim?: number;
  /** labels mode: restrict to these ids. Defaults to every skeletal label. */
  labels?: number[];
  /** threshold mode: keep voxels whose real value is >= this (Hounsfield units). */
  threshold?: number;
  /** Real value = stored * sclSlope + sclInter. */
  sclSlope?: number;
  sclInter?: number;
}

export interface BoneMeshResponse {
  ok: true;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** Voxel count per label actually present. */
  counts: [number, number][];
  /** Metres, after scaling from mm. */
  size: [number, number, number];
  stride: number;
  ms: number;
}

type Progress = { ok: false; stage: string; percent: number };

const post = (m: BoneMeshResponse | Progress | { ok: false; error: string }, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(m, (transfer ?? []) as never);

function viewOf(buffer: ArrayBuffer, kind: BoneMeshRequest['kind']) {
  switch (kind) {
    case 'u8': return new Uint8Array(buffer);
    case 'i16': return new Int16Array(buffer);
    case 'u16': return new Uint16Array(buffer);
    case 'i32': return new Int32Array(buffer);
    case 'f32': return new Float32Array(buffer);
  }
}

self.onmessage = (event: MessageEvent<BoneMeshRequest>) => {
  const started = performance.now();
  try {
    const { data, kind, dims, spacing } = event.data;
    const maxDim = event.data.maxDim ?? 224;
    const wanted = event.data.labels ?? BONE_IDS;
    const threshold = event.data.threshold;
    const ctMode = typeof threshold === 'number';
    const slope = event.data.sclSlope ?? 1;
    const inter = event.data.sclInter ?? 0;

    const src = viewOf(data, kind);
    const [nx, ny, nz] = dims;

    // labels mode: membership over the 0..255 label range.
    const isBone = new Uint8Array(256);
    if (!ctMode) for (const id of wanted) if (id >= 0 && id < 256) isBone[id] = 1;
    // threshold mode: keep voxels at or above the requested Hounsfield value.
    const hit = ctMode
      ? (v: number) => v * slope + inter >= (threshold as number)
      : (v: number) => v > 0 && v < 256 && isBone[v] === 1;

    post({ ok: false, stage: ctMode ? 'Thresholding volume' : 'Scanning labels', percent: 15 });

    // Pass 1: bounding box + per-label counts.
    const counts = new Map<number, number>();
    let hitCount = 0;
    let minX = nx, minY = ny, minZ = nz, maxX = -1, maxY = -1, maxZ = -1;
    for (let z = 0, i = 0; z < nz; ++z) {
      for (let y = 0; y < ny; ++y) {
        for (let x = 0; x < nx; ++x, ++i) {
          const v = src[i];
          if (!hit(v)) continue;
          ++hitCount;
          if (!ctMode) counts.set(v, (counts.get(v) ?? 0) + 1);
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
      }
    }
    if (ctMode) counts.set(-1, hitCount);
    if (maxX < 0) {
      throw new Error(ctMode
        ? `No voxels at or above ${threshold} HU. Lower the threshold, or this may not be a CT scan.`
        : 'The segmentation contains no skeletal labels.');
    }

    // Pad by one voxel so the surface closes cleanly at the crop edge.
    minX = Math.max(0, minX - 1); minY = Math.max(0, minY - 1); minZ = Math.max(0, minZ - 1);
    maxX = Math.min(nx - 1, maxX + 1); maxY = Math.min(ny - 1, maxY + 1); maxZ = Math.min(nz - 1, maxZ + 1);

    const cw = maxX - minX + 1, ch = maxY - minY + 1, cd = maxZ - minZ + 1;
    const stride = Math.max(1, Math.ceil(Math.max(cw, ch, cd) / maxDim));

    // Grid dimensions after downsampling, plus a one-voxel empty border so the
    // isosurface is watertight.
    const gx = Math.floor((cw + stride - 1) / stride) + 2;
    const gy = Math.floor((ch + stride - 1) / stride) + 2;
    const gz = Math.floor((cd + stride - 1) / stride) + 2;

    post({ ok: false, stage: 'Building volume', percent: 35 });

    // Max-pool bone occupancy, and keep a representative label for tinting.
    const total = gx * gy * gz;
    const field = new Float32Array(total);
    const labelAt = new Uint8Array(total);
    field.fill(1);

    for (let z = minZ; z <= maxZ; ++z) {
      const gzi = Math.floor((z - minZ) / stride) + 1;
      for (let y = minY; y <= maxY; ++y) {
        const gyi = Math.floor((y - minY) / stride) + 1;
        let i = z * nx * ny + y * nx + minX;
        for (let x = minX; x <= maxX; ++x, ++i) {
          const v = src[i];
          if (!hit(v)) continue;
          const gxi = Math.floor((x - minX) / stride) + 1;
          const g = gzi * gx * gy + gyi * gx + gxi;
          field[g] = -1;
          // A lesion always wins the tint so the injury stays visible.
          if (!ctMode && (labelAt[g] === 0 || v === LESION_ID)) labelAt[g] = v;
        }
      }
    }

    post({ ok: false, stage: 'Smoothing', percent: 55 });

    // One separable 1-2-1 pass. Softens the voxel staircase without eroding thin bone.
    smooth(field, gx, gy, gz);

    post({ ok: false, stage: 'Extracting surface', percent: 70 });

    const { positions, indices } = surfaceNets(field, [gx, gy, gz]);
    if (positions.length === 0) throw new Error('No bone surface could be extracted.');

    post({ ok: false, stage: 'Shading', percent: 88 });

    // Grid -> world. NIfTI axes are (L-R, A-P, I-S); three.js wants Y up.
    const [sx, sy, sz] = spacing;
    const colors = new Float32Array(positions.length);
    const world = new Float32Array(positions.length);
    let wMinX = Infinity, wMinY = Infinity, wMinZ = Infinity;
    let wMaxX = -Infinity, wMaxY = -Infinity, wMaxZ = -Infinity;

    for (let i = 0; i < positions.length; i += 3) {
      const gxf = positions[i], gyf = positions[i + 1], gzf = positions[i + 2];
      // Millimetres, then metres.
      const mx = (minX + (gxf - 1) * stride) * sx / 1000;
      const my = (minY + (gyf - 1) * stride) * sy / 1000;
      const mz = (minZ + (gzf - 1) * stride) * sz / 1000;
      const wx = mx, wy = mz, wz = -my;   // I-S becomes up, A-P becomes depth
      world[i] = wx; world[i + 1] = wy; world[i + 2] = wz;
      if (wx < wMinX) wMinX = wx; if (wx > wMaxX) wMaxX = wx;
      if (wy < wMinY) wMinY = wy; if (wy > wMaxY) wMaxY = wy;
      if (wz < wMinZ) wMinZ = wz; if (wz > wMaxZ) wMaxZ = wz;

      const g =
        Math.min(gz - 1, Math.max(0, Math.round(gzf))) * gx * gy +
        Math.min(gy - 1, Math.max(0, Math.round(gyf))) * gx +
        Math.min(gx - 1, Math.max(0, Math.round(gxf)));
      const [r, gg, b] = boneTint(labelAt[g] || 0);
      colors[i] = r; colors[i + 1] = gg; colors[i + 2] = b;
    }

    // Centre on the origin in X/Z and stand it on the platform.
    const cx = (wMinX + wMaxX) / 2, cz = (wMinZ + wMaxZ) / 2;
    for (let i = 0; i < world.length; i += 3) {
      world[i] -= cx;
      world[i + 1] -= wMinY;
      world[i + 2] -= cz;
    }

    const normals = computeNormals(world, indices);

    post(
      {
        ok: true,
        positions: world,
        normals,
        colors,
        indices,
        counts: [...counts.entries()],
        size: [wMaxX - wMinX, wMaxY - wMinY, wMaxZ - wMinZ],
        stride,
        ms: Math.round(performance.now() - started),
      },
      [world.buffer, normals.buffer, colors.buffer, indices.buffer],
    );
  } catch (error) {
    post({ ok: false, error: error instanceof Error ? error.message : 'Bone reconstruction failed.' });
  }
};

function smooth(field: Float32Array, gx: number, gy: number, gz: number) {
  const tmp = new Float32Array(field.length);
  const planeSize = gx * gy;
  // X
  for (let z = 0; z < gz; ++z) for (let y = 0; y < gy; ++y) {
    const row = z * planeSize + y * gx;
    for (let x = 0; x < gx; ++x) {
      const a = field[row + Math.max(0, x - 1)], b = field[row + x], c = field[row + Math.min(gx - 1, x + 1)];
      tmp[row + x] = (a + 2 * b + c) / 4;
    }
  }
  // Y
  for (let z = 0; z < gz; ++z) for (let x = 0; x < gx; ++x) {
    const col = z * planeSize + x;
    for (let y = 0; y < gy; ++y) {
      const a = tmp[col + Math.max(0, y - 1) * gx], b = tmp[col + y * gx], c = tmp[col + Math.min(gy - 1, y + 1) * gx];
      field[col + y * gx] = (a + 2 * b + c) / 4;
    }
  }
  // Z
  for (let y = 0; y < gy; ++y) for (let x = 0; x < gx; ++x) {
    const col = y * gx + x;
    for (let z = 0; z < gz; ++z) {
      const a = field[col + Math.max(0, z - 1) * planeSize], b = field[col + z * planeSize], c = field[col + Math.min(gz - 1, z + 1) * planeSize];
      tmp[col + z * planeSize] = (a + 2 * b + c) / 4;
    }
  }
  field.set(tmp);
}
