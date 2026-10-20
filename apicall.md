# ShiftWeave — Epic FHIR R4 API Integration & Call Map

> **Implementation note (20 October 2026):** This document includes intended design and historical claims. Use [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for current verified behavior and limitations; use [incomingapikey.md](incomingapikey.md) for corrected Epic API guidance. External write-back, production authentication, universal recovery guarantees and fixed latency claims are not established by this document.

> **Source Reference**: `C:\Users\siddh\Downloads\EPIC-APIS.docx` (Official open.epic FHIR R4 API Catalog)  
> **Target System**: ShiftWeave ICU Shift Coordination & Handoff Platform  
> **Protocol**: HL7 FHIR R4 Standard (`https://open.epic.com/Interface/FHIR`)  
> **Architecture Policy**: **Zero Silent Fallbacks** — Every network/API failure must be explicitly surfaced, logged, and alerted.

---

## 📌 Executive Summary: ShiftWeave Ko Kaunsi Epic APIs Call Karni Hain?

ShiftWeave nursing shift handoffs ke liye **23 Core Epic FHIR R4 APIs** use karega. Yeh 6 operational workflows mein categorized hain:

1. **Patient Demographics & Ward Rostering** (Kaunse patients ICU-B mein admit hain)
2. **Clinical Safety & Guardrails** (Allergies, Diagnoses, Isolation Flags)
3. **Nursing Task Custody & Orders** (Prescriptions, scheduled tasks, barcode administrations)
4. **Bedside Observations & Flowsheets** (Vitals, GCS scores, Lines/Drains/Airways)
5. **Existing Shift Handoff Context** (Outgoing nurse Seema ke notes)
6. **Bidirectional Write-Back APIs** (Cloud EHR commit: Verified Tasks & Final SBAR Handoff Report)

---

## 📋 Complete Epic FHIR R4 API Call Map (Kiske Liye Kya)

### Group 1: Ward Rostering & Patient Master Data (Shift Login)

| # | Epic FHIR API Name | HTTP Method & Resource | Purpose in ShiftWeave | Request Query / Body | Expected Response & ShiftWeave Mapping |
| :-: | :--- | :--- | :--- | :--- | :--- |
| **1** | `List.Read (Patient List) (R4)`<br/>`List.Search (Patient List) (R4)` | `GET /List?code=patient-list&_id=icu_b` | **ICU Ward Roster**: Outgoing (Seema) aur incoming (Reema) ke ICU-B unit ke active patients ki list nikalna. | `code=patient-list`<br/>`_id=icu_b_ward` | Returns FHIR `List` with `entry[].item.reference` (Patient IDs). SQLite edge cache mein active roster populate hota hai. |
| **2** | `Patient.Read (Demographics) (R4)`<br/>`Patient.Search (Demographics) (R4)` | `GET /Patient/{id}`<br/>`GET /Patient?identifier={mrn}` | **Patient Master Identity**: Patient full name, MRN, room number, bed number, DOB, age, sex. | `identifier=MRN-90210` ya `{id}` | Maps directly to `patients` table: `id`, `full_name`, `mrn`, `room_number`, `bed_number`. |
| **3** | `Encounter.Read (Patient Chart) (R4)`<br/>`Encounter.Search (Patient Chart) (R4)` | `GET /Encounter?patient={id}&status=in-progress` | **Current Inpatient Stay Context**: Admission date, ICU stay duration, attending physician, and bed location. | `patient=pt_101`<br/>`status=in-progress` | Populates `patients.admission_date`, acuity estimation, and active doctor-in-charge. |

---

### Group 2: Clinical Safety & Guardrails (Zero Hallucination Safety)

| # | Epic FHIR API Name | HTTP Method & Resource | Purpose in ShiftWeave | Request Query / Body | Expected Response & ShiftWeave Mapping |
| :-: | :--- | :--- | :--- | :--- | :--- |
| **4** | `AllergyIntolerance.Read (Patient Chart) (R4)`<br/>`AllergyIntolerance.Search (Patient Chart) (R4)` | `GET /AllergyIntolerance?patient={id}&clinical-status=active` | **Critical Medication Allergies**: Handover ke waqt nurse ko drug reaction risk se bachana (e.g., Penicillin, Sulfa, Latex). | `patient=pt_102`<br/>`clinical-status=active` | Populates `patients.allergies`. Handover draft mein highlight hota hai aur conflicting prescriptions ko block karta hai. |
| **5** | `Condition.Read (Problems) (R4)`<br/>`Condition.Search (Problems) (R4)` | `GET /Condition?patient={id}&category=problem-list-item` | **Active Clinical Diagnosis**: Patient ICU mein kyu admit hai (e.g. Sepsis, Post-op Cholecystectomy, Diabetic Ketoacidosis). | `patient=pt_101`<br/>`clinical-status=active` | Maps to `patients.primary_diagnosis`. Handoff ke **Situation (S)** aur **Background (B)** narrative ka core foundation banta hai. |
| **6** | `Flag.Read (Isolation) (R4)`<br/>`Flag.Search (Isolation) (R4)` | `GET /Flag?patient={id}&category=isolation` | **PPE & Infection Control**: Room isolation protocols (Contact, Droplet, Airborne, MRSA, C. diff). | `patient=pt_102` | Dashboard par yellow/red isolation banner trigger karta hai (Nurse safety requirement). |

---

### Group 3: Task Tracking & Medical Discrepancy Detection (The Core Innovation)

| # | Epic FHIR API Name | HTTP Method & Resource | Purpose in ShiftWeave | Request Query / Body | Expected Response & ShiftWeave Mapping |
| :-: | :--- | :--- | :--- | :--- | :--- |
| **7** | `Task.Read (Episode Checklist) (R4)`<br/>`Task.Search (Episode Checklist) (R4)` | `GET /Task?patient={id}&owner={nurse_id}&status=ready,in-progress,completed` | **Nursing Shift Tasks**: Shift ke saare operational tasks (IV flush, wound dressing, mobility check). | `owner=nurse_seema_01`<br/>`status=ready,in-progress` | Maps to `tasks` and `task_assignments` tables. Powers MCP Tool `get_assigned_tasks`. |
| **8** | `MedicationRequest.Read (Signed Medication Order) (R4)`<br/>`MedicationRequest.Search (Signed Medication Order) (R4)` | `GET /MedicationRequest?patient={id}&status=active` | **Doctor Medication Orders**: Active physician medication orders (Drug name, dosage, route, scheduled time). | `patient=pt_102`<br/>`status=active` | Maps to `tasks` (category: `MEDICATION_CHECK`). Powers Room 305-B IV Vancomycin scheduled task. |
| **9** | `MedicationAdministration.Read (R4)`<br/>`MedicationAdministration.Search (R4)` | `GET /MedicationAdministration?patient={id}` | **Barcode Pump Administration Logs**: EHR barcode machine ne kya log kiya (Dose given vs not given). | `patient=pt_102`<br/>`status=completed` | **Conflict Detection Source A**: Agar Barcode pump bolta hai "COMPLETED" par nurse note bolta hai "PENDING", ShiftWeave `conflicts` table create karta hai! |
| **10** | `MedicationDispense.Read (Verified Orders) (R4)`<br/>`MedicationDispense.Search (Verified Orders) (R4)` | `GET /MedicationDispense?patient={id}` | **Pharmacy Dispense Status**: Kya batch pharmacy se ICU ward tak deliver hua ya delayed hai. | `patient=pt_102` | Confirms Seema's note: *"Awaiting pharmacy batch release at 06:30"*. Proves whether discrepancy is real. |

---

### Group 4: Bedside Monitoring, Vitals & Tubes/Lines

| # | Epic FHIR API Name | HTTP Method & Resource | Purpose in ShiftWeave | Request Query / Body | Expected Response & ShiftWeave Mapping |
| :-: | :--- | :--- | :--- | :--- | :--- |
| **11** | `Observation.Read (Vital Signs) (R4)`<br/>`Observation.Search (Vital Signs) (R4)` | `GET /Observation?patient={id}&category=vital-signs&_sort=-date&_count=5` | **Latest Vitals**: Blood Pressure, Heart Rate, SpO2, Temperature, Respiratory Rate. | `patient=pt_101`<br/>`category=vital-signs` | Nurse Reema ko incoming handover mein latest vital stats dikhata hai. |
| **12** | `Observation.Read (Flowsheets) (R4)`<br/>`Observation.Search (Flowsheets) (R4)` | `GET /Observation?patient={id}&category=flowsheet` | **ICU Flowsheets**: Glasgow Coma Scale (GCS), Fluid Intake/Output (I&O), Pain scale. | `patient=pt_101` | SBAR handoff narrative ke **Assessment (A)** section mein automatically embed hota hai. |
| **13** | `Device.Read (Lines, Drains, Airways) (R4)`<br/>`Device.Search (Lines, Drains, Airways) (R4)` | `GET /Device?patient={id}` | **Lines, Drains & Airways (LDA)**: Central venous lines, Foley catheters, arterial lines, endotracheal tube insertion site & dates. | `patient=pt_102` | Critical handoff requirement: Nurse ko pata hona chahiye ki kaunsi line kab expire/change honi hai. |
| **14** | `Procedure.Read (Nursing Intervention) (R4)`<br/>`Procedure.Search (Nursing Intervention) (R4)` | `GET /Procedure?patient={id}&category=nursing-intervention` | **Nursing Interventions**: Bedside clinical interventions (e.g. suctioning, repositioning Q2H, sterile dressing). | `patient=pt_101` | Seema ke completed interventions verify karta hai. |

---

### Group 5: Previous Handoff Notes & Outgoing Nurse Records

| # | Epic FHIR API Name | HTTP Method & Resource | Purpose in ShiftWeave | Request Query / Body | Expected Response & ShiftWeave Mapping |
| :-: | :--- | :--- | :--- | :--- | :--- |
| **15** | `DocumentReference.Read (Handoff) (R4)`<br/>`DocumentReference.Search (Handoff) (R4)` | `GET /DocumentReference?patient={id}&type=handoff` | **Previous Shift Handoff Metadata**: Seema ke pehle wale shift handoff reports ki metadata. | `type=handoff`<br/>`_sort=-date` | Outgoing shift context retrieve karta hai. Powers MCP Tool `get_handoff_context`. |
| **16** | `Binary.Read (Handoff) (R4)` | `GET /Binary/{id}` | **Handoff Document Payload**: Seema ke shift handover ka full raw text / CDA payload read karna. | `{id}` | Shift narrative parsing ke liye use hota hai. |
| **17** | `Practitioner.Read (Organizational Directory) (R4)` | `GET /Practitioner/{id}` | **Nurse Identity Verification**: Badge numbers, active credentials, registered nurse status (RN-4402 Seema, RN-5519 Reema). | `{id}` | Authenticates nurse identity in `nurses` table. |

---

### Group 6: Bidirectional WRITE-BACK APIs (Cloud EHR Commit — The Hackathon Differentiator)

> [!IMPORTANT]
> Yeh group sabse critical hai! Yeh prove karta hai ki ShiftWeave sirf ek read-only dashboard nahi hai, balki **active clinical workflow engine** hai jo verified outcomes ko external Epic EHR mein commit karta hai.

| # | Epic FHIR API Name | HTTP Method & Resource | Purpose in ShiftWeave | Request Payload (JSON) | External Epic EHR Outcome |
| :-: | :--- | :--- | :--- | :--- | :--- |
| **18** | `Task.Update (Community Resource) (R4)` | **`PUT /Task/{id}`** | **Bedside Task Sign-Off & Verification**: Jab Reema Room 305 ka Vancomycin conflict verify karti hai, toh status `completed` EHR mein commit hota hai. | `{"resourceType": "Task", "id": "task_med_102_03", "status": "completed", "note": [{"text": "Bedside verification by RN-5519"}]}` | Epic Central EHR mein task status update ho jata hai. Barcode audit mismatch close ho jata hai. |
| **19** | `DocumentReference.Create (Clinical Notes) (R4)` | **`POST /DocumentReference`** | **Official SBAR Shift Handoff Commit**: Shift handover finalize hote hi structured SBAR clinical report permanent medical record ban jata hai. | `{"resourceType": "DocumentReference", "status": "current", "type": {"text": "Nursing Shift Handoff SBAR"}, "content": [...]}` | Hospital EHR chart mein permanent clinical handover report log ho jati hai. |
| **20** | `Observation.Create (Vital Signs) (R4)` | **`POST /Observation`** | **Verified Bedside Vitals Write-back**: Handover ke waqt record kiye gaye fresh vitals EHR chart mein save karna. | `{"resourceType": "Observation", "status": "final", "category": [{"coding": [{"code": "vital-signs"}]}], "valueQuantity": {...}}` | Epic Flowsheet mein realtime vitals log commit ho jata hai. |
| **21** | `Communication.Create (Community Resource Communication) (R4)` | **`POST /Communication`** | **Shift Custody Transfer Event**: Official notification ki ICU-B ki clinical custody Seema Patel se Reema Roy ko transfer ho gayi hai. | `{"resourceType": "Communication", "status": "completed", "sender": {"reference": "Practitioner/nurse_seema_01"}, "recipient": [{"reference": "Practitioner/nurse_reema_02"}]}` | Legal audit compliance for nursing custody transfer. |
| **22** | `Provenance.Read (R4)` | **`GET /Provenance?target=DocumentReference/{id}`** | **Cryptographic Audit Trail**: Handoff report kis nurse ne kis machine/tablet se sign-off ki, uska digital footprint verify karna. | `target=DocumentReference/handoff_89d9ed55` | Validates audit trail for Joint Commission inspection. |
| **23** | `Observation.Create (Flowsheets) (R4)` | **`POST /Observation`** | **Updated Neuro & GCS Assessment Write-Back**: James Clark ke Q4 Neuro check score ko EHR chart mein commit karna. | `{"resourceType": "Observation", "code": {"text": "Glasgow Coma Scale"}, "valueInteger": 15}` | Updates flowsheets in Epic. |

---

## 🛡️ MANDATORY RULE: Zero Silent Fallback Policy

```
┌────────────────────────────────────────────────────────┐
│            STRICT ARCHITECTURAL MANDATE                │
│                                                        │
│  "NEVER DO SILENT FALLBACK ANYWHERE IN THE REPO"       │
│                                                        │
│  • No empty catch blocks: `catch {}` is FORBIDDEN.     │
│  • No silent default objects returning without alert.  │
│  • Every failure MUST produce an explicit status code, │
│    structured error object, and audit log entry.       │
└────────────────────────────────────────────────────────┘
```

### Epic API Call Failures Par Kya Hoga?

Jab koi Epic API call (e.g. `GET /Patient` ya `PUT /Task`) network outage, expired bearer token, ya HTTP 503 ke karan fail hoti hai:

```
❌ FORBIDDEN (Silent Fallback):
try {
  const res = await fetch("https://open.epic.com/Patient");
} catch {
  // SILENTLY return fake data or ignore
  return fakePatient; // ❌ VIOLATION!
}

✅ MANDATORY (Explicit Error & Transparent Degraded Mode):
try {
  const res = await fetch("https://open.epic.com/Patient");
  if (!res.ok) throw new Error(`[EPIC_API_ERROR] HTTP ${res.status}: ${res.statusText}`);
} catch (err: any) {
  // 1. Log explicit failure in audit trail
  AuditService.log({
    action: "EPIC_API_CALL:FAILED",
    outcome: "FAILURE",
    details: { error: err.message, endpoint: "/Patient" }
  });
  
  // 2. Throw typed error or return structured degradation status
  return {
    success: false,
    source: "EPIC_FHIR_CLOUD",
    status: "UNAVAILABLE",
    errorCode: "EPIC_CONNECTION_FAILED",
    message: err.message,
    fallbackTriggered: false // Must be explicitly approved by user
  };
}
```

---

## 🛠️ ShiftWeave MCP Tools $\leftrightarrow$ Epic APIs Mapping

ShiftWeave ke 9 MCP Tools internally inhi Epic APIs ko orchestrate karte hain:

```
ShiftWeave MCP Tool                      Epic FHIR R4 API Endpoint
──────────────────                      ─────────────────────────
1. get_assigned_tasks            ───►   Task.Search (Episode Checklist)
                                        MedicationRequest.Search (Signed Order)
2. get_task_details              ───►   Task.Read + MedicationAdministration.Read
3. get_task_changes              ───►   Observation.Search (since_timestamp)
4. get_handoff_context           ───►   DocumentReference.Read (Handoff)
                                        AllergyIntolerance.Search + Condition.Search
5. create_handoff_draft          ───►   DocumentReference.Create (Clinical Notes) [WRITE]
6. get_workflow_checkpoint       ───►   Provenance.Read (Target: Checkpoint)
7. save_workflow_checkpoint      ───►   Local Edge SQLite Commit (Idempotency Key)
8. resume_workflow               ───►   State Reconciliation Engine
9. acknowledge_task              ───►   Task.Update (Status: Completed) [WRITE]
                                        Communication.Create (Custody Transfer) [WRITE]
```

---

## 🏁 Summary Checklist for Implementation

- [x] Extracted all available FHIR R4 APIs from `EPIC-APIS.docx`.
- [x] Filtered out irrelevant non-clinical APIs (Insurance, Billing, Dental, Claims).
- [x] Identified 23 specific Inpatient Nursing Shift APIs across 6 core groups.
- [x] Documented both **READ (demographics, vitals, orders, allergies)** and **WRITE (task update, SBAR handoff document commit)**.
- [x] Formulated strict **Zero Silent Fallback Policy** with structured error patterns.
- [x] Mapped the 9 ShiftWeave MCP tools directly to Epic FHIR endpoints.
