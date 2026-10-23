import type { ClinicalTask, ConflictItem, AuditLogItem, HandoffItem, ProviderHealth } from './types.js';
import { safeUUID } from './uuid.js';

const API_BASE = ''; // Vite proxies /api and /health in dev; production uses the same origin.
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(API_BASE + path, { ...(body === undefined ? {} : { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(90000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: HTTP ${response.status}`);
  return data as T;
}
const workflowKey = 'shiftweave:workflow:nurse_reema_02';
function workflowId() {
  let id = localStorage.getItem(workflowKey);
  if (!id) { id = `wf_run_${safeUUID()}`; localStorage.setItem(workflowKey, id); }
  return id;
}
export function fetchHealth() { return request<ProviderHealth>('/health'); }
export async function fetchTasks() { return (await request<{ tasks: ClinicalTask[] }>('/api/tasks')).tasks; }
export async function fetchConflicts() { return (await request<{ conflicts: ConflictItem[] }>('/api/conflicts')).conflicts; }
export async function fetchExecutionTrace() { return (await request<{ logs: AuditLogItem[] }>('/api/execution-trace')).logs; }
export async function fetchHandoffs() { return (await request<{ handoffs: HandoffItem[] }>('/api/handoffs')).handoffs; }
const pendingKeys = new Map<string, string>();
function retryKey(action: string) {
  let key = pendingKeys.get(action);
  if (!key) { key = safeUUID(); pendingKeys.set(action, key); }
  return key;
}
export async function resolveConflict(conflictId: string, resolvedBy: string, finalStatus: string, resolutionNote: string) {
  const action = JSON.stringify({ conflictId, resolvedBy, finalStatus, resolutionNote });
  await request(`/api/conflicts/${encodeURIComponent(conflictId)}/resolve`, { resolvedBy, finalStatus, resolutionNote,
    human_confirmed: true, idempotency_key: retryKey(action) });
  pendingKeys.delete(action);
  return true;
}
export function switchProvider(providerId: 'sqlite-edge-cache' | 'live-fhir-api') { return request('/api/provider/switch', { providerId }); }
export function sendChatMessage(utterance: string, nurseId = 'nurse_reema_02') {
  const identity = `chat:${workflowId()}:${utterance}`;
  return request<{ speech: string; workflowRunId: string; provider: string;
    toolsExecuted: Array<{ name: string; args: Record<string, unknown>; resultSummary: string; latencyMs: number }>;
    dashboardCard?: any }>('/api/chat', { utterance, nurseId, workflowRunId: workflowId(),
      outgoingNurseId: 'nurse_seema_01', incomingNurseId: nurseId,
      idempotency_key: retryKey(identity) }).then(result => { pendingKeys.delete(identity); return result; });
}
export function fetchConversation() {
  const id = localStorage.getItem(workflowKey);
  return id ? request<{ messages: Array<{ role: string; content: string; toolCall?: unknown }> }>(
    `/api/conversations/${encodeURIComponent(id)}?nurseId=nurse_reema_02`) : Promise.resolve({ messages: [] });
}
export function startNewConversation() { localStorage.removeItem(workflowKey); }
export async function acknowledgeTask(taskId: string, action: 'ACCEPT_HANDOFF' | 'FLAG_FOR_SUPERVISOR', note: string, handoffId?: string) {
  const identity = JSON.stringify({ taskId, action, note, handoffId });
  const result = await request(`/api/tasks/${encodeURIComponent(taskId)}/acknowledge`, { nurse_id: 'nurse_reema_02',
    action, resolution_note: note, handoff_id: handoffId, human_confirmed: true, idempotency_key: retryKey(identity) });
  pendingKeys.delete(identity);
  return result;
}
export function savedChaosRunId() { return localStorage.getItem('shiftweave:chaosRun'); }
export async function triggerChaos(action: 'crash' | 'recover') {
  const key = 'shiftweave:chaosRun';
  const runId = savedChaosRunId();
  if (action === 'recover' && !runId) throw new Error('Start an interruption demo first');
  const result = await request<{status:'INTERRUPTED'|'RECOVERED';workflowRunId:string;checkpointId?:string;message:string}>('/api/chaos/simulate', { action, ...(action === 'recover' ? { workflowRunId: runId } : {}) });
  if (result.workflowRunId) localStorage.setItem(key, result.workflowRunId);
  return result;
}

export async function finalizeHandoff(id: string) {
  const identity = `finalize:${id}`;
  const result = await request(`/api/handoffs/${encodeURIComponent(id)}/finalize`, { nurse_id: 'nurse_reema_02',
    human_confirmed: true, idempotency_key: retryKey(identity) });
  pendingKeys.delete(identity);
  return result;
}
