/**
 * Voice Commands Subsystem
 * Built on Web Speech API with continuous listening auto-restart resilience.
 * Supports word-boundary regex parsing, synonym mapping, and headless/SSR safety.
 */

export type VoiceCommand =
  | { type: 'SET_TRANSFORM_MODE'; mode: 'translate' | 'rotate' | 'scale' }
  | { type: 'SET_APP_MODE'; mode: 'standard' | 'mri' | 'exoskeleton' }
  | { type: 'SET_MRI_TARGET'; target: 'body' | 'mri' }
  | { type: 'AUTO_ALIGN' }
  | { type: 'SHOW'; term: string }
  | { type: 'HIDE'; term: string }
  | { type: 'RESET' }
  | { type: 'ISOLATE' };

export type VoiceCallback = (command: VoiceCommand) => void;

let recognition: any = null;
let isExplicitlyStopped = true;
let isRecognizing = false;
let activeCallback: VoiceCallback | null = null;

/**
 * Parses spoken voice transcript using word-boundary regular expressions
 * and synonym mapping into strongly typed VoiceCommands.
 * Returns null for unrecognized speech, medical conversation, or noise.
 */
export function parseVoiceTranscript(transcript: string | null | undefined): VoiceCommand | null {
  if (!transcript || typeof transcript !== 'string') return null;

  const raw = transcript.toLowerCase().trim();
  const normalized = raw
    .replace(/[.,!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;

  // 1. Transform Mode Commands (Scale, Rotate, Translate/Move)
  // Scale
  if (
    /\b(scale|scaling|size|zoom)\s+mode\b/.test(normalized) ||
    /\bswitch\s+to\s+(?:the\s+)?(scale|scaling|size|zoom)(?:\s+mode)?\b/.test(normalized) ||
    /\b(activate|enable|set)\s+(?:the\s+)?(scale|scaling|size|zoom)\s+mode\b/.test(normalized)
  ) {
    return { type: 'SET_TRANSFORM_MODE', mode: 'scale' };
  }

  // Rotate
  if (
    /\b(rotate|rotation)\s+mode\b/.test(normalized) ||
    /\bswitch\s+to\s+(?:the\s+)?(rotate|rotation)(?:\s+mode)?\b/.test(normalized) ||
    /\b(activate|enable|set)\s+(?:the\s+)?(rotate|rotation)\s+mode\b/.test(normalized)
  ) {
    return { type: 'SET_TRANSFORM_MODE', mode: 'rotate' };
  }

  // Translate / Move / Pan / Drag
  if (
    /\b(translate|translation|move|drag|pan)\s+mode\b/.test(normalized) ||
    /\bswitch\s+to\s+(?:the\s+)?(translate|translation|move|drag|pan)(?:\s+mode)?\b/.test(normalized) ||
    /\b(activate|enable|set)\s+(?:the\s+)?(translate|translation|move|drag|pan)\s+mode\b/.test(normalized)
  ) {
    return { type: 'SET_TRANSFORM_MODE', mode: 'translate' };
  }

  // 2. Auto Align to Bone
  if (
    /\b(auto\s*align(\s+to\s+bone)?|align(\s+to)?\s+bone|snap\s+to\s+bone)\b/.test(normalized)
  ) {
    return { type: 'AUTO_ALIGN' };
  }

  // 3. App Mode Commands
  if (/\b(standard|mri|exoskeleton)\s+mode\b/.test(normalized)) {
    const match = normalized.match(/\b(standard|mri|exoskeleton)\s+mode\b/);
    if (match) {
      return { type: 'SET_APP_MODE', mode: match[1] as 'standard' | 'mri' | 'exoskeleton' };
    }
  }
  if (/\bswitch\s+to\s+(standard|mri|exoskeleton)(?:\s+mode|\s+view)?\b/.test(normalized)) {
    const match = normalized.match(/\bswitch\s+to\s+(standard|mri|exoskeleton)(?:\s+mode|\s+view)?\b/);
    if (match) {
      return { type: 'SET_APP_MODE', mode: match[1] as 'standard' | 'mri' | 'exoskeleton' };
    }
  }

  // 4. MRI Target Commands
  if (/\b(control|target|select)\s+(body|mri)\b/.test(normalized)) {
    const match = normalized.match(/\b(control|target|select)\s+(body|mri)\b/);
    if (match) {
      return { type: 'SET_MRI_TARGET', target: match[2] as 'body' | 'mri' };
    }
  }

  // 5. Isolate Command
  if (/\bisolate(\s+structure|\s+part)?\b/.test(normalized)) {
    return { type: 'ISOLATE' };
  }

  // 6. Reset Command
  if (/\b(reset(\s+view|\s+all)?|restore\s+view|default\s+view)\b/.test(normalized)) {
    return { type: 'RESET' };
  }

  // 7. Show / Find / Locate concept
  const showMatch = normalized.match(/\b(show|zoom\s+into|find|zoom\s+in\s+to|locate)\s+(.+)$/);
  if (showMatch && showMatch[2]?.trim()) {
    return { type: 'SHOW', term: showMatch[2].trim() };
  }

  // 8. Hide / Remove system
  const hideMatch = normalized.match(/\b(hide|remove)\s+(.+)$/);
  if (hideMatch && hideMatch[2]?.trim()) {
    return { type: 'HIDE', term: hideMatch[2].trim() };
  }

  return null;
}

/**
 * Initializes continuous Web Speech recognition with auto-restart resilience on speech timeout.
 * Headless & SSR safe.
 */
export function initVoiceCommands(onCommand: VoiceCallback): any {
  activeCallback = onCommand;

  if (typeof window === 'undefined') {
    return null;
  }

  const SpeechRecognition =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('Speech recognition is not supported in this browser.');
    return null;
  }

  if (recognition) {
    return recognition;
  }

  try {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      isRecognizing = true;
    };

    recognition.onresult = (event: any) => {
      if (!event || !event.results) return;
      const startIdx = typeof event.resultIndex === 'number' ? event.resultIndex : 0;
      for (let i = startIdx; i < event.results.length; ++i) {
        const res = event.results[i];
        if (res && (res.isFinal || res.isFinal === undefined)) {
          const text = res[0]?.transcript || '';
          console.log('Voice recognized:', text);
          const cmd = parseVoiceTranscript(text);
          if (cmd && activeCallback) {
            activeCallback(cmd);
          }
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.warn('Speech recognition error:', event?.error);
      if (event?.error === 'not-allowed') {
        isExplicitlyStopped = true;
      }
    };

    // Continuous auto-restart loop matching legacy SpeechManager.js
    recognition.onend = () => {
      isRecognizing = false;
      if (!isExplicitlyStopped && recognition?.continuous) {
        try {
          recognition.start();
        } catch {
          setTimeout(() => {
            if (!isExplicitlyStopped && !isRecognizing) {
              try {
                recognition.start();
              } catch {}
            }
          }, 500);
        }
      }
    };

    return recognition;
  } catch (err) {
    console.warn('Failed to initialize speech recognition:', err);
    return null;
  }
}

/**
 * Starts continuous voice recognition session.
 */
export function startVoice() {
  isExplicitlyStopped = false;
  if (recognition && !isRecognizing) {
    try {
      recognition.start();
    } catch {
      // Ignore transition error
    }
  }
}

/**
 * Explicitly stops continuous voice recognition session and cancels auto-restart.
 */
export function stopVoice() {
  isExplicitlyStopped = true;
  if (recognition) {
    try {
      recognition.stop();
    } catch {
      // Ignore transition error
    }
  }
}
