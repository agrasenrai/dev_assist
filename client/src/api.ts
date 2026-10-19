import type { ClinicalTask, ConflictItem, AuditLogItem, HandoffItem, ProviderHealth } from './types.js';

const API_BASE = 'http://localhost:3000';

export async function fetchHealth(): Promise<ProviderHealth> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('Health check failed');
  return res.json();
}

export async function fetchTasks(): Promise<ClinicalTask[]> {
  const res = await fetch(`${API_BASE}/api/tasks`);
  if (!res.ok) throw new Error('Failed to fetch tasks');
  const data = await res.json();
  return data.tasks || [];
}

export async function fetchConflicts(): Promise<ConflictItem[]> {
  const res = await fetch(`${API_BASE}/api/conflicts`);
  if (!res.ok) throw new Error('Failed to fetch conflicts');
  const data = await res.json();
  return data.conflicts || [];
}

export async function fetchExecutionTrace(): Promise<AuditLogItem[]> {
  const res = await fetch(`${API_BASE}/api/execution-trace`);
  if (!res.ok) throw new Error('Failed to fetch execution trace');
  const data = await res.json();
  return data.logs || [];
}

export async function fetchHandoffs(): Promise<HandoffItem[]> {
  const res = await fetch(`${API_BASE}/api/handoffs`);
  if (!res.ok) throw new Error('Failed to fetch handoffs');
  const data = await res.json();
  return data.handoffs || [];
}

export async function resolveConflict(
  conflictId: string,
  resolvedBy = 'nurse_reema_02',
  finalStatus = 'COMPLETED',
  resolutionNote = 'Bedside verification confirmed by RN'
): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/conflicts/${conflictId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolvedBy, finalStatus, resolutionNote })
  });
  return res.ok;
}

export async function switchProvider(
  providerId: 'sqlite-edge-cache' | 'live-fhir-api'
): Promise<any> {
  const res = await fetch(`${API_BASE}/api/provider/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId })
  });
  if (!res.ok) throw new Error('Failed to switch provider');
  return res.json();
}

export async function sendChatMessage(
  utterance: string,
  nurseId = 'nurse_reema_02'
): Promise<{
  speech: string;
  workflowRunId: string;
  toolsExecuted: Array<{ name: string; args: Record<string, unknown>; resultSummary: string; latencyMs: number }>;
  dashboardCard?: any;
}> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      utterance,
      nurseId,
      shiftId: 'shift_20261019_night',
      outgoingNurseId: 'nurse_seema_01',
      incomingNurseId: 'nurse_reema_02'
    })
  });
  if (!res.ok) throw new Error('Chat request failed');
  return res.json();
}

export async function triggerChaos(action: 'crash' | 'recover'): Promise<any> {
  const res = await fetch(`${API_BASE}/api/chaos/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action })
  });
  return res.json();
}
