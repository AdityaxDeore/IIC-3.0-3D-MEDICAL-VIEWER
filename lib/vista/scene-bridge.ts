import type * as T from 'three';

/**
 * Read-only handle the viewer publishes so additive features (like the
 * VISTA-3D bone reconstruction) can mount objects into the live scene without
 * the existing render loop needing to know about them.
 */
export interface AnatomySceneBridge {
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  /** The viewer only redraws when something changed; call this after mutating. */
  requestRender: () => void;
}

declare global {
  interface Window {
    __anatomyScene?: AnatomySceneBridge;
  }
}

export function getSceneBridge(): AnatomySceneBridge | null {
  return typeof window === 'undefined' ? null : window.__anatomyScene ?? null;
}
