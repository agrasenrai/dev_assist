import type { VoiceDisplay } from './voice-types.js';
import { safeUUID } from './uuid.js';

const sessionKey = 'shiftweave:voice:display-session';
let pageSessionId: string | undefined;

/** Start blank on each page load, while retaining old checkpoints and uncertain requests. */
export function startFreshVoiceSession() {
  if (!pageSessionId) {
    pageSessionId = safeUUID();
    localStorage.setItem(sessionKey, pageSessionId);
  }
  return pageSessionId;
}

export function voiceSessionId() {
  if (pageSessionId) return pageSessionId;
  let id = localStorage.getItem(sessionKey);
  if (!id) { id = safeUUID(); localStorage.setItem(sessionKey, id); }
  return id;
}
export async function readVoiceDisplay(): Promise<VoiceDisplay> {
  const response = await fetch(`/api/voice/${voiceSessionId()}`, { signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Display unavailable');
  return data;
}
export async function sendVoiceTurn(utterance: string, revision: number): Promise<VoiceDisplay> {
  const key = `shiftweave:voice:pending:${voiceSessionId()}`;
  const existing = localStorage.getItem(key);
  // Keep the exact request through network ambiguity, including a page refresh.
  const body = existing ? JSON.parse(existing) : { session_id: voiceSessionId(), utterance,
    expected_revision: revision, idempotency_key: safeUUID() };
  if (existing && body.utterance !== utterance) throw new Error('The previous request has an uncertain outcome. Say “retry last request” first.');
  localStorage.setItem(key, JSON.stringify(body));
  const response = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const data = await response.json();
  if (!response.ok) {
    // A revision rejection is known not to have committed; other errors may follow a commit.
    if (String(data.error).includes('Voice session changed') || response.status === 400) localStorage.removeItem(key);
    throw new Error(data.error || 'Voice request failed');
  }
  localStorage.removeItem(key);
  return data;
}
export function pendingVoiceRequest(): string | null {
  const saved = localStorage.getItem(`shiftweave:voice:pending:${voiceSessionId()}`);
  return saved ? (JSON.parse(saved) as { utterance: string }).utterance : null;
}
