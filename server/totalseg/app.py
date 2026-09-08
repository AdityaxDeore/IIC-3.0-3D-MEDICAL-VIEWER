"""
Tiny TotalSegmentator HTTP wrapper.

POST /segment
  multipart form:
    file  -> a NIfTI volume (.nii / .nii.gz)   [required]
    task  -> "total" (CT) or "total_mr" (MR)   [default: total]
    fast  -> "1" to use the fast (3mm) model   [default: 1 on CPU]
    roi   -> comma-separated structure names to limit to (faster)
  -> returns one multilabel segmentation as .nii.gz
     (label ids match totalsegmentator.map_to_binary.class_map[task])

GET /health -> {"ok": true, "device": "..."}
"""
import os
import shutil
import subprocess
import tempfile
import uuid

from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

DEVICE = os.environ.get("TS_DEVICE", "gpu" if shutil.which("nvidia-smi") else "cpu")

app = FastAPI(title="TotalSegmentator wrapper")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


@app.get("/health")
def health():
    return {"ok": True, "device": DEVICE}


@app.post("/segment")
async def segment(
    file: UploadFile,
    task: str = Form("total"),
    fast: str = Form("1" if DEVICE == "cpu" else "0"),
    roi: str = Form(""),
):
    if task not in ("total", "total_mr"):
        raise HTTPException(400, "task must be 'total' or 'total_mr'")

    work = tempfile.mkdtemp(prefix="ts_")
    src = os.path.join(work, file.filename or "input.nii.gz")
    out = os.path.join(work, f"{uuid.uuid4().hex}.nii.gz")
    with open(src, "wb") as fh:
        fh.write(await file.read())

    cmd = [
        "TotalSegmentator",
        "-i", src,
        "-o", out,
        "--ml",                 # one multilabel file, not a folder of masks
        "--task", task,
        "--device", DEVICE,
    ]
    if fast == "1":
        cmd.append("--fast")
    rois = [r.strip() for r in roi.split(",") if r.strip()]
    if rois:
        cmd += ["--roi_subset", *rois]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not os.path.exists(out):
        shutil.rmtree(work, ignore_errors=True)
        raise HTTPException(500, f"TotalSegmentator failed: {proc.stderr[-1500:]}")

    return FileResponse(
        out,
        media_type="application/gzip",
        filename="segmentation.nii.gz",
        background=None,
    )


@app.exception_handler(HTTPException)
async def _http_exc(_, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})
