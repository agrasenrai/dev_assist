import { db } from "./connection.js";

export const createTablesSQL = `
-- 1. NURSES
CREATE TABLE IF NOT EXISTS nurses (
    id TEXT PRIMARY KEY,
    badge_number TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    department TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'STAFF_NURSE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. SHIFTS
CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL,
    shift_type TEXT NOT NULL CHECK(shift_type IN ('DAY', 'NIGHT', 'ROTATING')),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('UPCOMING', 'ACTIVE', 'HANDOFF_IN_PROGRESS', 'CLOSED')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shifts_unit_status ON shifts(unit_id, status);

-- 3. PATIENTS
CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    mrn TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    room_number TEXT NOT NULL,
    bed_number TEXT NOT NULL DEFAULT 'A',
    admission_date TIMESTAMP NOT NULL,
    acuity_level INTEGER NOT NULL CHECK(acuity_level BETWEEN 1 AND 5),
    allergies TEXT,
    primary_diagnosis TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. TASKS
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL CHECK(category IN ('VITAL', 'MEDICATION_CHECK', 'LAB_DRAW', 'WOUND_CARE', 'MOBILITY', 'CONSULT', 'DISCHARGE_PREP')),
    status TEXT NOT NULL CHECK(status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'FLAGGED_CONFLICT')),
    priority TEXT NOT NULL CHECK(priority IN ('STAT', 'URGENT', 'ROUTINE')),
    scheduled_time TIMESTAMP NOT NULL,
    completed_time TIMESTAMP,
    source_system TEXT NOT NULL DEFAULT 'EHR_PRIMARY',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_tasks_patient_status ON tasks(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_time);

-- 5. TASK_ASSIGNMENTS
CREATE TABLE IF NOT EXISTS task_assignments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    nurse_id TEXT NOT NULL,
    shift_id TEXT NOT NULL,
    transfer_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(transfer_status IN ('ACTIVE', 'CARRIED_FORWARD', 'TRANSFERRED', 'UNASSIGNED')),
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_by TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (nurse_id) REFERENCES nurses(id) ON DELETE RESTRICT,
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_assignments_nurse_shift ON task_assignments(nurse_id, shift_id);

-- 6. TASK_EVENTS
CREATE TABLE IF NOT EXISTS task_events (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type IN ('STATUS_TRANSITION', 'REASSIGNMENT', 'SCHEDULE_CHANGE', 'NOTE_ADDED', 'CONFLICT_DETECTED')),
    previous_value TEXT,
    new_value TEXT NOT NULL,
    source TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    idempotency_key TEXT UNIQUE,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_events_task_time ON task_events(task_id, timestamp);

-- 7. CONFLICTS
CREATE TABLE IF NOT EXISTS conflicts (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    conflict_type TEXT NOT NULL CHECK(conflict_type IN ('STATUS_MISMATCH', 'DUPLICATE_ORDER', 'STALE_DATA', 'UNASSIGNED_CARRIED_FORWARD')),
    system_a_name TEXT NOT NULL,
    system_a_val TEXT NOT NULL,
    system_b_name TEXT NOT NULL,
    system_b_val TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'UNRESOLVED' CHECK(status IN ('UNRESOLVED', 'VERIFIED_RESOLVED', 'DISMISSED')),
    resolution_note TEXT,
    resolved_by TEXT,
    resolved_at TIMESTAMP,
    detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (resolved_by) REFERENCES nurses(id)
);
CREATE INDEX IF NOT EXISTS idx_conflicts_status ON conflicts(status);

-- 8. HANDOFFS
CREATE TABLE IF NOT EXISTS handoffs (
    id TEXT PRIMARY KEY,
    shift_id TEXT NOT NULL,
    outgoing_nurse_id TEXT NOT NULL,
    incoming_nurse_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'UNDER_REVIEW', 'ACKNOWLEDGED', 'FINALIZED')),
    summary_markdown TEXT NOT NULL,
    data_snapshot TEXT NOT NULL,
    unresolved_conflicts_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMP,
    FOREIGN KEY (shift_id) REFERENCES shifts(id),
    FOREIGN KEY (outgoing_nurse_id) REFERENCES nurses(id),
    FOREIGN KEY (incoming_nurse_id) REFERENCES nurses(id)
);

-- 9. WORKFLOW_RUNS
CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    workflow_type TEXT NOT NULL CHECK(workflow_type IN ('GENERATE_HANDOFF', 'RECOVER_INTERRUPTED_SHIFT', 'VERIFY_CONFLICTS')),
    initiated_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'INITIATED' CHECK(status IN ('INITIATED', 'IN_PROGRESS', 'INTERRUPTED', 'COMPLETED', 'FAILED')),
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 10. WORKFLOW_CHECKPOINTS
CREATE TABLE IF NOT EXISTS workflow_checkpoints (
    id TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    step_name TEXT NOT NULL,
    state_payload TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_run ON workflow_checkpoints(workflow_run_id, step_index DESC);

-- 11. AUDIT_LOG
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    actor_type TEXT NOT NULL CHECK(actor_type IN ('NURSE', 'AGENT', 'MCP_SERVER', 'SYSTEM')),
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_resource TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN ('SUCCESS', 'FAILURE', 'RECOVERED')),
    details TEXT,
    latency_ms INTEGER,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(timestamp DESC);
`;

export function initializeDatabase() {
  console.log("Initializing ShiftWeave SQLite database tables...");
  db.exec(createTablesSQL);
  console.log("All 11 canonical tables initialized successfully.");
}
