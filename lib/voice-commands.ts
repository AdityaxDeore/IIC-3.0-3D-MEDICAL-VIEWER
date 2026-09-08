export type VoiceCallback = (command: { type: 'SHOW' | 'ZOOM' | 'HIDE' | 'RESET'; term?: string }) => void;

let recognition: any = null;

export function initVoiceCommands(onCommand: VoiceCallback) {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    console.warn('Speech recognition is not supported in this browser.');
    return null;
  }

  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onresult = (event: any) => {
    const lastResult = event.results[event.results.length - 1];
    if (lastResult.isFinal) {
      const transcript = lastResult[0].transcript.trim().toLowerCase();
      console.log('Heard:', transcript);

      if (transcript.includes('reset')) {
        onCommand({ type: 'RESET' });
      } else if (transcript.includes('show') || transcript.includes('zoom into') || transcript.includes('find') || transcript.includes('zoom in to')) {
        const term = transcript.replace(/show|zoom into|find|zoom in to/g, '').trim();
        if (term) onCommand({ type: 'SHOW', term });
      } else if (transcript.includes('hide')) {
        const term = transcript.replace(/hide/g, '').trim();
        if (term) onCommand({ type: 'HIDE', term });
      }
    }
  };

  recognition.onerror = (event: any) => {
    console.error('Speech recognition error:', event.error);
  };

  return recognition;
}

export function startVoice() {
  if (recognition) {
    try { recognition.start(); } catch (e) {}
  }
}

export function stopVoice() {
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
  }
}
