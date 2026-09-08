# Handoff Report: Audio Legacy Survey & Architecture

**Agent**: Explorer 1 (Audio Legacy Explorer)  
**Milestone**: audio-legacy-survey  
**Date**: 2026-09-08  
**Working Directory**: `d:\Work\Hackathons\MUJ\IIC-DeoreModel\IIC-3.0-3D-MEDICAL-VIEWER\.agents\explorer_survey_1`

---

## 1. Observation

### 1.1 Legacy Asset & Code Discovery Across Workspace
A comprehensive search was performed across `d:\Work\Hackathons\MUJ` and its subdirectories (`IIC-MUJ`, `IIC-DeoreModel`, `3d-model-playground`, `anatomy`, `IIC-3.0-3D-MEDICAL-VIEWER`):

1. **Legacy Directory Contents**:
   - `d:\Work\Hackathons\MUJ\IIC-MUJ\third_party\3d-model-playground`:
     - Files: `audioManager.js`, `game.js`, `main.js`, `SpeechManager.js`, `index.html`, `styles.css`, `README.md`
     - Assets folder `d:\Work\Hackathons\MUJ\IIC-MUJ\third_party\3d-model-playground\assets`:
       - `Stan.gltf` (3,824,289 bytes)
       - `siteOGImage.jpg` (443,630 bytes)
       - **Zero audio files exist in this directory** (no `.wav`, `.mp3`, `.ogg`, `.aac`, etc.).
   - `d:\Work\Hackathons\MUJ\IIC-MUJ\third_party\anatomy`:
     - Files: `index.html`, `favicon.svg`, `README.md`, `js/OBJLoader.js`, `js/OrbitControls.js`.
     - Grep search for `audio` and `sound` produced **0 matches**. The anatomy project does not contain any audio system or assets.
   - `d:\Work\Hackathons\MUJ\IIC-DeoreModel\Recordly`:
     - A separate Electron desktop audio/video recording app. All `.wav` references in the workspace belong to Recordly's recording pipeline (`recording.mic.wav`, `recording.system.wav`).

2. **Legacy `audioManager.js` Code Analysis**:
   - File Path: `d:\Work\Hackathons\MUJ\IIC-MUJ\third_party\3d-model-playground\audioManager.js` (86 lines).
   - Verbatim implementation of audio synthesis:
     ```javascript
     // Lines 21-42: Context instantiation & State
     export var AudioManager = function() {
         function AudioManager() {
             var AudioContext = window.AudioContext || window.webkitAudioContext;
             this.audioCtx = null;
             this.isInitialized = false;
             this.lastClickTime = 0;
             this.clickInterval = 200; // Milliseconds between clicks for rhythm
             if (AudioContext) {
                 try {
                     this.audioCtx = new AudioContext();
                     this.isInitialized = true;
                     console.log("AudioContext created successfully.");
                 } catch (e) {
                     console.error("Error creating AudioContext:", e);
                 }
             } else {
                 console.warn("Web Audio API is not supported in this browser.");
             }
         }

     // Lines 46-55: Autoplay policy resumption
     resumeContext: function resumeContext() {
         if (this.audioCtx && this.audioCtx.state === 'suspended') {
             this.audioCtx.resume().then(function() {
                 console.log("AudioContext resumed successfully.");
             }).catch(function(e) {
                 return console.error("Error resuming AudioContext:", e);
             });
         }
     }

     // Lines 58-81: Synthesized Interaction Sound
     playInteractionClickSound: function playInteractionClickSound() {
         if (!this.isInitialized || !this.audioCtx || this.audioCtx.state !== 'running') return;
         var internalCurrentTime = this.audioCtx.currentTime;
         if (internalCurrentTime - this.lastClickTime < this.clickInterval / 1000) {
             return; // Throttling: Too soon for the next click
         }
         this.lastClickTime = internalCurrentTime;
         var oscillator = this.audioCtx.createOscillator();
         var gainNode = this.audioCtx.createGain();
         oscillator.connect(gainNode);
         gainNode.connect(this.audioCtx.destination);
         oscillator.type = 'sine'; // Softer waveform for a 'tic'
         oscillator.frequency.setValueAtTime(1200, this.audioCtx.currentTime); // 1200 Hz
         oscillator.frequency.exponentialRampToValueAtTime(600, this.audioCtx.currentTime + 0.01); // Drops to 600 Hz in 10ms
         var clickVolume = 0.08;
         gainNode.gain.setValueAtTime(0, this.audioCtx.currentTime);
         gainNode.gain.linearRampToValueAtTime(clickVolume, this.audioCtx.currentTime + 0.003); // 3ms attack
         gainNode.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.005); // 2ms decay
         oscillator.start(this.audioCtx.currentTime);
         oscillator.stop(this.audioCtx.currentTime + 0.005); // Total duration: 5ms
     }
     ```

3. **Legacy Audio Triggers in `game.js`**:
   - `game.js:308`: `this.audioManager.resumeContext()` called on startup when video begins playing.
   - `game.js:1470`: `this.audioManager.resumeContext()` called on canvas click.
   - `game.js:1104-1111`:
     ```javascript
     var isThisHandActivelyInteractingForSound = false;
     if (_this1.interactionMode === 'drag' || _this1.interactionMode === 'rotate') {
         isThisHandActivelyInteractingForSound = _this1.grabbingHandIndex === i && _this1.pickedUpModel === _this1.pandaModel;
     } else if (_this1.interactionMode === 'animate') {
         isThisHandActivelyInteractingForSound = _this1.animationControlHandIndex === i;
     }
     if (hand.isPinching && isThisHandActivelyInteractingForSound && _this1.interactionMode !== 'scale') {
         _this1.audioManager.playInteractionClickSound();
     }
     ```
   - `game.js:1126-1128`:
     ```javascript
     if (hand0PinchingAndVisible && hand1PinchingAndVisible) {
         this.audioManager.playInteractionClickSound();
     }
     ```

### 1.2 Target Application State (`IIC-3.0-3D-MEDICAL-VIEWER`)
1. **Target Interaction Points**:
   - **Auto-Align to Bone Button**:
     - Path: `app/scene.tsx`, lines 396-405:
     ```tsx
     <button onClick={() => {
       if (transformControls.object) {
          transformControls.object.scale.set(0.65, 0.65, 0.65);
          transformControls.object.position.set(0, 0, -2);
          dirty = true;
       }
     }} ...>
        Auto-Align to Bone
     </button>
     ```
   - **Hand Gesture Activation (Rotate and Pan)**:
     - Path: `app/scene.tsx`, lines 280-282 (Pan):
     ```typescript
     if (cmd.type === 'PAN') {
       const hx = 1 - cmd.dx;
       const hy = cmd.dy;
       if (!panActive) {
         panActive = true;
         // ---> POINT OF GESTURE ENGAGEMENT: Trigger UI grab sound here
         panSX = hx; panSY = hy;
       }
     ```
     - Path: `app/scene.tsx`, lines 311-316 (Rotate):
     ```typescript
     if (cmd.type === 'ROTATE') {
       const hx = 1 - cmd.dx;
       const hy = cmd.dy;
       if (!rotActive) {
         rotActive = true;
         // ---> POINT OF GESTURE ENGAGEMENT: Trigger UI grab sound here
         rotSX = hx; rotSY = hy; rotSRoll = cmd.roll;
         controls.target.set(0, 0, 0);
         controls.update();
         dirty = true;
       }
     ```
   - **Surgical Tool Dragging / Snapping**:
     - Path: `app/scene.tsx`, lines 46-49:
     ```typescript
     transformControls.addEventListener('dragging-changed', (event) => { 
         controls.enabled = !event.value && !latest.current.isolate; 
         trackball.enabled = !event.value && latest.current.isolate; 
         // event.value === true -> grab tool
         // event.value === false -> release / snap tool
     });
     ```
     - Path: `app/scene.tsx`, lines 69-94: `spawnToolRef.current = (toolType: 'screw' | 'rod' | 'clip') => { ... transformControls.attach(mesh); }`
   - **Anatomy System Isolation**:
     - Path: `app/page.tsx`, line 143:
     ```tsx
     <Button className={`primary-action ${state.isolate?'active':''}`} onClick={()=>setState(s=>({...s,isolate:!s.isolate,explode:0}))}>
       <Focus size={18}/>{state.isolate?'Show surrounding anatomy':'Isolate structure'}<ChevronRight size={16}/>
     </Button>
     ```
     - Path: `app/page.tsx`, line 133:
     ```tsx
     <Button variant="ghost" className="system-name" title={`Show only ${s.name.toLowerCase()}`} onClick={()=>setState(v=>({...v,visible:[s.id],isolate:false,selected:[]}))}>
     ```
     - Path: `app/scene.tsx`, lines 184-213: Camera and mesh transition on `s.isolate`.

---

## 2. Logic Chain

1. **Asset Mapping Inferences**:
   - The user request mentions: *"Extract the audio logic (e.g., `audioManager.js`) and audio assets from `IIC-MUJ/third_party/3d-model-playground/assets`. Map out all audio assets (.wav, .mp3, .ogg, etc., including confirmation sound, grab sound, align sound, snap sound, system isolation sound)."*
   - Direct inspection of the filesystem proves there are **no `.wav`, `.mp3`, or `.ogg` files in `3d-model-playground/assets` or anywhere in `3d-model-playground`**.
   - Analysis of `audioManager.js` demonstrates that legacy audio was built entirely on **Web Audio API procedural sound synthesis** (`AudioContext`, `createOscillator()`, `createGain()`, exponential frequency sweeps).
   - Therefore, the modern audio architecture must follow this synthesized Web Audio API paradigm (or optionally provide synthesized Web Audio API sounds as the default with fallback for custom audio files), requiring zero external static media files, zero network bandwidth, and eliminating HTTP 404/CORS failure modes.

2. **Synthesis Design for Required Sounds**:
   Based on Web Audio API oscillators and gain envelopes, each requested sound maps cleanly to procedural synthesis:
   - **Grab Sound (`playGrabSound` / `playInteractionClickSound`)**:
     - Direct legacy port of `playInteractionClickSound()`: Sine wave starting at 1200 Hz ramping down to 600 Hz over 10ms; volume 0.08 with 3ms linear attack and 2ms exponential decay. Duration ~5-15ms.
   - **Confirmation Sound (`playConfirmationSound`)**:
     - Two-tone major third/fifth ascending chime (e.g., C5 523.25 Hz for 80ms, followed by G5 783.99 Hz for 150ms with exponential decay). Volume 0.15. Perfect for "Auto-Align to Bone" button completion.
   - **Align / Snap Sound (`playSnapSound`)**:
     - Fast mechanical snap: Triangle or high-pitched sine pulse dropping from 800 Hz to 200 Hz over 25ms, volume 0.12. Triggered when releasing TransformControls or auto-aligning.
   - **System Isolation Sound (`playIsolateSound`)**:
     - Resonant harmonic sweep: Sine wave with light bandpass resonance sliding from 330 Hz (E4) to 660 Hz (E5) over 180ms with a smooth decay. Evokes focus / deep inspection.

3. **Browser Autoplay & AudioContext Lifecycle**:
   - Web Audio API specification blocks AudioContext audio output until a user gesture (click, touch, pointerdown) occurs.
   - `resumeContext()` must be wired to user interaction listeners (e.g. `pointerdown` / `click` on the canvas/window) to seamlessly resume from `'suspended'` to `'running'`.

4. **Integration Surface**:
   - Create a clean TypeScript module in `IIC-3.0-3D-MEDICAL-VIEWER/lib/audio-manager.ts` (or `lib/audio.ts`).
   - Export a singleton `audioManager` or lightweight helper functions (`playConfirmationSound`, `playGrabSound`, `playSnapSound`, `playIsolateSound`, `resumeAudioContext`).
   - Wire calls to:
     - `app/scene.tsx` Auto-Align button -> `playConfirmationSound()`
     - `app/scene.tsx` gesture start for `PAN` and `ROTATE` -> `playGrabSound()`
     - `app/scene.tsx` TransformControls `dragging-changed` -> `playGrabSound()` / `playSnapSound()`
     - `app/page.tsx` Isolate button -> `playIsolateSound()`

---

## 3. Caveats

1. **Absence of Pre-recorded Audio Files**:
   - There are no bundled `.wav` or `.mp3` assets in the legacy playground repo. Any expectation of pre-existing sound files on disk is based on a misconception; procedurally synthesized audio was the intentional design in the legacy code.
2. **AudioContext Autoplay Policy in Headless / Automated Tests**:
   - In automated test environments without a DOM or user interaction (like Node.js unit tests or headless browsers), `window.AudioContext` may be undefined or start suspended. All audio methods must guard against `typeof window === 'undefined'` and catch/suppress autoplay errors gracefully.
3. **Gesture Throttling**:
   - Hand gesture detection runs on webcam frames (~30 FPS). If sound is triggered on every frame that `panActive` or `rotActive` is true, it creates cacophony. The sound must trigger **strictly on the rising edge** (`if (!rotActive) { rotActive = true; playGrabSound(); }`) or use the legacy 200ms `clickInterval` throttle.

---

## 4. Conclusion

- **Audio Asset Location**: No static `.wav`/`.mp3` files exist in `IIC-MUJ/third_party/3d-model-playground/assets`.
- **Implementation Strategy**: Implement a modern TypeScript Web Audio API sound manager in `lib/audio-manager.ts` inspired by legacy `audioManager.js`.
- **Procedural Sound Suite**:
  1. `playConfirmationSound()` (two-tone chime for Auto-Align button)
  2. `playGrabSound()` (subtle 1200Hz->600Hz sine click for engaging Rotate and Pan hand gestures)
  3. `playSnapSound()` (rapid mechanical transient for tool positioning / transform release)
  4. `playIsolateSound()` (smooth resonant sweep for anatomy isolation)
- **Integration Points Identified**:
  - `app/scene.tsx:404` (Auto-Align to Bone button `onClick`)
  - `app/scene.tsx:281` (Pan gesture activation rising edge)
  - `app/scene.tsx:312` (Rotate gesture activation rising edge)
  - `app/scene.tsx:46` (TransformControls `dragging-changed`)
  - `app/page.tsx:143` (Isolate structure button `onClick`)

---

## 5. Verification Method

To independently verify these findings:

1. **Verify Asset Absence in Legacy Folder**:
   Inspect directory `d:\Work\Hackathons\MUJ\IIC-MUJ\third_party\3d-model-playground\assets`:
   ```powershell
   Get-ChildItem -Path "d:\Work\Hackathons\MUJ\IIC-MUJ\third_party\3d-model-playground\assets"
   ```
   *Expected result*: Only `Stan.gltf` and `siteOGImage.jpg` exist.

2. **Verify Legacy `audioManager.js`**:
   Inspect lines 21-82 of `d:\Work\Hackathons\MUJ\IIC-MUJ\third_party\3d-model-playground\audioManager.js`:
   *Expected result*: `createOscillator()` and `createGain()` procedural synthesis with sine frequency ramp from 1200 to 600.

3. **Verify Target Interaction Points**:
   Inspect `d:\Work\Hackathons\MUJ\IIC-DeoreModel\IIC-3.0-3D-MEDICAL-VIEWER\app\scene.tsx`:
   - Line 404: Auto-Align button
   - Line 280-282: `cmd.type === 'PAN'` branch (`if (!panActive)`)
   - Line 311-313: `cmd.type === 'ROTATE'` branch (`if (!rotActive)`)
   - Line 46: `transformControls.addEventListener('dragging-changed')`
   Inspect `d:\Work\Hackathons\MUJ\IIC-DeoreModel\IIC-3.0-3D-MEDICAL-VIEWER\app\page.tsx`:
   - Line 143: `isolate` button
