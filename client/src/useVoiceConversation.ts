import { useEffect, useRef, useState } from 'react';

const sentencePauseMs = 2500;

// Browser recognition is a demo adapter. The MCP voice_turn tool also accepts transcripts from a voice host.
export function useVoiceConversation(onTranscript: (text: string) => Promise<string>) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const callback = useRef(onTranscript); callback.current = onTranscript;
  const control = useRef({ enabled: false, processing: false, disposed: false, recognition: null as any,
    timer: 0, speechTimer: 0, sentenceTimer: 0, finalTranscript: '', interimTranscript: '',
    generation: 0, finishSpeech: null as (() => void) | null });
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const supported = Boolean(SpeechRecognition);
  const listenRef = useRef<() => void>(() => {});

  const stop = () => {
    const c = control.current; c.enabled = false; c.generation++;
    window.clearTimeout(c.timer);
    window.clearTimeout(c.sentenceTimer); c.sentenceTimer = 0; c.finalTranscript = ''; c.interimTranscript = '';
    c.recognition?.abort(); c.recognition = null;
    window.speechSynthesis?.cancel(); c.finishSpeech?.();
    setEnabled(false); setStatus('Paused');
  };
  const speak = (text: string) => new Promise<void>(resolve => {
    if (!window.speechSynthesis) { setError('Speech playback is unavailable. The response is displayed on screen.'); resolve(); return; }
    const c = control.current;
    const generation = c.generation;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US'; utterance.rate = 1;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true; window.clearTimeout(c.speechTimer); c.finishSpeech = null; resolve();
    };
    c.finishSpeech = finish;
    utterance.onend = finish;
    utterance.onerror = () => { if (!c.disposed && c.generation === generation) setError('Speech playback stopped. The response remains on screen.'); finish(); };
    c.speechTimer = window.setTimeout(() => {
      if (!c.disposed) setError('Speech playback timed out. The response remains on screen.');
      window.speechSynthesis.cancel(); finish();
    }, 120000);
    try { window.speechSynthesis.speak(utterance); }
    catch { setError('Speech playback is unavailable. The response remains on screen.'); finish(); }
  });
  const submit = async (text: string) => {
    const c = control.current;
    if (c.processing) return;
    window.clearTimeout(c.sentenceTimer); c.sentenceTimer = 0; c.finalTranscript = ''; c.interimTranscript = '';
    setTranscript(text);
    const generation = c.generation;
    c.processing = true;
    c.recognition?.abort(); c.recognition = null;
    setStatus('Working'); setError('');
    try {
      const answer = await callback.current(text);
      if (!c.disposed && c.generation === generation) {
        setStatus('Speaking');
        await speak(answer);
      }
    } catch (e) {
      if (!c.disposed && c.generation === generation) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('Speaking');
        await speak('I could not complete that request. Please retry the last request before starting another action.');
      }
    }
    finally {
      c.processing = false;
      if (!c.disposed) {
        setStatus(c.enabled ? 'Listening' : 'Ready');
        if (c.enabled) c.timer = window.setTimeout(() => listenRef.current(), 450);
      }
    }
  };
  const waitForSentence = () => {
    const c = control.current;
    window.clearTimeout(c.sentenceTimer);
    c.sentenceTimer = 0;
    if (!c.finalTranscript || c.interimTranscript || !c.enabled || c.disposed || c.processing) return;
    c.sentenceTimer = window.setTimeout(() => {
      c.sentenceTimer = 0;
      if (c.enabled && !c.processing && !c.disposed && !c.interimTranscript && c.finalTranscript) void submit(c.finalTranscript);
    }, sentencePauseMs);
  };
  listenRef.current = () => {
    const c = control.current;
    window.clearTimeout(c.timer);
    if (!c.enabled || c.processing || c.disposed || c.recognition || !SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    const prefix = c.finalTranscript;
    c.recognition = recognition;
    recognition.lang = navigator.language || 'en-US'; recognition.continuous = true; recognition.interimResults = true;
    recognition.onstart = () => setStatus('Listening');
    recognition.onspeechstart = () => {
      if (c.recognition === recognition) { window.clearTimeout(c.sentenceTimer); c.sentenceTimer = 0; }
    };
    recognition.onspeechend = () => { if (c.recognition === recognition) waitForSentence(); };
    recognition.onresult = (event: any) => {
      if (!c.enabled || c.recognition !== recognition || c.disposed || c.processing) return;
      const results = Array.from(event.results || []) as Array<{ isFinal: boolean; [index: number]: { transcript: string } }>;
      window.clearTimeout(c.sentenceTimer);
      c.finalTranscript = [prefix, ...results.filter(result => result.isFinal).map(result => result[0]?.transcript || '')].filter(Boolean).join(' ').trim();
      c.interimTranscript = results.filter(result => !result.isFinal).map(result => result[0]?.transcript || '').join(' ').trim();
      const heard = [c.finalTranscript,c.interimTranscript].filter(Boolean).join(' ');
      if (heard) { setTranscript(heard); setError(''); }
      waitForSentence();
    };
    recognition.onend = () => {
      if (c.recognition !== recognition) return;
      c.recognition = null;
      // Some engines end a run after a short pause; retain finalized text across the restart.
      if (!c.sentenceTimer) waitForSentence();
      if (c.enabled && !c.processing && !c.disposed) c.timer = window.setTimeout(() => listenRef.current(), 450);
    };
    recognition.onerror = (event: any) => {
      if (c.recognition !== recognition || c.disposed || !c.enabled) return;
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech') { setError('No speech detected. Check your microphone; still listening.'); return; }
      stop();
      const errors: Record<string,string> = {
        'not-allowed': 'Microphone permission is blocked. Allow the microphone in this browser’s site settings, then try again.',
        'service-not-allowed': 'Speech recognition is blocked in this browser. Open the voice workspace in Chrome or Edge.',
        'audio-capture': 'No microphone is available. Connect a microphone and check your system input settings.',
        network: 'The browser’s speech recognition service could not connect. Check your connection and try again.'
      };
      setError(errors[event.error] || `Speech recognition stopped: ${event.error}. Try the microphone again.`);
    };
    try { recognition.start(); } catch (e) { stop(); setError(String(e)); }
  };
  const start = async () => {
    if (!window.isSecureContext) { setError('Microphone access requires HTTPS or localhost. On this computer, open http://localhost:3000.'); return; }
    if (!supported) { setError('This browser does not support speech recognition. Open the voice workspace in Chrome or Edge.'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setError('Microphone capture is unavailable in this browser. Open the voice workspace in Chrome or Edge.'); return; }
    const c = control.current;
    if (c.enabled || c.processing || c.disposed) return;
    const generation = c.generation;
    c.enabled = true; setEnabled(true); setError(''); setTranscript(''); setStatus('Requesting microphone');
    c.finalTranscript = ''; c.interimTranscript = '';
    try {
      // Request permission explicitly and release the probe stream; recognition owns its own microphone capture.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      if (c.generation !== generation || c.disposed || !c.enabled) return;
      listenRef.current();
    } catch (error) {
      if (c.generation !== generation || c.disposed) return;
      stop();
      const name = error instanceof Error ? error.name : '';
      setError(name === 'NotAllowedError' ? 'Microphone permission is blocked. Allow the microphone in this browser’s site settings, then try again.'
        : name === 'NotFoundError' ? 'No microphone was found. Connect a microphone and try again.'
        : 'The microphone could not start. Check your browser permission and system input settings.');
    }
  };
  useEffect(() => {
    control.current.disposed = false;
    return () => {
      const c = control.current; c.disposed = true; c.enabled = false;
      window.clearTimeout(c.timer); window.clearTimeout(c.speechTimer); window.clearTimeout(c.sentenceTimer);
      c.recognition?.abort(); c.recognition = null;
      window.speechSynthesis?.cancel(); c.finishSpeech?.();
    };
  }, []);
  return { enabled, status, error, transcript, supported, start, stop, submit };
}
