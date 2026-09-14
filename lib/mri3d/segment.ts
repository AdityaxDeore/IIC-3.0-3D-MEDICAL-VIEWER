/**
 * In-plane segmentation primitives shared by the two reconstruction paths
 * (free-form inflation and atlas fitting). Extracted verbatim from
 * slice-mesh.worker.ts so both can use them; the behaviour is unchanged.
 */

/** Otsu's method: the threshold that best splits the histogram in two. */
export function otsu(gray: Float32Array, only?: Uint8Array): number {
  const hist = new Float64Array(256);
  let total = 0;
  for (let i = 0; i < gray.length; i++) {
    if (only && only[i] === 0) continue;
    hist[Math.min(255, Math.max(0, Math.round(gray[i])))]++;
    total++;
  }
  if (total === 0) return 128;
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
export function largestComponent(mask: Uint8Array, w: number, h: number): number {
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
export function majorityFilter(mask: Uint8Array, w: number, h: number) {
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
export function fillHoles(mask: Uint8Array, w: number, h: number) {
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
 * Box-filter a grayscale crop of an RGBA frame down to a detail budget.
 * Averaging every source pixel in the cell (not point-sampling one of them)
 * keeps the outline from being pre-aliased into a staircase before it is ever
 * segmented.
 */
export function grayCrop(
  rgba: Uint8ClampedArray,
  width: number,
  crop: { x0: number; y0: number; x1: number; y1: number },
  detail: number,
): { gray: Float32Array; w: number; h: number; step: number } {
  const cw = crop.x1 - crop.x0;
  const ch = crop.y1 - crop.y0;
  const step = Math.max(1, Math.ceil(Math.max(cw, ch) / Math.max(64, detail)));
  const w = Math.max(4, Math.floor(cw / step));
  const h = Math.max(4, Math.floor(ch / step));

  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const syA = crop.y0 + y * step;
    const syB = Math.min(crop.y1, syA + step);
    for (let x = 0; x < w; x++) {
      const sxA = crop.x0 + x * step;
      const sxB = Math.min(crop.x1, sxA + step);
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
      gray[y * w + x] = cnt ? acc / cnt : 0;
    }
  }
  return { gray, w, h, step };
}
