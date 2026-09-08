# Original User Request

## 2026-09-08T15:58:07Z

# Teamwork Project Prompt — Draft

> Status: Step 9 — Ready for launch — awaiting user approval
> Goal: Craft prompt → get user approval → delegate to teamwork_preview
> Requested team: [none — teamwork routes from the description]

Port the missing interactive features (Audio Feedback and extended Voice Modes) from the legacy `3D-MODEL-PLAYGROUND` and `anatomy` third-party reference folders into the modern `IIC-3.0-3D-MEDICAL-VIEWER` React/TypeScript application.

Working directory: d:\Work\Hackathons\MUJ\IIC-DeoreModel\IIC-3.0-3D-MEDICAL-VIEWER
Integrity mode: benchmark

## Requirements

### R1. Implement Audio Feedback
Extract the audio logic (e.g., `audioManager.js`) and audio assets from `IIC-MUJ/third_party/3d-model-playground/assets`. Integrate this into the medical viewer so that interactions like grabbing a surgical tool, snapping it into place, or isolating an anatomy system produce appropriate auditory feedback.

### R2. Extend Voice Commands
Analyze `SpeechManager.js` in the playground folder. Extend the current `lib/voice-commands.ts` in the medical viewer to support mode-switching via voice (e.g., saying "rotate mode" or "scale mode" immediately updates the MRI UI state without clicking). 

## Acceptance Criteria

### Audio System Integration
- [ ] Clicking the "Auto-Align to Bone" button plays a confirmation sound.
- [ ] Successfully engaging the "Rotate" or "Pan" hand gesture triggers a subtle UI "grab" sound.

### Voice Mode Control
- [ ] The user can say "scale mode" or "rotate mode" and the `TransformControls` gizmo instantly switches to that mode.
