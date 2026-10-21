import { useState } from 'react';
import { safeUUID } from '../uuid.js';

type Preview = { handoffId: string; patientId: string; encounterReference: string; authorReference: string;
  authorVerification: string; note: string; reviewHash: string; writesEnabled: boolean; externalSync: string };

export function EpicNoteReview({ handoffId, nurseId }: { handoffId: string; nurseId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [key] = useState(() => safeUUID());
  const [attempted, setAttempted] = useState(false);
  async function load() {
    setBusy(true); setMessage(''); setReviewed(false);
    try {
      const response = await fetch(`/api/handoffs/${encodeURIComponent(handoffId)}/epic-note-preview?nurse_id=${encodeURIComponent(nurseId)}`);
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setPreview(data);
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!preview || !reviewed || attempted) return;
    setBusy(true); setAttempted(true);
    try {
      const response = await fetch(`/api/handoffs/${encodeURIComponent(handoffId)}/publish-note`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nurse_id: nurseId, human_confirmed: true, review_hash: preview.reviewHash, idempotency_key: key, execution_mode: 'live' }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setMessage(`Epic publication: ${result.externalSync}. ${result.externalResourceId ? `DocumentReference/${result.externalResourceId}.` : ''} ${result.error || ''} ${result.warning || ''}`);
    } catch (e) { setMessage(`Publication was not confirmed: ${e instanceof Error ? e.message : String(e)}. Inspect the saved outcome before retrying.`); }
    finally { setBusy(false); }
  }
  return <section className="glass-panel" aria-label="Review Epic sandbox note">
    <h2>Epic sandbox note</h2>
    <button className="btn btn-outline" disabled={busy} onClick={load}>Preview note for review</button>
    {preview && <>
      <p>Patient/{preview.patientId} · {preview.encounterReference}</p>
      <p>Author: {preview.authorReference}. {preview.authorVerification}</p>
      <p>Saved publication status: {preview.externalSync}</p>
      <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '24rem', overflow: 'auto' }}>{preview.note}</pre>
      {!preview.writesEnabled && <p>Live publication is disabled in server configuration. This preview has not been sent.</p>}
      <label><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} disabled={busy || attempted} /> I reviewed this exact note, patient, encounter, and sandbox author.</label>
      <button className="btn btn-cyan" disabled={busy || !reviewed || !preview.writesEnabled || attempted || preview.externalSync !== 'NOT_REQUESTED'} onClick={publish}>Publish reviewed sandbox note</button>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
