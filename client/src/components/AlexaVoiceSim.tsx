import React, { useState, useEffect } from 'react';
import type { ChatMessage } from '../types.js';
import { Mic, MicOff, Send, Volume2, VolumeX, Sparkles, Bot, User, Radio } from 'lucide-react';

interface Props {
  messages: ChatMessage[];
  onSendMessage: (text: string) => Promise<void>;
  loading: boolean;
  speechEnabled: boolean;
  onToggleSpeech: () => void;
}

export const AlexaVoiceSim: React.FC<Props> = ({
  messages,
  onSendMessage,
  loading,
  speechEnabled,
  onToggleSpeech
}) => {
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [supportsSpeech, setSupportsSpeech] = useState(false);

  useEffect(() => {
    const hasWebSpeech = typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
    setSupportsSpeech(hasWebSpeech);
  }, []);

  const samplePrompts = [
    "Alexa, what is pending from Seema in ICU-B, and are there any conflicts?",
    "Alexa, resume my handoff preparation.",
    "Alexa, summarize my handoff draft."
  ];

  const handleSend = async (text: string) => {
    if (!text.trim() || loading) return;
    setInputText('');
    await onSendMessage(text);
  };

  const toggleListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Microphone voice input requires Web Speech API (supported in Google Chrome, Microsoft Edge, and Safari).");
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) {
          setInputText(transcript);
          handleSend(transcript);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn("Speech recognition error:", event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch (err) {
      console.error("Speech recognition startup failure:", err);
      setIsListening(false);
    }
  };

  return (
    <div className="glass-panel p-4" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px',
        paddingBottom: '8px',
        borderBottom: '1px solid rgba(148, 163, 184, 0.15)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '26px',
            height: '26px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Mic size={14} color="#ffffff" />
          </div>
          <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f8fafc' }}>
            Alexa+ Conversational Interface
          </h3>
          <span className="badge badge-routine" style={{ fontSize: '0.65rem' }}>Voice Sim</span>
        </div>

        <button
          onClick={onToggleSpeech}
          className="btn btn-outline"
          style={{ padding: '4px 8px', fontSize: '0.72rem' }}
          title={speechEnabled ? "Mute Voice TTS" : "Enable Voice TTS"}
        >
          {speechEnabled ? <Volume2 size={13} color="#06b6d4" /> : <VolumeX size={13} color="#64748b" />}
          <span>{speechEnabled ? "Voice ON" : "Voice Muted"}</span>
        </button>
      </div>

      {/* Suggested Quick Prompts */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
        {samplePrompts.map((p, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(p)}
            disabled={loading}
            style={{
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: '6px',
              padding: '4px 8px',
              color: '#38bdf8',
              fontSize: '0.7rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              textAlign: 'left'
            }}
          >
            <Sparkles size={11} /> {p}
          </button>
        ))}
      </div>

      {/* Message History */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        maxHeight: '320px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        paddingRight: '4px',
        marginBottom: '12px'
      }}>
        {messages.map(m => (
          <div
            key={m.id}
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start',
              flexDirection: m.role === 'nurse' ? 'row-reverse' : 'row'
            }}
          >
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: m.role === 'nurse' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(6, 182, 212, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              {m.role === 'nurse' ? <User size={14} color="#60a5fa" /> : <Bot size={14} color="#06b6d4" />}
            </div>

            <div style={{
              maxWidth: '82%',
              background: m.role === 'nurse' ? 'rgba(30, 58, 138, 0.5)' : 'rgba(15, 23, 42, 0.85)',
              border: m.role === 'nurse' ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid rgba(56, 189, 248, 0.2)',
              borderRadius: '10px',
              padding: '10px 12px'
            }}>
              <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '3px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, color: m.role === 'nurse' ? '#93c5fd' : '#38bdf8' }}>
                  {m.role === 'nurse' ? 'Reema Roy, RN' : 'Alexa+ Nursing Assistant'}
                </span>
                <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <p style={{ fontSize: '0.82rem', lineHeight: 1.45, color: '#f8fafc' }}>
                {m.text}
              </p>

              {/* Structured Dashboard Card if attached */}
              {m.card && (
                <div style={{
                  marginTop: '8px',
                  background: 'rgba(2, 6, 23, 0.8)',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid rgba(56, 189, 248, 0.2)'
                }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#38bdf8' }}>
                    📊 {m.card.title}
                  </div>
                  {m.card.metrics && (
                    <div style={{ display: 'flex', gap: '10px', marginTop: '4px', fontSize: '0.7rem', color: '#94a3b8' }}>
                      {Object.entries(m.card.metrics).map(([k, v]) => (
                        <span key={k}>
                          <strong style={{ color: '#cbd5e1' }}>{k}:</strong> {String(v)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#06b6d4', fontSize: '0.8rem', fontStyle: 'italic' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#06b6d4', display: 'inline-block' }} className="animate-pulse" />
            Alexa+ reasoning over MCP tools in Streamable HTTP...
          </div>
        )}
      </div>

      {/* Active Listening Indicator */}
      {isListening && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          borderRadius: '6px',
          padding: '6px 10px',
          marginBottom: '8px',
          color: '#fca5a5',
          fontSize: '0.75rem'
        }}>
          <Radio size={14} color="#ef4444" className="animate-pulse" />
          <span><strong>Listening via Microphone...</strong> Speak your clinical instruction now (e.g. &ldquo;Alexa, summarize my handoff draft&rdquo;)</span>
        </div>
      )}

      {/* Input Box and Voice Controls */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          placeholder={isListening ? "Listening to your voice..." : "Ask Alexa (or click the Mic to speak)..."}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend(inputText)}
          disabled={isListening}
          style={{
            flex: 1,
            background: 'rgba(15, 23, 42, 0.85)',
            border: isListening ? '1px solid #ef4444' : '1px solid rgba(148, 163, 184, 0.25)',
            borderRadius: '8px',
            padding: '8px 12px',
            color: '#f8fafc',
            fontSize: '0.85rem'
          }}
        />

        {/* Live Mic Speech Input Button */}
        {supportsSpeech && (
          <button
            type="button"
            onClick={toggleListening}
            disabled={loading}
            title={isListening ? "Click to stop listening" : "Click to speak to Alexa via Microphone"}
            className="btn"
            style={{
              padding: '8px 12px',
              background: isListening ? '#ef4444' : 'rgba(6, 182, 212, 0.2)',
              border: isListening ? '1px solid #ef4444' : '1px solid rgba(6, 182, 212, 0.4)',
              color: isListening ? '#ffffff' : '#06b6d4',
              cursor: 'pointer'
            }}
          >
            {isListening ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
        )}

        <button
          type="button"
          onClick={() => handleSend(inputText)}
          disabled={loading || !inputText.trim() || isListening}
          className="btn btn-cyan"
          style={{ padding: '8px 14px' }}
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
};
