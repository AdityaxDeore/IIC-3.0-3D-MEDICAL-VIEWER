/**
 * The contract between the measuring worker and the atlas fitting that
 * consumes it. It lives outside the worker file so both sides can import the
 * constants: importing a value from a worker module would run the worker's
 * own `self.onmessage` on whichever thread did the importing.
 */

/** Stations sampled along a structure's long axis. */
export const PROFILE_STATIONS = 48;

export interface MeasureTarget {
  name: string;
  /** Normalised [x0, y0, x1, y1] for this structure alone. */
  roi: [number, number, number, number];
  /** True when the structure reads darker than its surroundings. */
  invert: boolean;
  /** Bone gets the second, tissue-internal threshold; soft tissue does not. */
  bone: boolean;
}

export interface SliceMeasureRequest {
  /** RGBA bytes straight from an ImageData. */
  pixels: ArrayBuffer;
  width: number;
  height: number;
  targets: MeasureTarget[];
  /** Threshold nudge away from the automatic one, -1..1. */
  bias: number;
  /** Longest in-plane axis of each ROI after downsampling. */
  detail: number;
}

export interface Measurement {
  name: string;
  ok: boolean;
  /** Why the structure could not be measured; empty when ok. */
  reason: string;
  /** Extent along the principal axis, as a fraction of the image diagonal. */
  length: number;
  /** Mean full width across the axis, as a fraction of the image diagonal. */
  width: number;
  /**
   * Full width at each station from one end of the axis to the other, as a
   * fraction of `length`. Zero where the mask did not reach that station.
   */
  profile: Float32Array;
  /** Principal axis orientation in the image plane, radians from vertical. */
  tilt: number;
  /** Share of the ROI the structure occupies, 0..1. */
  coverage: number;
  /** Threshold actually used, for the read-out. */
  threshold: number;
}

export interface SliceMeasureResponse {
  ok: true;
  measurements: Measurement[];
  /** Every mask drawn back over the slice, so the segmentation can be checked. */
  preview: Uint8ClampedArray;
  previewWidth: number;
  previewHeight: number;
  ms: number;
}
