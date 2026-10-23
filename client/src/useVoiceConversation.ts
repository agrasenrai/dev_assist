import { useEffect, useRef, useState } from 'react';

const sentencePauseMs=1500, restartDelayMs=100;
const words=(text:string)=>text.toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const playbackControl=/^(?:(?:hey )?(?:medi|alexa)[, ]*)?(?:stop|stop speaking|be quiet|quiet|listen|listen to me|wait|hold on)[.! ]*$/i;

// Keep capture alive during playback. A new utterance waits for an in-flight
// backend operation to commit; interrupting audio never retries or cancels writes.
export function useVoiceConversation(onTranscript:(text:string)=>Promise<string>){
  const [enabled,setEnabled]=useState(false),[status,setStatus]=useState('Ready');
  const [error,setError]=useState(''),[transcript,setTranscript]=useState('');
  const callback=useRef(onTranscript);callback.current=onTranscript;
  const control=useRef({enabled:false,processing:false,disposed:false,speaking:false,suppressAnswer:false,
    recognition:null as any,stream:null as MediaStream|null,timer:0,sentenceTimer:0,speechTimer:0,startupTimer:0,
    finalTranscript:'',interimTranscript:'',queuedText:'',spokenText:'',ignoreEchoUntil:0,generation:0,turn:0,
    playback:0,finishSpeech:null as (()=>void)|null,ttsEnabled:false});
  const Recognition=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
  const supported=Boolean(Recognition);
  const listenRef=useRef<()=>void>(()=>{}),submitRef=useRef<(text:string)=>Promise<void>>(async()=>{});
  const cancelSpeech=()=>{
    const c=control.current;c.playback++;c.speaking=false;
    window.clearTimeout(c.speechTimer);window.clearTimeout(c.startupTimer);
    const finish=c.finishSpeech;c.finishSpeech=null;finish?.();window.speechSynthesis?.cancel();
    c.ignoreEchoUntil=performance.now()+350;
  };
  const stop=()=>{
    const c=control.current;c.enabled=false;c.generation++;c.suppressAnswer=true;
    window.clearTimeout(c.timer);window.clearTimeout(c.sentenceTimer);
    c.finalTranscript='';c.interimTranscript='';c.queuedText='';
    const recognition=c.recognition;c.recognition=null;recognition?.abort();
    c.stream?.getTracks().forEach(track=>track.stop());c.stream=null;
    cancelSpeech();setEnabled(false);setStatus('Paused');
  };
  const interrupt=()=>{
    const c=control.current;c.suppressAnswer=true;cancelSpeech();
    if(c.enabled){setStatus('Listening');listenRef.current();}else void start();
  };
  const speak=(text:string)=>new Promise<void>(resolve=>{
    const c=control.current;cancelSpeech();const playback=c.playback,generation=c.generation;
    let finished=false,browserStarted=false,audio:HTMLAudioElement|undefined;
    const current=()=>!finished&&!c.disposed&&c.playback===playback&&c.generation===generation;
    const releaseAudio=()=>{if(!audio)return;audio.onplay=null;audio.onended=null;audio.onerror=null;audio.pause();audio.removeAttribute('src');audio.load();audio=undefined;};
    const finish=()=>{if(finished)return;finished=true;releaseAudio();window.clearTimeout(c.speechTimer);window.clearTimeout(c.startupTimer);
      if(c.playback===playback){c.finishSpeech=null;c.speaking=false;c.ignoreEchoUntil=performance.now()+350;}resolve();};
    c.finishSpeech=finish;c.speaking=true;c.spokenText=text;c.ignoreEchoUntil=0;setStatus('Speaking');
    c.speechTimer=window.setTimeout(()=>{if(current()){setError('Speech playback timed out. The response remains on screen.');window.speechSynthesis?.cancel();finish();}},120000);
    const browser=()=>{
      if(!current()||browserStarted)return;browserStarted=true;releaseAudio();window.clearTimeout(c.startupTimer);
      if(!window.speechSynthesis){setError('Speech playback is unavailable. The response is displayed on screen.');finish();return;}
      const utterance=new SpeechSynthesisUtterance(text);utterance.lang=navigator.language||'en-US';utterance.rate=1;
      utterance.onend=finish;utterance.onerror=()=>{if(current())setError('Speech playback stopped. The response remains on screen.');finish();};
      try{window.speechSynthesis.speak(utterance);}catch{setError('Speech playback is unavailable. The response remains on screen.');finish();}
    };
    if(!c.ttsEnabled){browser();return;}
    audio=new Audio(`/api/tts/stream?text=${encodeURIComponent(text)}`);
    audio.onplay=()=>{if(current())window.clearTimeout(c.startupTimer);};audio.onended=finish;
    audio.onerror=()=>{if(current()){setError('Cloud speech is unavailable; using browser speech.');browser();}};
    c.startupTimer=window.setTimeout(()=>{if(current()){setError('Cloud speech is taking too long; using browser speech.');browser();}},1800);
    void audio.play().catch(()=>{if(current())browser();});
  });
  const resetCapture=()=>{
    const c=control.current;const recognition=c.recognition;c.recognition=null;recognition?.abort();
    c.finalTranscript='';c.interimTranscript='';if(c.enabled)listenRef.current();
  };
  const submit=async(raw:string)=>{
    const text=raw.trim();if(!text)return;const c=control.current;
    if(c.processing){c.queuedText=[c.queuedText,text].filter(Boolean).join(' ');c.suppressAnswer=true;resetCapture();return;}
    cancelSpeech();window.clearTimeout(c.sentenceTimer);c.finalTranscript='';c.interimTranscript='';c.queuedText='';c.suppressAnswer=false;
    const generation=c.generation,turn=++c.turn;c.processing=true;setTranscript(text);setStatus('Working');setError('');
    resetCapture();
    try{
      const answer=await callback.current(text);c.processing=false;
      if(!c.disposed&&c.generation===generation&&!c.suppressAnswer&&!c.queuedText)await speak(answer);
    }catch(e){c.processing=false;if(!c.disposed&&c.generation===generation&&!c.suppressAnswer){
      setError(e instanceof Error?e.message:String(e));await speak('I could not complete that request. Please retry the last request before starting another action.');
    }}finally{
      if(c.turn!==turn)return;c.processing=false;
      if(!c.disposed){if(c.enabled&&c.queuedText){const queued=c.queuedText;c.queuedText='';void submitRef.current(queued);}
        else{setStatus(c.enabled?'Listening':'Ready');if(c.enabled)listenRef.current();}}
    }
  };
  submitRef.current=submit;
  const waitForSentence=()=>{
    const c=control.current;window.clearTimeout(c.sentenceTimer);c.sentenceTimer=0;
    if(!c.finalTranscript||c.interimTranscript||!c.enabled||c.disposed||c.speaking)return;
    const delay=/^(?:confirm|yes confirm|cancel|no cancel)[.! ]*$/i.test(c.finalTranscript)?450:sentencePauseMs;
    c.sentenceTimer=window.setTimeout(()=>{c.sentenceTimer=0;if(c.enabled&&!c.disposed&&!c.interimTranscript&&c.finalTranscript){
      const text=c.finalTranscript;c.finalTranscript='';void submitRef.current(text);
    }},delay);
  };
  listenRef.current=()=>{
    const c=control.current;window.clearTimeout(c.timer);if(!c.enabled||c.disposed||c.recognition||!Recognition)return;
    const recognition=new Recognition();c.recognition=recognition;const prefix=c.finalTranscript;let discarded=0,inputStartedDuringPlayback=false;
    recognition.lang=navigator.language||'en-US';recognition.continuous=true;recognition.interimResults=true;
    recognition.onstart=()=>{if(c.recognition===recognition&&!c.speaking&&!c.processing)setStatus('Listening');};
    recognition.onspeechstart=()=>{if(c.recognition===recognition){window.clearTimeout(c.sentenceTimer);inputStartedDuringPlayback=c.speaking;}};
    recognition.onspeechend=()=>{if(c.recognition===recognition)waitForSentence();};
    recognition.onresult=(event:any)=>{
      if(!c.enabled||c.disposed||c.recognition!==recognition)return;
      const all=Array.from(event.results||[]) as Array<{isFinal:boolean;[index:number]:{transcript:string}}>;
      const results=all.slice(discarded),heard=results.map(result=>result[0]?.transcript||'').join(' ').trim();if(!heard)return;
      const echo=words(heard),spoken=words(c.spokenText);
      if((c.speaking||(inputStartedDuringPlayback&&performance.now()<c.ignoreEchoUntil))&&!playbackControl.test(heard)&&echo&&spoken.includes(echo)){
        discarded=all.filter(result=>result.isFinal).length;c.finalTranscript='';c.interimTranscript='';return;
      }
      const wasSpeaking=c.speaking,wasProcessing=c.processing;
      if(wasSpeaking||c.processing){c.suppressAnswer=true;cancelSpeech();setStatus('Listening');}
      if((wasSpeaking||wasProcessing)&&playbackControl.test(heard)){
        discarded=all.length;c.finalTranscript='';c.interimTranscript='';setTranscript(heard);return;
      }
      window.clearTimeout(c.sentenceTimer);
      c.finalTranscript=[prefix,...results.filter(result=>result.isFinal).map(result=>result[0]?.transcript||'')].filter(Boolean).join(' ').trim();
      c.interimTranscript=results.filter(result=>!result.isFinal).map(result=>result[0]?.transcript||'').join(' ').trim();
      setTranscript([c.finalTranscript,c.interimTranscript].filter(Boolean).join(' '));setError('');waitForSentence();
    };
    recognition.onend=()=>{if(c.recognition!==recognition)return;c.recognition=null;if(!c.sentenceTimer)waitForSentence();
      if(c.enabled&&!c.disposed)c.timer=window.setTimeout(()=>listenRef.current(),restartDelayMs);};
    recognition.onerror=(event:any)=>{
      if(c.recognition!==recognition||c.disposed||!c.enabled||event.error==='aborted'||event.error==='no-speech')return;
      stop();const errors:Record<string,string>={
        'not-allowed':'Microphone permission is blocked. Allow the microphone in this browser’s site settings, then try again.',
        'service-not-allowed':'Speech recognition is blocked in this browser. Open the voice workspace in Chrome or Edge.',
        'audio-capture':'No microphone is available. Connect a microphone and check your system input settings.',
        network:'The browser’s speech recognition service could not connect. Check your connection and try again.'};
      setError(errors[event.error]||`Speech recognition stopped: ${event.error}. Try the microphone again.`);
    };
    try{const track=c.stream?.getAudioTracks?.()[0];try{track?recognition.start(track):recognition.start();}
      catch(e){if(track&&e instanceof Error&&['TypeError','NotSupportedError'].includes(e.name))recognition.start();else throw e;}
    }catch(e){stop();setError(e instanceof Error?e.message:String(e));}
  };
  const start=async()=>{
    if(!window.isSecureContext){setError('Microphone access requires HTTPS or localhost.');return;}
    if(!supported||!navigator.mediaDevices?.getUserMedia){setError('Speech recognition is unavailable. Open the voice workspace in Chrome or Edge.');return;}
    const c=control.current;if(c.enabled||c.disposed)return;const generation=c.generation;
    c.enabled=true;setEnabled(true);setError('');setTranscript('');setStatus('Requesting microphone');c.finalTranscript='';c.interimTranscript='';
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(c.generation!==generation||c.disposed||!c.enabled){stream.getTracks().forEach(track=>track.stop());return;}
      c.stream=stream;listenRef.current();
    }catch(e){if(c.generation!==generation||c.disposed)return;stop();const name=e instanceof Error?e.name:'';
      setError(name==='NotAllowedError'?'Microphone permission is blocked. Allow the microphone in this browser’s site settings, then try again.'
        :name==='NotFoundError'?'No microphone was found. Connect a microphone and try again.'
        :'The microphone could not start. Check your browser permission and system input settings.');}
  };
  useEffect(()=>{
    const c=control.current;c.disposed=false;const abort=new AbortController();
    void fetch('/api/tts/config',{signal:abort.signal}).then(r=>r.ok?r.json():{enabled:false}).then(config=>{if(!c.disposed)c.ttsEnabled=config.enabled===true;}).catch(()=>{});
    return()=>{abort.abort();c.disposed=true;c.enabled=false;c.generation++;window.clearTimeout(c.timer);window.clearTimeout(c.sentenceTimer);
      const recognition=c.recognition;c.recognition=null;recognition?.abort();c.stream?.getTracks().forEach(track=>track.stop());c.stream=null;cancelSpeech();};
  },[]);
  return {enabled,status,error,transcript,supported,start,stop,interrupt,submit};
}
