# BRIEFING — 2026-09-08T15:59:16Z

## Mission
Investigate legacy SpeechManager.js and current lib/voice-commands.ts to map command recognition, mode switching, fuzzy matching, and state dispatching for voice integration.

## 🔒 My Identity
- Archetype: explorer
- Roles: Voice Legacy Explorer
- Working directory: d:\Work\Hackathons\MUJ\IIC-DeoreModel\IIC-3.0-3D-MEDICAL-VIEWER\.agents\explorer_survey_2
- Original parent: d3d2e124-482d-476e-9632-93831c7267ad
- Milestone: Survey & Analysis

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- DO NOT modify any source code files
- DO NOT run build/test commands
- Write findings to d:\Work\Hackathons\MUJ\IIC-DeoreModel\IIC-3.0-3D-MEDICAL-VIEWER\.agents\explorer_survey_2\handoff.md

## Current Parent
- Conversation ID: d3d2e124-482d-476e-9632-93831c7267ad
- Updated: not yet

## Investigation State
- **Explored paths**:
  - Legacy `SpeechManager.js` (`d:\Work\Hackathons\MUJ\IIC-MUJ\third_party\3d-model-playground\SpeechManager.js`)
  - Legacy `game.js` interaction & speech bubble logic (`d:\Work\Hackathons\MUJ\IIC-MUJ\third_party\3d-model-playground\game.js`)
  - Target `lib/voice-commands.ts` (`d:\Work\Hackathons\MUJ\IIC-DeoreModel\IIC-3.0-3D-MEDICAL-VIEWER\lib\voice-commands.ts`)
  - Target UI state in `app/page.tsx` and `app/scene.tsx` (`TransformControls` gizmo integration)
- **Key findings**:
  - Legacy `SpeechManager.js` uses `onend` auto-restart and `interimResults: true`, mapping commands via a dictionary with synonyms.
  - Current `lib/voice-commands.ts` only supports `RESET`, `SHOW`, `HIDE` via string includes without mode switching, dies on silence (no `onend` restart), and has no connection to `app/scene.tsx`'s `transformMode`.
  - Mode switching ("rotate mode", "scale mode", "translate mode") can be bridged using a `sceneActionsRef` (analogous to `spawnToolRef`) or lifted props to dynamically set `transformControls.setMode(...)`.
- **Unexplored areas**: None within survey scope.

## Key Decisions Made
- Designed comprehensive command parser with regex word boundaries and synonym dictionary.
- Recommended `sceneActionsRef` bridge matching existing `spawnToolRef` pattern in `app/scene.tsx`.

## Artifact Index
- DISPATCH.md — Incoming task history
- progress.md — Liveness heartbeat and milestone tracking
- handoff.md — Comprehensive comparison and integration architecture report
