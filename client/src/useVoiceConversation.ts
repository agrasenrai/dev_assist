import { useEffect, useRef, useState } from 'react';

// Browser recognition is a demo adapter. The MCP voice_turn tool also accepts transcripts from a voice host.
export function useVoiceConversation(onTranscript: (text: string) => Promise<string>) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState('');
  const callback = useRef(onTranscript); callback.current = onTranscript;
  const control = useRef({ enabled: false, processing: false, disposed: false, recognition: null as any,
    timer: 0, speechTimer: 0, finishSpeech: null as (() => void) | null });
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const supported = Boolean(SpeechRecognition);
  const listenRef = useRef<() => void>(() => {});

  const stop = () => {
    const c = control.current; c.enabled = false;
    window.clearTimeout(c.timer);
    c.recognition?.abort(); c.recognition = null;
    window.speechSynthesis?.cancel(); c.finishSpeech?.();
    setEnabled(false); setStatus('Paused');
  };
  const speak = (text: string) => new Promise<void>(resolve => {
    if (!window.speechSynthesis) { setError('Speech playback is unavailable. The response is displayed on screen.'); resolve(); return; }
    const c = control.current;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US'; utterance.rate = 1;
    const finish = () => { window.clearTimeout(c.speechTimer); c.finishSpeech = null; resolve(); };
    c.finishSpeech = finish;
    utterance.onend = finish;
    utterance.onerror = () => { if (!c.disposed) setError('Speech playback stopped. The response remains on screen.'); finish(); };
    c.speechTimer = window.setTimeout(() => { window.speechSynthesis.cancel(); finish(); }, 120000);
    window.speechSynthesis.speak(utterance);
  });
  const submit = async (text: string) => {
    const c = control.current;
    if (c.processing) return;
    c.processing = true;
    c.recognition?.abort(); c.recognition = null;
    setStatus('Working'); setError('');
    try {
      const answer = await callback.current(text);
      if (!c.disposed) {
        setStatus('Speaking');
        await speak(answer);
      }
    } catch (e) { if (!c.disposed) setError(e instanceof Error ? e.message : String(e)); }
    finally {
      c.processing = false;
      if (!c.disposed) {
        setStatus(c.enabled ? 'Listening' : 'Ready');
        if (c.enabled) c.timer = window.setTimeout(() => listenRef.current(), 450);
      }
    }
  };
  listenRef.current = () => {
    const c = control.current;
    window.clearTimeout(c.timer);
    if (!c.enabled || c.processing || c.disposed || c.recognition || !SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    c.recognition = recognition;
    recognition.lang = 'en-US'; recognition.continuous = false; recognition.interimResults = false;
    recognition.onstart = () => setStatus('Listening');
    recognition.onresult = (event: any) => {
      const text = event.results?.[0]?.[0]?.transcript;
      if (text) void submit(text);
    };
    recognition.onend = () => {
      if (c.recognition === recognition) c.recognition = null;
      if (c.enabled && !c.processing && !c.disposed) c.timer = window.setTimeout(() => listenRef.current(), 450);
    };
    recognition.onerror = (event: any) => {
      if (['aborted', 'no-speech'].includes(event.error)) return;
      stop(); setError(`Microphone unavailable: ${event.error}. Check browser permission or use text fallback.`);
    };
    try { recognition.start(); } catch (e) { stop(); setError(String(e)); }
  };
  const start = () => { control.current.enabled = true; setEnabled(true); setError(''); listenRef.current(); };
  useEffect(() => {
    control.current.disposed = false;
    return () => {
      const c = control.current; c.disposed = true; c.enabled = false;
      window.clearTimeout(c.timer); window.clearTimeout(c.speechTimer);
      c.recognition?.abort(); c.recognition = null;
      window.speechSynthesis?.cancel(); c.finishSpeech?.();
    };
  }, []);
  return { enabled, status, error, supported, start, stop, submit };
}
