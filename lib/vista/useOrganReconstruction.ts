import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoneMeshResponse } from './bone-mesh.worker';
import type { BoneResult } from './useBoneReconstruction';
import { parseNifti } from './nifti';
import { labelsFor, prettyName, segColor, type SegTask } from './totalseg-labels';

export interface OrganState {
  busy: boolean;
  stage: string;
  percent: number;
  error: string;
  result: (BoneResult & { structure: string }) | null;
}

const IDLE: OrganState = { busy: false, stage: '', percent: 0, error: '', result: null };

const KIND: Record<string, 'u8' | 'i16' | 'u16' | 'i32' | 'f32'> = {
  Uint8Array: 'u8', Int8Array: 'u8', Int16Array: 'i16', Uint16Array: 'u16',
  Int32Array: 'i32', Float32Array: 'f32',
};

/**
 * MRI/CT volume -> TotalSegmentator (via the proxy) -> a single isolated
 * organ/bone mesh, centred for close inspection. Mesh extraction runs in the
 * shared worker so the viewer never stalls.
 */
export function useOrganReconstruction() {
  const [state, setState] = useState<OrganState>(IDLE);
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

  const meshLabel = useCallback(
    (raw: ArrayBuffer, task: SegTask, structureId: number, quality: number) =>
      new Promise<BoneResult & { structure: string }>((resolve, reject) => {
        const name = labelsFor(task)[structureId] ?? `label ${structureId}`;
        parseNifti(raw)
          .then((volume) => {
            const kind = KIND[volume.data.constructor.name] ?? 'u8';
            const bytes = volume.data.slice().buffer;

            workerRef.current?.terminate();
            const worker = new Worker(new URL('./bone-mesh.worker.ts', import.meta.url), { type: 'module' });
            workerRef.current = worker;

            worker.onmessage = (
              event: MessageEvent<BoneMeshResponse | { ok: false; stage?: string; percent?: number; error?: string }>,
            ) => {
              const m = event.data;
              if (m.ok === false) {
                if ('error' in m && m.error) { worker.terminate(); reject(new Error(m.error)); }
                else setState((s) => ({ ...s, stage: m.stage ?? s.stage, percent: m.percent ?? s.percent }));
                return;
              }
              worker.terminate();
              workerRef.current = null;
              const voxels = m.counts.reduce((n, [, c]) => n + c, 0);
              resolve({
                positions: m.positions, normals: m.normals, colors: m.colors, indices: m.indices,
                found: [`${prettyName(name)} · ${voxels.toLocaleString()} voxels`],
                size: m.size,
                triangles: m.indices.length / 3,
                ms: m.ms,
                structure: prettyName(name),
              });
            };
            worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'Worker failed.')); };
            worker.postMessage(
              {
                data: bytes, kind, dims: volume.dims, spacing: volume.spacing, maxDim: quality,
                labels: [structureId], flatColor: segColor(name),
              },
              [bytes],
            );
          })
          .catch(reject);
      }),
    [],
  );

  /** Full path: upload MRI/CT volume -> segment -> isolate one structure. */
  const reconstruct = useCallback(
    async (file: File, opts: { task: SegTask; structureId: number; quality?: number }) => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      setState({ busy: true, stage: 'Uploading to TotalSegmentator', percent: 4, error: '', result: null });
      try {
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('task', opts.task);
        setState((s) => ({ ...s, stage: 'Segmenting (this can take a minute on CPU)', percent: 12 }));
        const response = await fetch('/api/seg/organ', { method: 'POST', body: form, signal: abort.signal });
        if (!response.ok) {
          const detail = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(detail.error ?? `Segmentation failed (${response.status}).`);
        }
        setState((s) => ({ ...s, stage: 'Building mesh', percent: 60 }));
        const result = await meshLabel(await response.arrayBuffer(), opts.task, opts.structureId, opts.quality ?? 256);
        setState({ busy: false, stage: 'Done', percent: 100, error: '', result });
        return result;
      } catch (error) {
        if (abort.signal.aborted) return null;
        setState({ busy: false, stage: '', percent: 0, error: error instanceof Error ? error.message : 'Failed.', result: null });
        return null;
      }
    },
    [meshLabel],
  );

  /** Offline: a multilabel mask you already have (e.g. saved TotalSegmentator output). */
  const fromMask = useCallback(
    async (file: File, opts: { task: SegTask; structureId: number; quality?: number }) => {
      setState({ busy: true, stage: 'Reading mask', percent: 8, error: '', result: null });
      try {
        const result = await meshLabel(await file.arrayBuffer(), opts.task, opts.structureId, opts.quality ?? 256);
        setState({ busy: false, stage: 'Done', percent: 100, error: '', result });
        return result;
      } catch (error) {
        setState({ busy: false, stage: '', percent: 0, error: error instanceof Error ? error.message : 'Failed.', result: null });
        return null;
      }
    },
    [meshLabel],
  );

  return { state, reset, reconstruct, fromMask };
}
