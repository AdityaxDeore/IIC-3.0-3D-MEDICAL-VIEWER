# Project: IIC-3.0-3D-MEDICAL-VIEWER Audio & Voice Extension

## Architecture
- **Audio Feedback Subsystem** (`lib/audio-manager.ts`): Procedurally synthesized sound using Web Audio API (`AudioContext`, oscillators, gain envelopes). Provides zero-dependency, low-latency auditory feedback for UI and 3D interactions. Guards against SSR/headless environments and manages browser autoplay resumption.
- **Voice Commands Subsystem** (`lib/voice-commands.ts`): Speech recognition engine built on Web Speech API with continuous listening auto-restart resilience (`onend` recovery). Word-boundary regex parser supporting mode commands, synonym resolution, and action dispatch.
- **UI & 3D Scene Integration Bridge** (`app/page.tsx`, `app/scene.tsx`): Exposes `sceneActionsRef` to allow voice commands received at the page level to dynamically invoke `setTransformMode`, `autoAlignToBone`, etc., in `AnatomyScene`. `TransformControls` reflects the new mode dynamically. Fixes lexical scoping for `transformControlsRef` and `dirtyRef`.
- **E2E Test Infrastructure** (`scripts/test-e2e.mjs`, `package.json`): Requirement-driven 4-tier test runner validating all audio synthesis routines, voice command grammar parsing, state bridging, and simulated surgical workflows.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Procedural Audio Manager | Web Audio API sound synthesis (`playConfirmationSound`, `playGrabSound`, `playSnapSound`, `playIsolateSound`, `resumeContext`, headless guards) in `lib/audio-manager.ts` | M2 | ORIGINAL_REQUEST §R1, survey |
| 2 | Auto-Align Confirmation Sound | Clicking "Auto-Align to Bone" button triggers `playConfirmationSound()` and fixes lexical scoping bug via `transformControlsRef` | M2 | ORIGINAL_REQUEST §AC, survey |
| 3 | Hand Gesture Grab Audio | Successfully engaging "Rotate" (two fingers) or "Pan" (fist) triggers `playGrabSound()` on rising edge in `app/scene.tsx` | M2 | ORIGINAL_REQUEST §AC, survey |
| 4 | Tool & Isolation Audio | Audio feedback for surgical tool dragging/snapping and anatomy structure isolation | M2 | ORIGINAL_REQUEST §R1, survey |
| 5 | Extended Voice Command Grammar | Parser for "scale mode", "rotate mode", "translate mode" / "move mode", "auto align to bone" with word boundaries & continuous `onend` auto-restart | M3 | ORIGINAL_REQUEST §R2, survey |
| 6 | Voice TransformControls Mode Switching | Spoken "scale mode" or "rotate mode" immediately switches `TransformControls` gizmo mode via `sceneActionsRef` bridge | M3 | ORIGINAL_REQUEST §AC, survey |
| 7 | 4-Tier E2E Test Suite | Automated test runner in `scripts/test-e2e.mjs` verifying Tiers 1-4 with exit code 0 | M1 | Dual Track, survey |
| 8 | Adversarial Coverage & Forensic Audit | White-box stress testing, zero test circumvention, authentic implementation verification | M4 | Dual Track, Audit |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | E2E Testing Suite | Create test infrastructure, runner (`scripts/test-e2e.mjs`), `package.json` script, and Tiers 1-4 test cases; publish `TEST_INFRA.md` & `TEST_READY.md` | none | DONE |
| M2 | Audio Feedback Implementation | Implement `lib/audio-manager.ts`, hook confirmation sound to Auto-Align button, hook grab sound to Rotate/Pan gestures, fix `transformControlsRef` in `app/scene.tsx` | none | IN_PROGRESS |
| M3 | Voice Mode Control Implementation | Implement extended `lib/voice-commands.ts` with `parseVoiceTranscript`, `onend` auto-restart, and `sceneActionsRef` bridge in `app/page.tsx` and `app/scene.tsx` | M2 | PLANNED |
| M4 | Final Milestone & Verification | Run 100% E2E tests, execute Reviewers, Challengers, and Forensic Auditor gate verification | M1, M2, M3 | PLANNED |

## Interface Contracts

### `lib/audio-manager.ts`
```typescript
export interface AudioManager {
  resumeContext: () => Promise<void>;
  playInteractionClickSound: () => void;
  playGrabSound: () => void;
  playConfirmationSound: () => void;
  playSnapSound: () => void;
  playIsolateSound: () => void;
}
export const audioManager: AudioManager;
export function playConfirmationSound(): void;
export function playGrabSound(): void;
export function playSnapSound(): void;
export function playIsolateSound(): void;
```

### `lib/voice-commands.ts`
```typescript
export type VoiceCommand =
  | { type: 'SET_TRANSFORM_MODE'; mode: 'translate' | 'rotate' | 'scale' }
  | { type: 'SET_APP_MODE'; mode: 'standard' | 'mri' | 'exoskeleton' }
  | { type: 'SET_MRI_TARGET'; target: 'body' | 'mri' }
  | { type: 'AUTO_ALIGN' }
  | { type: 'SHOW'; term: string }
  | { type: 'HIDE'; term: string }
  | { type: 'RESET' }
  | { type: 'ISOLATE' };

export function parseVoiceTranscript(transcript: string): VoiceCommand | null;
export function initVoiceCommands(onCommand: (cmd: VoiceCommand) => void): any;
export function startVoice(): void;
export function stopVoice(): void;
```

### `app/scene.tsx` ↔ `app/page.tsx`
```typescript
export interface SceneActions {
  setTransformMode: (mode: 'translate' | 'rotate' | 'scale') => void;
  setMode: (mode: 'standard' | 'exoskeleton' | 'mri' | 'hidden') => void;
  setMriTarget: (target: 'body' | 'mri') => void;
  autoAlignToBone: () => void;
}
// Passed via sceneActionsRef prop from Home to AnatomyScene
```

## Code Layout
- `lib/audio-manager.ts` — Web Audio API procedural synthesis engine
- `lib/voice-commands.ts` — Web Speech API parser & continuous listener
- `app/scene.tsx` — 3D Three.js canvas, TransformControls, gesture audio triggers, auto-align button
- `app/page.tsx` — Top-level medical viewer page, voice controller bridge, isolation audio trigger
- `scripts/test-e2e.mjs` — Requirement-driven E2E test runner
- `TEST_INFRA.md` — Test suite architecture & coverage specifications
- `TEST_READY.md` — Signal published upon test suite readiness
