/**
 * Validates the atlas-fitting reconstruction against the real atlas data.
 *
 * It covers the three failures the outline-inflation path had, using a
 * synthetic coronal scan of two thighs (two bright bones inside two darker
 * muscle envelopes) so the expected answer is known:
 *
 *   1. both legs are measured, not just the larger one;
 *   2. bone is separated from the muscle around it;
 *   3. the fitted mesh stays a proper solid - never thin, never rough.
 *
 * Run: node scripts/validate-atlas-fit.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;
const ok = (label, condition, detail = '') => {
  checks++;
  if (condition) { console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`); return true; }
  failures++;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
};

/** Bundle a TS module for node, resolving the @/ alias the app uses. */
async function load(entry, alias = {}, define = {}) {
  const result = await build({
    entryPoints: [join(root, entry)],
    bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22',
    alias: { '@': root, ...alias },
    define,
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

/**
 * Identification calls Gemini at module scope, so it is bundled against a stub
 * that replays a canned reply. That makes the parsing - which is where a
 * two-legged scan is kept from collapsing to one structure - testable offline.
 */
const GEMINI_STUB = join(root, 'scripts/fixtures/gemini-stub.ts');

// ---------------------------------------------------------------------------
// A synthetic coronal scan of two thighs.
// ---------------------------------------------------------------------------
const W = 320;
const H = 420;

/**
 * Each leg is a muscle envelope with a bone inside it. The right leg is drawn
 * deliberately larger than the left, which is exactly the case that made the
 * old whole-frame "largest component" step throw the smaller leg away.
 */
const LEGS = [
  { cx: 95, muscleHalf: 52, boneHalf: 15, name: 'Left femur' },
  { cx: 225, muscleHalf: 64, boneHalf: 19, name: 'Right femur' },
];
const BONE_TOP = 60;
const BONE_BOTTOM = 380;

function drawScan() {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let value = 12; // air
      for (const leg of LEGS) {
        const dx = Math.abs(x - leg.cx);
        if (y < 20 || y > H - 20 || dx > leg.muscleHalf) continue;
        value = 96; // muscle
        // A waist in the middle of the shaft, so the width profile is not flat
        // and the fit has something real to follow.
        const t = (y - BONE_TOP) / (BONE_BOTTOM - BONE_TOP);
        const taper = 1 - 0.35 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
        if (y >= BONE_TOP && y <= BONE_BOTTOM && dx <= leg.boneHalf * taper) value = 235; // bone
      }
      const p = (y * W + x) * 4;
      rgba[p] = rgba[p + 1] = rgba[p + 2] = value;
      rgba[p + 3] = 255;
    }
  }
  return rgba;
}

const scan = drawScan();
const roiFor = (leg) => [
  (leg.cx - leg.muscleHalf - 6) / W, 10 / H,
  (leg.cx + leg.muscleHalf + 6) / W, (H - 10) / H,
];

// ---------------------------------------------------------------------------
console.log('\nAtlas fit validation\n');

const segment = await load('lib/mri3d/segment.ts');
const morph = await load('lib/mri3d/atlas-morph.ts');
const parts = await load('lib/mri3d/atlas-parts.ts');
const { PROFILE_STATIONS } = await load('lib/mri3d/measurements.ts');

const atlas = JSON.parse(readFileSync(join(root, 'public/models/atlas.json'), 'utf8'));

// --- 1. every named structure resolves to the right atlas mesh -------------
console.log('Atlas matching');
{
  const left = parts.matchParts(atlas, 'Left femur', 'left');
  const right = parts.matchParts(atlas, 'Right femur', 'right');
  ok('"Left femur" resolves to exactly one mesh', left.length === 1, left.map((p) => p.name).join(', '));
  ok('it is the left one', left[0]?.name === 'Left femur', left[0]?.name);
  ok('"Right femur" resolves to the right one', right.length === 1 && right[0].name === 'Right femur', right[0]?.name);
  ok('the two sides are different meshes', left[0]?.id !== right[0]?.id, `${left[0]?.id} vs ${right[0]?.id}`);

  // An unsided name must not silently pick a side.
  const both = parts.matchParts(atlas, 'femur', null);
  ok('"femur" with no side returns both', both.length === 2, both.map((p) => p.name).join(', '));

  // The side asked for wins over the side written in the name.
  const overridden = parts.matchParts(atlas, 'Left femur', 'right');
  ok('an explicit side overrides the name', overridden[0]?.name === 'Right femur', overridden[0]?.name);

  const muscle = parts.matchParts(atlas, 'Left vastus lateralis', 'left');
  ok('a muscle resolves too', muscle[0]?.name === 'Left vastus lateralis', muscle[0]?.name);

  const group = parts.matchParts(atlas, 'Left quadriceps', 'left');
  ok('a group name resolves to its members', group.length === 4,
    group.map((p) => p.name.replace('Left ', '')).join(', '));
  ok('the group is all left-sided', group.every((p) => p.name.startsWith('Left ')));

  const nonsense = parts.matchParts(atlas, 'Titanium plate', null);
  ok('an implant matches nothing', nonsense.length === 0,
    nonsense.map((p) => p.name).join(', ') || '0 matches');

  // Radiology wording for the same bone must land on the same mesh.
  for (const wording of ['Left femoral shaft', 'Left femoral diaphysis', 'Left femur bone', 'left mid femur']) {
    const hit = parts.matchParts(atlas, wording, null);
    ok(`"${wording}" resolves to the left femur`,
      hit.length === 1 && hit[0].name === 'Left femur',
      hit.map((p) => p.name).join(', ') || 'no match');
  }

  // ...but a different structure that shares a word must not.
  const artery = parts.matchParts(atlas, 'Left femoral artery', 'left');
  ok('"Left femoral artery" stays an artery',
    artery.length === 1 && artery[0].name === 'Left femoral artery',
    artery.map((p) => p.name).join(', ') || 'no match');

  const sibling = parts.matchParts(atlas, 'Left vastus lateralis', 'left');
  ok('a muscle does not spill onto its neighbours',
    sibling.length === 1 && sibling[0].name === 'Left vastus lateralis',
    sibling.map((p) => p.name).join(', '));

  const ribs = parts.matchParts(atlas, 'Left ribs', 'left');
  ok('"Left ribs" resolves to the left rib meshes',
    ribs.length >= 10 && ribs.every((p) => /rib$/i.test(p.name) && p.name.startsWith('Left ')),
    `${ribs.length} meshes`);

  const vertebra = parts.matchParts(atlas, 'First lumbar vertebra', null);
  ok('a named vertebra resolves to exactly itself',
    vertebra.length === 1 && vertebra[0].name === 'First lumbar vertebra',
    vertebra.map((p) => p.name).join(', ') || 'no match');

  // The old scene.tsx femur lookup used the FMA id against `part.id`; it must
  // be the conceptId, and this is the check that would have caught it.
  ok('FMA24475 is a conceptId, not a part id',
    atlas.parts.some((p) => p.conceptId === 'FMA24475') && !atlas.parts.some((p) => p.id === 'FMA24475'));
}

// --- 2. measurement: both legs, bone not muscle ---------------------------
console.log('\nMeasuring the slice');
const measured = [];
{
  // The worker's own measuring steps, run inline: same segment.ts primitives,
  // same order, so what is checked here is what the worker does.
  for (const leg of LEGS) {
    const roi = roiFor(leg);
    const crop = {
      x0: Math.floor(roi[0] * W), y0: Math.floor(roi[1] * H),
      x1: Math.ceil(roi[2] * W), y1: Math.ceil(roi[3] * H),
    };
    const { gray, w, h, step } = segment.grayCrop(scan, W, crop, 384);

    // Two-level Otsu, as chooseThreshold does for bone.
    const first = segment.otsu(gray);
    const half = new Uint8Array(gray.length);
    let n = 0;
    for (let i = 0; i < gray.length; i++) { half[i] = gray[i] >= first ? 1 : 0; n += half[i]; }
    const second = n > 200 ? segment.otsu(gray, half) : first;
    const threshold = second > first ? second : first;

    const mask = new Uint8Array(w * h);
    for (let i = 0; i < gray.length; i++) mask[i] = gray[i] >= threshold ? 1 : 0;
    const area = segment.largestComponent(mask, w, h);

    // Width of the mask at mid-height, in source pixels.
    let widest = 0;
    for (let y = 0; y < h; y++) {
      let lo = -1, hi = -1;
      for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (lo < 0) lo = x; hi = x; }
      if (lo >= 0) widest = Math.max(widest, (hi - lo + 1) * step);
    }
    measured.push({ leg, threshold, first, area, widest, w, h, step });
  }

  for (const m of measured) {
    const boneWidth = m.leg.boneHalf * 2;
    const muscleWidth = m.leg.muscleHalf * 2;
    ok(`${m.leg.name}: something was segmented`, m.area > 24, `${m.area} cells`);
    // The muscle sits at 96 and the bone at 235: a single Otsu cut lands
    // between air and tissue and would keep the muscle too.
    ok(`${m.leg.name}: the second threshold is above the first`,
      m.threshold > m.first, `${m.first} -> ${m.threshold}`);
    ok(`${m.leg.name}: bone was kept, muscle was not`,
      m.widest <= boneWidth * 1.35 && m.widest < muscleWidth * 0.6,
      `mask ${m.widest}px vs bone ${boneWidth}px, muscle ${muscleWidth}px`);
  }
  ok('both legs were measured independently', measured.length === 2);
  ok('the smaller leg survived alongside the larger one',
    measured[0].area > 24 && measured[1].area > 24,
    `${measured[0].area} and ${measured[1].area} cells`);
}

// --- 3. fitting the real femur meshes ------------------------------------
console.log('\nFitting the reference meshes');
{
  const femurs = ['Left femur', 'Right femur'].map((name) => {
    const part = atlas.parts.find((p) => p.name === name);
    const buffer = readFileSync(join(root, `public/models/body-${part.chunk}.bin`));
    const view = new Uint8Array(buffer).buffer.slice(
      buffer.byteOffset, buffer.byteOffset + buffer.byteLength,
    );
    return {
      part,
      positions: new Float32Array(view, part.positions, part.vertexCount * 3).slice(),
      indices: new Uint32Array(view, part.indices, part.indexCount).slice(),
    };
  });

  for (const femur of femurs) {
    ok(`${femur.part.name}: geometry loaded from the chunk`,
      femur.positions.length === femur.part.vertexCount * 3 && femur.indices.length === femur.part.indexCount,
      `${femur.part.vertexCount} vertices, ${femur.indices.length / 3} triangles`);
  }

  const extent = (positions) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (positions[i + k] < min[k]) min[k] = positions[i + k];
        if (positions[i + k] > max[k]) max[k] = positions[i + k];
      }
    }
    return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  };

  // A measurement taken from the synthetic scan: a shaft with a waist.
  const profile = new Float32Array(PROFILE_STATIONS);
  for (let i = 0; i < PROFILE_STATIONS; i++) {
    const t = i / (PROFILE_STATIONS - 1);
    profile[i] = 0.1 * (1 - 0.35 * Math.sin(Math.PI * t));
  }
  const measurement = {
    name: 'Left femur', ok: true, reason: '', length: 0.6, width: 0.06,
    profile, tilt: 0, coverage: 0.2, threshold: 180,
  };

  const before = femurs.map((f) => extent(f.positions));
  const fitted = femurs.map((f) => ({
    name: f.part.name,
    positions: f.positions.slice(),
    indices: f.indices,
    color: [0.886, 0.851, 0.729],
  }));
  const reports = fitted.map((f) => morph.morphToMeasurement(f.positions, measurement, 1));

  reports.forEach((report, i) => {
    ok(`${femurs[i].part.name}: the mesh actually moved`, report.meanChange > 0.5,
      `${report.meanChange.toFixed(1)}% mean`);
    // The whole point of the clamps: no measurement can flatten the bone.
    ok(`${femurs[i].part.name}: no vertex moved absurdly`, report.maxChange < 60,
      `${report.maxChange.toFixed(1)}% peak`);
  });

  const after = fitted.map((f) => extent(f.positions));
  after.forEach((span, i) => {
    // The long axis is untouched by the radial fit, so the bone cannot be
    // stretched into a stick or squashed into a puck.
    const longBefore = Math.max(...before[i]);
    const longAfter = Math.max(...after[i]);
    ok(`${femurs[i].part.name}: length unchanged`, Math.abs(longAfter - longBefore) < 1e-5,
      `${longBefore.toFixed(4)} -> ${longAfter.toFixed(4)}`);

    // Thinness was the visible symptom. Compare the two cross-axes against the
    // long axis and against each other.
    const cross = [before[i], after[i]].map((s) => s.filter((v) => v !== Math.max(...s)));
    const slendernessBefore = Math.min(...cross[0]) / longBefore;
    const slendernessAfter = Math.min(...cross[1]) / longAfter;
    ok(`${femurs[i].part.name}: still a solid, not a wafer`,
      slendernessAfter > slendernessBefore * 0.7 && slendernessAfter > 0.04,
      `narrowest/longest ${slendernessBefore.toFixed(3)} -> ${slendernessAfter.toFixed(3)}`);
  });

  // --- strength 0 must be a no-op --------------------------------------
  const untouched = femurs[0].positions.slice();
  const zeroReport = morph.morphToMeasurement(untouched, measurement, 0);
  ok('strength 0 leaves the reference mesh alone',
    zeroReport.maxChange === 0 && untouched.every((v, i) => v === femurs[0].positions[i]));

  // --- a failed measurement must not deform anything -------------------
  const unmeasured = femurs[0].positions.slice();
  const failReport = morph.morphToMeasurement(
    unmeasured, { ...measurement, ok: false, reason: 'nothing separated' }, 1,
  );
  ok('an unmeasured structure keeps the reference mesh exactly',
    failReport.maxChange === 0 && unmeasured.every((v, i) => v === femurs[0].positions[i]));

  // --- merging both legs -----------------------------------------------
  const merged = morph.mergeFitted(fitted);
  ok('both femurs merged into one geometry', !!merged && merged.ranges.length === 2,
    merged?.ranges.map((r) => `${r.name}:${r.count}`).join(', '));
  ok('the merged triangle count is the sum of the parts',
    merged.indices.length === femurs[0].indices.length + femurs[1].indices.length,
    `${merged.indices.length / 3} triangles`);
  ok('every index is in range',
    merged.indices.every((v) => v < merged.positions.length / 3));
  ok('normals are unit length',
    (() => {
      for (let i = 0; i < merged.normals.length; i += 3) {
        const len = Math.hypot(merged.normals[i], merged.normals[i + 1], merged.normals[i + 2]);
        if (Math.abs(len - 1) > 0.01) return false;
      }
      return true;
    })());
  ok('a colour was written for every vertex',
    merged.colors.length === merged.positions.length &&
    merged.colors.every((v) => v > 0 && v <= 1));

  const mergedSpan = extent(merged.positions);
  ok('normalised: longest axis is 1', Math.abs(Math.max(...mergedSpan) - 1) < 1e-4,
    mergedSpan.map((v) => v.toFixed(3)).join(' x '));
  let minY = Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < merged.positions.length; i += 3) {
    if (merged.positions[i + 1] < minY) minY = merged.positions[i + 1];
    if (merged.positions[i] < minX) minX = merged.positions[i];
    if (merged.positions[i] > maxX) maxX = merged.positions[i];
  }
  ok('normalised: rests on Y = 0', Math.abs(minY) < 1e-4, minY.toFixed(6));
  ok('normalised: centred in X', Math.abs(minX + maxX) < 1e-4, `${minX.toFixed(4)} .. ${maxX.toFixed(4)}`);

  // Two legs side by side means the merged result is genuinely wider than one.
  const oneLeg = morph.mergeFitted([fitted[0]]);
  const oneSpan = extent(oneLeg.positions);
  ok('two legs are wider than one', mergedSpan[0] > oneSpan[0] * 1.5,
    `${mergedSpan[0].toFixed(3)} vs ${oneSpan[0].toFixed(3)}`);
}

// --- 4. the fit follows the profile it was given --------------------------
console.log('\nFit factors');
{
  const flat = new Float32Array(PROFILE_STATIONS).fill(0.1);
  const waisted = new Float32Array(PROFILE_STATIONS);
  for (let i = 0; i < PROFILE_STATIONS; i++) {
    waisted[i] = 0.1 * (1 - 0.3 * Math.sin((Math.PI * i) / (PROFILE_STATIONS - 1)));
  }
  const make = (profile) => ({
    name: 'x', ok: true, reason: '', length: 1, width: 0.1,
    profile, tilt: 0, coverage: 0.2, threshold: 128,
  });

  const identical = morph.fitFactors(flat, make(flat), 1);
  ok('a matching profile changes nothing',
    identical.every((f) => Math.abs(f - 1) < 1e-5),
    `max deviation ${Math.max(...[...identical].map((f) => Math.abs(f - 1))).toFixed(6)}`);

  // A waisted scan against a flat mesh must narrow the middle, widen the ends.
  const narrowed = morph.fitFactors(flat, make(waisted), 1);
  const mid = narrowed[PROFILE_STATIONS >> 1];
  const quarter = narrowed[PROFILE_STATIONS >> 2];
  ok('a waisted scan narrows the middle', mid < 0.98, `mid factor ${mid.toFixed(3)}`);
  ok('and the middle is narrower than the quarter point', mid < quarter,
    `${mid.toFixed(3)} < ${quarter.toFixed(3)}`);

  // Every clamp holds, however extreme the measurement.
  const absurd = new Float32Array(PROFILE_STATIONS).fill(0.0001);
  const squashed = morph.fitFactors(flat, make(absurd), 1);
  ok('an absurdly thin measurement is clamped', squashed.every((f) => f > 0.5 && f < 1.5),
    `range ${Math.min(...squashed).toFixed(3)} .. ${Math.max(...squashed).toFixed(3)}`);

  const huge = new Float32Array(PROFILE_STATIONS).fill(90);
  const bloated = morph.fitFactors(flat, make(huge), 1);
  ok('an absurdly wide measurement is clamped', bloated.every((f) => f > 0.5 && f < 1.6),
    `range ${Math.min(...bloated).toFixed(3)} .. ${Math.max(...bloated).toFixed(3)}`);

  // A zeroed profile is the "nothing was measured" shape; it must not deform.
  const empty = new Float32Array(PROFILE_STATIONS);
  const untouched = morph.fitFactors(flat, make(empty), 1);
  ok('an empty profile changes nothing', untouched.every((f) => f === 1));

  // Smoothness: neighbouring stations must not jump, or the mesh gets ridges.
  let worstStep = 0;
  for (let i = 1; i < narrowed.length; i++) worstStep = Math.max(worstStep, Math.abs(narrowed[i] - narrowed[i - 1]));
  ok('the factors vary smoothly station to station', worstStep < 0.05,
    `largest step ${worstStep.toFixed(4)}`);
}

// --- 5. identification keeps every structure apart -----------------------
console.log('\nIdentification');
{
  // The stub is bundled into the module, so its queue is re-exported to let
  // the harness reach it. Bundling once and re-queueing per case is enough:
  // identification holds no state between calls.
  const bundled = await build({
    entryPoints: [join(root, 'lib/mri3d/identify.ts')],
    bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22',
    alias: { '@/lib/gemini': GEMINI_STUB, '@': root },
    logLevel: 'silent',
    footer: { js: 'export { queue as __queue, errorQueue as __errors, GeminiError as __GeminiError };' },
  });
  const identify = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
  );
  const run = (reply) => {
    identify.__queue.length = 0;
    identify.__errors.length = 0;
    identify.__queue.push(reply);
    return identify.identifySlice('data:image/png;base64,');
  };
  /** Drive identification into a client failure of a given shape. */
  const runError = (status, message, quota, retryAfter) => {
    identify.__queue.length = 0;
    identify.__errors.length = 0;
    identify.__errors.push(new identify.__GeminiError(message, status, quota, retryAfter));
    return identify.identifySlice('data:image/png;base64,');
  };

  // The reported case: a scan of both thighs.
  const both = await run(JSON.stringify({
    structures: [
      { name: 'Left femur', category: 'bone', appears: 'bright', box: [0.2, 0.1, 0.35, 0.95] },
      { name: 'Right femur', category: 'bone', appears: 'bright', box: [0.62, 0.1, 0.78, 0.95] },
      { name: 'Left vastus lateralis', category: 'other', appears: 'dark', box: [0.1, 0.2, 0.3, 0.9] },
    ],
    findings: ['Cortical irregularity of the left femoral neck'],
  }));
  ok('all three structures survive parsing', both.structures.length === 3,
    both.structures.map((s) => s.name).join(', '));
  ok('the two femurs keep different boxes',
    both.structures[0].roi[0] !== both.structures[1].roi[0]);
  ok('sides are read off the names',
    both.structures[0].side === 'left' && both.structures[1].side === 'right');
  ok('the muscle is not classed as bone', both.structures[2].category === 'other');
  ok('findings come through', both.findings.length === 1);

  // A model that lists the same bone twice must not produce it twice.
  const duplicated = await run(JSON.stringify({
    structures: [
      { name: 'Left femur', category: 'bone', appears: 'bright', box: [0.2, 0.1, 0.35, 0.95] },
      { name: 'Left femur', category: 'bone', appears: 'bright', box: [0.21, 0.11, 0.34, 0.94] },
    ],
  }));
  ok('a repeated structure is collapsed', duplicated.structures.length === 1,
    `${duplicated.structures.length} kept`);

  // Two entries on the same side sitting on the same box are one call twice.
  const overlapping = await run(JSON.stringify({
    structures: [
      { name: 'Left femur', category: 'bone', appears: 'bright', box: [0.2, 0.1, 0.35, 0.95] },
      { name: 'Left femoral shaft', category: 'bone', appears: 'bright', box: [0.2, 0.1, 0.35, 0.95] },
    ],
  }));
  ok('two names for one box are collapsed', overlapping.structures.length === 1,
    overlapping.structures.map((s) => s.name).join(', '));

  // A muscle mislabelled "bone" must not be fitted with a bone.
  const mislabelled = await run(JSON.stringify({
    structures: [{ name: 'Left gluteus medius', category: 'bone', appears: 'dark', box: [0.3, 0.2, 0.6, 0.7] }],
  }));
  ok('a muscle called "bone" is corrected', mislabelled.structures[0].category === 'other',
    mislabelled.structures[0].category);

  // One structure may fill the frame; several may not.
  const lone = await run(JSON.stringify({
    structures: [{ name: 'Left femur', category: 'bone', appears: 'bright', box: [0, 0, 1, 1] }],
  }));
  ok('a lone structure may fill the frame', lone.structures.length === 1);

  const boxless = await run(JSON.stringify({
    structures: [
      { name: 'Left femur', category: 'bone', appears: 'bright', box: [0.2, 0.1, 0.35, 0.95] },
      { name: 'Soft tissue', category: 'other', appears: 'dark', box: [0, 0, 1, 1] },
    ],
  }));
  ok('a whole-frame box among several is dropped', boxless.structures.length === 1,
    boxless.structures.map((s) => s.name).join(', '));

  // Percent-scale boxes are common; they must be rescaled, not rejected.
  const percent = await run(JSON.stringify({
    structures: [
      { name: 'Left femur', category: 'bone', appears: 'bright', box: [20, 10, 35, 95] },
      { name: 'Right femur', category: 'bone', appears: 'bright', box: [62, 10, 78, 95] },
    ],
  }));
  ok('percent-scale boxes are rescaled', percent.structures.length === 2 &&
    percent.structures.every((s) => s.roi.every((v) => v >= 0 && v <= 1)),
    percent.structures.map((s) => s.roi.map((v) => v.toFixed(2)).join(',')).join(' | '));

  // Garbage must fall back rather than throw - and must not invent a structure.
  const broken = await run('I am not JSON at all');
  ok('an unparseable reply falls back', !broken.identified, broken.failure?.message ?? '');
  ok('the fallback invents no structure', broken.structures.length === 0,
    `${broken.structures.length} structures`);
  ok('the fallback records why', !!broken.failure && broken.failure.kind === 'other',
    broken.failure?.kind);

  // The reported case: the free-tier quota is spent. It must be told apart
  // from a passing burst, because only one of the two is worth retrying.
  const quota = await runError(
    429,
    'Gemini request failed (429): You exceeded your current quota, please check your plan and billing details.',
    true,
    42.628158855,
  );
  ok('an exhausted quota is classified as quota', quota.failure?.kind === 'quota', quota.failure?.kind);
  ok('a quota failure names no structure', quota.structures.length === 0);
  ok('the retry delay is carried through', quota.failure?.retryAfter > 42, `${quota.failure?.retryAfter}s`);

  const burst = await runError(429, 'Gemini request failed (429): too many requests', false, 1.5);
  ok('a passing burst is classified as a rate limit', burst.failure?.kind === 'rate', burst.failure?.kind);

  const unkeyed = await run('');
  void unkeyed;
  const keyless = await identify.identifySlice('data:image/png;base64,')
    .catch(() => null);
  ok('a missing reply still yields a failure, never a throw',
    keyless !== null && keyless.identified === false, keyless?.failure?.kind);
}

// --- 7. naming structures by hand, with no model call --------------------
console.log('\nManual naming');
{
  const identify = await load('lib/mri3d/identify.ts', { '@/lib/gemini': GEMINI_STUB });

  const both = identify.manualIdentification(['Left femur', 'Right femur'], 'bright', false);
  ok('both femurs are accepted', both.structures.length === 2,
    both.structures.map((s) => s.name).join(', '));
  ok('it is flagged as manual', both.manual === true && both.identified === true);
  ok('no model failure is recorded', both.failure === null);
  ok('categories come from the names', both.structures.every((s) => s.category === 'bone'));
  ok('polarity is taken from the caller', both.structures.every((s) => s.appears === 'bright'));

  // Radiological convention: the patient's left is on the viewer's right.
  const [leftStructure, rightStructure] = both.structures;
  ok('a left structure is looked for on the image right', leftStructure.roi[0] > 0.4,
    `x from ${leftStructure.roi[0]}`);
  ok('a right structure is looked for on the image left', rightStructure.roi[2] < 0.6,
    `x to ${rightStructure.roi[2]}`);
  ok('the two halves overlap slightly at the midline',
    leftStructure.roi[0] < rightStructure.roi[2],
    `${leftStructure.roi[0]} < ${rightStructure.roi[2]}`);
  ok('together they cover the frame',
    leftStructure.roi[2] === 1 && rightStructure.roi[0] === 0);

  const flipped = identify.manualIdentification(['Left femur'], 'bright', true);
  ok('mirrored swaps which half is searched', flipped.structures[0].roi[2] < 0.6,
    `x to ${flipped.structures[0].roi[2]}`);

  const unsided = identify.manualIdentification(['Sacrum'], 'dark', false);
  ok('an unsided structure searches the whole frame',
    unsided.structures[0].roi.join(',') === '0,0,1,1', unsided.structures[0].roi.join(','));
  ok('dark polarity is carried through', unsided.structures[0].appears === 'dark');

  const deduped = identify.manualIdentification(['Left femur', 'left femur', ' '], 'bright', false);
  ok('duplicates and blanks are dropped', deduped.structures.length === 1,
    `${deduped.structures.length} kept`);

  const none = identify.manualIdentification([], 'bright', false);
  ok('naming nothing identifies nothing', none.structures.length === 0 && none.identified === false);

  // Every manual name must reach a real mesh, or the picker offers dead ends.
  const quickPicks = [
    'Left femur', 'Right femur', 'Left tibia', 'Right tibia',
    'Left patella', 'Right patella', 'Left hip bone', 'Right hip bone', 'Sacrum',
  ];
  for (const name of quickPicks) {
    const manual = identify.manualIdentification([name], 'bright', false);
    const hit = parts.matchParts(atlas, name, manual.structures[0].side);
    ok(`the "${name}" quick pick resolves`, hit.length >= 1 && hit[0].name === name,
      hit.map((p) => p.name).join(', ') || 'no match');
  }
}

// --- 8. a failed Gemini call is classified, not guessed ------------------
console.log('\nGemini failure handling');
{
  // Vite replaces import.meta.env at build time; node has no such object, so
  // it is injected here the same way the app's build does.
  const gemini = await load('lib/gemini.ts', {}, {
    'import.meta.env': JSON.stringify({ VITE_GEMINI_API_KEY: 'test-key' }),
  });

  // The real body Google returns when the free tier is spent.
  const quotaBody = JSON.stringify({
    error: {
      code: 429,
      message: 'You exceeded your current quota, please check your plan and billing details.',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generate_content_free_tier_requests' }] },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '42.628158855s' },
      ],
    },
  });

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(quotaBody, { status: 429 });
  };
  let caught;
  try {
    await gemini.analyzeImageWithGemini('data:image/png;base64,AAAA', 'prompt');
  } catch (error) {
    caught = error;
  }
  globalThis.fetch = originalFetch;

  ok('a 429 raises a GeminiError', caught?.name === 'GeminiError',
    `${caught?.name}: ${caught?.message}`);
  ok('an exhausted quota is marked as such', caught?.quota === true);
  ok('the status is kept', caught?.status === 429, String(caught?.status));
  ok("Google's own retry delay is read", Math.abs(caught?.retryAfter - 42.628158855) < 1e-6,
    `${caught?.retryAfter}s`);
  // 42s is far longer than any inline wait, so it must give up at once rather
  // than sleeping through three attempts.
  ok('a long delay is not waited out', calls === 1, `${calls} request(s)`);
  ok('the message reaches the user intact', /exceeded your current quota/.test(caught?.message ?? ''));

  // A short delay, by contrast, should be waited out and retried.
  const shortBody = JSON.stringify({
    error: { code: 429, message: 'too many requests', details: [{ retryDelay: '0.05s' }] },
  });
  let shortCalls = 0;
  globalThis.fetch = async () => {
    shortCalls++;
    if (shortCalls < 2) return new Response(shortBody, { status: 429 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 });
  };
  const recovered = await gemini.analyzeImageWithGemini('data:image/png;base64,AAAA', 'prompt');
  globalThis.fetch = originalFetch;
  ok('a short delay is waited out and retried', recovered === 'ok' && shortCalls === 2,
    `${shortCalls} request(s), got ${JSON.stringify(recovered)}`);
}

// --- 6. the measuring worker, end to end ---------------------------------
console.log('\nMeasuring worker (end to end)');
{
  const posted = [];
  globalThis.self = { postMessage: (m) => posted.push(m) };
  globalThis.performance ??= { now: () => Date.now() };
  await load('lib/mri3d/slice-measure.worker.ts');
  const handler = globalThis.self.onmessage;
  ok('the worker installed a handler', typeof handler === 'function');

  const pixels = scan.slice().buffer;
  handler({
    data: {
      pixels,
      width: W,
      height: H,
      targets: LEGS.map((leg) => ({ name: leg.name, roi: roiFor(leg), invert: false, bone: true })),
      bias: 0,
      detail: 384,
    },
  });

  const result = posted.find((m) => m.ok === true);
  ok('the worker produced a result', !!result, result ? `${result.ms} ms` : 'none');
  ok('it measured both legs', result?.measurements.length === 2,
    result?.measurements.map((m) => `${m.name}:${m.ok ? 'ok' : m.reason}`).join(', '));
  ok('both measurements succeeded', result?.measurements.every((m) => m.ok));

  const [left, right] = result.measurements;
  ok('both bones are near-vertical', Math.abs(left.tilt) < 0.1 && Math.abs(right.tilt) < 0.1,
    `${left.tilt.toFixed(3)}, ${right.tilt.toFixed(3)} rad`);
  ok('both have the same length', Math.abs(left.length - right.length) < 0.02,
    `${left.length.toFixed(3)} vs ${right.length.toFixed(3)}`);
  // The right leg's bone was drawn wider; the measurement must see that.
  ok('the wider bone measures wider', right.width > left.width * 1.1,
    `${left.width.toFixed(4)} vs ${right.width.toFixed(4)}`);

  // The drawn waist must show up as a dip in the middle of the profile.
  for (const m of result.measurements) {
    const mid = m.profile[PROFILE_STATIONS >> 1];
    const near = m.profile[3];
    ok(`${m.name}: the drawn waist is in the profile`, mid < near * 0.85,
      `mid ${mid.toFixed(4)} vs end ${near.toFixed(4)}`);
    ok(`${m.name}: no station was left empty`, m.profile.every((v) => v > 0));
  }
  ok('a preview was returned', result.previewWidth > 0 && result.previewHeight > 0 &&
    result.preview.length === result.previewWidth * result.previewHeight * 4,
    `${result.previewWidth}x${result.previewHeight}`);

  // Progress must be reported, and only ever forward.
  const progress = posted.filter((m) => m.ok === false && typeof m.percent === 'number');
  ok('progress was reported', progress.length >= 2, `${progress.length} updates`);
  ok('progress never goes backwards',
    progress.every((m, i) => i === 0 || m.percent >= progress[i - 1].percent));

  // An ROI over empty air must fail that structure alone, not the whole run.
  // The gap between the two legs (x 148..160) is air at every row.
  posted.length = 0;
  handler({
    data: {
      pixels: scan.slice().buffer,
      width: W,
      height: H,
      targets: [
        { name: 'Left femur', roi: roiFor(LEGS[0]), invert: false, bone: true },
        { name: 'Nothing', roi: [149 / W, 0.3, 160 / W, 0.6], invert: false, bone: true },
      ],
      bias: 0,
      detail: 384,
    },
  });
  const partial = posted.find((m) => m.ok === true);
  ok('one bad ROI does not fail the whole slice', !!partial);
  ok('the good structure still measured', partial?.measurements[0].ok === true);
  ok('the empty one is reported as failed with a reason',
    partial?.measurements[1].ok === false && !!partial.measurements[1].reason,
    partial?.measurements[1].reason);
}

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
