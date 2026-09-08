# Handoff Report — Viewer Target Architecture Survey

**Target Codebase**: `d:\Work\Hackathons\MUJ\IIC-DeoreModel\IIC-3.0-3D-MEDICAL-VIEWER`  
**Explorer**: Explorer 3 (Viewer Target Explorer)  
**Date**: 2026-09-08  
**Handoff Type**: Hard (Investigation complete)

---

## 1. Observation

Direct code observations from files, exact line numbers, and contents:

### 1.1 "Auto-Align to Bone" Button & Alignment Trigger Logic
- **Location**: `app/scene.tsx`, lines 396–405.
- **Verbatim Code**:
  ```tsx
  <button onClick={() => {
    if (transformControls.object) {
       // Simulate AI-based auto alignment by adjusting the MRI scale to match a typical isolated bone
       transformControls.object.scale.set(0.65, 0.65, 0.65);
       transformControls.object.position.set(0, 0, -2);
       dirty = true;
    }
  }} style={{background: '#3b82f6', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', border: 'none', fontWeight: 'bold'}}>
     Auto-Align to Bone
  </button>
  ```
- **Rendering Condition**:
  - `mode === 'mri'` (line 379: enabled when user clicks `"MRI Mode"` button at line 376).
  - `mriTarget === 'mri'` (line 389: enabled when user clicks `"Control MRI"` button at line 387).
- **Lexical Scope Bug Observed**:
  - `transformControls` is declared as a local `const` inside `useEffect` (`app/scene.tsx`, line 44):
    `const transformControls = new TransformControls(camera, renderer.domElement);`
  - `dirty` is declared as a local `let` inside `useEffect` (`app/scene.tsx`, line 33):
    `let disposed=false,frame=0,dirty=true,ready=false,lastView='',lastReset=-1,lastIsolate='',layoutKey='',amount=0;`
  - Neither `transformControls` nor `dirty` is defined in component outer scope or attached to a ref. The JSX `onClick` at lines 396–402 accesses them as free variables, which will produce a runtime `ReferenceError: transformControls is not defined` unless attached to a component-level `useRef`.
- **Trigger Behavior**:
  - Checks if an object is currently attached: `transformControls.object`.
  - Resets attached object scale: `.scale.set(0.65, 0.65, 0.65)`.
  - Resets attached object position: `.position.set(0, 0, -2)`.
  - Marks Three.js scene dirty: `dirty = true`.

### 1.2 Hand Gesture Recognition & Interaction Logic
- **File 1**: `lib/gestures.ts` (lines 1–97)
  - `InteractionCommand` type definition (lines 1–7):
    ```ts
    export type InteractionCommand =
      | { type: "CURSOR"; x: number; y: number; active: boolean }
      | { type: "SELECT"; x: number; y: number }
      | { type: "ROTATE"; dx: number; dy: number; roll: number }
      | { type: "ZOOM"; amount: number }
      | { type: "PAN"; dx: number; dy: number }
      | { type: "RESET" };
    ```
  - **Rotate Detection** (lines 76–81):
    ```ts
    if (indexExt && middleExt && !ringExt && !pinkyExt) {
      const tipX = (indexTip.x + middleTip.x) / 2;
      const tipY = (indexTip.y + middleTip.y) / 2;
      const roll = Math.atan2(tipY - wrist.y, tipX - wrist.x);
      return { type: "ROTATE", dx: tipX, dy: tipY, roll };
    }
    ```
  - **Pan / Grab Detection** (lines 83–88):
    ```ts
    if (!indexExt && !middleExt && !ringExt && !pinkyExt) {
      const palmX = (wrist.x + middleMCP.x) / 2;
      const palmY = (wrist.y + middleMCP.y) / 2;
      return { type: "PAN", dx: palmX, dy: palmY };
    }
    ```
  - **Zoom Detection** (lines 29–41): Two hands pinching simultaneously (`distance(thumb, index) < 0.08`).
  - **Select Detection** (lines 69–71): Single hand pinch (`indexExt && !middleExt && distance(thumbTip, indexTip) < 0.05`).
  - **Cursor Detection** (lines 91–93): Single index finger extended.

- **File 2**: `lib/hand-tracking.ts` (lines 1–153)
  - Loads `@mediapipe/tasks-vision` `HandLandmarker` (lines 31–54) using GPU delegate.
  - Webcam captured via `startCamera()` (lines 56–80) at 640x480, `audio: false`.
  - Frame loop `predictWebcam()` (lines 127–152) runs `handLandmarker.detectForVideo()`, draws skeleton via `drawExoskeleton()`, and dispatches detected gesture to `onCommand(command)`.

- **File 3**: `app/scene.tsx` (lines 251–358)
  - State variables for gestures:
    - Line 252: `let rotActive = false, rotSX = 0, rotSY = 0, rotSRoll = 0;`
    - Line 254: `let panActive = false, panSX = 0, panSY = 0;`
  - Gesture deactivation when command ends (lines 271–272):
    ```ts
    if (!cmd || cmd.type !== 'ROTATE') { rotActive = false; }
    if (!cmd || cmd.type !== 'PAN') { panActive = false; }
    ```
  - **Pan / Grab Engagement Trigger** (lines 280–282):
    ```ts
    if (!panActive) {
      panActive = true;
      panSX = hx; panSY = hy;
      // >>> EXACT TRANSITION: Pan gesture engaged <<<
    }
    ```
  - **Rotate Engagement Trigger** (lines 311–316):
    ```ts
    if (!rotActive) {
      rotActive = true;
      rotSX = hx; rotSY = hy; rotSRoll = cmd.roll;
      controls.target.set(0, 0, 0);
      controls.update();
      dirty = true;
      // >>> EXACT TRANSITION: Rotate gesture engaged <<<
    }
    ```

### 1.3 `TransformControls` and MRI UI State Flow
- **State Storage** (`app/scene.tsx`):
  - Line 20: `const [mode, setMode] = useState<"standard" | "exoskeleton" | "mri" | "hidden">("standard");`
  - Line 21: `const [mriTarget, setMriTarget] = useState<"body" | "mri">("mri");`
  - Line 22: `const [transformMode, setTransformMode] = useState<"translate" | "rotate" | "scale">("translate");`
- **Render-Loop Refs** (`app/scene.tsx`):
  - Lines 25–30:
    ```tsx
    const mriTargetRef = useRef(mriTarget);
    const transformModeRef = useRef(transformMode);
    const modeRef = useRef(mode);
    mriTargetRef.current = mriTarget;
    transformModeRef.current = transformMode;
    modeRef.current = mode;
    ```
- **UI Mode Buttons** (`app/scene.tsx` lines 392–394):
  - `Move` button: `onClick={() => setTransformMode('translate')}`
  - `Rotate` button: `onClick={() => setTransformMode('rotate')}`
  - `Scale` button: `onClick={() => setTransformMode('scale')}`
- **Three.js Instantiation & Attachment** (`app/scene.tsx` lines 44–64, 89–93):
  - Line 44: `const transformControls = new TransformControls(camera, renderer.domElement);`
  - Attached to MRI mesh on file upload: `transformControls.attach(mesh);` (line 63).
  - Attached to spawned surgical tools: `transformControls.attach(mesh);` (line 92).
  - Mode update in render loop (`animate()`, lines 179–182):
    ```tsx
    if (transformControls.mode !== transformModeRef.current) {
      transformControls.setMode(transformModeRef.current);
      dirty = true;
    }
    ```
- **Voice Commands Architecture Gap**:
  - `lib/voice-commands.ts` (lines 1–53) defines `VoiceCallback = (command: { type: 'SHOW' | 'ZOOM' | 'HIDE' | 'RESET'; term?: string }) => void`.
  - Only handles `reset`, `show`/`zoom into`/`find`, and `hide`.
  - Has no commands or recognition for mode switching (`"scale mode"`, `"rotate mode"`, `"translate mode"` / `"move mode"`).
  - `app/page.tsx` initializes `initVoiceCommands` at line 62 and routes commands to `onVoiceRef.current` (lines 48–61).
  - `AnatomyScene` (`app/scene.tsx`) manages `transformMode` internally and has no props or listeners connecting it to `Home`'s voice commands.

### 1.4 Package, Dependencies, and Testing Setup
- **`package.json`**:
  - Scripts:
    ```json
    "scripts": {
      "dev": "vite --host 0.0.0.0 --port 3016",
      "build": "vite build",
      "build:vercel": "vite build",
      "check": "tsc --noEmit"
    }
    ```
  - Dependencies: React 19 (`19.2.6`), Three.js (`^0.159.0`), `@types/three` (`^0.159.0`), `@mediapipe/tasks-vision` (`^1.0.1`), `@shadcn/react`, `lucide-react`, `tailwind-merge`.
  - DevDependencies: Vite 8 (`8.0.13`), TypeScript (`5.9.3`), `@vitejs/plugin-react` (`6.0.2`), `@tailwindcss/postcss` (`4.2.1`), `oxlint`, `wrangler`.
  - No `"test"` script exists.
  - No testing framework (`vitest`, `jest`, `@testing-library/react`) is installed.
  - No test configuration files exist (`vitest.config.*`, `jest.config.*`).
- **Existing Scripts**:
  - `scripts/validate-interactions.mjs`: Tests explosion layout packing calculations, pointer tap events (`PointerTap`), and atlas search/inspect tool contracts using Node's built-in `node:assert/strict`.
  - `scripts/validate-atlas.mjs`: Validates `atlas.json` integrity (2,234 parts, 3,432 concepts, triangle counts, buffer offsets) using Node's built-in `node:assert/strict`.

---

## 2. Logic Chain

1. **Auto-Align Confirmation Sound Trigger**:
   - **Observation**: Acceptance criterion states: *"Clicking the 'Auto-Align to Bone' button plays a confirmation sound."*
   - **Reasoning**: The button exists at `app/scene.tsx:396-405`. When clicked, it sets scale to `(0.65, 0.65, 0.65)` and position to `(0, 0, -2)`.
   - **Deduction**: Playing the confirmation sound must occur inside this `onClick` handler. Additionally, `transformControls` must be bridged through a React ref (e.g., `transformControlsRef = useRef<TransformControls | null>(null)`) so that `onClick` can access `transformControlsRef.current` without throwing a `ReferenceError`.

2. **Hand Gesture Grab Sound Trigger**:
   - **Observation**: Acceptance criterion states: *"Successfully engaging the 'Rotate' or 'Pan' hand gesture triggers a subtle UI 'grab' sound."*
   - **Reasoning**: In `app/scene.tsx`, gesture recognition messages from MediaPipe are processed on each video frame.
   - For Pan: when `cmd.type === 'PAN'`, the code evaluates `if (!panActive) { panActive = true; ... }` (lines 280–282).
   - For Rotate: when `cmd.type === 'ROTATE'`, the code evaluates `if (!rotActive) { rotActive = true; ... }` (lines 311–313).
   - When the user is not performing the gesture, `panActive` and `rotActive` are reset to `false` (lines 271–272).
   - **Deduction**: The leading edge of gesture engagement is precisely `if (!panActive)` and `if (!rotActive)`. Playing the UI "grab" sound at these exact transitions will fire once per successful gesture engagement without repetitive re-triggering during continuous dragging.

3. **Voice Mode Switching for TransformControls**:
   - **Observation**: Acceptance criterion states: *"The user can say 'scale mode' or 'rotate mode' and the `TransformControls` gizmo instantly switches to that mode."*
   - **Reasoning**: Currently:
     - `lib/voice-commands.ts` parses speech transcripts but only checks for `reset`, `show`, and `hide`.
     - `app/page.tsx` receives these commands in `onVoiceRef.current` and does not track or expose transform modes.
     - `app/scene.tsx` holds `transformMode` state (`"translate" | "rotate" | "scale"`), and its per-frame loop updates `transformControls.setMode(transformModeRef.current)` when `transformControls.mode !== transformModeRef.current`.
   - **Deduction**:
     - `lib/voice-commands.ts` must be extended to recognize transcripts such as `"scale mode"`, `"rotate mode"`, `"translate mode"`, `"move mode"` and dispatch a command `{ type: 'MODE', mode: 'scale' | 'rotate' | 'translate' }`.
     - Either `transformMode` / `setTransformMode` needs to be lifted to `Home` (`app/page.tsx`) and passed as props to `AnatomyScene`, OR `AnatomyScene` must register a handler with the voice command dispatcher.
     - Once `setTransformMode('scale')` or `setTransformMode('rotate')` is called, `transformModeRef.current` updates on re-render, and `animate()` in `app/scene.tsx` immediately calls `transformControls.setMode(...)`, satisfying the requirement.

4. **Testing Strategy**:
   - **Observation**: `package.json` contains no test runner; only Node `assert` scripts exist in `scripts/`.
   - **Reasoning**: Any automated test suite for new features (audio manager, voice command parser, gesture trigger logic) will either need:
     - Standalone Node assertion scripts in `scripts/` (consistent with `validate-interactions.mjs`), or
     - Adding `vitest` to `devDependencies` and configuring a test runner in `vite.config.ts`.

---

## 3. Caveats

- **Scope Boundary Compliance**: Per instructions, no code files were modified and no build/test commands were executed.
- **Audio Assets Not Yet Imported**: There are currently zero audio assets in `IIC-3.0-3D-MEDICAL-VIEWER/public/` or `app/`. Explorer 1 and Explorer 2 are surveying the source audio assets in `IIC-MUJ/third_party/3d-model-playground/assets`.
- **Lexical Scope Bug**: The runtime bug in `app/scene.tsx:397` (`transformControls` inside `onClick`) was identified via static code analysis; it must be fixed when integrating audio so the button does not crash on click.

---

## 4. Conclusion

The target application `IIC-3.0-3D-MEDICAL-VIEWER` has clear, pinpointed extension points for all three acceptance criteria:

1. **Auto-Align Confirmation Sound**: Hook into `app/scene.tsx:396-405` inside `<button onClick={...}>Auto-Align to Bone</button>`, after resolving the `transformControls` reference via a `useRef`.
2. **Gesture Grab Sound**: Hook into `app/scene.tsx:281` (`if (!panActive)`) and `app/scene.tsx:312` (`if (!rotActive)`), which cleanly detect the initial engagement of Pan (closed fist) and Rotate (two fingers).
3. **Voice Mode Switching**:
   - Extend `lib/voice-commands.ts` regex parsing to detect `"scale mode"`, `"rotate mode"`, and `"translate mode"` / `"move mode"`.
   - Wire the dispatched mode to `setTransformMode` in `app/scene.tsx` (via lifted state or a voice listener bridge).
   - In `app/scene.tsx:179-182`, `transformControls.setMode()` is already bound to `transformModeRef.current` and responds dynamically.
4. **Testing Setup**: Testing can follow the existing pattern in `scripts/validate-interactions.mjs` using `node:assert/strict`, or introduce `vitest`.

---

## 5. Verification Method

To independently verify the findings in this report:

1. **Verify "Auto-Align to Bone" button and scope**:
   - Inspect `app/scene.tsx` lines 396–405 to observe the button markup and the reference to `transformControls.object`.
   - Inspect `app/scene.tsx` line 44 and line 33 to confirm `transformControls` and `dirty` are declared within the `useEffect` scope and not component scope.
2. **Verify Gesture Engagement Transitions**:
   - Inspect `lib/gestures.ts` lines 76–88 for `ROTATE` and `PAN` detection definitions.
   - Inspect `app/scene.tsx` lines 271–333 to confirm `rotActive` and `panActive` gating logic.
3. **Verify TransformControls & State Flow**:
   - Inspect `app/scene.tsx` lines 20–30 for `transformMode` state and ref sync.
   - Inspect `app/scene.tsx` lines 179–182 for `transformControls.setMode(transformModeRef.current)`.
   - Inspect `lib/voice-commands.ts` lines 20–33 to confirm absent mode-switching commands.
4. **Verify Test Environment**:
   - Inspect `package.json` lines 8–13 to confirm scripts (`dev`, `build`, `build:vercel`, `check`).
   - Inspect `scripts/validate-interactions.mjs` lines 1–42 to review the existing Node `assert` validation pattern.
