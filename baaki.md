# ShiftWeave — Baaki Kaam aur Gap Analysis (Architecture vs Reality)

> **File Purpose**: Yeh document [`architecture.md`](./architecture.md), [`plan.md`](./plan.md), aur [`how_it_works.md`](./how_it_works.md) ke promises ko **actual code** ke saath line-by-line compare karta hai — aur saaf-saaf batata hai ki **kya complete hai**, **kya partial/mock hai**, aur **kya sach mein baaki hai**.

---

## 📊 High-Level Summary: Kitna Ho Gaya vs Kitna Baaki Hai?

| Component / Layer | Architecture Claim | Actual Code Status | Status |
| :--- | :--- | :--- | :---: |
| **1. MCP Transport & Spec** | Streamable HTTP (`2025-11-25`) | 100% Real Express `/mcp` + 9 Tools | ✅ COMPLETE |
| **2. Checkpoint & Chaos Recovery** | Zero-loss SQLite crash recovery | 100% Real Checkpoint & Recovery Engine | ✅ COMPLETE |
| **3. Clinical Safety & Conflicts** | Discrepancy isolation & human sign-off | 100% Real Conflict Drawer & Audit Log | ✅ COMPLETE |
| **4. React Dashboard & Voice Sim** | Bedside UI + Alexa+ Voice Loop | 100% Real TTS + Web Speech Mic STT | ✅ COMPLETE |
| **5. LLM Agent Reasoning** | Autonomous Multi-Turn Clinical Agent | **Hardcoded Mock Script (Only 2 questions)** | ⚠️ PARTIAL |
| **6. Hospital Dataset** | Full ICU Ward Shift Roster | **Sirf 2 Patients aur 2 Tasks** | ⚠️ PARTIAL |
| **7. External FHIR Write-Back** | Bidirectional REST Write (`PUT`/`POST`) | **Actual HTTP Write 0% (Sirf local SQLite)** | ❌ BAAKI HAI |
| **8. Git & Submission Package** | Judges' 1-Click Run & 3-Min Video | Branches unmerged, Video Demo unrecorded | ⚠️ BAAKI HAI |

---

## 🔍 Deep-Dive: Kaunsa Kaam Kitna Baaki Hai?

---

### 1. 🧠 LLM & Agent Reasoning Layer (⚠️ PARTIAL / MOCK)

#### Architecture Claim:
* Agent kisi bhi nurse ke natural question par autonomously evaluate karta hai, relevant MCP tools select karta hai, aur grounded medical answer deta hai.
* AWS Bedrock Converse API mini-challenge ke liye fully wired hai.

#### Actual Code Reality (`src/agent/llm-provider.ts`):
1. **Mock Agent Hardcoded Hai**:
   * Default runner `MockAutonomousAgent` ke andar static `if (lastUserMsg.includes("resume")) ... else ...` laga hai.
   * Agar judge ya nurse koi doosra clinical question pooche (jaise *"James Clark ka neuro check pass hua kya?"* ya *"Elena Rostova ko kaunsi dawa chal rahi hai?"*), toh Mock Agent wahi fixed Seema-Reema canned handoff text wapas bol deta hai!
2. **Gemini LLM Runner Kachha Hai**:
   * `GeminiLLMProvider` native Google Gemini Function Calling (`tools: [{ functionDeclarations }]`) use nahi kar raha. Sirf basic prompt mein string JSON maang raha hai, jo production mein format error se crash ho sakta hai.
3. **Bedrock Runner Multi-Turn mein Toot-ta Hai**:
   * `BedrockLLMProvider` line 334 par messages filter karte waqt `role: "tool"` ke messages ko drop kar deta hai:
     ```ts
     .filter(m => m.role === "user" || m.role === "assistant")
     ```
   * Is wajah se AWS Bedrock Converse API ko pehle tool call ka result wapas milta hi nahi hai, aur multi-step reasoning break ho jati hai!

#### 🛠️ Kya Karna Baaki Hai:
- [ ] **Intelligent Dynamic Fallback Agent**: Mock runner ko rule/intent-based banana taaki woh har type ke clinical question (patient details, vitals, pending tasks, acuity) par actual SQLite database query karke dynamic answer generate kare.
- [ ] **Native Gemini Function Calling**: Gemini SDK ke structured tool-calling format ko implement karna.
- [ ] **Bedrock Converse Tool-Result Fix**: Bedrock message history mein tool-result blocks (`role: "user"` with `toolResult`) ko proper schema ke sath bhejna.

---

### 2. 🗄️ Clinical Dataset & Database Calls (⚠️ PARTIAL)

#### Architecture Claim:
* Real ICU-B ward data with multiple patient rooms, varied acuity levels (1 to 5), pending doses, vitals, and scheduled clinical procedures.

#### Actual Code Reality (`data/incoming/sample_template.json`):
1. **Bohot Chhota Dataset**:
   * Database mein sirf **2 patients** hain:
     * James Clark (Room 304, Post-op Cholecystectomy)
     * Elena Rostova (Room 305, Sepsis)
   * Aur sirf **2 tasks** hain (1 Vital check + 1 Vancomycin med check).
2. **Dashboard Khali Lagta Hai**:
   * Kanban board par 4 columns hain (Pending, In Progress, Conflict, Completed), lekin total 2 tasks hone ki wajah se UI realistic hospital station nahi lagta.
3. **Live FHIR API Provider Fake Queries Karta Hai**:
   * [`src/providers/fhir-api-provider.ts`](./src/providers/fhir-api-provider.ts) mein jab mode switch karte hain, woh bas SQLite se hi data query karke field mein `'FHIR_R4_BRIDGE'` likh deta hai.

#### 🛠️ Kya Karna Baaki Hai:
- [ ] **Expand Dataset to 4-5 Beds**:
  - Room 304: James Clark (Acuity 2 - Q4 Neuro Check [Done])
  - Room 305: Elena Rostova (Acuity 1 - STAT IV Vancomycin [Conflict])
  - Room 306: Marcus Vance (Acuity 3 - IV Saline Flush [Completed])
  - Room 307: Sarah Jenkins (Acuity 2 - STAT Blood Glucose Check [Pending])
  - Room 308: David Miller (Acuity 4 - Post-op Wound Dressing [Pending])
- [ ] Ingest script dobara run karna taaki UI full hospital department jaisa bhara hua dikhe.

---

### 3. 🌐 External EHR "Write-Back" Pipeline (❌ BAAKI HAI)

#### Architecture Claim (`how_it_works.md` & `README.md`):
* *"Bidirectional Integration: ShiftWeave does not merely read; it actively WRITES BACK verified workflow outcomes to external FHIR R4 EHR destination."*
  * `PUT /fhir/R4/Task/:id` (Bedside verification write-back)
  * `POST /fhir/R4/DocumentReference` (SBAR clinical handoff write-back)

#### Actual Code Reality (`src/providers/fhir-api-provider.ts` & `src/server.ts`):
1. **Actual HTTP PUT / POST Call Code Mein Hai Hi Nahi**:
   * `updateTaskStatus()` method sirf local SQLite table `tasks` aur `task_events` mein row update karta hai.
   * `create_handoff_draft` tool sirf SQLite table `handoffs` mein draft save karta hai.
   * Koi bhi `fetch('https://hapi.fhir.org/baseR4/...', { method: 'PUT' / 'POST' })` call nahi jaati!
2. **Kyun Risk Hai**:
   * Agar koi judge network tab inspect kare ya backend code dekhe, toh unhe pata chal jayega ki external write-back sirf paper/doc pe likha hai, actual HTTP call nahi ho rahi.

#### 🛠️ Kya Karna Baaki Hai:
- [ ] **Real FHIR REST Write Methods Implement Karna**:
  - `writeTaskUpdateToFHIR(taskId, status, note)`: Actual HTTP PUT call to `https://hapi.fhir.org/baseR4/Task/${taskId}`.
  - `writeHandoffDocumentToFHIR(handoffRecord)`: Actual HTTP POST call to `https://hapi.fhir.org/baseR4/DocumentReference`.
- [ ] UI Drawer mein "FHIR Cloud Sync: 200 OK (Resource ID: fhir_task_102)" ka visual feedback display karna.

---

### 4. 🖥️ UI Micro-Polish (⚠️ QUICK FIX BAAKI)

#### Actual Status:
* React UI bohot achha bana hua hai.
* Lekin do high-value visual indicators missing hain:
  1. **AWS Bedrock Badge**: Header par dikhna chahiye ki AWS Bedrock Converse API integrated hai (Hackathon Mini Challenge score capture karne ke liye).
  2. **Active Provider Indicator in Chat**: Alexa+ ke message ke niche ek chhota tag: `[LLM: Local Deterministic Engine | Fallback AWS Bedrock Ready]`.

#### 🛠️ Kya Karna Baaki Hai:
- [ ] `ShiftHeader.tsx` mein AWS Bedrock badge add karna.
- [ ] `ConflictReviewDrawer.tsx` mein FHIR Write-Back confirmation chip add karna.
- [ ] `npm run build:client` recompile karna.

---

### 5. 📦 Git Repository & Submission Delivery (⚠️ CRITICAL BAAKI)

#### Actual Status:
1. **Git Branches Split Hain**:
   * Saara latest code `feature/md` aur `feature/voiceassistant` par hai.
   * Remote `origin` par `main` branch update nahi hai ya alag branch par hai.
   * Agar judge `git clone` karega, toh usse latest code aur latest README nahi milega jab tak `main` merge na ho!
2. **3-Minute Video Demo Script Recorded Nahi Hai**:
   * Script [`README.md`](./README.md) mein likha hai, lekin screen recording abhi baaki hai.
3. **Devpost Submission Form Fields**:
   * Form text ready karke rakhna baaki hai.

#### 🛠️ Kya Karna Baaki Hai:
- [ ] Sare feature branches ko merge karke GitHub ki default branch par push karna.
- [ ] 3-minute video recording complete karna (Crash & Recovery demonstration ke sath).
- [ ] Submission description draft karna.

---

## 🎯 Action Priority Roadmap (Jeetne Ke Liye Next Steps)

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: Code Gaps (Actual Technical Depth)                  │
│ • Real Dynamic LLM Router (Any Question Answerable)         │
│ • Real FHIR HTTP PUT/POST Write-Back                        │
│ • 5-Bed Expanded ICU Dataset                                │
├─────────────────────────────────────────────────────────────┤
│ STEP 2: UI Visuals (Proving to Judges)                      │
│ • AWS Bedrock Badge in ShiftHeader                          │
│ • Live FHIR Write-Back Toast in Conflict Drawer             │
├─────────────────────────────────────────────────────────────┤
│ STEP 3: Git & Repo Housekeeping                             │
│ • Merge to main branch & verify 1-click clone               │
├─────────────────────────────────────────────────────────────┤
│ STEP 4: Video Demo & Final Submission                       │
│ • Record 3-minute walkthrough video                         │
│ • Submit on Amazon Hackathon Portal                         │
└─────────────────────────────────────────────────────────────┘
```
