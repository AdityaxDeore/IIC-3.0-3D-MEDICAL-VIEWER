/**
 * Deforms a real atlas mesh so it agrees with what a scan shows, without
 * inventing the shape from the scan.
 *
 * The atlas mesh supplies the anatomy: a femur arrives with its head, neck,
 * shaft and condyles, closed and smooth. The measurements only stretch it -
 * overall slenderness, and how the width runs from one end to the other. So
 * the two things that ruined the old outline-inflation path cannot happen
 * here: a noisy mask can no longer flatten the bone into a wafer, because
 * every scale factor is clamped near 1, and it cannot roughen the surface,
 * because the surface is never rebuilt.
 */
import { computeNormals } from '../vista/surface-nets';
import { PROFILE_STATIONS, type Measurement } from './measurements';

/** How far a station's width may be pushed from the atlas value. */
const STATION_LIMIT = { min: 0.72, max: 1.4 };
/** How far the structure's overall slenderness may be pushed. */
const ASPECT_LIMIT = { min: 0.8, max: 1.3 };
/**
 * Overall slenderness is the least trustworthy measurement - it depends on
 * where the ROI was drawn and on a bone being cut off by the edge of the
 * frame - so it is applied at a fraction of the station weight.
 */
const ASPECT_WEIGHT = 0.5;

export interface FittedGeometry {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** Vertex range each source part ended up occupying, in vertex units. */
  ranges: { name: string; start: number; count: number }[];
}

export interface FittedPart {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  /** Flat RGB (0..1) this part is painted. */
  color: [number, number, number];
}

/** Index of the longest axis of a point set: the structure's own long axis. */
function longestAxis(positions: Float32Array): 0 | 1 | 2 {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const span = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  if (span[1] >= span[0] && span[1] >= span[2]) return 1;
  return span[0] >= span[2] ? 0 : 2;
}

/** Replace each station with a 1-2-1 average of its neighbours, `passes` times. */
function smooth(values: Float32Array, passes: number) {
  const tmp = new Float32Array(values.length);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < values.length; i++) {
      const a = values[Math.max(0, i - 1)];
      const b = values[i];
      const c = values[Math.min(values.length - 1, i + 1)];
      tmp[i] = (a + 2 * b + c) / 4;
    }
    values.set(tmp);
  }
}

export interface AxisFrame {
  axis: 0 | 1 | 2;
  /** The two axes across the long one. */
  u: 0 | 1 | 2;
  v: 0 | 1 | 2;
  lo: number;
  span: number;
  /** Cross-section centre at each station, in the two across-axes. */
  centreU: Float32Array;
  centreV: Float32Array;
  /** Largest distance from that centre at each station. */
  radius: Float32Array;
}

/**
 * Where each station of the mesh sits and how wide it is there. The centre is
 * tracked per station rather than once for the whole mesh, so a curved bone is
 * scaled about its own centreline instead of being sheared toward a global axis.
 */
function frameOf(positions: Float32Array, axis: 0 | 1 | 2): AxisFrame | null {
  const u = ((axis + 1) % 3) as 0 | 1 | 2;
  const v = ((axis + 2) % 3) as 0 | 1 | 2;

  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const t = positions[i + axis];
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  const span = hi - lo;
  if (!(span > 1e-9)) return null;

  const station = (t: number) =>
    Math.min(PROFILE_STATIONS - 1, Math.max(0, Math.floor(((t - lo) / span) * PROFILE_STATIONS)));

  const sumU = new Float64Array(PROFILE_STATIONS);
  const sumV = new Float64Array(PROFILE_STATIONS);
  const count = new Float64Array(PROFILE_STATIONS);
  for (let i = 0; i < positions.length; i += 3) {
    const s = station(positions[i + axis]);
    sumU[s] += positions[i + u];
    sumV[s] += positions[i + v];
    count[s]++;
  }

  const centreU = new Float32Array(PROFILE_STATIONS);
  const centreV = new Float32Array(PROFILE_STATIONS);
  // A station with no vertices inherits its neighbour's centre, so the
  // centreline stays continuous along a mesh with gaps in it.
  let lastU = 0;
  let lastV = 0;
  for (let s = 0; s < PROFILE_STATIONS; s++) {
    if (count[s] > 0) { lastU = sumU[s] / count[s]; lastV = sumV[s] / count[s]; }
    centreU[s] = lastU;
    centreV[s] = lastV;
  }
  for (let s = PROFILE_STATIONS - 1; s >= 0; s--) {
    if (count[s] > 0) { lastU = centreU[s]; lastV = centreV[s]; }
    else { centreU[s] = lastU; centreV[s] = lastV; }
  }
  smooth(centreU, 2);
  smooth(centreV, 2);

  const radius = new Float32Array(PROFILE_STATIONS);
  for (let i = 0; i < positions.length; i += 3) {
    const s = station(positions[i + axis]);
    const r = Math.hypot(positions[i + u] - centreU[s], positions[i + v] - centreV[s]);
    if (r > radius[s]) radius[s] = r;
  }
  let lastR = 0;
  for (let s = 0; s < PROFILE_STATIONS; s++) {
    if (radius[s] > 0) lastR = radius[s];
    else radius[s] = lastR;
  }
  for (let s = PROFILE_STATIONS - 1; s >= 0; s--) {
    if (radius[s] > 0) lastR = radius[s];
    else radius[s] = lastR;
  }

  return { axis, u, v, lo, span, centreU, centreV, radius };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The per-station scale factors that carry the atlas mesh toward the measured
 * structure. Exported so the fit can be checked without building a mesh.
 *
 * `strength` is 0 (leave the atlas mesh exactly as it is) to 1 (apply the
 * measurements in full, still inside the clamps).
 */
export function fitFactors(
  /** The mesh's own widths at each station, relative to its length. */
  atlasProfile: Float32Array,
  measurement: Measurement,
  strength: number,
): Float32Array {
  const factors = new Float32Array(PROFILE_STATIONS).fill(1);
  const s = clamp(strength, 0, 1);
  if (s <= 0 || !measurement.ok) return factors;

  let atlasMean = 0;
  let imageMean = 0;
  for (let i = 0; i < PROFILE_STATIONS; i++) { atlasMean += atlasProfile[i]; imageMean += measurement.profile[i]; }
  atlasMean /= PROFILE_STATIONS;
  imageMean /= PROFILE_STATIONS;
  if (!(atlasMean > 1e-9) || !(imageMean > 1e-9)) return factors;

  // Overall slenderness, applied weakly and clamped hard: this is the term
  // that used to be able to squash the result flat.
  const aspect = clamp(imageMean / atlasMean, ASPECT_LIMIT.min, ASPECT_LIMIT.max);
  const overall = 1 + (aspect - 1) * s * ASPECT_WEIGHT;

  for (let i = 0; i < PROFILE_STATIONS; i++) {
    // Shape only: each station against its own profile's mean, so a station
    // that is proportionally wider on the scan becomes wider on the mesh.
    const atlasShape = atlasProfile[i] / atlasMean;
    const imageShape = measurement.profile[i] / imageMean;
    const ratio = atlasShape > 1e-9 ? imageShape / atlasShape : 1;
    factors[i] = overall * (1 + (clamp(ratio, STATION_LIMIT.min, STATION_LIMIT.max) - 1) * s);
  }
  // The scan's two ends are the least reliable stations - that is where a bone
  // runs out of the frame - so let the fit relax back toward the atlas there.
  factors[0] = 1 + (factors[0] - 1) * 0.35;
  factors[1] = 1 + (factors[1] - 1) * 0.7;
  factors[PROFILE_STATIONS - 1] = 1 + (factors[PROFILE_STATIONS - 1] - 1) * 0.35;
  factors[PROFILE_STATIONS - 2] = 1 + (factors[PROFILE_STATIONS - 2] - 1) * 0.7;
  smooth(factors, 3);
  return factors;
}

export interface FitReport {
  /** Largest deviation from the atlas mesh, as a percentage. */
  maxChange: number;
  /** Mean deviation from the atlas mesh, as a percentage. */
  meanChange: number;
}

/**
 * Scale `positions` in place, radially about the structure's own centreline,
 * by the factors the measurement implies. Returns how far the mesh was moved.
 */
export function morphToMeasurement(
  positions: Float32Array,
  measurement: Measurement,
  strength: number,
): FitReport {
  const axis = longestAxis(positions);
  const frame = frameOf(positions, axis);
  if (!frame) return { maxChange: 0, meanChange: 0 };

  // Both profiles are widths relative to their own length, so they compare
  // directly without either being in real-world units.
  const atlasProfile = new Float32Array(PROFILE_STATIONS);
  for (let i = 0; i < PROFILE_STATIONS; i++) atlasProfile[i] = (2 * frame.radius[i]) / frame.span;

  const factors = fitFactors(atlasProfile, measurement, strength);
  const { u, v, lo, span, centreU, centreV } = frame;

  let maxChange = 0;
  let sumChange = 0;
  let n = 0;
  for (let i = 0; i < positions.length; i += 3) {
    // Sample the factor between stations, so the mesh is not stepped where one
    // station hands over to the next.
    const t = clamp(((positions[i + axis] - lo) / span) * PROFILE_STATIONS - 0.5, 0, PROFILE_STATIONS - 1);
    const s0 = Math.floor(t);
    const s1 = Math.min(PROFILE_STATIONS - 1, s0 + 1);
    const frac = t - s0;
    const factor = factors[s0] + (factors[s1] - factors[s0]) * frac;
    const cu = centreU[s0] + (centreU[s1] - centreU[s0]) * frac;
    const cv = centreV[s0] + (centreV[s1] - centreV[s0]) * frac;

    positions[i + u] = cu + (positions[i + u] - cu) * factor;
    positions[i + v] = cv + (positions[i + v] - cv) * factor;

    const change = Math.abs(factor - 1);
    if (change > maxChange) maxChange = change;
    sumChange += change;
    n++;
  }
  return { maxChange: maxChange * 100, meanChange: n ? (sumChange / n) * 100 : 0 };
}

/**
 * Merge fitted parts into one buffer geometry and normalise it the way the
 * viewer expects: longest axis 1, centred in X and Z, resting on Y = 0.
 *
 * The parts keep their positions relative to each other, so a left and a right
 * femur stand side by side exactly as they do in the body.
 */
export function mergeFitted(parts: FittedPart[]): FittedGeometry | null {
  const usable = parts.filter((p) => p.positions.length >= 9 && p.indices.length >= 3);
  if (!usable.length) return null;

  let vertexCount = 0;
  let indexCount = 0;
  for (const p of usable) { vertexCount += p.positions.length / 3; indexCount += p.indices.length; }

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  const ranges: { name: string; start: number; count: number }[] = [];
  let vOffset = 0;
  let iOffset = 0;
  for (const p of usable) {
    const count = p.positions.length / 3;
    positions.set(p.positions, vOffset * 3);
    for (let i = 0; i < count; i++) {
      colors[(vOffset + i) * 3] = p.color[0];
      colors[(vOffset + i) * 3 + 1] = p.color[1];
      colors[(vOffset + i) * 3 + 2] = p.color[2];
    }
    for (let i = 0; i < p.indices.length; i++) indices[iOffset + i] = p.indices[i] + vOffset;
    ranges.push({ name: p.name, start: vOffset, count });
    vOffset += count;
    iOffset += p.indices.length;
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] < minX) minX = positions[i];
    if (positions[i] > maxX) maxX = positions[i];
    if (positions[i + 1] < minY) minY = positions[i + 1];
    if (positions[i + 1] > maxY) maxY = positions[i + 1];
    if (positions[i + 2] < minZ) minZ = positions[i + 2];
    if (positions[i + 2] > maxZ) maxZ = positions[i + 2];
  }
  const scale = 1 / Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i] - cx) * scale;
    positions[i + 1] = (positions[i + 1] - minY) * scale;
    positions[i + 2] = (positions[i + 2] - cz) * scale;
  }

  return { positions, normals: computeNormals(positions, indices), colors, indices, ranges };
}
