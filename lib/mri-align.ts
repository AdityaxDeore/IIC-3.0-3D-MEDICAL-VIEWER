/**
 * Sizing and placement for the MRI/CT overlay plane.
 *
 * A scan frame is mostly empty background, so scaling the whole frame to a bone
 * always oversizes the anatomy. These two steps fix that:
 *   1. measureContent — find where the imaged tissue actually sits in the frame.
 *   2. fitToBone      — size that content box to the target bone, aspect intact.
 */
import type { RegionBox } from '@/lib/vista/atlas-regions';

/** Side length of the overlay's PlaneGeometry, in local units. */
export const PLANE = 1.5;

export interface ImageContent {
  /** Pixel width / height of the source frame. */
  aspect: number;
  /** Content box, normalised 0..1. `cy` is measured from the top edge. */
  cx: number;
  cy: number;
  cw: number;
  ch: number;
}

export interface PlaneFit {
  scaleX: number;
  scaleY: number;
  position: [number, number, number];
}

const whole = (aspect: number): ImageContent => ({ aspect, cx: 0.5, cy: 0.5, cw: 1, ch: 1 });

/** Longest edge the frame is sampled down to before measuring. */
const SAMPLE = 256;

/**
 * Locate the imaged anatomy inside a scan frame.
 *
 * Scan background is near-black, so a luminance threshold separates tissue from
 * air. Row and column projections then decide the box, which keeps burned-in
 * corner annotations and scanner speckle from dragging the bounds out to the
 * full frame. Falls back to the whole frame whenever the pixels can't be read.
 */
export function measureContent(image: HTMLImageElement | ImageBitmap | HTMLCanvasElement): ImageContent {
  const iw = (image as HTMLImageElement).naturalWidth || image.width;
  const ih = (image as HTMLImageElement).naturalHeight || image.height;
  if (!iw || !ih) return whole(1);
  const aspect = iw / ih;

  try {
    const factor = Math.min(1, SAMPLE / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * factor));
    const h = Math.max(1, Math.round(ih * factor));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return whole(aspect);
    ctx.drawImage(image as CanvasImageSource, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    const luma = new Uint8Array(w * h);
    let peak = 0;
    for (let i = 0, p = 0; p < data.length; p += 4, i++) {
      const v = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
      luma[i] = v;
      if (v > peak) peak = v;
    }
    // An essentially black frame has nothing to measure.
    if (peak < 8) return whole(aspect);
    const threshold = Math.max(10, peak * 0.14);

    const rows = new Uint32Array(h);
    const cols = new Uint32Array(w);
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) {
        if (luma[i] >= threshold) { rows[y]++; cols[x]++; }
      }
    }

    // A row/column only counts once ~2% of it is lit, so a line of overlay text
    // or a dusting of noise cannot widen the box on its own.
    const span = (projection: Uint32Array, needed: number): [number, number] | null => {
      const min = Math.max(1, Math.round(needed * 0.02));
      let lo = -1;
      let hi = -1;
      for (let i = 0; i < projection.length; i++) {
        if (projection[i] < min) continue;
        if (lo < 0) lo = i;
        hi = i;
      }
      return lo < 0 ? null : [lo, hi + 1];
    };

    const ys = span(rows, w);
    const xs = span(cols, h);
    if (!ys || !xs) return whole(aspect);

    return {
      aspect,
      cx: (xs[0] + xs[1]) / 2 / w,
      cy: (ys[0] + ys[1]) / 2 / h,
      cw: (xs[1] - xs[0]) / w,
      ch: (ys[1] - ys[0]) / h,
    };
  } catch {
    // No 2D context, or a tainted canvas.
    return whole(aspect);
  }
}

/**
 * Size and place the overlay plane so the imaged anatomy covers `box`.
 *
 * The plane keeps the frame's aspect ratio, so only one axis can be matched to
 * the bone. Matching the bone's own longest axis is what reads correctly: a
 * femur is judged along its length, a pelvis across its width.
 */
export function fitToBone(content: ImageContent, box: RegionBox): PlaneFit {
  const { aspect, cx, cy, cw, ch } = content;
  const boneW = box.max[0] - box.min[0];
  const boneH = box.max[1] - box.min[1];

  // Guard the divisors: a degenerate content box must not blow the plane up.
  const raw = boneH >= boneW
    ? boneH / (PLANE * Math.max(ch, 0.05))
    : boneW / (PLANE * aspect * Math.max(cw, 0.05));

  // Hard ceiling: a scan frame is never more than twice the bone it depicts, so
  // a bad content measurement can't produce a slab that dwarfs the whole body.
  const ceiling = (2 * Math.max(boneW, boneH)) / (PLANE * Math.max(1, aspect));
  const k = Math.min(Math.max(raw, 0.02), ceiling);

  // Offset the plane so the content centre lands on the bone, not the frame centre.
  const offsetX = (cx - 0.5) * PLANE * aspect * k;
  const offsetY = (0.5 - cy) * PLANE * k;

  return {
    scaleX: aspect * k,
    scaleY: k,
    // Sitting on the bone's own depth makes the plane slice through it.
    position: [box.center[0] - offsetX, box.center[1] - offsetY, box.center[2]],
  };
}
