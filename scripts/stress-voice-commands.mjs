/**
 * scripts/stress-voice-commands.mjs
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST HARNESS for Challenger 2
 * Focus: Voice Mode Control Subsystem
 *
 * Targets:
 * 1. parseVoiceTranscript grammar, boundaries, noise, casing, punctuation, ReDoS
 * 2. SpeechRecognition lifecycle, onend auto-restart resilience, error handling
 * 3. Page & Scene bridge integration, gizmo mode updates, active UI button state
 */

import assert from 'node:assert/strict';

// Load the actual voice-commands module
const {
  parseVoiceTranscript,
  initVoiceCommands,
  startVoice,
  stopVoice,
} = await import('../lib/voice-commands.ts');

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;
const findings = [];

function check(name, fn) {
  totalChecks++;
  try {
    fn();
    passedChecks++;
    console.log(`  ✓ [PASS] ${name}`);
  } catch (err) {
    failedChecks++;
    findings.push({ name, error: err.message });
    console.error(`  ✗ [FAIL] ${name}: ${err.message}`);
  }
}

async function asyncCheck(name, fn) {
  totalChecks++;
  try {
    await fn();
    passedChecks++;
    console.log(`  ✓ [PASS] ${name}`);
  } catch (err) {
    failedChecks++;
    findings.push({ name, error: err.message });
    console.error(`  ✗ [FAIL] ${name}: ${err.message}`);
  }
}

console.log('\n============================================================');
console.log('CHALLENGER 2: EMPIRICAL STRESS TEST HARNESS (Voice & Mode)');
console.log('============================================================\n');

// -----------------------------------------------------------------------------
// SUITE 1: Grammar Parsing & Mode Switching Stress Test
// -----------------------------------------------------------------------------
console.log('--- SUITE 1: Grammar Parsing & Mode Switching Canonical & Synonyms ---');

const canonicalModes = [
  { transcript: 'scale mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'scale' } },
  { transcript: 'rotate mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'rotate' } },
  { transcript: 'translate mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'translate' } },
  { transcript: 'move mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'translate' } },
  { transcript: 'auto align to bone', expected: { type: 'AUTO_ALIGN' } },
];

for (const { transcript, expected } of canonicalModes) {
  check(`Canonical transcript: "${transcript}"`, () => {
    const res = parseVoiceTranscript(transcript);
    assert.deepEqual(res, expected);
  });
}

// Synonyms
const synonyms = [
  { transcript: 'zoom mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'scale' } },
  { transcript: 'size mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'scale' } },
  { transcript: 'scaling mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'scale' } },
  { transcript: 'rotation mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'rotate' } },
  { transcript: 'translation mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'translate' } },
  { transcript: 'pan mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'translate' } },
  { transcript: 'drag mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'translate' } },
  { transcript: 'snap to bone', expected: { type: 'AUTO_ALIGN' } },
  { transcript: 'align to bone', expected: { type: 'AUTO_ALIGN' } },
  { transcript: 'align bone', expected: { type: 'AUTO_ALIGN' } },
  { transcript: 'auto align', expected: { type: 'AUTO_ALIGN' } },
  { transcript: 'autoalign to bone', expected: { type: 'AUTO_ALIGN' } },
];

for (const { transcript, expected } of synonyms) {
  check(`Synonym transcript: "${transcript}"`, () => {
    const res = parseVoiceTranscript(transcript);
    assert.deepEqual(res, expected);
  });
}

// Prefix & Action Verbs
const actionVerbs = [
  { transcript: 'switch to scale mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'scale' } },
  { transcript: 'switch to rotate mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'rotate' } },
  { transcript: 'switch to translate mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'translate' } },
  { transcript: 'switch to move mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'translate' } },
  { transcript: 'switch to scale', expected: { type: 'SET_TRANSFORM_MODE', mode: 'scale' } },
  { transcript: 'switch to rotate', expected: { type: 'SET_TRANSFORM_MODE', mode: 'rotate' } },
  { transcript: 'switch to rotation', expected: { type: 'SET_TRANSFORM_MODE', mode: 'rotate' } },
  { transcript: 'switch to the rotate mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'rotate' } },
  { transcript: 'switch to the scale mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'scale' } },
  { transcript: 'activate scale mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'scale' } },
  { transcript: 'enable rotate mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'rotate' } },
  { transcript: 'set translate mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'translate' } },
  { transcript: 'set the move mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'translate' } },
];

for (const { transcript, expected } of actionVerbs) {
  check(`Action verb transcript: "${transcript}"`, () => {
    const res = parseVoiceTranscript(transcript);
    assert.deepEqual(res, expected);
  });
}

// -----------------------------------------------------------------------------
// SUITE 2: Noise Words, Conversational Fillers & Punctuation
// -----------------------------------------------------------------------------
console.log('\n--- SUITE 2: Noise Words, Conversational Fillers & Punctuation ---');

const conversationalFillers = [
  'Please switch to scale mode',
  'Can you switch to rotate mode for me',
  'Hey system please activate move mode',
  'Could we enter scale mode now',
  'Umm let us go to rotate mode',
  'Doctor requesting scale mode immediately',
  'Now switch to translate mode please',
  'Computer auto align to bone right now',
  'Please auto align to bone',
  'Can you please snap to bone thank you',
];

for (const transcript of conversationalFillers) {
  check(`Conversational filler: "${transcript}"`, () => {
    const res = parseVoiceTranscript(transcript);
    assert.ok(res !== null, `Expected valid command for: "${transcript}"`);
  });
}

// Casing and Spacing Variations
const formatVariations = [
  { transcript: '   SCALE   MODE   ', expected: { type: 'SET_TRANSFORM_MODE', mode: 'scale' } },
  { transcript: '\t\tROTATE\tMODE\n\n', expected: { type: 'SET_TRANSFORM_MODE', mode: 'rotate' } },
  { transcript: 'TrAnSlAtE     mOdE', expected: { type: 'SET_TRANSFORM_MODE', mode: 'translate' } },
  { transcript: 'mOvE  MoDe', expected: { type: 'SET_TRANSFORM_MODE', mode: 'translate' } },
  { transcript: 'AUTO    ALIGN    TO    BONE', expected: { type: 'AUTO_ALIGN' } },
];

for (const { transcript, expected } of formatVariations) {
  check(`Whitespace & Casing: ${JSON.stringify(transcript)}`, () => {
    const res = parseVoiceTranscript(transcript);
    assert.deepEqual(res, expected);
  });
}

// Standard Punctuation
const punctuationTests = [
  { transcript: 'scale mode!', expected: { type: 'SET_TRANSFORM_MODE', mode: 'scale' } },
  { transcript: 'rotate mode?', expected: { type: 'SET_TRANSFORM_MODE', mode: 'rotate' } },
  { transcript: 'move mode...', expected: { type: 'SET_TRANSFORM_MODE', mode: 'translate' } },
  { transcript: 'auto align to bone.', expected: { type: 'AUTO_ALIGN' } },
  { transcript: 'scale mode; rotate mode later', expected: { type: 'SET_TRANSFORM_MODE', mode: 'scale' } },
  { transcript: 'please, switch to rotate mode!', expected: { type: 'SET_TRANSFORM_MODE', mode: 'rotate' } },
  { transcript: 'status: move mode', expected: { type: 'SET_TRANSFORM_MODE', mode: 'translate' } },
];

for (const { transcript, expected } of punctuationTests) {
  check(`Standard punctuation: "${transcript}"`, () => {
    const res = parseVoiceTranscript(transcript);
    assert.deepEqual(res, expected);
  });
}

// Non-standard punctuation & Hyphenation exploration
const hyphenationExplorations = [
  { transcript: 'auto-align to bone', expectedMode: 'AUTO_ALIGN', expectedBehavior: 'pass' },
  { transcript: 'auto-align', expectedMode: 'AUTO_ALIGN', expectedBehavior: 'inspect' },
  { transcript: 'scale-mode', expectedMode: 'SET_TRANSFORM_MODE', expectedBehavior: 'inspect' },
  { transcript: 'rotate-mode', expectedMode: 'SET_TRANSFORM_MODE', expectedBehavior: 'inspect' },
  { transcript: 'move-mode', expectedMode: 'SET_TRANSFORM_MODE', expectedBehavior: 'inspect' },
];

for (const item of hyphenationExplorations) {
  check(`Hyphenation test: "${item.transcript}"`, () => {
    const res = parseVoiceTranscript(item.transcript);
    console.log(`    [Empirical Observation] "${item.transcript}" -> ${JSON.stringify(res)}`);
    if (item.expectedBehavior === 'pass') {
      assert.ok(res !== null, `Expected command for ${item.transcript}`);
    }
  });
}

// -----------------------------------------------------------------------------
// SUITE 3: Negative Cases & False-Positive Rejection (Adversarial)
// -----------------------------------------------------------------------------
console.log('\n--- SUITE 3: Negative Cases & False-Positive Rejection ---');

const falsePositiveAdversarial = [
  'we need to rotate the patient 45 degrees on the bed',
  'the tumor has grown significantly in scale',
  'please move the surgical tray over here',
  'let us translate these clinical findings to the paper',
  'scaling down the antibiotic dosage',
  'the ventilator mode of operation is bi-level',
  'nurse on rotating shift',
  'align the bone clamps with the retractor',
  'bone alignment looks anatomical',
  'the bone is fractured in three places',
  'patient is in recovery mode',
  'just scale',
  'just rotate',
  'just move',
  'mode only',
  'scale',
  'rotate',
  'move',
  'translate',
  'bone',
  'align',
  'mode',
  'zoom into rotate mode', // Note: zoom into is SHOW command!
];

for (const phrase of falsePositiveAdversarial) {
  check(`Reject conversational/ambiguous: "${phrase}"`, () => {
    const res = parseVoiceTranscript(phrase);
    if (phrase === 'zoom into rotate mode') {
      // In our earlier check, zoom mode matches scale mode first.
      console.log(`    [Ambiguity Observation] "${phrase}" -> ${JSON.stringify(res)}`);
    } else {
      assert.equal(res, null, `Should not match command for conversational phrase: "${phrase}"`);
    }
  });
}

// Malformed, Non-String & Boundary Inputs
check('Reject null, undefined, empty, number, object', () => {
  assert.equal(parseVoiceTranscript(null), null);
  assert.equal(parseVoiceTranscript(undefined), null);
  assert.equal(parseVoiceTranscript(''), null);
  assert.equal(parseVoiceTranscript('   '), null);
  assert.equal(parseVoiceTranscript(12345), null);
  assert.equal(parseVoiceTranscript({}), null);
  assert.equal(parseVoiceTranscript([]), null);
  assert.equal(parseVoiceTranscript(true), null);
});

// ReDoS & Extreme Input Stress
check('Survives 20,000 character noisy input without hang or ReDoS', () => {
  const noise = 'the quick brown fox jumps over the lazy dog '.repeat(400);
  const start = performance.now();
  const res = parseVoiceTranscript(noise);
  const duration = performance.now() - start;
  assert.equal(res, null);
  assert.ok(duration < 50, `Parser took ${duration}ms, must be < 50ms to prevent UI thread stutter`);
  console.log(`    [Performance] 20,000 char parsing executed in ${duration.toFixed(2)}ms`);
});

check('Matches command embedded at end of 20,000 character noise stream', () => {
  const noise = 'medical discussion test words '.repeat(600) + ' scale mode';
  const start = performance.now();
  const res = parseVoiceTranscript(noise);
  const duration = performance.now() - start;
  assert.deepEqual(res, { type: 'SET_TRANSFORM_MODE', mode: 'scale' });
  assert.ok(duration < 50, `Parser took ${duration}ms`);
});

// -----------------------------------------------------------------------------
// SUITE 4: SpeechRecognition Lifecycle & onend Auto-Restart Resilience
// -----------------------------------------------------------------------------
console.log('\n--- SUITE 4: SpeechRecognition Lifecycle & onend Auto-Restart ---');

class MockSpeechRecognitionHarness {
  constructor() {
    this.continuous = false;
    this.interimResults = false;
    this.lang = 'en-US';
    this.onstart = null;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this.isStarted = false;
    this.startCount = 0;
    this.stopCount = 0;
    this.failNextStart = false;
  }
  start() {
    if (this.failNextStart) {
      this.failNextStart = false;
      throw new Error('InvalidStateError: recognition has already started');
    }
    if (this.isStarted) {
      throw new Error('Recognition already started');
    }
    this.isStarted = true;
    this.startCount++;
    if (this.onstart) this.onstart();
  }
  stop() {
    this.isStarted = false;
    this.stopCount++;
    if (this.onend) this.onend();
  }
  simulateTranscript(text) {
    if (!this.onresult) return;
    this.onresult({
      results: [
        Object.assign([{ transcript: text }], { isFinal: true })
      ]
    });
  }
  simulateUnexpectedEnd() {
    this.isStarted = false;
    if (this.onend) this.onend();
  }
  simulateError(err) {
    if (this.onerror) this.onerror({ error: err });
  }
}

// Install mock in global window
const mockRec = new MockSpeechRecognitionHarness();
global.window = {
  SpeechRecognition: function() { return mockRec; },
};

await asyncCheck('Lifecycle: init -> startVoice -> recognizes commands', async () => {
  let lastDispatched = null;
  const rec = initVoiceCommands((cmd) => {
    lastDispatched = cmd;
  });

  assert.ok(rec, 'initVoiceCommands should return recognition instance');
  startVoice();
  assert.equal(mockRec.isStarted, true, 'recognition should be started');
  assert.equal(mockRec.startCount, 1, 'start() should be called once');

  // Emit transcript
  mockRec.simulateTranscript('scale mode');
  assert.deepEqual(lastDispatched, { type: 'SET_TRANSFORM_MODE', mode: 'scale' });

  mockRec.simulateTranscript('rotate mode');
  assert.deepEqual(lastDispatched, { type: 'SET_TRANSFORM_MODE', mode: 'rotate' });
});

await asyncCheck('onend auto-restart resilience when recognition ends unexpectedly', async () => {
  const initialStartCount = mockRec.startCount;
  // Recognition is currently running (isStarted = true)
  // Simulate unexpected drop (e.g. Chrome 60s silence timeout)
  mockRec.simulateUnexpectedEnd();

  // It should have automatically invoked recognition.start() synchronously
  assert.equal(mockRec.isStarted, true, 'Recognition should have restarted automatically');
  assert.equal(mockRec.startCount, initialStartCount + 1, 'start() should have been called again');
});

await asyncCheck('onend retry recovery via setTimeout when start() throws synchronously', async () => {
  const initialStartCount = mockRec.startCount;
  // Configure mock to throw on immediate start() (simulating Chrome race condition)
  mockRec.failNextStart = true;

  // Trigger unexpected end
  mockRec.simulateUnexpectedEnd();

  // Immediately, start failed, so isStarted is false
  assert.equal(mockRec.isStarted, false);

  // Wait 550ms for the 500ms fallback timeout to fire
  await new Promise(r => setTimeout(r, 550));

  // Now it should have succeeded in starting
  assert.equal(mockRec.isStarted, true, 'Should recover via 500ms fallback restart');
  assert.equal(mockRec.startCount, initialStartCount + 1);
});

await asyncCheck('Explicit stopVoice cancels auto-restart and leaves recognition stopped', async () => {
  stopVoice();
  assert.equal(mockRec.isStarted, false);
  const stopCount = mockRec.startCount;

  // Simulate trailing onend
  mockRec.simulateUnexpectedEnd();

  // Must NOT restart
  assert.equal(mockRec.isStarted, false);
  assert.equal(mockRec.startCount, stopCount, 'start() must not be called after stopVoice()');
});

await asyncCheck('Permission denied ("not-allowed") error disables auto-restart', async () => {
  startVoice();
  assert.equal(mockRec.isStarted, true);
  const curStarts = mockRec.startCount;

  // Permission error
  mockRec.simulateError('not-allowed');

  // Subsequent onend
  mockRec.simulateUnexpectedEnd();

  // Must NOT restart into an infinite loop
  assert.equal(mockRec.isStarted, false);
  assert.equal(mockRec.startCount, curStarts, 'start() must not be called when permission was denied');
});

await asyncCheck('Rapid toggle bursts (startVoice / stopVoice cycles) maintain correct state', async () => {
  for (let i = 0; i < 25; i++) {
    startVoice();
    stopVoice();
  }
  assert.equal(mockRec.isStarted, false, 'Final state after stopVoice should be stopped');
  mockRec.simulateUnexpectedEnd();
  assert.equal(mockRec.isStarted, false, 'Should remain stopped');
});

// -----------------------------------------------------------------------------
// SUITE 5: Bridge & UI Synchronization (SceneActions, Gizmo Mode, Active CSS)
// -----------------------------------------------------------------------------
console.log('\n--- SUITE 5: Bridge & UI Synchronization (SceneActions & Gizmo) ---');

// Mock scene integration environment
class MockTransformControls {
  constructor() {
    this.mode = 'translate';
    this.object = {
      position: { x: 1, y: 2, z: 3, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    };
  }
  setMode(m) {
    this.mode = m;
  }
}

// Simulate AnatomyScene internal mechanics (from app/scene.tsx)
const mockGizmo = new MockTransformControls();
let sceneTransformModeState = 'translate';
let sceneDirtyFlag = false;
let confirmationAudioCount = 0;

const mockAudio = {
  playConfirmationSound: () => { confirmationAudioCount++; }
};

const updateTransformMode = (m) => {
  sceneTransformModeState = m;
  mockGizmo.setMode(m);
  sceneDirtyFlag = true;
};

const autoAlignToBone = () => {
  if (mockGizmo.object) {
    mockGizmo.object.scale.set(0.65, 0.65, 0.65);
    mockGizmo.object.position.set(0, 0, -2);
    sceneDirtyFlag = true;
    mockAudio.playConfirmationSound();
  }
};

const sceneActionsRef = {
  current: {
    setTransformMode: updateTransformMode,
    autoAlignToBone: autoAlignToBone,
  }
};

// UI Active Highlight calculation matching app/scene.tsx:
// border: transformMode === 'translate' ? '2px solid #3b82f6' : '2px solid transparent'
const getButtonHighlight = (buttonType, currentMode) => {
  return currentMode === buttonType ? '2px solid #3b82f6' : '2px solid transparent';
};

check('Initial UI button highlights match default "translate" mode', () => {
  assert.equal(getButtonHighlight('translate', sceneTransformModeState), '2px solid #3b82f6');
  assert.equal(getButtonHighlight('rotate', sceneTransformModeState), '2px solid transparent');
  assert.equal(getButtonHighlight('scale', sceneTransformModeState), '2px solid transparent');
  assert.equal(mockGizmo.mode, 'translate');
});

check('Voice "scale mode" command updates gizmo and activates Scale button highlight', () => {
  const cmd = parseVoiceTranscript('scale mode');
  assert.equal(cmd.type, 'SET_TRANSFORM_MODE');
  sceneActionsRef.current.setTransformMode(cmd.mode);

  assert.equal(sceneTransformModeState, 'scale');
  assert.equal(mockGizmo.mode, 'scale');
  assert.equal(getButtonHighlight('scale', sceneTransformModeState), '2px solid #3b82f6');
  assert.equal(getButtonHighlight('rotate', sceneTransformModeState), '2px solid transparent');
  assert.equal(getButtonHighlight('translate', sceneTransformModeState), '2px solid transparent');
});

check('Voice "rotate mode" command updates gizmo and activates Rotate button highlight', () => {
  const cmd = parseVoiceTranscript('rotate mode');
  assert.equal(cmd.type, 'SET_TRANSFORM_MODE');
  sceneActionsRef.current.setTransformMode(cmd.mode);

  assert.equal(sceneTransformModeState, 'rotate');
  assert.equal(mockGizmo.mode, 'rotate');
  assert.equal(getButtonHighlight('rotate', sceneTransformModeState), '2px solid #3b82f6');
  assert.equal(getButtonHighlight('scale', sceneTransformModeState), '2px solid transparent');
  assert.equal(getButtonHighlight('translate', sceneTransformModeState), '2px solid transparent');
});

check('Voice "move mode" command updates gizmo and activates Move button highlight', () => {
  const cmd = parseVoiceTranscript('move mode');
  assert.equal(cmd.type, 'SET_TRANSFORM_MODE');
  sceneActionsRef.current.setTransformMode(cmd.mode);

  assert.equal(sceneTransformModeState, 'translate');
  assert.equal(mockGizmo.mode, 'translate');
  assert.equal(getButtonHighlight('translate', sceneTransformModeState), '2px solid #3b82f6');
  assert.equal(getButtonHighlight('rotate', sceneTransformModeState), '2px solid transparent');
  assert.equal(getButtonHighlight('scale', sceneTransformModeState), '2px solid transparent');
});

check('Voice "auto align to bone" invokes autoAlignToBone, adjusts 3D transform and plays audio', () => {
  confirmationAudioCount = 0;
  const cmd = parseVoiceTranscript('auto align to bone');
  assert.equal(cmd.type, 'AUTO_ALIGN');
  sceneActionsRef.current.autoAlignToBone();

  assert.equal(mockGizmo.object.scale.x, 0.65);
  assert.equal(mockGizmo.object.scale.y, 0.65);
  assert.equal(mockGizmo.object.scale.z, 0.65);
  assert.equal(mockGizmo.object.position.x, 0);
  assert.equal(mockGizmo.object.position.y, 0);
  assert.equal(mockGizmo.object.position.z, -2);
  assert.equal(confirmationAudioCount, 1);
  assert.equal(sceneDirtyFlag, true);
});

console.log('\n============================================================');
console.log('CHALLENGER 2 STRESS TEST EXECUTION COMPLETE');
console.log(`Total Checks:  ${totalChecks}`);
console.log(`Passed:        ${passedChecks}`);
console.log(`Failed:        ${failedChecks}`);
console.log('============================================================\n');

if (failedChecks > 0) {
  console.error(`FAILED CHECKS COUNT: ${failedChecks}`);
  process.exit(1);
} else {
  console.log('ALL EMPIRICAL CHECKS PASSED.');
  process.exit(0);
}
