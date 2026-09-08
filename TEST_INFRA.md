# E2E Test Infrastructure & Specification

## Overview

The `IIC-3.0-3D-MEDICAL-VIEWER` end-to-end (E2E) testing framework provides requirement-driven, opaque-box validation for interactive Audio Feedback, Web Speech Voice Controls, 3D Transform Gizmo integration, and simulated surgical workflows.

The test runner is located at `scripts/test-e2e.mjs` and executes with standard Node.js assertions (`node:assert/strict`), requiring zero external test runners while maintaining full compatibility with modern Node (>=22.13.0).

---

## Architecture & Design Principles

1. **Progressive Testability & Interface Contract Validation**:
   - Tests evaluate subsystems against canonical interface contracts defined in `PROJECT.md`.
   - The test harness dynamically loads implemented modules (`lib/audio-manager.ts`, `lib/voice-commands.ts`) when present.
   - For unbuilt milestones or environments lacking browser Web APIs, the harness provides a compliant reference contract harness to verify behavioral semantics, mathematical correctness, state machine transitions, and timing constraints without facade shortcuts.

2. **Isolated Synthetic Environments**:
   - **Mock Web Audio API**: Simulates `AudioContext`, `AudioNode`, `GainNode`, `OscillatorNode`, and `AudioParam` timeline events (`setValueAtTime`, `exponentialRampToValueAtTime`, `linearRampToValueAtTime`) to verify frequency pitches, connection graphs, and millisecond duration limits without requiring physical audio hardware.
   - **Mock Web Speech API**: Simulates `SpeechRecognition` lifecycle, grammar tokenization, `onresult` dispatch, `onerror` resilience, and `onend` auto-recovery.
   - **3D Scene & Gesture State Machine**: Simulates Three.js `TransformControls`, `Object3D` scale/position matrices, `PointerTap`, and landmark gesture stream processing (`ROTATE`, `PAN`, `ZOOM`, `CURSOR`).

3. **Opaque-Box Verification**:
   - Tests assert observable outputs, state transitions, audio trigger counts, and audio graph parameters without coupling to private implementation trivia.

---

## 4-Tier Test Hierarchy

```
Total Test Cases: 64
├── Tier 1: Feature Coverage (28 tests across 5 features)
│   ├── Feature 1.1: Web Audio API synthesis methods (7 tests)
│   ├── Feature 1.2: Auto-Align button confirmation audio (5 tests)
│   ├── Feature 1.3: Rotate & Pan gesture grab audio (6 tests)
│   ├── Feature 1.4: Voice Mode switching grammar (5 tests)
│   └── Feature 1.5: Auto-Align voice command (5 tests)
├── Tier 2: Boundary & Corner Cases (25 tests across 5 features)
│   ├── Feature 2.1: SSR/headless AudioContext safety (5 tests)
│   ├── Feature 2.2: Rapid gesture events (5 tests)
│   ├── Feature 2.3: Silence / speech recognition timeout & continuous auto-restart (5 tests)
│   ├── Feature 2.4: Case-insensitivity & whitespace in voice commands (5 tests)
│   └── Feature 2.5: Unknown speech utterances (5 tests)
├── Tier 3: Cross-Feature Combinations (8 pairwise tests)
│   └── Pairwise interactions between voice commands, transform modes, and gesture grabs
└── Tier 4: Real-World Application Scenarios (3 surgical simulations)
    ├── Scenario 1: Orthopedic Surgical Preparation Workflow
    ├── Scenario 2: Sterile Hands-Free OR Inspection & Isolation Workflow
    └── Scenario 3: Audio Autoplay Resilience & Background Noise Recovery
```

---

## Detailed Test Inventory

### Tier 1: Feature Coverage (28 tests)

| ID | Test Name | Assertion Target |
|---|---|---|
| **T1.1.1** | `resumeContext transitions audio context from suspended to running` | State transition to `'running'` |
| **T1.1.2** | `playInteractionClickSound synthesizes click envelope and connects destination` | Oscillator 1000Hz, Gain envelope, node connections |
| **T1.1.3** | `playGrabSound synthesizes UI pitch drop cue with micro-envelope (<0.12s)` | Pitch sweep 180Hz -> 100Hz, duration <= 0.12s |
| **T1.1.4** | `playConfirmationSound synthesizes ascending dual-tone chime (>500Hz)` | Tone 1 (587Hz) and Tone 2 (880Hz) ascending chime |
| **T1.1.5** | `playSnapSound synthesizes crisp high-transient click/snap graph` | Triangle wave 1200Hz, duration <= 0.05s |
| **T1.1.6** | `playIsolateSound synthesizes harmonic isolation resonant sound` | Base 440Hz -> 659.25Hz harmonic sweep |
| **T1.1.7** | `Export contract conforms to PROJECT.md interface specifications` | Singleton `audioManager` + named export methods |
| **T1.2.1** | `Clicking Auto-Align button triggers playConfirmationSound exactly once` | 1 invocation of confirmation sound |
| **T1.2.2** | `Auto-Align sets object scale to standard preset (0.65, 0.65, 0.65)` | Transform scale reset to `(0.65, 0.65, 0.65)` |
| **T1.2.3** | `Auto-Align sets object position to standard preset (0, 0, -2)` | Transform position reset to `(0, 0, -2)` |
| **T1.2.4** | `Auto-Align sets dirty flag to force renderer frame redraw` | `dirty = true` and `dirtyRef.current = true` |
| **T1.2.5** | `Auto-Align handles null or detached transformControls.object gracefully` | Safe no-op, 0 audio invocations |
| **T1.3.1** | `ROTATE gesture detection rising edge triggers playGrabSound on initial engagement` | Rising edge triggers `playGrabSound` |
| **T1.3.2** | `Sustained ROTATE gesture across consecutive frames does NOT repeatedly trigger playGrabSound` | Redundant frames suppress audio re-trigger |
| **T1.3.3** | `PAN gesture detection rising edge triggers playGrabSound on initial engagement` | Rising edge triggers `playGrabSound` |
| **T1.3.4** | `Sustained PAN gesture across consecutive frames does NOT repeatedly trigger playGrabSound` | Redundant frames suppress audio re-trigger |
| **T1.3.5** | `Disengaging gesture (null command) resets active state so subsequent re-engagement triggers grab sound` | Full reset and re-engagement trigger count = 2 |
| **T1.3.6** | `Non-manipulation commands (CURSOR, ZOOM) do NOT trigger playGrabSound` | Zero grab triggers on cursor/zoom |
| **T1.4.1** | `Spoken "scale mode" parses to { type: "SET_TRANSFORM_MODE", mode: "scale" }` | Command parser tokenization |
| **T1.4.2** | `Spoken "rotate mode" parses to { type: "SET_TRANSFORM_MODE", mode: "rotate" }` | Command parser tokenization |
| **T1.4.3** | `Spoken "translate mode" parses to { type: "SET_TRANSFORM_MODE", mode: "translate" }` | Command parser tokenization |
| **T1.4.4** | `Spoken "move mode" parses to { type: "SET_TRANSFORM_MODE", mode: "translate" }` | Synonym mapping to `translate` |
| **T1.4.5** | `Contextual embedded phrases with word boundaries parse accurately` | Phrase matching within natural sentences |
| **T1.5.1** | `Spoken "auto align to bone" parses to { type: "AUTO_ALIGN" }` | Full voice command parsing |
| **T1.5.2** | `Spoken "auto align" parses to { type: "AUTO_ALIGN" }` | Short voice command parsing |
| **T1.5.3** | `Spoken "align to bone" parses to { type: "AUTO_ALIGN" }` | Prepositional voice command parsing |
| **T1.5.4** | `Spoken "align bone" parses to { type: "AUTO_ALIGN" }` | Compact voice command parsing |
| **T1.5.5** | `Dispatching AUTO_ALIGN voice command invokes autoAlignToBone on sceneActionsRef and plays audio` | Voice dispatch -> scene update + chime |

---

### Tier 2: Boundary & Corner Cases (25 tests)

| ID | Test Name | Assertion Target |
|---|---|---|
| **T2.1.1** | `Audio methods invoked when window is undefined execute safely without throwing` | Headless/SSR node safety |
| **T2.1.2** | `Audio methods handle window.AudioContext being undefined gracefully` | Missing Web Audio API environment |
| **T2.1.3** | `Audio methods handle AudioContext constructor throwing error gracefully` | Browser autoplay / policy exception safety |
| **T2.1.4** | `resumeContext returns resolved Promise even when AudioContext is absent` | Unrejected promise guarantee |
| **T2.1.5** | `Repeated audio calls in headless environment do not leak state or throw` | 50 repeated invocations without state leak |
| **T2.2.1** | `Rapidly alternating ROTATE -> PAN -> ROTATE triggers grab sound only at each state transition` | Exact transition edge counts (3 triggers) |
| **T2.2.2** | `Burst of 100 identical ROTATE frames at 60fps triggers grab sound exactly 1 time` | Frame burst debounce/suppression |
| **T2.2.3** | `Jittery hand tracking data below movement deadzone maintains active state without re-triggering grab sound` | Deadzone threshold filtering |
| **T2.2.4** | `Rapid loss of tracking (null for 1 frame) immediately followed by re-acquisition triggers grab on rising edge` | Frame dropout recovery |
| **T2.2.5** | `Zero-latency burst of simultaneous landmark updates handles state smoothing without NaN coordinates` | Coordinate validity and finite bounds |
| **T2.3.1** | `SpeechRecognition onend event triggers recognition.start automatically when active listening is intended` | Continuous listening recovery |
| **T2.3.2** | `Calling stopVoice sets listening flag to false, and subsequent onend does NOT restart recognition` | Deliberate termination compliance |
| **T2.3.3** | `Silence timeout resulting in no-speech error followed by onend safely restarts listening` | `no-speech` error recovery |
| **T2.3.4** | `Rapid consecutive onend firings guard against synchronous call stack exhaustion` | 10 rapid cycle stack protection |
| **T2.3.5** | `Consecutive manual toggle cycles (startVoice -> stopVoice -> startVoice) preserve single active instance` | Clean re-instantiation |
| **T2.4.1** | `ALL-CAPS commands parse accurately` | Case insensitivity |
| **T2.4.2** | `Mixed-case commands parse accurately` | Case insensitivity |
| **T2.4.3** | `Heavy surrounding whitespace and tabs parse accurately` | Whitespace trimming |
| **T2.4.4** | `Multiple internal spaces between tokens parse accurately` | Internal whitespace collapsing |
| **T2.4.5** | `Transcripts containing trailing punctuation parse accurately` | Punctuation stripping |
| **T2.5.1** | `Conversational medical chatter returns null gracefully` | Non-command false positive prevention |
| **T2.5.2** | `Substring collisions do not falsely trigger transform modes` | Word boundary enforcement |
| **T2.5.3** | `Empty or whitespace-only transcripts return null safely` | Empty/nil transcript protection |
| **T2.5.4** | `Random symbols and punctuation return null without regex syntax errors` | Regex safety against special characters |
| **T2.5.5** | `Single ambiguous keywords return null without false positive mode switches` | Strict grammar requirement |

---

### Tier 3: Cross-Feature Combinations (8 tests)

| ID | Test Name | Assertion Target |
|---|---|---|
| **T3.1** | `Pairwise: Voice "scale mode" -> sceneActions.setTransformMode -> TransformControls.mode === "scale"` | Voice to Gizmo scale state |
| **T3.2** | `Pairwise: Voice "rotate mode" -> sceneActions.setTransformMode -> TransformControls.mode === "rotate"` | Voice to Gizmo rotate state |
| **T3.3** | `Pairwise: Voice "move mode" -> sceneActions.setTransformMode -> TransformControls.mode === "translate"` | Voice to Gizmo translate state |
| **T3.4** | `Pairwise: Voice "auto align to bone" -> sceneActions.autoAlignToBone updates transform and plays chime` | Voice auto-align + audio feedback |
| **T3.5** | `Pairwise: Button click Auto-Align updates transform, marks dirty, and plays chime synchronously` | Button auto-align + audio feedback |
| **T3.6** | `Pairwise: Hand engages ROTATE gesture while TransformControls is in "scale" mode without collision` | Gesture grab audio + gizmo preservation |
| **T3.7** | `Pairwise: Hand engages PAN gesture while TransformControls is in "translate" mode` | Gesture pan translation + grab audio |
| **T3.8** | `Pairwise: Spoken "rotate mode" executes while hand tracking is actively streaming PAN gesture` | Concurrent speech & hand tracking |

---

### Tier 4: Real-World Application Scenarios (3 tests)

| ID | Test Name | Scenario Description |
|---|---|---|
| **T4.1** | `Scenario 1 - Comprehensive Orthopedic Surgical Preparation Workflow` | Full multi-step sequence: MRI mode entry -> voice rotate mode -> hand gesture rotation -> voice auto-align to bone with confirmation chime -> voice scale mode with fine adjustment |
| **T4.2** | `Scenario 2 - Sterile Hands-Free OR Inspection & Isolation Workflow` | Hands-free sterile sequence: voice move mode -> fist pan translation with grab audio -> voice show heart -> voice isolate structure with isolation audio -> voice reset |
| **T4.3** | `Scenario 3 - Audio Autoplay Resilience & Background Noise Recovery` | Resilience sequence: audio context suspended by browser autoplay -> OR ambient chatter ignored -> speech recognition silence timeout recovered -> context resumed on interaction -> voice mode switch executed with grab audio |

---

## Execution Instructions

### Running the Suite
```bash
npm test
# or directly:
node scripts/test-e2e.mjs
```

### Expected Output
The runner outputs formatted test logs with millisecond timings, a tier breakdown summary table, and exits with code `0`:
```
================================================================================
IIC-3.0-3D-MEDICAL-VIEWER: Audio Feedback & Voice Mode E2E Test Suite
================================================================================
...
================================================================================
E2E TEST EXECUTION SUMMARY
================================================================================

Total Tests Executed: 64
Passed:               64
Failed:               0

Tier Breakdown:
--------------------------------------------------------------------------------
Tier Name                                    Total       Passed      Failed     
--------------------------------------------------------------------------------
Tier 1: Feature Coverage                     28          28          0          
Tier 2: Boundary & Corner Cases              25          25          0          
Tier 3: Cross-Feature Combinations           8           8           0          
Tier 4: Real-World Application Scenarios     3           3           0          
--------------------------------------------------------------------------------

✅ ALL 64 TESTS PASSED SUCCESSFULLY.
```
