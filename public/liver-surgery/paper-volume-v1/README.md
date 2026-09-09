# LiverSurgerySimWeb — Paper Volume Snapshot v1

This subfolder is a **frozen deployment** preserved for reproducibility of the
volumetric measurements reported in our AE-CAI 2026 paper (20 anatomical cases
× liver / tumor / portal / vein / GB / S1–S8 volumes). It is a complete,
self-contained copy of the simulator at the state used for measurement.

## Live URL

**https://meimeimei1223.github.io/LiverSurgerySimWeb/paper-volume-v1/**

Open this URL in a WebGL2-capable browser (Chrome, Firefox, Edge). Volume
measurement is performed on the desktop browser version; the Volume panel and
**Export JSON** button are the primary instruments.

## What is preserved

| Component | Version |
|---|---|
| `index.html` | v311 (Volume panel with Other Organs + Liver(excl tumor) + Export JSON) |
| `softbody.{js,wasm,data}` | Build of 2026-05-19 (includes tumor-mask embind) |
| Service Worker cache name | `liver-sim-paper-volume-v1` (isolated from live deployment) |

### WASM features added for volume measurement

The WASM bindings (in `softbody.wasm`) include the following five functions
required to reproduce the anatomical measurements:

- `buildTumorOverlapMaskFromChild(int tumorChildIdx)` — at startup, marks liver
  high-res tets that spatially overlap with the tumor (spatial hash + point-in-
  tet, OpenMP-parallel on native; single-thread on WASM).
- `calculateTotalVolumeExcludingMask()` — live total liver volume minus
  mask-flagged tets (follows cut state via `highResTetValid` AND).
- `getOriginalTotalVolumeExcludingTumor()` — snapshot of exclude-tumor volume
  captured right after `buildTumorOverlapMaskFromChild`. Used as the denominator
  of the functional remnant ratio.
- `hasTumorOverlapMask()` — guard for the above.
- `getChildTotalVolume(int childIdx)` — initial volume of Portal / Vein / Tumor
  / GB child meshes. Scale factor is propagated from the liver SoftBodyDuo to
  all children (v302 fix).

All of these are thin wrappers around the desktop C++ implementation in
`src/SoftBodyDuo.cpp` (functions: `buildTumorOverlapMask`,
`calculateTotalVolumeExcludingMask`, `calculateTotalVolume`).

## Relation to the live deployment

The live (continuously updated) version is at the repository root:
`https://meimeimei1223.github.io/LiverSurgerySimWeb/`

The live root is **bit-identical** to this snapshot at the time of writing
(both are v311). This subfolder exists to guarantee that the binaries and UI
behaviour used for the published measurements remain available even after
the live deployment is updated.

## How to reproduce the volume measurements

1. Open the URL above in a desktop browser.
2. Drop the OBJ mesh dataset for one case (5 files: liver, portal, vein, tumor,
   gallbladder) into the browser window. The 20 cases used in the paper are
   available in the supplementary material.
3. Choose a tetrahedral mesh density preset (Low / Mid / High). Use **High**
   for the paper measurements (the volume values are tet-density sensitive).
4. Press **Generate**. After ~10–40 s the simulation becomes interactive and
   the tumor-overlap mask is built automatically.
5. Press **B** (or tap the 📊 icon) to open the Volume panel.
6. Click **Export JSON** at the bottom of the panel. A file named
   `volume_<timestamp>.json` is downloaded.
7. Repeat steps 2–6 for the remaining cases.
8. Aggregate all 20 JSON files with the Python script in the supplementary
   material (`paper_benchmarks/aggregate_volume.py`).

## Output JSON schema

Each `volume_<timestamp>.json` contains:

```json
{
  "meta": {
    "exportedAt": "2026-05-19T13:45:30.123Z",
    "appVersion": "v310/v311",
    "useOBJSegmentation": true,
    "hasTumorMask": true
  },
  "liver": {
    "total_ml": 1965.5,
    "originalTotal_ml": 1967.6,
    "remnantPct": 99.89,
    "excludeTumor_ml": 1962.2,
    "excludeTumor_original_ml": 1962.2,
    "excludeTumor_pct": 100.0
  },
  "segments": {
    "S1": {
      "current_ml": 118.6,
      "original_ml": 118.6,
      "ratioToOriginal_pct": 100.0,
      "pctOfLiverOriginal": 6.03
    },
    "S2": { /* ... */ },
    /* through S8 */
  },
  "otherOrgans": {
    "Portal_ml": 45.2,
    "Vein_ml": 12.1,
    "Tumor_ml": 8.3,
    "GB_ml": 18.0
  }
}
```

The `excludeTumor_*` fields are present only if a tumor mesh is loaded.
The `S1..S8` segments are present only when the Preset Segmentation OBJ files
are bound (typical for clinical anatomical cases).

## How to clone and serve locally

```bash
git clone https://github.com/meimeimei1223/LiverSurgerySimWeb.git
cd LiverSurgerySimWeb
git checkout paper-volume-v1
python -m http.server 8000
# Then open http://localhost:8000/paper-volume-v1/
```

(Note: the `paper-volume-v1` git tag and this subfolder reflect the same
v311 state but live in different places — the tag points at the repository
root commit, while this subfolder is a copy embedded in the live deployment.)

## License

See `LICENSE` in the repository root.

## Citation

If you use this code or measurement methodology, please cite our paper (BibTeX
will be added on publication).

## Contact

Meidai Kasai — meidai1223@gmail.com
