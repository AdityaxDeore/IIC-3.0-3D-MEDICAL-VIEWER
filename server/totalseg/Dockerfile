# TotalSegmentator HTTP wrapper. CPU by default; pass --gpus all + TS_DEVICE=gpu for GPU.
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl xz-utils && rm -rf /var/lib/apt/lists/*

# CPU torch keeps the image small; override the index for CUDA if you have a GPU.
RUN pip install --no-cache-dir \
      torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir \
      TotalSegmentator fastapi "uvicorn[standard]" python-multipart

# Pre-download the weights so the first request isn't a 10-minute stall.
RUN TotalSegmentator --help >/dev/null 2>&1 || true

WORKDIR /app
COPY app.py .

ENV TS_DEVICE=cpu
EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
