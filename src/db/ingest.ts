import fs from "fs";
import { createHash } from 'crypto';
import { z } from 'zod';
import { MutationService } from '../services/mutation.service.js';
import path from "path";
import dotenv from "dotenv";
import { db } from "./connection.js";
import { initializeDatabase } from "./schema.js";

dotenv.config();

const incomingDir = process.env.INCOMING_DATA_DIR || "./data/incoming";

interface HospitalDataPayload {
  conflicts?: Array<{ id: string; task_id: string; conflict_type: string; system_a_name: string; system_a_val: string;
    system_b_name: string; system_b_val: string; resolution_note?: string }>;

  nurses?: Array<{
    id: string;
    badge_number: string;
    full_name: string;
    email: string;
    department: string;
    role?: string;
  }>;
  shifts?: Array<{
    id: string;
    unit_id: string;
    shift_type: "DAY" | "NIGHT" | "ROTATING";
    start_time: string;
    end_time: string;
    status?: string;
  }>;
  patients?: Array<{
    id: string;
    mrn: string;
    full_name: string;
    room_number: string;
    bed_number?: string;
    admission_date: string;
    acuity_level: number;
    allergies?: string;
    primary_diagnosis: string;
  }>;
  tasks?: Array<{
    id: string;
    patient_id: string;
    title: string;
    description?: string;
    category: string;
    status: string;
    priority: string;
    scheduled_time: string;
    completed_time?: string;
    source_system?: string;
  }>;
  task_assignments?: Array<{
    id: string;
    task_id: string;
    nurse_id: string;
    shift_id: string;
    transfer_status?: string;
    assigned_by: string;
  }>;
}

export function importIncomingData() {
  console.log(`\n========================================`);
  console.log(`Starting Data Ingestion Pipeline from: ${incomingDir}`);
  console.log(`========================================\n`);

  if (!fs.existsSync(incomingDir)) {
    console.error(`Directory not found: ${incomingDir}`);
    return;
  }

  // Ensure tables exist
  initializeDatabase();

  const files = fs.readdirSync(incomingDir).filter(f => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("No JSON data files found in incoming directory.");
    return;
  }

  const insertNurse = db.prepare(`
    INSERT INTO nurses (id, badge_number, full_name, email, department, role)
    VALUES (@id, @badge_number, @full_name, @email, @department, COALESCE(@role, 'STAFF_NURSE'))
    ON CONFLICT(id) DO UPDATE SET
      badge_number=excluded.badge_number,
      full_name=excluded.full_name,
      email=excluded.email,
      department=excluded.department,
      role=excluded.role
  `);

  const insertShift = db.prepare(`
    INSERT INTO shifts (id, unit_id, shift_type, start_time, end_time, status)
    VALUES (@id, @unit_id, @shift_type, @start_time, @end_time, COALESCE(@status, 'ACTIVE'))
    ON CONFLICT(id) DO UPDATE SET
      unit_id=excluded.unit_id,
      shift_type=excluded.shift_type,
      start_time=excluded.start_time,
      end_time=excluded.end_time,
      status=excluded.status
  `);

  const insertPatient = db.prepare(`
    INSERT INTO patients (id, mrn, full_name, room_number, bed_number, admission_date, acuity_level, allergies, primary_diagnosis)
    VALUES (@id, @mrn, @full_name, @room_number, COALESCE(@bed_number, 'A'), @admission_date, @acuity_level, @allergies, @primary_diagnosis)
    ON CONFLICT(id) DO UPDATE SET
      mrn=excluded.mrn,
      full_name=excluded.full_name,
      room_number=excluded.room_number,
      bed_number=excluded.bed_number,
      admission_date=excluded.admission_date,
      acuity_level=excluded.acuity_level,
      allergies=excluded.allergies,
      primary_diagnosis=excluded.primary_diagnosis
  `);

  const insertTask = db.prepare(`
    INSERT INTO tasks (id, patient_id, title, description, category, status, priority, scheduled_time, completed_time, source_system)
    VALUES (@id, @patient_id, @title, @description, @category, @status, @priority, @scheduled_time, @completed_time, COALESCE(@source_system, 'EHR_PRIMARY'))
    ON CONFLICT(id) DO UPDATE SET
      patient_id=excluded.patient_id,
      title=excluded.title,
      description=excluded.description,
      category=excluded.category,
      status=excluded.status,
      priority=excluded.priority,
      scheduled_time=excluded.scheduled_time,
      completed_time=excluded.completed_time,
      source_system=excluded.source_system
  `);

  const insertAssignment = db.prepare(`
    INSERT INTO task_assignments (id, task_id, nurse_id, shift_id, transfer_status, assigned_by)
    VALUES (@id, @task_id, @nurse_id, @shift_id, COALESCE(@transfer_status, 'ACTIVE'), @assigned_by)
    ON CONFLICT(id) DO UPDATE SET
      task_id=excluded.task_id,
      nurse_id=excluded.nurse_id,
      shift_id=excluded.shift_id,
      transfer_status=excluded.transfer_status,
      assigned_by=excluded.assigned_by
  `);

  const insertConflict = db.prepare(`
    INSERT INTO conflicts (id, task_id, conflict_type, system_a_name, system_a_val, system_b_name, system_b_val, status, resolution_note)
    VALUES (@id, @task_id, @conflict_type, @system_a_name, @system_a_val, @system_b_name, @system_b_val, 'UNRESOLVED', @resolution_note)
    ON CONFLICT(id) DO NOTHING
  `);

  let totalNurses = 0;
  let totalShifts = 0;
  let totalPatients = 0;
  let totalTasks = 0;
  let totalAssignments = 0;
  let totalConflicts = 0;

  const ingestTransaction = db.transaction((payload: HospitalDataPayload) => {
    // 1. Nurses
    if (payload.nurses) {
      for (const n of payload.nurses) {
        insertNurse.run({
          role: "STAFF_NURSE",
          ...n
        });
        totalNurses++;
      }
    }

    // 2. Shifts
    if (payload.shifts) {
      for (const s of payload.shifts) {
        insertShift.run({
          status: "ACTIVE",
          ...s
        });
        totalShifts++;
      }
    }

    // 3. Patients
    if (payload.patients) {
      for (const p of payload.patients) {
        insertPatient.run({
          bed_number: "A",
          allergies: null,
          ...p
        });
        totalPatients++;
      }
    }

    // 4. Tasks
    if (payload.tasks) {
      for (const t of payload.tasks) {
        insertTask.run({
          description: null,
          completed_time: null,
          source_system: "EHR_PRIMARY",
          ...t
        });
        totalTasks++;

      }
    }
    for (const conflict of payload.conflicts || []) {
      insertConflict.run({ resolution_note: null, ...conflict });
      totalConflicts++;
    }

    // 5. Task Assignments
    if (payload.task_assignments) {
      for (const a of payload.task_assignments) {
        insertAssignment.run({
          transfer_status: "ACTIVE",
          ...a
        });
        totalAssignments++;
      }
    }
  });

  for (const file of files) {
    const fullPath = path.join(incomingDir, file);
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const data: HospitalDataPayload = JSON.parse(content);
      console.log(`Processing file: ${file}...`);
      const envelope = z.object({ nurses: z.array(z.object({ id: z.string().min(1) }).passthrough()).optional(),
        patients: z.array(z.object({ id: z.string().min(1), acuity_level: z.number().int().min(1).max(5) }).passthrough()).optional(),
        tasks: z.array(z.object({ id: z.string().min(1), patient_id: z.string().min(1), status: z.enum(['PENDING','IN_PROGRESS','COMPLETED','CANCELLED','FLAGGED_CONFLICT']) }).passthrough()).optional(),
        conflicts: z.array(z.object({ id: z.string().min(1), task_id: z.string().min(1), system_a_name: z.string().min(1),
          system_a_val: z.string().min(1), system_b_name: z.string().min(1), system_b_val: z.string().min(1) }).passthrough()).optional()
      }).passthrough();
      envelope.parse(data);
      for (const task of data.tasks || []) {
        if (task.status === 'FLAGGED_CONFLICT' && !data.conflicts?.some(c => c.task_id === task.id)) {
          throw new Error(`Flagged task ${task.id} requires explicit source conflict records`);
        }
      }
      const key = 'ingest:' + createHash('sha256').update(content).digest('hex');
      MutationService.execute('IMPORT_DATA', key, data, 'SYSTEM', () => { ingestTransaction(data); return { imported: file }; });
      console.log(`Successfully ingested ${file}`);
    } catch (err) {
      throw new Error(`Failed to ingest ${file}`, { cause: err });
    }
  }

  console.log(`\n========================================`);
  console.log(`Ingestion Complete!`);
  console.log(`Nurses Ingested:      ${totalNurses}`);
  console.log(`Shifts Ingested:      ${totalShifts}`);
  console.log(`Patients Ingested:    ${totalPatients}`);
  console.log(`Tasks Ingested:       ${totalTasks}`);
  console.log(`Assignments Ingested: ${totalAssignments}`);
  console.log(`Conflicts Flagged:    ${totalConflicts}`);
  console.log(`========================================\n`);
}

// Run directly if invoked via CLI
if (process.argv[1]?.endsWith("ingest.ts") || process.argv[1]?.endsWith("ingest.js")) {
  importIncomingData();
  db.close();
}
