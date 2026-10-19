# ShiftWeave — Lean Epic FHIR R4 API Specification (`callapi.md`)

> **File Purpose**: Yeh document ShiftWeave ke liye **sirf aur sirf zaroori (Core) APIs** ko define karta hai.  
> **Architecture Principle**: **No Over-Engineering, Zero Bloat, Zero Silent Fallbacks.**  
> **Key Decision**: 23 APIs ke bloat ko trim karke **8 Must-Have APIs** (6 READ + 2 WRITE-BACK) par streamline kiya gaya hai taaki demo 100% fast, reliable, aur crash-proof rahe.

---

## 📊 High-Level Comparison: 8 Core vs 15 Waste APIs

```
Total Catalog APIs: 23
┌──────────────────────────────────────────────────────────────────┐
│ 🟢 THE 8 CORE APIS (100% Sufficient for Hackathon & Demo)        │
│    • 6 READ APIs: Patient, Condition, Allergy, Task, MedOrder,   │
│                   Barcode Administration                         │
│    • 2 WRITE APIs: Task.Update (PUT), DocumentReference (POST)   │
└──────────────────────────────────┬───────────────────────────────┘
                                   │ Filtered out 15 APIs
┌──────────────────────────────────▼───────────────────────────────┐
│ 🔴 15 REDUNDANT / WASTE APIS (Skipped to prevent lag & crashes)   │
│    • Binary.Read, Procedure.Read, Communication.Create,          │
│      Provenance.Read, Device.Read, MedicationDispense, Flag,     │
│      Encounter.Read, List.Read, Observation.Create (Multiple)... │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🟢 PART 1: The 8 Must-Have Core APIs (Detailed Specs)

---

### Group A: The 6 READ APIs (Shift Data Ingestion)

#### 1. `Patient.Read (Demographics)`
* **HTTP Method & Endpoint**: `GET /Patient/{id}`
* **Kiske Liye**: Patient name, MRN, room number, bed, age, sex.
* **Request Query**: `GET /Patient/pt_102`
* **Response Sample (FHIR JSON)**:
  ```json
  {
    "resourceType": "Patient",
    "id": "pt_102",
    "identifier": [{ "system": "urn:oid:hospital-mrn", "value": "MRN-90211" }],
    "name": [{ "family": "Rostova", "given": ["Elena"] }],
    "gender": "female",
    "birthDate": "1982-11-03"
  }
  ```
* **ShiftWeave Mapping**: SQLite `patients` table mein store hota hai.

---

#### 2. `Condition.Read (Problems)`
* **HTTP Method & Endpoint**: `GET /Condition?patient={id}&clinical-status=active`
* **Kiske Liye**: Patient ka primary ICU diagnosis (SBAR handoff ka Situation & Background).
* **Request Query**: `GET /Condition?patient=pt_102&category=problem-list-item`
* **Response Sample**:
  ```json
  {
    "resourceType": "Condition",
    "id": "cond_102_01",
    "clinicalStatus": { "coding": [{ "code": "active" }] },
    "code": { "text": "Severe Sepsis secondary to Pyelonephritis" },
    "subject": { "reference": "Patient/pt_102" }
  }
  ```
* **ShiftWeave Mapping**: `patients.primary_diagnosis` mein save hota hai.

---

#### 3. `AllergyIntolerance.Read (Patient Chart)`
* **HTTP Method & Endpoint**: `GET /AllergyIntolerance?patient={id}&clinical-status=active`
* **Kiske Liye**: Medication allergy warnings (Latex, Sulfa, Penicillin) taaki nurse safe rahe.
* **Request Query**: `GET /AllergyIntolerance?patient=pt_102`
* **Response Sample**:
  ```json
  {
    "resourceType": "AllergyIntolerance",
    "id": "alg_102_01",
    "criticality": "high",
    "code": { "text": "Latex, Sulfa" },
    "patient": { "reference": "Patient/pt_102" }
  }
  ```
* **ShiftWeave Mapping**: `patients.allergies` aur Handoff Alert cards mein display hota hai.

---

#### 4. `Task.Read (Episode Checklist)`
* **HTTP Method & Endpoint**: `GET /Task?patient={id}&status=ready,in-progress,completed`
* **Kiske Liye**: Nurse ke operational tasks (Q4 neuro check, vitals, mobility check).
* **Request Query**: `GET /Task?owner=nurse_seema_01`
* **Response Sample**:
  ```json
  {
    "resourceType": "Task",
    "id": "task_vital_101_01",
    "status": "completed",
    "priority": "routine",
    "description": "Q4 Vital Signs & Neuro Check",
    "for": { "reference": "Patient/pt_101" },
    "executionPeriod": { "start": "2026-10-20T06:00:00Z" }
  }
  ```
* **ShiftWeave Mapping**: SQLite `tasks` table aur MCP Tool `get_assigned_tasks`.

---

#### 5. `MedicationRequest.Read (Signed Medication Order)`
* **HTTP Method & Endpoint**: `GET /MedicationRequest?patient={id}&status=active`
* **Kiske Liye**: Doctor ka active prescription order (Dawa ka naam, dose, route, scheduled time).
* **Request Query**: `GET /MedicationRequest?patient=pt_102`
* **Response Sample**:
  ```json
  {
    "resourceType": "MedicationRequest",
    "id": "med_req_vancomycin_102",
    "status": "active",
    "intent": "order",
    "medicationCodeableConcept": { "text": "IV Vancomycin 1g Infusion" },
    "dosageInstruction": [{
      "text": "1g IV in 250mL NS over 60 mins Q12H",
      "timing": { "repeat": { "frequency": 2, "period": 24, "periodUnit": "h" } }
    }]
  }
  ```
* **ShiftWeave Mapping**: SQLite `tasks` table (`category: 'MEDICATION_CHECK'`).

---

#### 6. `MedicationAdministration.Read` (The Conflict Detection Engine!)
* **HTTP Method & Endpoint**: `GET /MedicationAdministration?patient={id}`
* **Kiske Liye**: **Discrepancy Source A**! Barcode pump logs jo EHR mein log hue.
* **Request Query**: `GET /MedicationAdministration?patient=pt_102`
* **Response Sample (EHR Data says GIVEN)**:
  ```json
  {
    "resourceType": "MedicationAdministration",
    "id": "med_admin_pump_04",
    "status": "completed",
    "effectiveDateTime": "2026-10-20T06:10:00Z",
    "device": [{ "display": "BC-Pump-ICU-04" }],
    "medicationCodeableConcept": { "text": "IV Vancomycin 1g" }
  }
  ```
* **The Magic in ShiftWeave**:
  * Machine log bolta hai: `COMPLETED` at 06:10 AM.
  * Seema ka shift note bolta hai: `PENDING / DELAYED` (Pharmacy release pending).
  * ShiftWeave instant `conflicts` table entry generate karta hai aur human review drawer open karta hai!

---

### Group B: The 2 WRITE-BACK APIs (Cloud EHR Commit)

> [!IMPORTANT]
> Yeh 2 WRITE APIs prove karti hain ki ShiftWeave bidirectional hai aur bedside verification ko cloud EHR mein commit karta hai.

#### 7. `Task.Update (PUT /Task/{id})` — Bedside Conflict Resolution Write-Back
* **HTTP Method**: **`PUT`**
* **Endpoint**: `https://hapi.fhir.org/baseR4/Task/task_med_102_03`
* **Kiske Liye**: Jab Nurse Reema bedside physically verify karke conflict resolve karti hai, toh status `completed` external Epic EHR mein commit hota hai.
* **Request Payload**:
  ```json
  {
    "resourceType": "Task",
    "id": "task_med_102_03",
    "status": "completed",
    "businessStatus": { "text": "BEDSIDE_VERIFIED" },
    "note": [{
      "authorString": "Reema Roy, RN (RN-5519)",
      "time": "2026-10-20T07:15:00Z",
      "text": "Physically verified empty IV bag on pole; infusion completed normally."
    }],
    "lastModified": "2026-10-20T07:15:00Z"
  }
  ```
* **Outcome**: Epic Central EHR mein task status `COMPLETED` ho jata hai aur audit discrepancy close ho jati hai.

---

#### 8. `DocumentReference.Create (POST /DocumentReference)` — Official SBAR Handoff Commit
* **HTTP Method**: **`POST`**
* **Endpoint**: `https://hapi.fhir.org/baseR4/DocumentReference`
* **Kiske Liye**: Seema aur Reema ke shift handover sign-off karte hi full SBAR handover report permanent medical record ke roop mein Epic EHR chart mein save hoti hai.
* **Request Payload**:
  ```json
  {
    "resourceType": "DocumentReference",
    "status": "current",
    "type": {
      "coding": [{
        "system": "http://loinc.org",
        "code": "51848-0",
        "display": "Nursing Shift Handoff SBAR"
      }]
    },
    "subject": { "reference": "Patient/pt_102" },
    "author": [{ "reference": "Practitioner/nurse_reema_02" }],
    "content": [{
      "attachment": {
        "contentType": "text/markdown",
        "title": "ICU-B Morning Shift Handoff (Seema -> Reema)",
        "data": "IyBJQ1UtQiBIYW5kb2Zm..."
      }
    }]
  }
  ```
* **Outcome**: Permanent clinical handover note Epic chart mein officially file ho jata hai.

---

## 🔴 PART 2: The 15 Waste / Redundant APIs (Kyun Ignore Karein?)

| # | Skipped API Name | Kyun Waste / Redundant Hai? |
| :-: | :--- | :--- |
| **1** | `Binary.Read (Handoff)` | **Redundant**: `DocumentReference` ke inline attachment mein hi note aa jata hai. Alag se Binary call karna double latency hai. |
| **2** | `Procedure.Read (Nursing Intervention)` | **Redundant**: Tasks already `Task.Read` se mil rahe hain. Duplicate data. |
| **3** | `Communication.Create` | **Redundant**: Custody transfer already `DocumentReference` ke author field se record ho jata hai. |
| **4** | `Observation.Create (Vital Signs)` | **Over-Engineered**: Har vital ke liye alag POST call server ko choke karti hai; SBAR document write-back enough hai. |
| **5** | `Observation.Create (Flowsheets)` | **Over-Engineered**: Same as above. |
| **6** | `Provenance.Read` | **Waste**: Cryptographic blockchain provenance hackathon demo mein evaluate nahi hota. Internal SQLite audit log isse better hai. |
| **7** | `Device.Read (Lines/Drains)` | **Overkill**: Lines aur catheter ka context simple task description mein include ho jata hai. |
| **8** | `MedicationDispense.Read` | **Redundant**: Nurse shift note already pharmacy status bata deta hai. |
| **9** | `Flag.Read (Isolation)` | **Redundant**: `AllergyIntolerance` aur `Condition` safety context ke liye kaafi hain. |
| **10** | `Encounter.Read` | **Redundant**: Room number aur admission date `Patient` resource mein already mil jati hai. |
| **11** | `List.Read (Patient List)` | **Redundant**: Ward query direct `Patient.Search?unit=ICU-B` se hoti hai. |
| **12** | `Specimen.Read` | **Waste**: Phlebotomy specimen tracking hackathon scope se bahar hai. |
| **13** | `CarePlan.Read` | **Waste**: Shift handoff ke liye `Task` aur `Condition` sufficient hain. |
| **14** | `NutritionOrder.Read` | **Waste**: Dietary orders shift handover ka core part nahi hain. |
| **15** | `Observation.Read (Flowsheets)` | **Redundant**: Observation Vitals se hi critical numbers mil jaate hain. |

---

## 🛡️ PART 3: Strict "Zero Silent Fallbacks" Rule for the 8 APIs

```
┌────────────────────────────────────────────────────────┐
│            STRICT ARCHITECTURAL MANDATE                │
│                                                        │
│  "NEVER DO SILENT FALLBACK ANYWHERE IN THE REPO"       │
│                                                        │
│  • Agar Epic FHIR API fail ho ya token expire ho:     │
│    1. Error ko swallow ya hide MAT karo.               │
│    2. Local cache par chupke se fallback MAT karo.     │
│    3. Caller ko explicit Error Object return karo.     │
│    4. UI par explicit "Connection Error" banner dikhao. │
│    5. Audit log mein FAILURE record karo.              │
└────────────────────────────────────────────────────────┘
```

### Explicit Error Handling Pattern (Zero Silent Fallback)
```typescript
async function callEpicAPI(endpoint: string, options: RequestInit = {}) {
  try {
    const res = await fetch(`https://hapi.fhir.org/baseR4${endpoint}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers }
    });

    if (!res.ok) {
      // ❌ NO SILENT FALLBACK! Explicitly throw with status:
      throw new Error(`[EPIC_API_ERROR] HTTP ${res.status}: ${res.statusText} at ${endpoint}`);
    }

    return await res.json();
  } catch (err: any) {
    // Log explicit failure
    AuditService.log({
      action: `EPIC_CALL_FAILED:${endpoint}`,
      outcome: "FAILURE",
      details: { error: err.message }
    });

    // Bubble up explicit error to UI / Caller (Never swallow!)
    throw new Error(`External Epic EHR unavailable: ${err.message}`);
  }
}
```

---

## 📋 ShiftWeave MCP Tools $\leftrightarrow$ 8 Core APIs Direct Mapping

```
ShiftWeave MCP Tool           Method    Epic FHIR R4 Endpoint
───────────────────           ──────    ─────────────────────
1. get_assigned_tasks          GET      /Task?status=ready,in-progress
2. get_task_details            GET      /Task/{id} + /MedicationAdministration
3. get_handoff_context         GET      /Patient/{id} + /Condition + /AllergyIntolerance
4. acknowledge_task (Resolve)  PUT      /Task/{id} [WRITE-BACK]
5. create_handoff_draft        POST     /DocumentReference [WRITE-BACK]
```

Yeh 8 APIs ShiftWeave ko **100% clean**, **sub-second fast**, aur **clinically sound** banati hain!
