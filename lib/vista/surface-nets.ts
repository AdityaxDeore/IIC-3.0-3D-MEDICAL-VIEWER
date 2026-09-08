/**
 * Naive Surface Nets isosurface extraction (Gibson 1998).
 * Chosen over marching cubes because its lookup tables are generated at load
 * time rather than hard-coded, and it produces a smoother, lower-poly shell —
 * which is what we want for a browser-side bone reconstruction.
 *
 * The scalar field convention is the usual one: negative is inside the surface.
 */

const CUBE_EDGES = new Int32Array(24);
const EDGE_TABLE = new Int32Array(256);

(function buildTables() {
  let k = 0;
  for (let i = 0; i < 8; ++i) {
    for (let j = 1; j <= 4; j <<= 1) {
      const p = i ^ j;
      if (i <= p) {
        CUBE_EDGES[k++] = i;
        CUBE_EDGES[k++] = p;
      }
    }
  }
  for (let i = 0; i < 256; ++i) {
    let em = 0;
    for (let j = 0; j < 24; j += 2) {
      const a = !!(i & (1 << CUBE_EDGES[j]));
      const b = !!(i & (1 << CUBE_EDGES[j + 1]));
      em |= a !== b ? 1 << (j >> 1) : 0;
    }
    EDGE_TABLE[i] = em;
  }
})();

export interface SurfaceNetsResult {
  /** Vertex positions in grid space (x, y, z triples). */
  positions: Float32Array;
  /** Triangle indices. */
  indices: Uint32Array;
}

export function surfaceNets(field: Float32Array, dims: [number, number, number]): SurfaceNetsResult {
  const verts: number[] = [];
  const tris: number[] = [];

  const x = new Int32Array(3);
  const R = new Int32Array([1, dims[0] + 1, (dims[0] + 1) * (dims[1] + 1)]);
  const grid = new Float32Array(8);
  const buffer = new Int32Array(R[2] * 2);
  let bufNo = 1;
  let n = 0;

  for (x[2] = 0; x[2] < dims[2] - 1; ++x[2], n += dims[0], bufNo ^= 1, R[2] = -R[2]) {
    let m = 1 + (dims[0] + 1) * (1 + bufNo * (dims[1] + 1));

    for (x[1] = 0; x[1] < dims[1] - 1; ++x[1], ++n, m += 2) {
      for (x[0] = 0; x[0] < dims[0] - 1; ++x[0], ++n, ++m) {
        // Sample the eight corners of this cube.
        let mask = 0;
        let g = 0;
        let idx = n;
        for (let k = 0; k < 2; ++k, idx += dims[0] * (dims[1] - 2)) {
          for (let j = 0; j < 2; ++j, idx += dims[0] - 2) {
            for (let i = 0; i < 2; ++i, ++g, ++idx) {
              const p = field[idx];
              grid[g] = p;
              mask |= p < 0 ? 1 << g : 0;
            }
          }
        }
        if (mask === 0 || mask === 0xff) continue;

        const edgeMask = EDGE_TABLE[mask];
        let vx = 0, vy = 0, vz = 0;
        let edges = 0;

        for (let i = 0; i < 12; ++i) {
          if (!(edgeMask & (1 << i))) continue;
          ++edges;
          const e0 = CUBE_EDGES[i << 1];
          const e1 = CUBE_EDGES[(i << 1) + 1];
          const g0 = grid[e0];
          const g1 = grid[e1];
          let t = g0 - g1;
          if (Math.abs(t) <= 1e-6) continue;
          t = g0 / t;

          // Accumulate the crossing point, axis by axis.
          const a0 = e0 & 1, b0 = e1 & 1;
          if (a0 !== b0) vx += a0 ? 1 - t : t; else vx += a0 ? 1 : 0;
          const a1 = e0 & 2, b1 = e1 & 2;
          if (a1 !== b1) vy += a1 ? 1 - t : t; else vy += a1 ? 1 : 0;
          const a2 = e0 & 4, b2 = e1 & 4;
          if (a2 !== b2) vz += a2 ? 1 - t : t; else vz += a2 ? 1 : 0;
        }
        if (edges === 0) continue;

        const s = 1 / edges;
        const vertexIndex = verts.length / 3;
        verts.push(x[0] + s * vx, x[1] + s * vy, x[2] + s * vz);
        buffer[m] = vertexIndex;

        // Stitch a quad (two triangles) for each axis whose edge is crossed.
        for (let i = 0; i < 3; ++i) {
          if (!(edgeMask & (1 << i))) continue;
          const iu = (i + 1) % 3;
          const iv = (i + 2) % 3;
          if (x[iu] === 0 || x[iv] === 0) continue;
          const du = R[iu];
          const dv = R[iv];
          const a = buffer[m];
          const b = buffer[m - du];
          const c = buffer[m - du - dv];
          const d = buffer[m - dv];
          if (mask & 1) {
            tris.push(a, b, c, a, c, d);
          } else {
            tris.push(a, d, c, a, c, b);
          }
        }
      }
    }
  }

  return { positions: new Float32Array(verts), indices: new Uint32Array(tris) };
}

/** Area-weighted vertex normals. */
export function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const e1x = positions[b] - ax, e1y = positions[b + 1] - ay, e1z = positions[b + 2] - az;
    const e2x = positions[c] - ax, e2y = positions[c + 1] - ay, e2z = positions[c + 2] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz;
    normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz;
    normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len;
  }
  return normals;
}
