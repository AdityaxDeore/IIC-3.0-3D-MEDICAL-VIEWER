/// <reference lib="webworker" />
/**
 * Measures the structures on a 2-D slice, off the main thread. It builds no
 * geometry: it reports how long and how wide each named structure is, and the
 * atlas mesh for that structure is then deformed to match (see atlas-morph.ts).
 *
 * Two things here fix the failures of building the mesh from the outline alone:
 *
 * 1. Each structure is segmented inside its own ROI, and the largest blob is
 *    taken *within that ROI*. Taking the largest blob over the whole frame is
 *    what made a scan of two thighs produce one femur - the other leg was a
 *    smaller component and was discarded.
 * 2. For a bone the threshold is chosen twice: once to split tissue from air,
 *    then again inside the tissue to split cortical bone from muscle. A single
 *    Otsu cut on a limb keeps the muscle, which is why the old reconstruction
 *    could not tell the two apart.
 */
import { fillHoles, grayCrop, largestComponent, majorityFilter, otsu } from './segment';
import {
  PROFILE_STATIONS,
  type Measurement,
  type SliceMeasureRequest,
  type SliceMeasureResponse,
} from './measurements';

export type { MeasureTarget, Measurement, SliceMeasureRequest, SliceMeasureResponse } from './measurements';

type Progress = { ok: false; stage: string; percent: number };

const post = (m: SliceMeasureResponse | Progress | { ok: false; error: string }, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(m, (transfer ?? []) as never);

/** Distinct mask tints in the preview, so two legs are told apart by eye. */
const TINTS: [number, number, number][] = [
  [90, 190, 170], [220, 150, 90], [150, 160, 230], [210, 120, 160],
  [130, 200, 120], [230, 200, 110], [120, 190, 220], [200, 130, 210],
];

/**
 * The threshold that separates the structure from its surroundings.
 *
 * `bone` runs Otsu twice: the first cut splits the ROI into background and
 * tissue, the second splits that tissue again. Cortical bone is the extreme of
 * the tissue histogram, so the second cut is the one that leaves muscle out.
 */
function chooseThreshold(gray: Float32Array, invert: boolean, bone: boolean, bias: number): number {
  const first = otsu(gray);
  let t = first;

  if (bone) {
    // Restrict to the half the structure lives in, then split that again.
    const half = new Uint8Array(gray.length);
    let n = 0;
    for (let i = 0; i < gray.length; i++) {
      const inHalf = invert ? gray[i] <= first : gray[i] >= first;
      half[i] = inHalf ? 1 : 0;
      n += half[i];
    }
    // Below a few hundred pixels the sub-histogram is too sparse to split.
    if (n > 200) {
      const second = otsu(gray, half);
      // Only accept a cut that actually moved further into the structure.
      if (invert ? second < first : second > first) t = second;
    }
  }
  return Math.min(254, Math.max(1, Math.round(t + bias * 60)));
}

/** Second-moment principal axis of a mask, as a unit vector in grid space. */
function principalAxis(mask: Uint8Array, w: number, h: number) {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    n++; sx += x; sy += y;
  }
  const cx = sx / n, cy = sy / n;

  let xx = 0, yy = 0, xy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    const dx = x - cx, dy = y - cy;
    xx += dx * dx; yy += dy * dy; xy += dx * dy;
  }
  xx /= n; yy /= n; xy /= n;

  // Larger eigenvalue of the 2x2 covariance; its eigenvector is the long axis.
  const mid = (xx + yy) / 2;
  const spread = Math.sqrt(Math.max(0, ((xx - yy) / 2) ** 2 + xy * xy));
  const major = mid + spread;
  let ax = xy;
  let ay = major - xx;
  if (Math.abs(ax) < 1e-9 && Math.abs(ay) < 1e-9) { ax = 0; ay = 1; }
  const len = Math.hypot(ax, ay) || 1;
  return { cx, cy, ax: ax / len, ay: ay / len, count: n };
}

/** Replace each station with a 1-2-1 average of its neighbours, `passes` times. */
function smoothProfile(profile: Float32Array, passes: number) {
  const tmp = new Float32Array(profile.length);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < profile.length; i++) {
      const a = profile[Math.max(0, i - 1)];
      const b = profile[i];
      const c = profile[Math.min(profile.length - 1, i + 1)];
      tmp[i] = (a + 2 * b + c) / 4;
    }
    profile.set(tmp);
  }
}

/** Carry the nearest measured value into stations the mask never reached. */
function fillGaps(profile: Float32Array) {
  const n = profile.length;
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) if (profile[i] > 0) { if (first < 0) first = i; last = i; }
  if (first < 0) return false;
  for (let i = 0; i < first; i++) profile[i] = profile[first];
  for (let i = last + 1; i < n; i++) profile[i] = profile[last];
  for (let i = first; i <= last; i++) {
    if (profile[i] > 0) continue;
    let j = i;
    while (j <= last && profile[j] === 0) j++;
    const before = profile[i - 1];
    const after = j <= last ? profile[j] : before;
    for (let k = i; k < j; k++) profile[k] = before + ((after - before) * (k - i + 1)) / (j - i + 1);
    i = j;
  }
  return true;
}

const FAILED = (name: string, reason: string): Measurement => ({
  name, ok: false, reason, length: 0, width: 0,
  profile: new Float32Array(PROFILE_STATIONS), tilt: 0, coverage: 0, threshold: 0,
});

self.onmessage = (event: MessageEvent<SliceMeasureRequest>) => {
  const started = performance.now();
  try {
    const { pixels, width, height, targets, bias, detail } = event.data;
    const rgba = new Uint8ClampedArray(pixels);
    if (!targets.length) throw new Error('No structure was named in this slice.');

    const diagonal = Math.hypot(width, height);
    const measurements: Measurement[] = [];

    // The preview is the whole frame at a fixed budget, so every ROI's mask can
    // be painted back into one picture the doctor can check at a glance.
    const previewScale = Math.max(1, Math.ceil(Math.max(width, height) / 512));
    const pw = Math.max(4, Math.floor(width / previewScale));
    const ph = Math.max(4, Math.floor(height / previewScale));
    const previewGray = grayCrop(rgba, width, { x0: 0, y0: 0, x1: width, y1: height }, Math.max(pw, ph));
    const preview = new Uint8ClampedArray(pw * ph * 4);
    for (let i = 0; i < pw * ph; i++) {
      const g = (previewGray.gray[i] ?? 0) * 0.55;
      preview[i * 4] = preview[i * 4 + 1] = preview[i * 4 + 2] = g;
      preview[i * 4 + 3] = 255;
    }

    targets.forEach((target, ti) => {
      post({
        ok: false,
        stage: `Measuring ${target.name}`,
        percent: 20 + Math.round((ti / targets.length) * 60),
      });

      // --- crop to this structure's ROI, clamped and never degenerate -------
      const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
      const r = target.roi;
      let x0 = Math.floor(clamp01(Math.min(r[0], r[2])) * width);
      let y0 = Math.floor(clamp01(Math.min(r[1], r[3])) * height);
      let x1 = Math.ceil(clamp01(Math.max(r[0], r[2])) * width);
      let y1 = Math.ceil(clamp01(Math.max(r[1], r[3])) * height);
      if (x1 - x0 < 8) { x0 = 0; x1 = width; }
      if (y1 - y0 < 8) { y0 = 0; y1 = height; }

      const { gray, w: mw, h: mh, step } = grayCrop(rgba, width, { x0, y0, x1, y1 }, detail);

      // A flat region has no structure in it to find. Otsu would still return
      // a threshold, every pixel would land on one side of it, and the ROI
      // rectangle itself would be measured as though it were the anatomy.
      let lowest = Infinity;
      let highest = -Infinity;
      for (let i = 0; i < gray.length; i++) {
        if (gray[i] < lowest) lowest = gray[i];
        if (gray[i] > highest) highest = gray[i];
      }
      if (highest - lowest < 8) {
        measurements.push(FAILED(target.name, 'that region of the scan is blank'));
        return;
      }

      const threshold = chooseThreshold(gray, target.invert, target.bone, bias);

      const mask = new Uint8Array(mw * mh);
      for (let i = 0; i < gray.length; i++) {
        mask[i] = (target.invert ? gray[i] < threshold : gray[i] >= threshold) ? 1 : 0;
      }

      // Largest blob *inside this ROI*, so a second leg in the frame is never
      // discarded for being the smaller component of the whole picture.
      const separated = largestComponent(mask, mw, mh);
      if (separated < 24) {
        measurements.push(FAILED(target.name, 'nothing separated at this threshold'));
        return;
      }
      // A mask that covers the ROI edge to edge has not isolated anything
      // either; it would hand back the box the model drew, not the structure.
      if (separated > 0.97 * mw * mh) {
        measurements.push(FAILED(target.name, 'nothing stood out from the background here'));
        return;
      }
      majorityFilter(mask, mw, mh);
      majorityFilter(mask, mw, mh);
      const area = largestComponent(mask, mw, mh);
      if (area < 24) {
        measurements.push(FAILED(target.name, 'the outline was lost while cleaning it'));
        return;
      }
      fillHoles(mask, mw, mh);

      // --- paint this mask into the shared preview -------------------------
      const tint = TINTS[ti % TINTS.length];
      for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
        if (!mask[y * mw + x]) continue;
        const px = Math.floor((x0 + x * step) / previewScale);
        const py = Math.floor((y0 + y * step) / previewScale);
        for (let dy = 0; dy < Math.max(1, Math.round(step / previewScale)); dy++) {
          for (let dx = 0; dx < Math.max(1, Math.round(step / previewScale)); dx++) {
            const qx = px + dx, qy = py + dy;
            if (qx < 0 || qx >= pw || qy < 0 || qy >= ph) continue;
            const p = (qy * pw + qx) * 4;
            preview[p] = (preview[p] + tint[0]) / 2 + 40;
            preview[p + 1] = (preview[p + 1] + tint[1]) / 2 + 40;
            preview[p + 2] = (preview[p + 2] + tint[2]) / 2 + 40;
          }
        }
      }

      // --- length, tilt and the width profile along the long axis ----------
      const axis = principalAxis(mask, mw, mh);
      // Perpendicular to the axis, for the width measurement.
      const px_ = -axis.ay;
      const py_ = axis.ax;

      let along0 = Infinity, along1 = -Infinity;
      for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
        if (!mask[y * mw + x]) continue;
        const t = (x - axis.cx) * axis.ax + (y - axis.cy) * axis.ay;
        if (t < along0) along0 = t;
        if (t > along1) along1 = t;
      }
      const span = along1 - along0;
      if (!(span > 1)) {
        measurements.push(FAILED(target.name, 'the outline had no measurable length'));
        return;
      }

      // Per-station min and max across the axis; their difference is the width.
      const lo = new Float32Array(PROFILE_STATIONS).fill(Infinity);
      const hi = new Float32Array(PROFILE_STATIONS).fill(-Infinity);
      for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
        if (!mask[y * mw + x]) continue;
        const dx = x - axis.cx, dy = y - axis.cy;
        const t = (dx * axis.ax + dy * axis.ay - along0) / span;
        const s = dx * px_ + dy * py_;
        const bin = Math.min(PROFILE_STATIONS - 1, Math.max(0, Math.floor(t * PROFILE_STATIONS)));
        if (s < lo[bin]) lo[bin] = s;
        if (s > hi[bin]) hi[bin] = s;
      }

      const profile = new Float32Array(PROFILE_STATIONS);
      for (let i = 0; i < PROFILE_STATIONS; i++) {
        profile[i] = hi[i] >= lo[i] ? (hi[i] - lo[i]) / span : 0;
      }
      if (!fillGaps(profile)) {
        measurements.push(FAILED(target.name, 'the outline had no measurable width'));
        return;
      }
      // A staircase in the profile becomes a ripple on the fitted mesh; two
      // passes round it off while leaving real shape changes intact.
      smoothProfile(profile, 2);

      // Grid units back to image pixels, then to a resolution-free fraction.
      const lengthPx = span * step;
      let widthSum = 0;
      for (let i = 0; i < PROFILE_STATIONS; i++) widthSum += profile[i];

      measurements.push({
        name: target.name,
        ok: true,
        reason: '',
        length: lengthPx / diagonal,
        width: ((widthSum / PROFILE_STATIONS) * lengthPx) / diagonal,
        profile,
        // The axis points down-image in grid space; report the lean off vertical.
        tilt: Math.atan2(axis.ax, Math.abs(axis.ay)),
        coverage: area / (mw * mh),
        threshold,
      });
    });

    if (!measurements.some((m) => m.ok)) {
      throw new Error(
        'No structure could be separated at this threshold. Try the Invert toggle, or move the Threshold slider.',
      );
    }

    post({
      ok: true,
      measurements,
      preview,
      previewWidth: pw,
      previewHeight: ph,
      ms: Math.round(performance.now() - started),
    }, [preview.buffer, ...measurements.map((m) => m.profile.buffer)]);
  } catch (error) {
    post({ ok: false, error: error instanceof Error ? error.message : 'Measurement failed.' });
  }
};
