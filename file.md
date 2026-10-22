# ShiftWeave — Complete Dataset Inventory & Expansion Blueprint (`file.md`)

> **File Purpose**: Complete audit of all active data currently loaded in the ShiftWeave system across SQLite databases, Epic FHIR snapshots, and ingestion templates, followed by schema specifications and instructions to scale the dataset.

---

## 1. Executive Summary: Current Data Counts

| Entity / Table | Active Count | Source / Authority | Notes |
| :--- | :--- | :--- | :--- |
| **Nurses & Staff** | **10** | SQLite (`nurses`, `staff_accounts`) | 6 Staff Nurses, 1 Charge Nurse, 1 Admin, 2 Physicians |
| **Shifts** | **2** | SQLite (`shifts`) | 1 Simulation Ward Rotating Shift, 1 ICU-B Night Shift |
| **Patients** | **9** | SQLite (`patients`) + Epic FHIR R4 | 2 Synthetic ICU Bedside patients + 7 Epic Sandbox patients |
| **Bedside & Coord. Tasks** | **23** | SQLite (`tasks`) | 2 ICU Clinical Bedside tasks + 21 Synthetic Coordination tasks |
| **Task Assignments** | **24** | SQLite (`task_assignments`) | Active, Carried Forward, and Transfer states |
| **Discrepancies / Conflicts** | **2** | SQLite (`conflicts`) | 1 Medication status mismatch + 1 EHR-vs-Note discrepancy |
| **Shift Handoffs** | **5** | SQLite (`handoffs`) | Draft, Finalized, and Acknowledged SBAR custody handoffs |
| **Operational Shift Notes** | **8** | SQLite (`operational_notes`) | Bedside nurse observations & handover remarks |
| **Epic FHIR R4 Snapshots** | **7** | SQLite (`epic_patient_snapshots`) | Grounded Conditions, Medications, Allergies, Encounters |
| **Staff Shift Memberships** | **8** | SQLite (`staff_shift_memberships`) | Duty roles (Outgoing, Incoming, Consulting, Supervisor) |
| **Audit Log Entries** | **588** | SQLite (`audit_log`) | Immutable event trace with latency and actor IDs |
| **Workflow Runs & Steps** | **290** runs / **478** checkpoints | SQLite (`workflow_runs`, `workflow_checkpoints`) | Zero-loss recovery & durable state machine steps |

*Active Database*: `./data/workflow-sandbox-1792609735104.db` (configured via `SQLITE_DB_PATH` in `.env`).  
*Baseline Demonstration Fixture*: `./data/incoming/sample_template.json` (used by `npm run import:data`).

---

## 2. Complete Inventory of Current Records

### 2.1. Nurses & Staff Directory (`nurses` & `staff_accounts`)

| ID | Full Name & Credential | Role | Unit / Dept | Badge | Email |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `staff:administrator` | Sandbox Administrator | `ADMIN` | SIMULATION-WARD | `SIM-1000` | `administrator@workflow-sandbox.invalid` |
| `staff:charge.meera` | Meera Shah, RN | `CHARGE_NURSE` | SIMULATION-WARD | `SIM-1001` | `charge.meera@workflow-sandbox.invalid` |
| `staff:seema` | Seema Patel, RN | `STAFF_NURSE` | SIMULATION-WARD | `SIM-1002` | `seema@workflow-sandbox.invalid` |
| `staff:reema` | Reema Roy, RN | `STAFF_NURSE` | SIMULATION-WARD | `SIM-1003` | `reema@workflow-sandbox.invalid` |
| `staff:jordan` | Jordan Lee, RN | `STAFF_NURSE` | SIMULATION-WARD | `SIM-1004` | `jordan@workflow-sandbox.invalid` |
| `staff:asha` | Asha Rao, RN | `STAFF_NURSE` | SIMULATION-WARD | `SIM-1005` | `asha@workflow-sandbox.invalid` |
| `staff:doctor.mira` | Dr Mira Sen | `PHYSICIAN` | SIMULATION-WARD | `SIM-1006` | `doctor.mira@workflow-sandbox.invalid` |
| `staff:doctor.arun` | Dr Arun Mehta | `PHYSICIAN` | SIMULATION-WARD | `SIM-1007` | `doctor.arun@workflow-sandbox.invalid` |
| `nurse_seema_01` | Seema Patel, RN | `STAFF_NURSE` | ICU-B | `RN-4402` | `seema.patel@hospital.org` |
| `nurse_reema_02` | Reema Roy, RN | `STAFF_NURSE` | ICU-B | `RN-5519` | `reema.roy@hospital.org` |

---

### 2.2. Hospital Shifts (`shifts`)

1. **Simulation Ward Rotating Shift**:
   - **ID**: `shift:65580ab8-c301-45f0-a89d-284c7451ddfe`
   - **Unit**: `SIMULATION-WARD`
   - **Shift Type**: `ROTATING`
   - **Start Time**: `2026-10-21T18:08:56.107Z`
   - **End Time**: `2026-10-22T19:08:56.108Z`
   - **Status**: `ACTIVE`
2. **ICU-B Night Shift**:
   - **ID**: `shift_20261019_night`
   - **Unit**: `ICU-B`
   - **Shift Type**: `NIGHT`
   - **Start Time**: `2026-10-18T19:00:00Z`
   - **End Time**: `2026-10-19T07:00:00Z`
   - **Status**: `HANDOFF_IN_PROGRESS`

---

### 2.3. Patients Directory (`patients`)

| Patient ID | Full Name | MRN | Room / Bed | Acuity | Documented Allergies | Primary Diagnosis |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `pt_101` | **James Clark** | `MRN-90210` | Room 304, Bed A | 2 | Penicillin | Post-op Laparoscopic Cholecystectomy |
| `pt_102` | **Elena Rostova** | `MRN-90211` | Room 305, Bed B | 1 | Latex, Sulfa | Severe Sepsis secondary to Pyelonephritis |
| `epic:bb0aec7387fa:Patient:erXuFYUfucBZaryVksYEcMg3` | **Camila Maria Lopez** | `FHRWMGJ8FC8SR7D` | EMC Family Medicine | — | Not on File | PCOS (polycystic ovarian syndrome) |
| `epic:bb0aec7387fa:Patient:eq081-VQEgP8drUUqCWzHfw3` | **Derrick Lin** | `eq081-VQEgP...` | EMH Medical Surgical | — | Not on File | Acute Bronchitis / Asthma Exacerbation |
| `epic:bb0aec7387fa:Patient:eAB3mDIBBcyUKviyzrxsnAw3` | **Desiree Caroline Powell** | `eAB3mDIBB...` | EMH Cardiology Ward | — | Not on File | Atrial Fibrillation with RVR |
| `epic:bb0aec7387fa:Patient:egqBHVfQlt4Bw3XGXoxVxHg3` | **Elijah John Davis** | `egqBHVfQl...` | EMH Pediatric ICU | — | Lactose, Latex | Acute Gastroenteritis / Dehydration |
| `epic:bb0aec7387fa:Patient:eIXesllypH3M9tAA5WdJftQ3` | **Dr. Linda Jane Ross** | `eIXesllypH...` | Outpatient Oncology | — | Not on File | Invasive Ductal Carcinoma (Monitoring) |
| `epic:bb0aec7387fa:Patient:eh2xYHuzl9nkSFVvV3osUHg3` | **Olivia Anne Robinson** | `eh2xYHuzl...` | EMH Labor & Delivery | — | Not on File | Primigravida at 38 weeks |
| `epic:bb0aec7387fa:Patient:e0w0LEDCYtfckT6N.CkJKCw3` | **Warren James McGinnis III** | `1000477` | Room 2048, MSPOOL | — | Penicillins (Anaphylaxis) | Coronary Artery Disease / Angina Pectoris |

---

### 2.4. Bedside Tasks & Coordination Tasks (`tasks`)

#### A. Synthetic Bedside Tasks (ICU-B)
1. **`task_vital_101_01`**:
   - **Patient**: James Clark (`pt_101`, Room 304)
   - **Title**: `Q4 Vital Signs & Neuro Check`
   - **Description**: Assess BP, HR, O2 Sat, and GCS score.
   - **Category**: `VITAL` | **Priority**: `ROUTINE` | **Status**: `COMPLETED`
   - **Source System**: `EHR_PRIMARY`
2. **`task_med_102_03`**:
   - **Patient**: Elena Rostova (`pt_102`, Room 305)
   - **Title**: `IV Vancomycin 1g Infusion`
   - **Description**: Administer over 60 mins; check trough level prior to infusion.
   - **Category**: `MEDICATION_CHECK` | **Priority**: `STAT` | **Status**: `FLAGGED_CONFLICT`
   - **Source System**: `EHR_PRIMARY`

#### B. Sourced Coordination Tasks (Simulation Ward — 3 per Epic patient)
For each of the 7 Epic Sandbox patients, 3 coordination tasks are assigned:
- `Review sourced clinical records for handoff` (Category: `CONSULT`, Status: `PENDING`)
- `Review outstanding nursing documentation` (Category: `CONSULT`, Status: `PENDING` / `FLAGGED_CONFLICT`)
- `Confirm incoming coordination requirements` (Category: `DISCHARGE_PREP`, Status: `PENDING`)

---

### 2.5. Clinical Discrepancies & Conflicts (`conflicts`)

1. **`conf_task_med_102_03` (Bedside Status Conflict)**:
   - **Task**: `task_med_102_03` (IV Vancomycin 1g Infusion)
   - **Conflict Type**: `STATUS_MISMATCH`
   - **System A (EHR Primary Core)**: `COMPLETED (Logged 06:10)`
   - **System B (Nurse Shift Notes)**: `PENDING (Awaiting pharmacy delivery)`
   - **Status**: `VERIFIED_RESOLVED`
   - **Resolution Note**: Verified with pharmacy that infusion is scheduled and prepared. Resolved by Reema Roy, RN.

2. **`conf:coordination:0fd91b79-537e-4174-a4ce-55191b25e78a` (Documentation Discrepancy)**:
   - **Task**: `coordination:0fd91b79-537e-4174-a4ce-55191b25e78a` (Desiree Caroline Powell)
   - **Conflict Type**: `STATUS_MISMATCH`
   - **System A**: `Epic Inpatient Encounter Order`
   - **System B**: `Operational Shift Handoff Review`
   - **Status**: `UNRESOLVED` (Flagged for incoming charge nurse review).

---

### 2.6. Operational Shift Notes (`operational_notes`)

1. **Note 1** (`staff:seema`): *"Morning assessment completed for Room 304. Incision site clean, dry, and intact. Pain managed with oral analgesics."*
2. **Note 2** (`staff:seema`): *"Room 305 Vancomycin pending. Contacted central pharmacy at 06:15; awaiting batch delivery."*
3. **Note 3** (`staff:reema`): *"Pharmacy delivered Vancomycin infusion bag at 06:40. Verified two-nurse check completed."*
4. **Note 4** (`staff:reema`): *"Commenced infusion at 06:45 via peripheral IV line 2. No signs of erythema or extravasation."*
5. **Note 5** (`staff:jordan`): *"Assisted Room 2048 with ambulation to chair. Oxygen saturation remained stable at 96% on room air."*
6. **Note 6** (`staff:asha`): *"Telemetry monitoring for Desiree Powell noted occasional PACs. Notified consulting cardiologist."*
7. **Note 7** (`staff:charge.meera`): *"Shift staffing adequate. All 9 patients accounted for. Carry-forward items reviewed with oncoming team."*
8. **Note 8** (`staff:doctor.mira`): *"Reviewed Warren McGinnis telemetry strip. Approved continued step-down protocol."*

---

### 2.7. Shift Handoff Summaries (`handoffs`)

- **Total Handoff Records**: 5
- **Key Handoff Example (`handoff_89d9ed55` / `shift_20261019_night`)**:
  - **Outgoing Nurse**: Seema Patel, RN (`nurse_seema_01`)
  - **Incoming Nurse**: Reema Roy, RN (`nurse_reema_02`)
  - **Status**: `FINALIZED`
  - **SBAR Structure**:
    - **Situation**: Night shift handoff for ICU-B. 2 assigned tasks.
    - **Background**: James Clark (Room 304) post-op laparoscopy; Elena Rostova (Room 305) sepsis.
    - **Assessment**: Q4 vitals completed; Vancomycin infusion has documentation discrepancy flagged.
    - **Recommendation**: Reema to verify delivery with pharmacy and complete custody acceptance.
  - **Carried Forward Task IDs**: `["task_med_102_03"]`

---

## 3. Dataset Expansion Blueprint (How to Add More Data)

To increase the dataset for testing high scale (e.g., 50+ patients, 20+ nurses, 100+ tasks), use the built-in atomic ingestion pipeline.

### 3.1. Ingestion Pipeline Mechanics
- Files placed in `data/incoming/*.json` are imported by executing:
  ```bash
  npm run import:data
  ```
- **Atomicity**: Ingestion runs inside a single SQLite transaction with an idempotency key.
- **Relational Integrity**: If a task references a `patient_id` or an assignment references a `nurse_id` that does not exist in the file or database, the transaction aborts with zero partial writes.
- **Discrepancy Rule**: Any task marked `"status": "FLAGGED_CONFLICT"` **must** have a corresponding entry in the `"conflicts"` array.

---

### 3.2. Ready-to-Use Expansion Template

Create a new file (e.g., `data/incoming/batch_icu_expansion.json`) using the standard schema below:

```json
{
  "nurses": [
    {
      "id": "nurse_vikram_03",
      "badge_number": "RN-6621",
      "full_name": "Vikram Singh, RN",
      "email": "vikram.singh@hospital.org",
      "department": "ICU-B",
      "role": "STAFF_NURSE"
    },
    {
      "id": "nurse_priya_04",
      "badge_number": "RN-7734",
      "full_name": "Priya Sharma, RN",
      "email": "priya.sharma@hospital.org",
      "department": "ICU-B",
      "role": "CHARGE_NURSE"
    }
  ],
  "shifts": [
    {
      "id": "shift_20261020_day",
      "unit_id": "ICU-B",
      "shift_type": "DAY",
      "start_time": "2026-10-20T07:00:00Z",
      "end_time": "2026-10-20T19:00:00Z",
      "status": "ACTIVE"
    }
  ],
  "patients": [
    {
      "id": "pt_103",
      "mrn": "MRN-90212",
      "full_name": "Marcus Aurelius Vance",
      "room_number": "Room 306",
      "bed_number": "A",
      "admission_date": "2026-10-18T11:00:00Z",
      "acuity_level": 1,
      "allergies": "Morphine, Ciprofloxacin",
      "primary_diagnosis": "Acute Respiratory Distress Syndrome (ARDS)"
    },
    {
      "id": "pt_104",
      "mrn": "MRN-90213",
      "full_name": "Ananya Sen",
      "room_number": "Room 307",
      "bed_number": "B",
      "admission_date": "2026-10-19T14:45:00Z",
      "acuity_level": 2,
      "allergies": "None Known",
      "primary_diagnosis": "Diabetic Ketoacidosis (DKA) Management"
    },
    {
      "id": "pt_105",
      "mrn": "MRN-90214",
      "full_name": "Robert Miller",
      "room_number": "Room 308",
      "bed_number": "A",
      "admission_date": "2026-10-19T22:10:00Z",
      "acuity_level": 1,
      "allergies": "Aspirin, Iodine",
      "primary_diagnosis": "Post Cardiac Arrest Hypothermia Protocol"
    }
  ],
  "tasks": [
    {
      "id": "task_vent_103_01",
      "patient_id": "pt_103",
      "title": "ABG Draw & Ventilator Synchrony Check",
      "description": "Obtain arterial blood gas sample and evaluate PEEP 10 cmH2O response.",
      "category": "RESPIRATORY",
      "status": "PENDING",
      "priority": "STAT",
      "scheduled_time": "2026-10-20T08:00:00Z",
      "source_system": "EHR_PRIMARY"
    },
    {
      "id": "task_insulin_104_02",
      "patient_id": "pt_104",
      "title": "Q1 Hourly Blood Glucose & Insulin Titration",
      "description": "Check capillary blood glucose; titrate regular insulin drip per DKA protocol.",
      "category": "MEDICATION_CHECK",
      "status": "FLAGGED_CONFLICT",
      "priority": "STAT",
      "scheduled_time": "2026-10-20T08:00:00Z",
      "source_system": "EHR_PRIMARY"
    },
    {
      "id": "task_neuro_105_03",
      "patient_id": "pt_105",
      "title": "Continuous Core Temp & Pupillometry",
      "description": "Maintain esophageal probe temp at 36.0C; log NPi every 2 hours.",
      "category": "VITAL",
      "status": "IN_PROGRESS",
      "priority": "ROUTINE",
      "scheduled_time": "2026-10-20T09:00:00Z",
      "source_system": "EHR_PRIMARY"
    }
  ],
  "task_assignments": [
    {
      "id": "asgn_9901",
      "task_id": "task_vent_103_01",
      "nurse_id": "nurse_vikram_03",
      "shift_id": "shift_20261020_day",
      "transfer_status": "ACTIVE",
      "assigned_by": "CHARGE_NURSE"
    },
    {
      "id": "asgn_9902",
      "task_id": "task_insulin_104_02",
      "nurse_id": "nurse_vikram_03",
      "shift_id": "shift_20261020_day",
      "transfer_status": "CARRIED_FORWARD",
      "assigned_by": "SEEMA_RN"
    },
    {
      "id": "asgn_9903",
      "task_id": "task_neuro_105_03",
      "nurse_id": "nurse_priya_04",
      "shift_id": "shift_20261020_day",
      "transfer_status": "ACTIVE",
      "assigned_by": "CHARGE_NURSE"
    }
  ],
  "conflicts": [
    {
      "id": "conf_task_insulin_104_02",
      "task_id": "task_insulin_104_02",
      "conflict_type": "STATUS_MISMATCH",
      "system_a_name": "Point-of-Care Glucometer Flowsheet",
      "system_a_val": "Blood Glucose 184 mg/dL (Logged 07:55)",
      "system_b_name": "Nurse Shift Handoff Verbal Note",
      "system_b_val": "Blood Glucose 240 mg/dL (Reported at bedside)",
      "resolution_note": "Repeat point-of-care test required before adjusting insulin infusion rate."
    }
  ]
}
```

---

## 4. Entity Schema Reference

| Table | Required Fields | Allowed Enums / Constraints |
| :--- | :--- | :--- |
| `nurses` | `id`, `badge_number`, `full_name`, `email`, `department`, `role` | Role: `STAFF_NURSE`, `CHARGE_NURSE`, `NURSE_PRACTITIONER`, `NURSE_MANAGER`, `ADMIN`, `PHYSICIAN` |
| `shifts` | `id`, `unit_id`, `shift_type`, `start_time`, `end_time`, `status` | Shift Type: `DAY`, `NIGHT`, `EVENING`, `ROTATING`<br>Status: `SCHEDULED`, `ACTIVE`, `HANDOFF_IN_PROGRESS`, `COMPLETED` |
| `patients` | `id`, `mrn`, `full_name`, `room_number`, `bed_number`, `admission_date` | Acuity: `1` (Critical) to `4` (Stable) |
| `tasks` | `id`, `patient_id`, `title`, `category`, `status`, `priority`, `scheduled_time`, `source_system` | Status: `PENDING`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `FLAGGED_CONFLICT`<br>Priority: `STAT`, `URGENT`, `ROUTINE`, `PRN`<br>Category: `VITAL`, `MEDICATION_CHECK`, `LAB_REVIEW`, `ASSESSMENT`, `CONSULT`, `DISCHARGE_PREP`, `INTERVENTION`, `CARE_COORDINATION` |
| `task_assignments` | `id`, `task_id`, `nurse_id`, `shift_id`, `transfer_status`, `assigned_by` | Transfer Status: `ACTIVE`, `CARRIED_FORWARD`, `TRANSFERRED`, `REJECTED`, `REASSIGNED` |
| `conflicts` | `id`, `task_id`, `conflict_type`, `system_a_name`, `system_a_val`, `system_b_name`, `system_b_val` | Conflict Type: `STATUS_MISMATCH`, `PRIORITY_MISMATCH`, `ASSIGNMENT_MISMATCH`, `TIME_MISMATCH`, `EHR_VS_NOTE_DISCREPANCY` |
| `handoffs` | `id`, `shift_id`, `outgoing_nurse_id`, `incoming_nurse_id`, `status` | Status: `DRAFT`, `FINALIZED`, `ACKNOWLEDGED` |
| `operational_notes`| `id`, `shift_id`, `author_staff_id`, `text`, `recorded_status` | Recorded Status: `ACTIVE`, `ARCHIVED` |
