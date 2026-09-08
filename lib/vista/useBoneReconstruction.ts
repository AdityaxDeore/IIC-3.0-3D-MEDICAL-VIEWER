import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoneMeshResponse } from './bone-mesh.worker';
import { BONE_CLASSES, BONE_LABELS } from './labels';
import { parseNifti } from './nifti';

export interface BoneResult {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** ["right femur (12,043 voxels)", ...] most prominent first. */
  found: string[];
  size: [number, number, number];
  triangles: number;
  ms: number;
}

export interface ReconstructionState {
  busy: boolean;
  stage: string;
  percent: number;
  error: string;
  result: BoneResult | null;
}

const IDLE: ReconstructionState = { busy: false, stage: '', percent: 0, error: '', result: null };

const KIND: Record<string, 'u8' | 'i16' | 'u16' | 'i32' | 'f32'> = {
  Uint8Array: 'u8', Int8Array: 'u8', Int16Array: 'i16', Uint16Array: 'u16',
  Int32Array: 'i32', Float32Array: 'f32',
};

export function useBoneReconstruction() {
  const [state, setState] = useState<ReconstructionState>(IDLE);
  const workerRef = useRef<Worker | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    workerRef.current?.terminate();
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    workerRef.current?.terminate();
    workerRef.current = null;
    setState(IDLE);
  }, []);

  /** Hand a volume to the worker. `threshold` (HU) switches it to raw-CT mode. */
  const meshFromVolume = useCallback(async (raw: ArrayBuffer, quality: number, threshold?: number) => {
    setState((s) => ({ ...s, stage: 'Reading volume', percent: 8 }));
    const volume = await parseNifti(raw);

    const kind = KIND[volume.data.constructor.name] ?? 'u8';
    // Copy out so the buffer is transferable and detaching cannot hurt the caller.
    const bytes = volume.data.slice().buffer;

    workerRef.current?.terminate();
    const worker = new Worker(new URL('./bone-mesh.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    return new Promise<BoneResult>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<BoneMeshResponse | { ok: false; stage?: string; percent?: number; error?: string }>) => {
        const message = event.data;
        if (message.ok === false) {
          if ('error' in message && message.error) {
            worker.terminate();
            reject(new Error(message.error));
          } else {
            setState((s) => ({ ...s, stage: message.stage ?? s.stage, percent: message.percent ?? s.percent }));
          }
          return;
        }
        worker.terminate();
        workerRef.current = null;
        resolve({
          positions: message.positions,
          normals: message.normals,
          colors: message.colors,
          indices: message.indices,
          found: message.counts
            .sort((a, b) => b[1] - a[1])
            .map(([id, n]) =>
              id === -1
                ? `bone (CT threshold) · ${n.toLocaleString()} voxels`
                : `${BONE_LABELS[id] ?? `label ${id}`} · ${n.toLocaleString()} voxels`),
          size: message.size,
          triangles: message.indices.length / 3,
          ms: message.ms,
        });
      };
      worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'Worker failed.')); };
      worker.postMessage(
        {
          data: bytes, kind, dims: volume.dims, spacing: volume.spacing, maxDim: quality,
          ...(typeof threshold === 'number'
            ? { threshold, sclSlope: volume.sclSlope, sclInter: volume.sclInter }
            : {}),
        },
        [bytes],
      );
    });
  }, []);

  /** Full path: scan URL -> VISTA-3D (via the proxy) -> bone mesh. */
  const segmentFromUrl = useCallback(async (imageUrl: string, quality = 224) => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setState({ busy: true, stage: 'Calling NVIDIA VISTA-3D', percent: 3, error: '', result: null });
    try {
      const response = await fetch('/api/vista/segment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageUrl, classes: BONE_CLASSES }),
        signal: abort.signal,
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? `Segmentation failed (${response.status}).`);
      }
      const result = await meshFromVolume(await response.arrayBuffer(), quality);
      setState({ busy: false, stage: 'Done', percent: 100, error: '', result });
      return result;
    } catch (error) {
      if (abort.signal.aborted) return null;
      setState({ busy: false, stage: '', percent: 0, error: error instanceof Error ? error.message : 'Failed.', result: null });
      return null;
    }
  }, [meshFromVolume]);

  /** Skip the API: mesh a segmentation mask you already have. */
  const meshFromFile = useCallback(async (file: File, quality = 224) => {
    setState({ busy: true, stage: 'Reading file', percent: 3, error: '', result: null });
    try {
      const result = await meshFromVolume(await file.arrayBuffer(), quality);
      setState({ busy: false, stage: 'Done', percent: 100, error: '', result });
      return result;
    } catch (error) {
      setState({ busy: false, stage: '', percent: 0, error: error instanceof Error ? error.message : 'Failed.', result: null });
      return null;
    }
  }, [meshFromVolume]);

  /**
   * Offline path — no API, no GPU. Threshold a raw CT volume (bone is bright:
   * HU >= ~300) straight into a mesh. This is the fallback while NVIDIA's hosted
   * VISTA-3D endpoint is retired.
   */
  const ctFromFile = useCallback(async (file: File, quality = 224, threshold = 300) => {
    setState({ busy: true, stage: 'Reading scan', percent: 3, error: '', result: null });
    try {
      const result = await meshFromVolume(await file.arrayBuffer(), quality, threshold);
      setState({ busy: false, stage: 'Done', percent: 100, error: '', result });
      return result;
    } catch (error) {
      setState({ busy: false, stage: '', percent: 0, error: error instanceof Error ? error.message : 'Failed.', result: null });
      return null;
    }
  }, [meshFromVolume]);

  /** Upload a local scan so VISTA-3D can fetch it, then segment. */
  const segmentFromFile = useCallback(async (file: File, quality = 224) => {
    setState({ busy: true, stage: 'Uploading scan', percent: 2, error: '', result: null });
    try {
      const upload = await fetch(`/api/vista/upload?name=${encodeURIComponent(file.name)}`, {
        method: 'PUT',
        body: file,
      });
      const payload = (await upload.json()) as { url?: string; error?: string };
      if (!upload.ok || !payload.url) throw new Error(payload.error ?? 'Upload failed.');
      return segmentFromUrl(payload.url, quality);
    } catch (error) {
      setState({ busy: false, stage: '', percent: 0, error: error instanceof Error ? error.message : 'Failed.', result: null });
      return null;
    }
  }, [segmentFromUrl]);

  return { state, reset, segmentFromUrl, segmentFromFile, meshFromFile, ctFromFile };
}
