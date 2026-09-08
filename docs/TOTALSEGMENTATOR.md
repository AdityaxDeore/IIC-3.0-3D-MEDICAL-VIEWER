# MRI/CT → 3D of one organ or bone (TotalSegmentator)

Branch `total-segmentation-3d`. Panel: **CT/MRI → 3D bones** (bottom-left) → **Organ / structure** tab.

A doctor uploads a CT or MRI volume, picks one structure (liver, L3 vertebra,
right femur, …), and gets just that structure rebuilt in 3D next to the atlas
skeleton — sized for close inspection so a fracture, crack or lesion reads at a
glance. Nothing in the bones path or the rest of the app changed.

## Pipeline

```
volume (.nii/.nii.gz)
  → proxy /api/seg/organ  (server/vista-proxy.mjs, forwards multipart)
  → TotalSegmentator HTTP service  (server/totalseg/, `--ml` multilabel out)
  → NIfTI label volume back to the browser
  → bone-mesh.worker.ts  (labels:[id], flatColor)  — crop → downsample → Surface Nets
  → mounted isolated, ~0.4 m, beside the skeleton
```

Mesh extraction stays in the Web Worker, so the viewer never stalls.

## Run it

### 1. The segmentation service (once)

```sh
cd server/totalseg
docker build -t totalseg .
docker run --rm -p 8001:8001 totalseg              # CPU (~1 min/scan, --fast auto)
# GPU:  docker run --rm --gpus all -e TS_DEVICE=gpu -p 8001:8001 totalseg
```

Health check: `curl localhost:8001/health` → `{"ok":true,"device":"cpu"}`.
First real request downloads the model weights (~1–2 min once).

### 2. The app

```sh
npm run vista     # proxy :8788  (reads TOTALSEG_URL, default http://localhost:8001/segment)
npm run dev       # app :3016
```

Open the panel → **Organ / structure** → choose **CT** or **MRI**, pick a
structure, **Segment & reconstruct structure**, select the volume.

No server? Use **Load segmentation mask (no server)** with a saved
TotalSegmentator `--ml` output.

## Config (`.env`, all optional)

| var | default | meaning |
|---|---|---|
| `TOTALSEG_URL` | `http://localhost:8001/segment` | where the proxy sends volumes |

## Structures

`total` (CT, 117) and `total_mr` (MR, 50) label maps are in
`lib/vista/totalseg-labels.ts`, grouped organ / bone / vessel / muscle, each
tinted by category in the isolated view.

## Notes / limits

- **Volumes only.** A single 2-D slice has no depth — upload a series / NIfTI
  volume. A 2-D-slice "inflate" fallback is a possible next step.
- CPU segmentation of a large series can take a few minutes; `--fast` (3 mm) is
  on by default on CPU. Pass `roi` in the form to limit ROIs and speed it up.
- MRI long-bone/organ coverage is smaller than CT (50 vs 117 classes).
- Deploy: the app is static (Vercel); the proxy + TotalSegmentator container go
  on any box with Docker (Render / Fly / a VPS). Point `TOTALSEG_URL` at it.

## Files

```
server/totalseg/Dockerfile           CPU-first TotalSegmentator + FastAPI
server/totalseg/app.py                POST /segment  (multipart: file, task, fast, roi)
server/vista-proxy.mjs                + /api/seg/organ route (forwards multipart)
lib/vista/totalseg-labels.ts          CT + MR label maps, categories, colours
lib/vista/useOrganReconstruction.ts   hook: upload → segment → isolate one label
lib/vista/bone-mesh.worker.ts         + flatColor (isolated-structure tint)
components/vista/BoneReconstructionPanel.tsx  + "Organ / structure" tab
```
