/// <reference lib="webworker" />
/**
 * Turns a single 2-D MRI/CT slice into a 3-D solid, off the main thread.
 *
 * A lone slice carries no depth, so the third dimension cannot be recovered —
 * it has to be modelled. The structure is segmented in-plane, then inflated: a
 * point far from the outline is thick, a point on the outline is thin, which
 * reproduces the rounded cross-section of a real bone or organ rather than a
 * flat extrusion. The result is a readable 3-D shell of that slice's anatomy,
 * not a volumetric scan.
 *
 * Pipeline: crop to ROI -> box-filter downsample -> Otsu threshold ->
 * largest component -> majority-filter the contour -> fill holes ->
 * signed 2-D distance -> inflate to a signed 3-D field -> smooth the field ->
 * Surface Nets -> Taubin-smooth the mesh.
 */
import { computeNormals, surfaceNets } from '../vista/surface-nets';

export interface SliceMeshRequest {
  /** RGBA bytes straight from an ImageData. */
  pixels: ArrayBuffer;
  width: number;
  height: number;
  /** Normalised [x0, y0, x1, y1] crop around the structure. */
  roi?: [number, number, number, number];
  /** True when the structure reads darker than its surroundings. */
  invert: boolean;
  /** Threshold nudge away from the automatic one, -1..1. */
  bias: number;
  /** Peak half-thickness as a fraction of the structure's in-plane radius. */
  thickness: number;
  /** Longest in-plane axis after downsampling. */
  detail: number;
  /** Flat RGB (0..1) for every vertex. */
  color: [number, number, number];
}

export interface SliceMeshResponse {
  ok: true;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** Mask overlaid on the slice, so the segmentation can be eyeballed. */
  preview: Uint8ClampedArray;
  previewWidth: number;
  previewHeight: number;
  /** Share of the cropped frame the structure occupies, 0..1. */
  coverage: number;
  /** Proportions of the result, longest axis normalised to 1. */
  size: [number, number, number];
  triangles: number;
  threshold: number;
  ms: number;
}

type Progress = { ok: false; stage: string; percent: number };

/** Above this the field grid is refused; keeps a huge Detail value from hanging the tab. */
const MAX_FIELD_CELLS = 110_000_000;

const post = (m: SliceMeshResponse | Progress | { ok: false; error: string }, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(m, (transfer ?? []) as never);

/** Otsu's method: the threshold that best splits the histogram in two. */
function otsu(gray: Float32Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[Math.min(255, Math.max(0, Math.round(gray[i])))]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let lo = 0;
  let hi = 0;
  let bestVariance = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVariance) { bestVariance = between; lo = hi = t; }
    else if (between === bestVariance) { hi = t; }
  }
  // Scans have a wide empty gap between air and tissue, so a whole plateau of
  // thresholds splits the histogram identically. Sitting in the middle of that
  // plateau keeps noise at the top of the background out of the mask; taking the
  // first one puts the cut right on the background's upper edge.
  return Math.round((lo + hi) / 2);
}

/**
 * Keep only the largest 8-connected blob. Medical slices are full of unrelated
 * bright tissue; the structure of interest is the one body in the ROI.
 */
function largestComponent(mask: Uint8Array, w: number, h: number): number {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let best = 0;
  let bestSize = 0;
  let current = 0;

  for (let seed = 0; seed < mask.length; seed++) {
    if (mask[seed] === 0 || label[seed] !== 0) continue;
    current++;
    let top = 0;
    let size = 0;
    stack[top++] = seed;
    label[seed] = current;
    while (top > 0) {
      const p = stack[--top];
      size++;
      const px = p % w;
      const py = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] === 0 || label[q] !== 0) continue;
          label[q] = current;
          stack[top++] = q;
        }
      }
    }
    if (size > bestSize) { bestSize = size; best = current; }
  }

  for (let i = 0; i < mask.length; i++) mask[i] = label[i] === best ? 1 : 0;
  return bestSize;
}

/**
 * 3x3 majority vote, in place. Rounds off single-pixel spurs and staircase jags
 * on the mask edge without eroding the body, so the contour the mesh is built
 * from is already smooth before anything is inflated.
 */
function majorityFilter(mask: Uint8Array, w: number, h: number) {
  const out = mask.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          n++;
          on += mask[yy * w + xx];
        }
      }
      out[y * w + x] = on * 2 > n ? 1 : 0;
    }
  }
  mask.set(out);
}

/** Fill enclosed holes: background reachable from the border stays background. */
function fillHoles(mask: Uint8Array, w: number, h: number) {
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const push = (p: number) => { if (mask[p] === 0 && outside[p] === 0) { outside[p] = 1; stack[top++] = p; } };

  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }

  while (top > 0) {
    const p = stack[--top];
    const px = p % w;
    const py = (p / w) | 0;
    if (px > 0) push(p - 1);
    if (px < w - 1) push(p + 1);
    if (py > 0) push(p - w);
    if (py < h - 1) push(p + w);
  }
  for (let i = 0; i < mask.length; i++) if (mask[i] === 0 && outside[i] === 0) mask[i] = 1;
}

/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher, 2004), run
 * per axis. Replaces the old 3-4 chamfer, whose diagonal bias faceted the
 * inflated surface. Returns distance in pixels to the nearest zero cell.
 */
function edt(binary: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const g = new Float64Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = binary[i] ? INF : 0;

  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);

  const transform1d = (n: number, read: (i: number) => number, write: (i: number, val: number) => void) => {
    for (let i = 0; i < n; i++) f[i] = read(i);
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
    for (let i = 0; i < n; i++) write(i, d[i]);
  };

  for (let x = 0; x < w; x++) {
    transform1d(h, (y) => g[y * w + x], (y, val) => { g[y * w + x] = val; });
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    transform1d(w, (x) => g[row + x], (x, val) => { g[row + x] = val; });
  }

  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(g[i]);
  return out;
}

/** Separable 1-2-1 smoothing of a scalar field, `passes` times. */
function smoothField(field: Float32Array, gx: number, gy: number, gz: number, passes: number) {
  const tmp = new Float32Array(field.length);
  const plane = gx * gy;
  for (let p = 0; p < passes; p++) {
    for (let z = 0; z < gz; ++z) for (let y = 0; y < gy; ++y) {
      const row = z * plane + y * gx;
      for (let x = 0; x < gx; ++x) {
        const a = field[row + Math.max(0, x - 1)];
        const b = field[row + x];
        const c = field[row + Math.min(gx - 1, x + 1)];
        tmp[row + x] = (a + 2 * b + c) / 4;
      }
    }
    for (let z = 0; z < gz; ++z) for (let x = 0; x < gx; ++x) {
      const col = z * plane + x;
      for (let y = 0; y < gy; ++y) {
        const a = tmp[col + Math.max(0, y - 1) * gx];
        const b = tmp[col + y * gx];
        const c = tmp[col + Math.min(gy - 1, y + 1) * gx];
        field[col + y * gx] = (a + 2 * b + c) / 4;
      }
    }
    for (let y = 0; y < gy; ++y) for (let x = 0; x < gx; ++x) {
      const col = y * gx + x;
      for (let z = 0; z < gz; ++z) {
        const a = field[col + Math.max(0, z - 1) * plane];
        const b = field[col + z * plane];
        const c = field[col + Math.min(gz - 1, z + 1) * plane];
        tmp[col + z * plane] = (a + 2 * b + c) / 4;
      }
    }
    field.set(tmp);
  }
}

/**
 * Taubin (λ|μ) mesh smoothing. A low-pass on the vertex positions that rounds
 * off the Surface Nets facets without the shrinkage a plain Laplacian causes.
 * The mesh from this pipeline is closed, so every interior edge is shared by
 * two triangles and the umbrella weight is uniform.
 */
function taubinSmooth(pos: Float32Array, idx: Uint32Array, iterations: number) {
  const n = pos.length / 3;
  const deg = new Float32Array(n);
  for (let t = 0; t < idx.length; t += 3) {
    deg[idx[t]] += 2; deg[idx[t + 1]] += 2; deg[idx[t + 2]] += 2;
  }
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sz = new Float32Array(n);

  const step = (lambda: number) => {
    sx.fill(0); sy.fill(0); sz.fill(0);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
      const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
      sx[a] += bx + cx; sy[a] += by + cy; sz[a] += bz + cz;
      sx[b] += ax + cx; sy[b] += ay + cy; sz[b] += az + cz;
      sx[c] += ax + bx; sy[c] += ay + by; sz[c] += az + bz;
    }
    for (let vtx = 0; vtx < n; vtx++) {
      const d = deg[vtx];
      if (d === 0) continue;
      const px = pos[vtx * 3], py = pos[vtx * 3 + 1], pz = pos[vtx * 3 + 2];
      pos[vtx * 3] = px + lambda * (sx[vtx] / d - px);
      pos[vtx * 3 + 1] = py + lambda * (sy[vtx] / d - py);
      pos[vtx * 3 + 2] = pz + lambda * (sz[vtx] / d - pz);
    }
  };

  for (let i = 0; i < iterations; i++) { step(0.5); step(-0.53); }
}

self.onmessage = (event: MessageEvent<SliceMeshRequest>) => {
  const started = performance.now();
  try {
    const { pixels, width, height, roi, invert, bias, thickness, detail, color } = event.data;
    const rgba = new Uint8ClampedArray(pixels);

    post({ ok: false, stage: 'Cropping to the structure', percent: 8 });

    // --- crop to the ROI, clamped and never degenerate -----------------------
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    const r = roi ?? [0, 0, 1, 1];
    let x0 = Math.floor(clamp01(Math.min(r[0], r[2])) * width);
    let y0 = Math.floor(clamp01(Math.min(r[1], r[3])) * height);
    let x1 = Math.ceil(clamp01(Math.max(r[0], r[2])) * width);
    let y1 = Math.ceil(clamp01(Math.max(r[1], r[3])) * height);
    if (x1 - x0 < 8) { x0 = 0; x1 = width; }
    if (y1 - y0 < 8) { y0 = 0; y1 = height; }
    const cw = x1 - x0;
    const ch = y1 - y0;

    // --- box-filter downsample to the detail budget ------------------------
    // Averaging every source pixel in the cell (not point-sampling one of them)
    // keeps the outline from being pre-aliased into a staircase before it is
    // ever segmented.
    const step = Math.max(1, Math.ceil(Math.max(cw, ch) / Math.max(64, detail)));
    const mw = Math.max(4, Math.floor(cw / step));
    const mh = Math.max(4, Math.floor(ch / step));

    const gray = new Float32Array(mw * mh);
    for (let y = 0; y < mh; y++) {
      const syA = y0 + y * step;
      const syB = Math.min(y1, syA + step);
      for (let x = 0; x < mw; x++) {
        const sxA = x0 + x * step;
        const sxB = Math.min(x1, sxA + step);
        let acc = 0;
        let cnt = 0;
        for (let yy = syA; yy < syB; yy++) {
          const rowBase = yy * width;
          for (let xx = sxA; xx < sxB; xx++) {
            const p = (rowBase + xx) * 4;
            acc += (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
            cnt++;
          }
        }
        gray[y * mw + x] = cnt ? acc / cnt : 0;
      }
    }

    post({ ok: false, stage: 'Segmenting the structure', percent: 26 });

    // --- threshold --------------------------------------------------------
    const threshold = Math.min(254, Math.max(1, otsu(gray) + Math.round(bias * 60)));
    const mask = new Uint8Array(mw * mh);
    for (let i = 0; i < gray.length; i++) {
      const on = invert ? gray[i] < threshold : gray[i] >= threshold;
      mask[i] = on ? 1 : 0;
    }

    if (largestComponent(mask, mw, mh) < 24) {
      throw new Error(
        'No structure could be separated at this threshold. Try the Invert toggle, or move the Threshold slider.',
      );
    }
    // Two gentle majority passes round the contour, then re-isolate in case a
    // pixel bridge was cut, then close any interior gaps.
    majorityFilter(mask, mw, mh);
    majorityFilter(mask, mw, mh);
    const area = largestComponent(mask, mw, mh);
    if (area < 24) throw new Error('The structure was lost while cleaning the outline. Adjust the Threshold slider.');
    fillHoles(mask, mw, mh);

    // --- preview so the segmentation can be checked by eye ----------------
    const preview = new Uint8ClampedArray(mw * mh * 4);
    for (let i = 0; i < mask.length; i++) {
      const g = gray[i];
      const p = i * 4;
      if (mask[i]) {
        preview[p] = Math.min(255, g * 0.45 + 90);
        preview[p + 1] = Math.min(255, g * 0.45 + 190);
        preview[p + 2] = Math.min(255, g * 0.45 + 170);
      } else {
        preview[p] = preview[p + 1] = preview[p + 2] = g * 0.55;
      }
      preview[p + 3] = 255;
    }

    post({ ok: false, stage: 'Inflating to 3-D', percent: 46 });

    // --- signed in-plane distance ---------------------------------------
    const inside = edt(mask, mw, mh);
    const invMask = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) invMask[i] = mask[i] ? 0 : 1;
    const outside = edt(invMask, mw, mh);

    let peak = 0;
    for (let i = 0; i < inside.length; i++) if (inside[i] > peak) peak = inside[i];
    if (peak <= 0) throw new Error('The segmented structure is too thin to inflate.');

    // Half-thickness profile. The 0.4 power fills the cross-section out to a
    // rounded barrel instead of a lens, so the solid reads as a solid when
    // it is turned side-on.
    const maxHalf = Math.max(2, thickness * peak);
    const half = new Float32Array(mask.length);
    for (let i = 0; i < mask.length; i++) {
      half[i] = mask[i] ? maxHalf * Math.pow(inside[i] / peak, 0.4) : 0;
    }

    // --- signed 3-D field --------------------------------------------------
    // Z is oversampled ~2x relative to its physical extent so the rounded caps
    // are not stair-stepped; `zStep` converts a grid layer back to pixel units
    // when the mesh is placed, keeping the proportions honest.
    const zLayers = Math.min(240, Math.max(12, Math.round(maxHalf * 2 * 2)));
    const zStep = (maxHalf * 2) / zLayers;
    const gw = mw + 2;
    const gh = mh + 2;
    const gd = zLayers + 3;
    if (gw * gh * gd > MAX_FIELD_CELLS) {
      throw new Error('That slice is too detailed for the browser — lower the Detail slider a step.');
    }

    const field = new Float32Array(gw * gh * gd);
    field.fill(1);
    const zc = (gd - 1) / 2;
    const band = Math.max(3, maxHalf * 0.6); // linear range each side of the surface

    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const i = y * mw + x;
        // Negative inside the outline, positive outside it — in pixels.
        const plane = mask[i] ? -inside[i] : outside[i];
        const t = half[i];
        const colBase = (y + 1) * gw + (x + 1);
        for (let z = 0; z < gd; z++) {
          const zWorld = (z - zc) * zStep;
          // Intersect the outline prism with the thickness slab.
          const v = Math.max(plane, Math.abs(zWorld) - t);
          field[z * gw * gh + colBase] = Math.min(1, Math.max(-1, v / band));
        }
      }
    }

    post({ ok: false, stage: 'Smoothing the volume', percent: 62 });
    smoothField(field, gw, gh, gd, 3);

    post({ ok: false, stage: 'Extracting the surface', percent: 76 });

    const { positions, indices } = surfaceNets(field, [gw, gh, gd]);
    if (positions.length === 0) throw new Error('No surface could be extracted from this slice.');

    post({ ok: false, stage: 'Refining the mesh', percent: 88 });

    // Undo the Z oversample so grid units are isotropic again, then polish.
    for (let i = 2; i < positions.length; i += 3) {
      positions[i] = (positions[i] - zc) * zStep + zc;
    }
    taubinSmooth(positions, indices, 4);

    post({ ok: false, stage: 'Shading', percent: 95 });

    // --- grid -> world --------------------------------------------------
    // Image columns run left-right, image rows run downward, so the row axis is
    // flipped to stand the structure up the way it is displayed.
    const world = new Float32Array(positions.length);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const wx = positions[i];
      const wy = gh - positions[i + 1];
      const wz = positions[i + 2];
      world[i] = wx; world[i + 1] = wy; world[i + 2] = wz;
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
    }

    // Normalise: longest axis becomes 1, centred in X/Z, resting on Y = 0.
    const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
    const scale = 1 / Math.max(spanX, spanY, spanZ, 1e-6);
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    for (let i = 0; i < world.length; i += 3) {
      world[i] = (world[i] - cx) * scale;
      world[i + 1] = (world[i + 1] - minY) * scale;
      world[i + 2] = (world[i + 2] - cz) * scale;
    }

    const colors = new Float32Array(positions.length);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = color[0]; colors[i + 1] = color[1]; colors[i + 2] = color[2];
    }
    const normals = computeNormals(world, indices);

    post(
      {
        ok: true,
        positions: world,
        normals,
        colors,
        indices,
        preview,
        previewWidth: mw,
        previewHeight: mh,
        coverage: area / (mw * mh),
        size: [spanX * scale, spanY * scale, spanZ * scale],
        triangles: indices.length / 3,
        threshold,
        ms: Math.round(performance.now() - started),
      },
      [world.buffer, normals.buffer, colors.buffer, indices.buffer, preview.buffer],
    );
  } catch (error) {
    post({ ok: false, error: error instanceof Error ? error.message : 'Reconstruction failed.' });
  }
};
