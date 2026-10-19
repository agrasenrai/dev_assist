export type ShiftType = 'DAY' | 'NIGHT' | 'ROTATING';
export type TaskCategory = 'VITAL' | 'MEDICATION_CHECK' | 'LAB_DRAW' | 'WOUND_CARE' | 'MOBILITY' | 'CONSULT' | 'DISCHARGE_PREP';
export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'FLAGGED_CONFLICT';
export type TaskPriority = 'STAT' | 'URGENT' | 'ROUTINE';
export type TransferStatus = 'ACTIVE' | 'CARRIED_FORWARD' | 'TRANSFERRED' | 'UNASSIGNED';

export interface Patient {
  id: string;
  mrn: string;
  fullName: string;
  roomNumber: string;
  bedNumber: string;
  admissionDate: string;
  acuityLevel: number;
  allergies?: string | null;
  primaryDiagnosis: string;
  createdAt?: string;
}

export interface Nurse {
  id: string;
  badgeNumber: string;
  fullName: string;
  email: string;
  department: string;
  role: string;
  createdAt?: string;
}

export interface Shift {
  id: string;
  unitId: string;
  shiftType: ShiftType;
  startTime: string;
  endTime: string;
  status: string;
  createdAt?: string;
}

export interface Task {
  id: string;
  patientId: string;
  patientName?: string;
  roomNumber?: string;
  title: string;
  description?: string | null;
  category: TaskCategory;
  status: TaskStatus;
  priority: TaskPriority;
  scheduledTime: string;
  completedTime?: string | null;
  sourceSystem: string;
  transferStatus?: TransferStatus;
  assignedNurseId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  eventType: string;
  previousValue?: string | null;
  newValue: string;
  source: string;
  actorId: string;
  idempotencyKey?: string | null;
  timestamp: string;
  metadata?: string | null;
}

export interface IEHRProvider {
  readonly providerId: string;
  readonly providerName: string;
  readonly isEdgeCache: boolean;

  /** Health & capability check */
  ping(): Promise<boolean>;

  /** Fetch active patient roster for a nursing unit */
  getPatientsByUnit(unitId: string): Promise<Patient[]>;

  /** Fetch clinical tasks assigned to a nurse for a specific shift */
  getTasksForNurse(nurseId: string, shiftId: string): Promise<Task[]>;

  /** Fetch details for a single task including patient and recent events */
  getTaskDetails(taskId: string): Promise<{ task: Task; patient?: Patient; recentEvents: TaskEvent[] } | null>;

  /** Fetch real-time event updates since a timestamp */
  getRecentEvents(since: Date): Promise<TaskEvent[]>;

  /** Update task status in EHR with idempotency protection */
  updateTaskStatus(
    taskId: string,
    newStatus: TaskStatus,
    actorId: string,
    idempotencyKey: string,
    note?: string
  ): Promise<{ success: boolean; committedVersion: string }>;

  /** Optional: Sync external FHIR R4 bundle into local edge SQLite cache */
  syncFromExternalFHIR?(endpointUrl: string, unitId: string): Promise<{ syncedPatients: number; syncedOrders: number }>;
}
