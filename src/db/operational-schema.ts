import { db } from './connection.js';

export function initializeOperationalSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_accounts (
      staff_id TEXT PRIMARY KEY REFERENCES nurses(id), username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0, password_version INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'SHIFTWEAVE_OPERATIONAL_SANDBOX', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS staff_sessions (
      token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES staff_accounts(staff_id),
      expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, password_version INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS staff_voice_sessions (
      session_id TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES staff_accounts(staff_id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS staff_shift_memberships (
      id TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES nurses(id), shift_id TEXT NOT NULL REFERENCES shifts(id),
      duty_start TEXT NOT NULL, duty_end TEXT NOT NULL, duty_role TEXT NOT NULL CHECK(duty_role IN ('OUTGOING','INCOMING','SUPERVISOR','CONSULTING')),
      UNIQUE(staff_id,shift_id));
    CREATE TABLE IF NOT EXISTS patient_care_team (
      id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id), staff_id TEXT NOT NULL REFERENCES nurses(id),
      shift_id TEXT NOT NULL REFERENCES shifts(id), team_role TEXT NOT NULL CHECK(team_role IN ('PRIMARY_NURSE','INCOMING_NURSE','PHYSICIAN')),
      active INTEGER NOT NULL DEFAULT 1, assigned_by TEXT NOT NULL REFERENCES nurses(id), UNIQUE(patient_id,staff_id,shift_id));
    CREATE TABLE IF NOT EXISTS operational_task_versions (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id), revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS operational_notes (
      id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id), task_id TEXT REFERENCES tasks(id),
      shift_id TEXT NOT NULL REFERENCES shifts(id), author_id TEXT NOT NULL REFERENCES nurses(id), text TEXT NOT NULL,
      recorded_status TEXT, source TEXT NOT NULL DEFAULT 'SHIFTWEAVE_OPERATIONAL_SANDBOX', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sandbox_documents (
      id TEXT PRIMARY KEY, handoff_id TEXT NOT NULL REFERENCES handoffs(id), patient_id TEXT NOT NULL REFERENCES patients(id),
      author_id TEXT NOT NULL REFERENCES nurses(id), content TEXT NOT NULL, review_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, UNIQUE(handoff_id,patient_id));
    CREATE TABLE IF NOT EXISTS sandbox_source_resources (
      resource_type TEXT NOT NULL, id TEXT NOT NULL, patient_id TEXT NOT NULL REFERENCES patients(id),
      author_id TEXT NOT NULL REFERENCES nurses(id), resource_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(resource_type,id));
  `);
}
