/**
 * Drives the slice -> 3-D tool.
 *
 * The default path fits real anatomy: the slice is identified, each named
 * structure is resolved to the BodyParts3D meshes already shipped with the
 * viewer, the slice is measured structure by structure, and those meshes are
 * deformed to agree with the measurements. The mesh is therefore anatomically
 * correct and closed before the scan ever touches it, and every structure on
 * the slice gets its own - two thighs give two femurs.
 *
 * The free-form path (build the surface from the outline alone) is kept for
 * anything the atlas has no mesh for. It is the older behaviour and it can
 * only ever produce one structure.
 *
 * Decoded pixels are cached so the fit can be re-tuned without re-uploading or
 * spending another identification call.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Atlas } from '@/app/anatomy';
import type { SliceMeshRequest, SliceMeshResponse } from './slice-mesh.worker';
import type { MeasureTarget, Measurement, SliceMeasureRequest, SliceMeasureResponse } from './measurements';
import {
  colorFor,
  identifySlice,
  manualIdentification,
  type SliceIdentification,
  type SliceStructure,
} from './identify';
import { loadPartGeometry, matchParts } from './atlas-parts';
import { mergeFitted, morphToMeasurement, type FittedPart } from './atlas-morph';

export type FitMode = 'atlas' | 'freeform';

export interface SliceSettings {
  /** Fit the atlas meshes, or build the surface from the outline alone. */
  mode: FitMode;
  /** Segment structures darker than their surroundings. */
  invert: boolean;
  /** Threshold nudge away from the automatic one, -1..1. */
  bias: number;
  /**
   * How far the scan is allowed to pull the atlas mesh, 0..1. Atlas mode only;
   * 0 leaves the reference anatomy untouched.
   */
  strength: number;
  /** Peak half-thickness as a fraction of the in-plane radius. Free-form only. */
  thickness: number;
  /** Longest in-plane axis after downsampling. */
  detail: number;
}

export const DEFAULT_SETTINGS: SliceSettings = {
  mode: 'atlas',
  invert: false,
  bias: 0,
  strength: 0.6,
  thickness: 0.7,
  detail: 384,
};

/** What became of one identified structure, for the read-out. */
export interface StructureReport {
  name: string;
  /** The atlas meshes it was fitted with; empty when nothing matched. */
  parts: string[];
  fitted: boolean;
  /** Why it was not fitted; empty when it was. */
  reason: string;
  triangles: number;
  /** Largest and mean deviation from the reference mesh, as percentages. */
  maxChange: number;
  meanChange: number;
}

export interface SliceResult {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  preview: ImageData;
  /** One entry per identified structure, in identification order. */
  structures: StructureReport[];
  coverage: number;
  triangles: number;
  ms: number;
  /** Free-form only: the threshold that was used. */
  threshold: number;
}

export interface SliceState {
  busy: boolean;
  stage: string;
  percent: number;
  error: string;
  fileName: string;
  identification: SliceIdentification | null;
  result: SliceResult | null;
}

const IDLE: SliceState = {
  busy: false, stage: '', percent: 0, error: '', fileName: '', identification: null, result: null,
};

/**
 * What to tell the user when nothing could be identified. Each case names the
 * real cause and the way forward, because "no reference mesh matched" would
 * blame the atlas for a failure that never reached it.
 */
function describeFailure(identity: SliceIdentification): string {
  const failure = identity.failure;
  if (!failure) return 'No structure could be identified in this slice. Name it below to fit it.';
  const wait = failure.retryAfter > 0 ? ` Google asked for about ${Math.ceil(failure.retryAfter)}s.` : '';
  switch (failure.kind) {
    case 'quota':
      return 'The Gemini free-tier quota for this API key is used up, so the scan could not be ' +
        'identified automatically. Name the structure below to fit it without a model call — ' +
        'everything else works as normal.';
    case 'rate':
      return `Gemini is rate-limiting this key, so identification was skipped.${wait} ` +
        'Retry it, or name the structure below to fit it without a model call.';
    case 'key':
      return 'No Gemini API key is configured, so the scan cannot be identified automatically. ' +
        'Name the structure below to fit it without a model call.';
    default:
      return `${failure.message} Name the structure below to fit it without a model call.`;
  }
}

/** Decode an uploaded image to raw pixels plus a data URL for identification. */
function decode(file: File): Promise<{ pixels: ImageData; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image this browser can open.'));
      img.onload = () => {
        // Cap the working resolution; the worker downsamples again per its budget.
        // Kept well above the Detail ceiling so the box filter has real pixels to average.
        const longest = Math.max(img.naturalWidth, img.naturalHeight);
        const factor = Math.min(1, 1600 / Math.max(1, longest));
        const w = Math.max(8, Math.round(img.naturalWidth * factor));
        const h = Math.max(8, Math.round(img.naturalHeight * factor));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return reject(new Error('This browser could not open a 2D canvas.'));
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ pixels: ctx.getImageData(0, 0, w, h), dataUrl });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function useSliceTo3D(atlas: Atlas | null) {
  const [state, setState] = useState<SliceState>(IDLE);
  const [settings, setSettings] = useState<SliceSettings>(DEFAULT_SETTINGS);
  const workerRef = useRef<Worker | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pixelsRef = useRef<ImageData | null>(null);
  const identityRef = useRef<SliceIdentification | null>(null);
  const dataUrlRef = useRef<string | null>(null);
  const atlasRef = useRef(atlas);
  atlasRef.current = atlas;

  const stop = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const reset = useCallback(() => {
    stop();
    pixelsRef.current = null;
    identityRef.current = null;
    dataUrlRef.current = null;
    setState(IDLE);
    setSettings(DEFAULT_SETTINGS);
  }, [stop]);

  /** Run the measuring worker over every identified structure at once. */
  const measure = useCallback((
    pixels: ImageData,
    targets: MeasureTarget[],
    next: SliceSettings,
  ) => new Promise<SliceMeasureResponse>((resolve, reject) => {
    const worker = new Worker(new URL('./slice-measure.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<SliceMeasureResponse | { ok: false; stage?: string; percent?: number; error?: string }>) => {
      const message = event.data;
      if (message.ok === false) {
        if ('error' in message && message.error) {
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          reject(new Error(message.error));
        } else {
          setState((s) => ({ ...s, stage: message.stage ?? s.stage, percent: message.percent ?? s.percent }));
        }
        return;
      }
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      resolve(message);
    };
    worker.onerror = (e) => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      reject(new Error(e.message || 'Measurement failed.'));
    };

    // Copy the pixels so the cached slice survives the transfer.
    const buffer = pixels.data.buffer.slice(0);
    const request: SliceMeasureRequest = {
      pixels: buffer,
      width: pixels.width,
      height: pixels.height,
      targets,
      bias: next.bias,
      detail: next.detail,
    };
    worker.postMessage(request, [buffer]);
  }), []);

  /** Fit the atlas meshes for every identified structure to the slice. */
  const buildAtlas = useCallback(async (next: SliceSettings): Promise<SliceResult | null> => {
    const pixels = pixelsRef.current;
    const identity = identityRef.current;
    const currentAtlas = atlasRef.current;
    if (!pixels || !identity) return null;
    if (!currentAtlas) throw new Error('The anatomy catalogue is still loading. Try again in a moment.');

    // Resolve every structure to atlas meshes first: a name the atlas has no
    // mesh for is reported rather than quietly reconstructed as a blob.
    const resolved = identity.structures.map((structure) => ({
      structure,
      parts: matchParts(currentAtlas, structure.name, structure.side),
    }));
    const fittable = resolved.filter((r) => r.parts.length > 0);
    if (!fittable.length) {
      throw new Error(
        `No reference mesh matches ${identity.structures.map((s) => s.name).join(', ')}. ` +
        'Pick the structure from the list below, or switch to Free-form to build the ' +
        'shape from the outline instead.',
      );
    }

    setState((s) => ({ ...s, stage: 'Loading reference anatomy', percent: 16 }));
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const geometry = await Promise.all(
      fittable.map((r) => loadPartGeometry(currentAtlas, r.parts, abort.signal)),
    );

    const targets: MeasureTarget[] = fittable.map(({ structure }) => ({
      name: structure.name,
      roi: structure.roi,
      // A per-structure override is not worth a control of its own; the panel's
      // one Invert toggle flips whatever identification decided.
      invert: next.invert ? structure.appears !== 'dark' : structure.appears === 'dark',
      bone: structure.category === 'bone',
    }));

    const measured = await measure(pixels, targets, next);
    setState((s) => ({ ...s, stage: 'Fitting the reference meshes', percent: 84 }));

    const byName = new Map<string, Measurement>(measured.measurements.map((m) => [m.name, m]));
    const fitted: FittedPart[] = [];
    const reports = new Map<string, StructureReport>();

    fittable.forEach(({ structure, parts }, i) => {
      const measurement = byName.get(structure.name);
      const color = colorFor(structure.category);
      let triangles = 0;
      let maxChange = 0;
      let changeSum = 0;

      geometry[i].forEach((geo) => {
        // With no usable measurement the reference mesh is still shown - it is
        // the right anatomy, just unfitted - and the read-out says so.
        if (measurement?.ok) {
          const report = morphToMeasurement(geo.positions, measurement, next.strength);
          maxChange = Math.max(maxChange, report.maxChange);
          changeSum += report.meanChange;
        }
        triangles += geo.indices.length / 3;
        fitted.push({ name: structure.name, positions: geo.positions, indices: geo.indices, color });
      });

      reports.set(structure.name, {
        name: structure.name,
        parts: parts.map((p) => p.name),
        fitted: !!measurement?.ok,
        reason: measurement?.ok ? '' : measurement?.reason || 'not measured on this slice',
        triangles,
        maxChange,
        meanChange: geometry[i].length ? changeSum / geometry[i].length : 0,
      });
    });

    const merged = mergeFitted(fitted);
    if (!merged) throw new Error('The reference meshes for this structure were empty.');

    // Report in identification order, unmatched structures included.
    const structures: StructureReport[] = identity.structures.map((s) =>
      reports.get(s.name) ?? {
        name: s.name,
        parts: [],
        fitted: false,
        reason: 'no matching mesh in the atlas',
        triangles: 0,
        maxChange: 0,
        meanChange: 0,
      });

    const measuredOk = measured.measurements.filter((m) => m.ok);
    return {
      positions: merged.positions,
      normals: merged.normals,
      colors: merged.colors,
      indices: merged.indices,
      preview: new ImageData(
        new Uint8ClampedArray(measured.preview),
        measured.previewWidth,
        measured.previewHeight,
      ),
      structures,
      coverage: measuredOk.length
        ? measuredOk.reduce((sum, m) => sum + m.coverage, 0) / measuredOk.length
        : 0,
      triangles: merged.indices.length / 3,
      ms: measured.ms,
      threshold: measuredOk[0]?.threshold ?? 0,
    };
  }, [measure]);

  /** Older path: segment the outline and inflate it. One structure only. */
  const buildFreeform = useCallback((next: SliceSettings) => {
    const pixels = pixelsRef.current;
    const identity = identityRef.current;
    if (!pixels || !identity) return Promise.resolve<SliceResult | null>(null);
    const primary: SliceStructure = identity.structures[0];

    const worker = new Worker(new URL('./slice-mesh.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    return new Promise<SliceResult>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<SliceMeshResponse | { ok: false; stage?: string; percent?: number; error?: string }>) => {
        const message = event.data;
        if (message.ok === false) {
          if ('error' in message && message.error) {
            worker.terminate();
            if (workerRef.current === worker) workerRef.current = null;
            reject(new Error(message.error));
          } else {
            setState((s) => ({ ...s, stage: message.stage ?? s.stage, percent: message.percent ?? s.percent }));
          }
          return;
        }
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        resolve({
          positions: message.positions,
          normals: message.normals,
          colors: message.colors,
          indices: message.indices,
          // Re-view over a plain ArrayBuffer; a transferred array is typed as ArrayBufferLike.
          preview: new ImageData(
            new Uint8ClampedArray(message.preview),
            message.previewWidth,
            message.previewHeight,
          ),
          structures: [{
            name: primary.name,
            parts: [],
            fitted: false,
            reason: 'built from the outline, not fitted to reference anatomy',
            triangles: message.triangles,
            maxChange: 0,
            meanChange: 0,
          }],
          coverage: message.coverage,
          triangles: message.triangles,
          ms: message.ms,
          threshold: message.threshold,
        });
      };
      worker.onerror = (e) => {
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        reject(new Error(e.message || 'Reconstruction failed.'));
      };

      const buffer = pixels.data.buffer.slice(0);
      const request: SliceMeshRequest = {
        pixels: buffer,
        width: pixels.width,
        height: pixels.height,
        roi: primary.roi,
        invert: next.invert ? primary.appears !== 'dark' : primary.appears === 'dark',
        bias: next.bias,
        thickness: next.thickness,
        detail: next.detail,
        color: colorFor(primary.category),
      };
      worker.postMessage(request, [buffer]);
    });
  }, []);

  const build = useCallback(async (next: SliceSettings): Promise<SliceResult | null> => {
    if (!pixelsRef.current || !identityRef.current) return null;
    stop();
    setState((s) => ({
      ...s, busy: true, error: '',
      stage: next.mode === 'atlas' ? 'Matching the atlas' : 'Segmenting', percent: 14,
    }));
    try {
      const result = next.mode === 'atlas' ? await buildAtlas(next) : await buildFreeform(next);
      if (!result) {
        setState((s) => ({ ...s, busy: false, stage: '', percent: 0 }));
        return null;
      }
      setState((s) => ({ ...s, busy: false, stage: 'Done', percent: 100, error: '', result }));
      return result;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      setState((s) => ({
        ...s, busy: false, stage: '', percent: 0, result: null,
        error: error instanceof Error ? error.message : 'Reconstruction failed.',
      }));
      return null;
    }
  }, [buildAtlas, buildFreeform, stop]);

  /**
   * Run identification over the cached slice and fit what it finds. When
   * identification is unavailable the slice is kept and the state explains
   * why: the scan is still there to be fitted once a structure is named by
   * hand, so nothing has to be uploaded twice.
   */
  const identify = useCallback(async (dataUrl: string) => {
    setState((s) => ({ ...s, busy: true, stage: 'Identifying the structures', percent: 12, error: '' }));
    const identity = await identifySlice(dataUrl);
    identityRef.current = identity;
    setState((s) => ({ ...s, identification: identity }));

    if (!identity.structures.length) {
      setState((s) => ({
        ...s, busy: false, stage: '', percent: 0, result: null,
        error: describeFailure(identity),
      }));
      return null;
    }

    const next = { ...DEFAULT_SETTINGS };
    setSettings(next);
    return build(next);
  }, [build]);

  /** Upload -> identify -> fit. */
  const load = useCallback(async (file: File) => {
    stop();
    setState({ ...IDLE, busy: true, stage: 'Reading the scan', percent: 6, fileName: file.name });
    let decoded;
    try {
      decoded = await decode(file);
    } catch (error) {
      setState({ ...IDLE, error: error instanceof Error ? error.message : 'That file could not be read.' });
      return null;
    }
    pixelsRef.current = decoded.pixels;
    dataUrlRef.current = decoded.dataUrl;
    return identify(decoded.dataUrl);
  }, [identify, stop]);

  /** Try automatic identification again, for a failure that may have passed. */
  const retryIdentify = useCallback(() => {
    const dataUrl = dataUrlRef.current;
    if (!dataUrl) return Promise.resolve<SliceResult | null>(null);
    stop();
    return identify(dataUrl);
  }, [identify, stop]);

  /**
   * Fit the structures the user named, with no model call at all. This is the
   * way through when identification is unavailable, and the way to correct it
   * when it named the wrong thing.
   */
  const nameStructures = useCallback((
    names: string[],
    appears: 'bright' | 'dark',
    mirrored: boolean,
  ) => {
    if (!pixelsRef.current) return Promise.resolve<SliceResult | null>(null);
    const identity = manualIdentification(names, appears, mirrored);
    if (!identity.structures.length) {
      setState((s) => ({ ...s, error: 'Choose at least one structure to fit.' }));
      return Promise.resolve<SliceResult | null>(null);
    }
    stop();
    identityRef.current = identity;
    setState((s) => ({ ...s, identification: identity, error: '' }));
    const next = { ...settings, mode: 'atlas' as FitMode };
    setSettings(next);
    return build(next);
  }, [build, settings, stop]);

  /** Re-run with tweaked settings, reusing the cached slice and identification. */
  const retune = useCallback((patch: Partial<SliceSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    return build(next);
  }, [settings, build]);

  /**
   * Which identified structures the atlas can actually supply a mesh for.
   * The panel shows this before anything is built, so an unmatched name is
   * visible rather than silently missing from the result.
   */
  const matched = useMemo(() => {
    const identity = state.identification;
    if (!identity || !atlas) return [];
    return identity.structures.map((s) => ({
      structure: s,
      parts: matchParts(atlas, s.name, s.side).map((p) => p.name),
    }));
  }, [state.identification, atlas]);

  return {
    state, settings, matched, load, retune, reset,
    nameStructures, retryIdentify,
    ready: !!pixelsRef.current,
  };
}
