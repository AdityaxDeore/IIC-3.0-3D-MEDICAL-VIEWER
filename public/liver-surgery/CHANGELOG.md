# Changelog

All notable changes to the deployed simulator, newest first.
The version number shown in the app's corner is the `vNNN` here.

Frozen snapshots ([paper-benchmark-v1](paper-benchmark-v1/) = v286,
[paper-volume-v1](paper-volume-v1/) = v311, [demo-tutorial-v1](demo-tutorial-v1/) = v317)
never change; this log tracks the live root only.

---

## v321 — 2026-08-23

- Fixed the Quest 3 browser opening the touch layout. The desktop/touch choice
  reads the pointer capabilities the browser reports, and Meta Browser now
  matches `(pointer: coarse)` with no `(any-pointer: fine)` — the signature of a
  phone. The visible symptom was that OBJ Drop, Firebase and the VR/AR buttons
  disappeared: the touch layout folds them into the collapsed panel in the
  top-left corner, while the landscape rule still restored the desktop side
  panel, so the page looked almost normal with those three controls missing.
  A headset is now identified from the user agent and always gets the desktop
  layout. (v316 had already made the same correction for the VR button alone.)
- `?ui=desktop` / `?ui=mobile` forces the layout on any build, including the
  frozen snapshots, which cannot be changed. README documents this.
- Documentation: the Quest OBJ loading instructions said to drag the ZIP onto
  the page. Every recorded Quest benchmark run used the file picker instead, so
  the instructions now say to click the OBJ Drop area and pick the ZIP. Added a
  note about ZIP files copied over USB staying invisible to the picker until
  the headset is rebooted or the MediaStore entry is scanned.

## v320 — 2026-08-15

- Fixed the whole mesh shifting sideways after a cut (and snapping back on
  undo): the bbox-based smoothing size adjustment rescaled around a center
  that jumps when a cut changes the surface bounding box. The adjustment is
  now disabled.
- Follow-up (same day): default liver substeps returned to 3 — the value 7
  introduced in v318 cost too much frame rate at the HIGH preset. The stiffer
  desktop-equivalent setting remains available from the Substeps slider
  (range now 1–20).

## v319 — 2026-08-15

- Fixed intermittent spikes on the unanchored portal trunk: a fast liver
  motion concentrates displacement into the few free vessel vertices, and a
  single constraint projection could overshoot. Each projection's vertex
  displacement is now clamped to half the constraint's rest length
  (kill-switchable, tunable from the dev panel).

## v318 — 2026-08-15

- **Cutting a vessel now physically severs it.** Previously a cut child organ
  (portal/hepatic vein) only looked separated; its physics constraints still
  spanned the cut, so the pieces stayed tethered. Child cuts now invalidate
  the child's low-res physics too, and undo restores it.
- Physics/performance port from the GPU research branch: cut-aware constraint
  caches, a tet→edge table replacing five hash-set rebuilds, faster mesh
  parsing and surface mapping — cuts, undos, and startup are all faster.
- Child organ motion now matches the desktop reference: XPBD plus weak shape
  matching for vessels (rigid follow of the liver), XPBD only for tumor and
  gallbladder.
- Liver solver substeps raised 3 → 7 on desktop, matching the desktop build's
  effective stiffness (mobile and low-power GPUs keep 3 for frame rate).
- New developer tuning panel behind `?dev=1` (hidden otherwise): per-organ
  solver iterations, shape-matching blend/velKill, liver substeps, spike
  clamp, with live anchored/free counts and presets.

## v317 — 2026-08-09

- Interactive tutorial shipped on the live site: five lessons (Deform, Cut,
  Select & Cut, Display & Organs, Camera & Controls) with real screenshots.
  Opens from the **🎓 Tutorial** pill (bottom-right); `?tut=1` / `?tut=0`
  overrides; disabled entirely under `?bench` so it cannot interfere with
  benchmark runs.
- Two remaining Japanese UI strings translated to English (AR reticle hint,
  VR button tooltip).

## v316 — 2026-06-07

- Fixed the VR button greying out on Quest 3: a Meta Browser update made the
  headset report touch capability, which tripped the "touch devices get no VR"
  guard from v300. The guard now excludes Quest devices.

## v315 — 2026-05-26

- Fixed fragment-preview colors not updating when a liver is loaded without a
  portal vein: the highlight draw path required skeleton analysis even for
  plain liver fragment selection. (JS-side fix; the C++ color computation was
  already correct.)

## v314 — 2026-05-24

- Volume panel **Export JSON** now records `displayMode`
  (`normal` / `auto-seg` / `preset-seg`) so exported cases state which
  segmentation view was active at export time.

## v313 — 2026-05-24

- Fixed Visibility buttons mislabeling organs when a dropped model set is
  missing a mesh (e.g. no vein): the UI now resolves organ cards by label
  instead of load order, across desktop, mobile, VR panel, and cut targets.

## v301–v312 — 2026-05-19

- Volume panel: **Other Organs** section (Portal / Vein / Tumor / GB) and live
  **Liver (excl. tumor)** row backed by a tumor-overlap voxel mask computed in
  WebAssembly; panel is draggable; **Export JSON** button added.
- Mobile: Volume overlay fixes for portrait/landscape and AR transitions.
- Fullscreen + AR conflict now blocked with a warning banner.
- `paper-volume-v1` snapshot frozen from v311; v312 is comment translation
  only (binaries identical to v311).

## v288–v300 — 2026-05-18

- Mobile landscape UI overhaul, tablet layout, low-power GPU handling, and
  portal segmentation exposed through the WASM wrapper (v288).

## v283–v287 — 2026-05-17

- Benchmark instrumentation (`?bench=1`, benchmark.js v1.0.7–v1.0.9) and UI
  fixes used for the paper's 18-cell performance measurements.
  `paper-benchmark-v1` snapshot frozen from v286.
