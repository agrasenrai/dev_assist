export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'FLAGGED_CONFLICT';
export type TaskPriority = 'ROUTINE' | 'URGENT' | 'STAT';

export interface ClinicalTask {
  id: string;
  patientId: string;
  patientName: string;
  roomNumber: string;
  title: string;
  description: string;
  category: string;
  status: TaskStatus;
  priority: TaskPriority;
  scheduledTime: string;
  completedTime?: string | null;
  sourceSystem: string;
  transferStatus: string;
  assignedNurseId?: string;
  assignedNurseName?: string;
}

export interface ConflictItem {
  id: string;
  taskId: string;
  taskTitle: string;
  patientRoom: string;
  patientName: string;
  conflictType: string;
  systemAName: string;
  systemAVal: string;
  systemBName: string;
  systemBVal: string;
  status: 'UNRESOLVED' | 'VERIFIED_RESOLVED' | 'DISMISSED';
  resolutionNote?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  detectedAt: string;
}

export interface AuditLogItem {
  id: string;
  actorType: 'NURSE' | 'AGENT' | 'MCP_SERVER' | 'SYSTEM';
  actorId: string;
  action: string;
  targetResource: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'RECOVERED';
  latencyMs: number;
  details?: Record<string, unknown> | string;
  timestamp: string;
}

export interface HandoffItem {
  id: string;
  shiftId: string;
  outgoingNurseId: string;
  outgoingNurseName?: string;
  incomingNurseId: string;
  incomingNurseName?: string;
  status: string;
  summaryMarkdown: string;
  structuredSnapshot?: string;
  createdAt: string;
}

export interface ProviderHealth {
  status: string;
  server: string;
  specVersion: string;
  transport: string;
  activeSessions: number;
  provider: {
    id: string;
    name: string;
    isEdgeCache: boolean;
    healthy: boolean;
  };
  timestamp: string;
}

export interface ChatMessage {
  id: string;
  role: 'nurse' | 'medi';
  text: string;
  timestamp: string;
  card?: {
    title: string;
    type: string;
    metrics?: Record<string, unknown>;
    data?: unknown;
  };
  provider?: string;
  toolsExecuted?: Array<{
    name: string;
    latencyMs: number;
    resultSummary: string;
  }>;
}
