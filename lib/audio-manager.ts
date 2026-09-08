/// <reference types="vite/client" />
/**
 * lib/audio-manager.ts
 *
 * Procedural Web Audio API sound synthesis engine for medical viewer.
 * Provides zero-dependency, low-latency auditory feedback for 3D interactions:
 * - Confirmation chime (Auto-Align to bone)
 * - Grab audio (Rotate & Pan gestures)
 * - Snap sound (Tool positioning and TransformControls release)
 * - Isolation sound (Anatomy structure isolation)
 * - Interaction click sound (UI feedback with 200ms throttle)
 *
 * Fully safe in SSR, headless tests, and respects browser autoplay policies.
 */

export interface AudioManager {
  resumeContext: () => Promise<void>;
  playInteractionClickSound: () => void;
  playGrabSound: () => void;
  playConfirmationSound: () => void;
  playSnapSound: () => void;
  playIsolateSound: () => void;
}

let activeAudioContext: AudioContext | null = null;
let lastClickTime = -1;
const CLICK_THROTTLE_SECONDS = 0.20; // 200ms throttle between clicks

/**
 * Safely retrieves or instantiates the AudioContext singleton.
 * Returns null if running in SSR, headless Node.js without window, or if Web Audio is unsupported.
 */
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return activeAudioContext;
  }

  if (activeAudioContext && activeAudioContext.state === 'closed') {
    activeAudioContext = null;
  }

  if (!activeAudioContext) {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        activeAudioContext = new AudioContextClass();
      }
    } catch (e) {
      // Browser autoplay policy or permission error
      console.warn('AudioContext initialization deferred or restricted:', e);
      return null;
    }
  }

  return activeAudioContext;
}

/**
 * Resumes the AudioContext if it is in the suspended state.
 * Required to comply with modern browser autoplay policies on user interaction.
 */
export async function resumeContext(): Promise<void> {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      // Suppress autoplay policy rejection until next user interaction
    }
  }
}

/**
 * Synthesizes a subtle interaction click sound.
 * Throttled to 200ms to prevent cacophony during rapid gestures or rapid clicking.
 */
export function playInteractionClickSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    if (lastClickTime >= 0 && now - lastClickTime < CLICK_THROTTLE_SECONDS) {
      return; // Throttled
    }
    lastClickTime = now;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, now);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.03);
  } catch (err) {
    console.debug('Error in playInteractionClickSound:', err);
  }
}

/**
 * Synthesizes a subtle UI "grab" sound for gesture engagement (Rotate & Pan).
 * Low-pitch sweep from 180Hz down to 100Hz with a micro-envelope (<120ms).
 */
export function playGrabSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    if (ctx.state === 'suspended') {
      resumeContext();
    }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.08);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.08);
  } catch (err) {
    console.debug('Error in playGrabSound:', err);
  }
}

/**
 * Synthesizes a two-tone ascending chime (D5 587.33Hz -> A5 880.00Hz).
 * Played upon successful "Auto-Align to Bone" button click or voice command.
 */
export function playConfirmationSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    if (ctx.state === 'suspended') {
      resumeContext();
    }
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';

    osc1.frequency.setValueAtTime(587.33, now);
    osc2.frequency.setValueAtTime(880.00, now + 0.08);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.12);

    osc2.start(now + 0.08);
    osc2.stop(now + 0.28);
  } catch (err) {
    console.debug('Error in playConfirmationSound:', err);
  }
}

/**
 * Synthesizes a crisp high-transient mechanical snap sound.
 * Played when surgical tools or TransformControls snap/release into place.
 */
export function playSnapSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    if (ctx.state === 'suspended') {
      resumeContext();
    }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.04);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.04);
  } catch (err) {
    console.debug('Error in playSnapSound:', err);
  }
}

/**
 * Synthesizes a smooth harmonic resonant sweep (440Hz -> 659.25Hz).
 * Played when isolating an anatomy structure.
 */
export function playIsolateSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    if (ctx.state === 'suspended') {
      resumeContext();
    }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.linearRampToValueAtTime(659.25, now + 0.15);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.35);
  } catch (err) {
    console.debug('Error in playIsolateSound:', err);
  }
}

/**
 * Returns the current AudioContext instance.
 */
export function _getContext(): AudioContext | null {
  return activeAudioContext;
}

/**
 * Sets the active AudioContext instance (for testing/mocking).
 */
export function _setContext(c: AudioContext | null): void {
  activeAudioContext = c;
}

/**
 * Allows setting a custom AudioContext (e.g. mock context for unit/integration tests).
 */
export function setAudioContextForTesting(ctx: AudioContext | null): void {
  activeAudioContext = ctx;
}

/**
 * Resets click throttle state for testing.
 */
export function resetClickThrottleForTesting(): void {
  lastClickTime = -1;
}

// Auto-register resumption listener on first browser interaction
if (typeof window !== 'undefined') {
  const handleUserInteraction = () => {
    resumeContext();
  };
  window.addEventListener('pointerdown', handleUserInteraction, { once: true, passive: true });
  window.addEventListener('keydown', handleUserInteraction, { once: true, passive: true });
}

export const audioManager: AudioManager = {
  resumeContext,
  playInteractionClickSound,
  playGrabSound,
  playConfirmationSound,
  playSnapSound,
  playIsolateSound,
};

export default audioManager;
