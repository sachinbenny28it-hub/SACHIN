/**
 * SACHIN voice module.
 *
 * Uses the browser's native Web Speech API (SpeechRecognition +
 * SpeechSynthesis). This is real, working voice I/O while the tab is
 * open and the user has granted microphone permission — it is NOT a
 * fake. What it deliberately does NOT do is listen in the background
 * after the tab/browser is closed: no website can do that reliably.
 * Persistent, closed-app wake-word detection needs a native desktop
 * or mobile companion process (see README → "Background wake word").
 */
const SachinVoice = (() => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognitionSupported = !!SpeechRecognition;
  const speechSupported = 'speechSynthesis' in window;

  let recognizer = null;
  let wakeRecognizer = null;
  let wakeActive = false;
  let recorder = null;
  let recordingStream = null;
  let recordingTimer = null;
  let micGranted = false;

  function isSupported() { return recognitionSupported; }
  function isSpeechSupported() { return speechSupported; }
  function isRecordingSupported() { return !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder === 'function'; }

  async function convertRecordingToWav(blob) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser cannot prepare a recording for local transcription.');
    const context = new AudioContextClass();
    try {
      const audio = await context.decodeAudioData(await blob.arrayBuffer());
      const sourceRate = audio.sampleRate;
      const targetRate = 16000;
      const ratio = sourceRate / targetRate;
      const outputLength = Math.ceil(audio.length / ratio);
      const samples = new Float32Array(outputLength);
      const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
      for (let i = 0; i < outputLength; i += 1) {
        const start = Math.floor(i * ratio);
        const end = Math.min(audio.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
        let sum = 0;
        for (const channel of channels) {
          for (let j = start; j < end; j += 1) sum += channel[j] / channels.length;
        }
        samples[i] = sum / (end - start);
      }

      const dataBytes = samples.length * 2;
      const wav = new ArrayBuffer(44 + dataBytes);
      const view = new DataView(wav);
      const writeText = (offset, text) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
      writeText(0, 'RIFF');
      view.setUint32(4, 36 + dataBytes, true);
      writeText(8, 'WAVE');
      writeText(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, targetRate, true);
      view.setUint32(28, targetRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeText(36, 'data');
      view.setUint32(40, dataBytes, true);
      for (let i = 0; i < samples.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      }
      return new Blob([wav], { type: 'audio/wav' });
    } finally {
      await context.close().catch(() => {});
    }
  }

  async function requestMicPermission() {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      micGranted = true;
      return true;
    } catch {
      micGranted = false;
      return false;
    }
  }

  function hasMicPermission() { return micGranted; }

  /** One-shot: listen for a single utterance and resolve with the transcript. */
  function listenOnce({ onStart, onEnd } = {}) {
    return new Promise((resolve, reject) => {
      if (!recognitionSupported) return reject(new Error('Voice input is not supported in this browser.'));
      recognizer = new SpeechRecognition();
      recognizer.lang = 'en-US';
      recognizer.interimResults = false;
      recognizer.maxAlternatives = 1;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        onEnd?.();
        callback(value);
      };

      recognizer.onstart = () => onStart?.();
      recognizer.onerror = (e) => {
        finish(reject, new Error(e.error === 'not-allowed' ? 'Microphone access was denied.' : 'I had trouble hearing that.'));
      };
      recognizer.onresult = (e) => {
        const transcript = e.results?.[e.resultIndex]?.[0]?.transcript?.trim();
        if (transcript) finish(resolve, transcript);
      };
      recognizer.onend = () => {
        if (!settled) finish(reject, new Error('I didn’t catch that. Try speaking once more.'));
      };
      recognizer.start();
    });
  }

  function stopListening() {
    recognizer?.stop();
  }

  /** Record a short, bounded voice message for server-side transcription. */
  function recordAudio({ maxDurationMs = 20000, onStart, onEnd } = {}) {
    return new Promise((resolve, reject) => {
      if (!isRecordingSupported()) return reject(new Error('Voice recording is not supported in this browser.'));
      if (recorder && recorder.state !== 'inactive') return reject(new Error('A voice recording is already in progress.'));

      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        recordingStream = stream;
        const chunks = [];
        let settled = false;
        let activeRecorder;
        const cleanup = () => {
          if (recordingTimer) window.clearTimeout(recordingTimer);
          recordingTimer = null;
          stream.getTracks().forEach((track) => track.stop());
          recordingStream = null;
          if (recorder === activeRecorder) recorder = null;
          onEnd?.();
        };
        const fail = (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };

        try {
          const supportedTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
          const mimeType = supportedTypes.find((type) => MediaRecorder.isTypeSupported?.(type));
          activeRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
          recorder = activeRecorder;
          activeRecorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
          activeRecorder.onerror = () => fail(new Error('I had trouble recording that. Try again.'));
          activeRecorder.onstop = () => {
            if (settled) return;
            settled = true;
            const blob = new Blob(chunks, { type: activeRecorder.mimeType || 'audio/webm' });
            cleanup();
            if (!blob.size) reject(new Error('I didn’t catch any audio. Try speaking once more.'));
            else convertRecordingToWav(blob).then(resolve).catch(() => reject(new Error('I couldn’t prepare that recording. Try voice input in Chrome or Edge.')));
          };
          activeRecorder.start(250);
          onStart?.();
          recordingTimer = window.setTimeout(() => {
            if (activeRecorder.state === 'recording') activeRecorder.stop();
          }, Math.min(Math.max(maxDurationMs, 1000), 20000));
        } catch {
          fail(new Error('Could not start voice recording in this browser.'));
        }
      }).catch((error) => {
        reject(new Error(error?.name === 'NotAllowedError' ? 'Microphone access was denied.' : 'I couldn’t access the microphone. Check the browser permission and try again.'));
      });
    });
  }

  function stopRecording() {
    if (recorder && recorder.state === 'recording') recorder.stop();
  }

  /**
   * Continuous background listening (while this tab is open and focused)
   * for the user's configured wake phrase. Calls onWake(transcriptAfterWake)
   * once the phrase is detected. Must be explicitly started/stopped by the
   * user via a visible ON/OFF control — never enabled silently.
   */
  function startWakeListening(wakePhrase, onWake, onError) {
    if (!recognitionSupported) { onError?.(new Error('Voice is not supported in this browser.')); return; }
    stopWakeListening();

    wakeRecognizer = new SpeechRecognition();
    wakeRecognizer.lang = 'en-US';
    wakeRecognizer.continuous = true;
    wakeRecognizer.interimResults = false;

    const normalizedWake = normalize(wakePhrase);
    if (!normalizedWake || !normalizedWake.includes('sachin')) {
      wakeRecognizer = null;
      onError?.(new Error('The saved wake phrase is not valid.'));
      return;
    }
    wakeActive = true;
    let lastTrigger = 0;

    wakeRecognizer.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        const transcript = normalize(result[0].transcript);
        const idx = transcript.indexOf(normalizedWake);
        if (idx !== -1 && Date.now() - lastTrigger > 2500) {
          lastTrigger = Date.now();
          onWake(transcript.slice(idx + normalizedWake.length).trim());
          break;
        }
      }
    };
    wakeRecognizer.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        onError?.(new Error(e.error === 'not-allowed' ? 'Microphone permission was denied.' : 'Voice activation stopped.'));
        stopWakeListening();
      }
    };
    wakeRecognizer.onend = () => {
      // Auto-restart to stay listening, unless explicitly stopped.
      if (wakeActive && wakeRecognizer) {
        window.setTimeout(() => {
          if (!wakeActive || !wakeRecognizer) return;
          try { wakeRecognizer.start(); } catch { /* wait for the next onend cycle */ }
        }, 250);
      }
    };
    try { wakeRecognizer.start(); }
    catch (error) { stopWakeListening(); onError?.(new Error('Could not start voice activation in this browser.')); }
  }

  function stopWakeListening() {
    wakeActive = false;
    if (wakeRecognizer) {
      const r = wakeRecognizer;
      wakeRecognizer = null; // prevent auto-restart in onend
      r.stop();
    }
  }

  function speak(text, { voiceName } = {}) {
    return new Promise((resolve, reject) => {
      if (!speechSupported) return reject(new Error('Speech output is not supported.'));
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      if (voiceName) {
        const voice = window.speechSynthesis.getVoices().find((v) => v.name === voiceName);
        if (voice) utterance.voice = voice;
      }
      utterance.onend = resolve;
      utterance.onerror = () => reject(new Error('I had trouble speaking that out loud.'));
      window.speechSynthesis.speak(utterance);
    });
  }

  function stopSpeaking() {
    window.speechSynthesis?.cancel();
  }

  function listVoices() {
    return window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  }

  function normalize(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  return {
    isSupported, isSpeechSupported, isRecordingSupported, requestMicPermission, hasMicPermission,
    listenOnce, stopListening, recordAudio, stopRecording,
    startWakeListening, stopWakeListening,
    speak, stopSpeaking, listVoices
  };
})();
