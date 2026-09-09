# LiverSurgerySimWeb — Paper Benchmark Snapshot v1

This subfolder is a **frozen deployment** preserved for reproducibility of the
benchmark results reported in our AE-CAI 2026 paper. It is a complete,
self-contained copy of the simulator at the state used for measurement.

## Live URL

**https://meimeimei1223.github.io/LiverSurgerySimWeb/paper-benchmark-v1/?bench=1**

Open this URL in a WebGL2-capable browser (Chrome, Firefox, Edge, Quest3 Browser,
Android Chrome). The `?bench=1` query parameter activates the floating
benchmark panel (📊 icon in the bottom-right corner).

## What is preserved

| Component | Version |
|---|---|
| `index.html` | v286 (UI baseline at time of measurement) |
| `benchmark.js` | v1.0.9 (XR session FPS measurement with `isGrabbingVR()` fix) |
| `softbody.{js,wasm,data}` | Build of 2026-04-30 (unchanged through all benchmark sessions) |
| Service Worker cache name | `liver-sim-paper-benchmark-v1` (isolated from live deployment) |

## Relation to the live deployment

The live (continuously updated) version is at the repository root:
`https://meimeimei1223.github.io/LiverSurgerySimWeb/`

Differences from this snapshot:
- v287 fixes the VR side-panel draw order so 3D objects render in front of UI
- Future releases may add features or rebuild WASM with different toolchain

The `softbody.{wasm,data}` binaries in the live root are **bit-identical** to
this snapshot at the time of writing; the snapshot exists to guarantee this
relationship is preserved against future changes.

## How to reproduce the measurements

1. Open the URL above in the target platform (Desktop Chrome, Quest3, etc.).
2. Drop the supplied OBJ mesh dataset (5 files: liver, portal, vein, tumor,
   gallbladder) into the browser window. The dataset used for our published
   measurements is included in the paper's supplementary material.
3. Choose a tetrahedral mesh density preset (Low / Mid / High).
4. Press **Generate**. After ~5–40 seconds (preset-dependent) the simulation
   becomes interactive.
5. For XR-capable platforms, enter VR/AR mode via the in-app button.
6. Perform the standardized interaction sequence:
   10 s idle → 10 s rotation → 10 s deform → 3 free cuts → 1 segment cut.
7. Click the **📊** button → **Download JSON**.
8. Compare against the paper's Table 1 / Table 2 / supplementary CSV files.

## How to clone and serve locally

```bash
git clone https://github.com/meimeimei1223/LiverSurgerySimWeb.git
cd LiverSurgerySimWeb
git checkout paper-benchmark-v1   # corresponds to commit 54c80b7
python -m http.server 8000
# Then open http://localhost:8000/?bench=1
```

(Note: the `paper-benchmark-v1` git tag and this subfolder reflect the same
v286 state but live in different places — the tag is at the repository root
level, while this subfolder is a copy embedded in the live deployment.)

## License

See `LICENSE` in the repository root.

## Citation

If you use this code or benchmark methodology, please cite our paper (BibTeX
will be added on publication).

## Contact

Meidai Kasai — meidai1223@gmail.com
