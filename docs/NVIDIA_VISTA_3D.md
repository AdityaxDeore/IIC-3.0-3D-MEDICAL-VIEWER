# CT/MRI → 3D bones (NVIDIA VISTA-3D)

Additive feature on the `nvidia-dev` branch. It takes a 3D CT/MRI volume,
segments it with NVIDIA VISTA-3D, and drops the resulting **skeletal** mesh into
the existing Human Atlas scene so the injury can be read in 3D.

Nothing in the existing viewer, gesture system, MRI overlay or surgical planner
was changed. The only touch points are two additive lines (a scene bridge in
`app/scene.tsx`, a panel mount in `app/page.tsx`) and a dev proxy entry in
`vite.config.ts`.

## Status of the NVIDIA endpoint — read this first

The hosted endpoint `https://health.api.nvidia.com/v1/medicalimaging/nvidia/vista-3d`
**was retired by NVIDIA on 2026-08-25**. Verified live with the keys in `.env`:

```
HTTP 410 Gone
{"title":"Gone","detail":"This endpoint has reached its end of life on 2026-08-25T09:00:00Z"}
```

The keys themselves are valid (they authenticate; the 410 is about the route, not
auth). So the working path is a **self-hosted VISTA-3D NIM**, which is exactly
what the `build.nvidia.com/nvidia/vista-3d/deploy` tab documents. The proxy still
tries the hosted URL last, so this starts working again if NVIDIA restores it.

## Running it

```sh
npm run vista     # terminal 1 — proxy on :8788
npm run dev       # terminal 2 — app on :3016
```

Open the app and click **CT/MRI → 3D bones** (bottom left).

### Ways in

| Button | Needs | What it does |
|---|---|---|
| **Reconstruct bones from CT (offline)** | nothing | Thresholds a raw CT volume (bone is bright: HU ≥ ~300, slider-adjustable) straight into a mesh, in a worker. **The default** — no API, no GPU, no keys. CT only; MRI bone is dark and needs the NIM. |
| **Load mask (no API)** | nothing | Meshes a segmentation you already have. |
| **Segment & build** | a reachable NIM | Sends a public scan URL to VISTA-3D, meshes the bones it returns. |
| **Upload scan…** | a reachable NIM | Uploads a local volume, serves it back at a URL the NIM can fetch, then segments. |

Input volumes must be **NIfTI (`.nii` / `.nii.gz`) or NRRD** — 3D volumes, not
2D PNG/JPEG slices.

The offline CT path exists because NVIDIA retired the hosted endpoint (see
below); it needs no NVIDIA anything. The VISTA-3D paths add accurate per-bone
labels and MRI support once a NIM is reachable.

### Standing up the NIM

```sh
docker login nvcr.io          # username: $oauthtoken, password: the nvapi- key in .env
docker run --rm --gpus all -p 8000:8000 nvcr.io/nim/nvidia/vista3d:latest
```

The proxy auto-detects it at `http://localhost:8000/v1/vista3d/inference`.
Override with `VISTA_INVOKE_URL` in `.env` if you deploy elsewhere.

Uploads are served to the model at `http://host.docker.internal:8788/files/...`,
so a container on the same machine needs **no tunnel**. For a remote endpoint,
set `VISTA_PUBLIC_BASE_URL` to a public origin (e.g.
`cloudflared tunnel --url http://localhost:8788`).

## Why a proxy

1. `health.api.nvidia.com` sends no CORS headers — the call cannot come from the browser.
2. The API keys must not ship in the client bundle.
3. VISTA-3D fetches the scan **by URL** itself, so an uploaded file needs hosting.

> Note: `.env` currently names the keys `VITE_NVIDIA_VISTA_API` / `VITE_NVIDIA_VISTA_FALLBACK`.
> The `VITE_` prefix makes Vite inline them into the **client bundle** wherever
> `import.meta.env.VITE_…` is referenced. The proxy reads them server-side and never
> exposes them; renaming them without the `VITE_` prefix would close that leak.

## How it stays fast

The whole reconstruction runs **off the main thread** in
`lib/vista/bone-mesh.worker.ts`, so the 3D viewer never drops a frame:

1. One pass over the label volume for the bone bounding box and per-label counts.
2. Crop to that box, then downsample so the longest axis hits the detail budget
   (96–384, default 224). Cropping first keeps resolution where the bone actually is.
3. Build a signed field and smooth it once (separable 1-2-1) to kill the voxel staircase.
4. **Surface Nets** isosurface extraction — chosen over marching cubes because its
   tables are generated at load time and it yields a smoother, lower-poly shell.
5. Transform to metres, centre in X/Z, stand it on the platform, tint per label.
6. Results come back as **transferable** typed arrays — no copy, no GC spike.

The viewer only redraws when something changed, so the panel calls
`requestRender()` after mounting or adjusting the mesh.

## Bones covered

All VISTA-3D skeletal labels: vertebrae C1–C7 / T1–T12 / L1–L5 / S1, ribs 1–12
left and right, skull, sternum, costal cartilages, scapulae, claviculae, humeri,
hips, femurs, sacrum — plus **bone lesion** (id 128), tinted red so the injury
stands out. See `lib/vista/labels.ts`.

## Files

```
server/vista-proxy.mjs                       proxy: keys, CORS, scan hosting, endpoint fallback
lib/vista/labels.ts                          VISTA-3D skeletal label map + tints
lib/vista/nifti.ts                           minimal NIfTI-1 reader (.nii / .nii.gz)
lib/vista/surface-nets.ts                    isosurface extraction + normals
lib/vista/bone-mesh.worker.ts                the off-thread pipeline
lib/vista/useBoneReconstruction.ts           React hook orchestrating it
lib/vista/scene-bridge.ts                    typed handle onto the live scene
components/vista/BoneReconstructionPanel.tsx the UI, mounts/unmounts its own group
```
