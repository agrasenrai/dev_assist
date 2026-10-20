# ShiftWeave — Important Epic Incoming APIs (R4)

Ye file Epic app registration mein API selection aur ShiftWeave integration planning ke liye hai. Isme actual API keys, tokens ya credentials store nahi karne hain.

## Incoming aur Outgoing ka matlab

- **Incoming API:** ShiftWeave client hai, Epic server hai. ShiftWeave Epic se data read karta hai ya permitted write request bhejta hai.
- **Outgoing API:** Epic client hai aur ShiftWeave server hai. Epic hamare endpoint ko call karta hai.
- **Current scope:** Nursing shift handoff ke liye primarily Incoming APIs chahiye. Di hui Outgoing API list mein se abhi koi required nahi hai.
- `DocumentReference.Create` jaisi write API bhi **Incoming** hai, kyunki request ShiftWeave se Epic ko jaati hai.

## 1. Core Incoming APIs — pehle ye evaluate/select karo

Neeche saare names **R4** versions ke liye hain. Selection ke baad target Epic environment mein permissions aur actual response fields verify karne hain.

| Epic API name | ShiftWeave mein zaroorat | Important limitation |
| --- | --- | --- |
| `Patient.Read (Demographics) (R4)` | Patient identity, name aur MRN retrieve karna. | Room, bed aur admission date sirf Patient resource se milenge, ye assume mat karo. |
| `Encounter.Read (Patient Chart) (R4)` | Known encounter ka admission aur location context retrieve karna. | Hospital ke encounter/location mappings verify karo. |
| `Encounter.Search (Patient Chart) (R4)` | Patient ke relevant active admission/encounter ko dhoondhna. | Supported search parameters aur encounter status mapping verify karo. |
| `List.Read (Patient List) (R4)` | Known hospital patient list se roster references lena. | ICU-B ki suitable list aur access available hona chahiye. |
| `List.Search (Patient List) (R4)` | Relevant patient list discover karna, jab supported ho. | Ye generic ward-search guarantee nahi hai; list configuration verify karo. |
| `Condition.Read (Encounter Diagnosis) (R4)` | Known admission diagnosis record retrieve karna. | Sirf recorded information summarize karni hai; diagnosis generate nahi karna. |
| `Condition.Search (Encounter Diagnosis) (R4)` | Encounter ke recorded diagnoses dhoondhna. | Encounter diagnosis aur longitudinal problem list alag contexts hain. |
| `Condition.Read (Problems) (R4)` | Known problem-list item retrieve karna. | Har problem current admission ka primary diagnosis nahi hota. |
| `Condition.Search (Problems) (R4)` | Patient ka relevant problem-list background lena. | Active/relevant problems ko source aur status ke saath preserve karo. |
| `AllergyIntolerance.Read (Patient Chart) (R4)` | Known allergy record retrieve karna. | Missing data ko automatically “no known allergies” mat banao. |
| `AllergyIntolerance.Search (Patient Chart) (R4)` | Recorded patient allergies retrieve karna. | Source aur clinical status preserve karo. |
| `MedicationRequest.Read (Signed Medication Order) (R4)` | Known signed medication order retrieve karna. | Order prescribed hone ka matlab administered hona nahi hai. |
| `MedicationRequest.Search (Signed Medication Order) (R4)` | Relevant prescribed medication orders retrieve karna. | Orders sirf read karne hain; dose ya treatment change nahi karna. |
| `MedicationAdministration.Read (R4)` | Known administration record ka documented status lena. | Administration record ko correct patient, order aur time window se match karo. |
| `MedicationAdministration.Search (R4)` | Relevant documented administrations dhoondhna. | Order aur administration status alag hone se akela conflict prove nahi hota. |
| `DocumentReference.Read (Handoff) (R4)` | Known previous handoff document ka reference/metadata lena. | Actual content alag Binary resource mein ho sakta hai. |
| `DocumentReference.Search (Handoff) (R4)` | Patient ke previous handoff records dhoondhna. | Relevant encounter, author aur timestamp identify karo. |
| `Binary.Read (Handoff) (R4)` | DocumentReference se linked handoff ka actual content lena. | Returned attachment URL/reference follow karo; content inline available ho to extra call zaroori nahi. |

**Read vs Search:** `Search` relevant records dhoondhne ke liye hai; `Read` known resource ID ka exact record retrieve karta hai. Har interaction har request mein call karna zaroori nahi hai.

**Roster alternative:** Agar configured patient list available nahi hai, authorized test patient/encounter IDs se demo chala sakte hain. `Patient?unit=ICU-B` jaisa undocumented query parameter invent nahi karna.

## 2. Optional Incoming APIs — feature chahiye tab add karo

| Epic API name | Kab use karna hai |
| --- | --- |
| `Observation.Read (Vital Signs) (R4)` / `Observation.Search (Vital Signs) (R4)` | Handoff mein recorded BP, HR, SpO2 aur doosre vitals dikhane hain. Values, units aur timestamps preserve karo. |
| `Observation.Read (Flowsheets) (R4)` / `Observation.Search (Flowsheets) (R4)` | Relevant nursing assessments/flowsheet observations summarize karni hain. |
| `DocumentReference.Read (Clinical Notes) (R4)` / `DocumentReference.Search (Clinical Notes) (R4)` | Nurse note ya relevant shift narrative Handoff resource mein available nahi hai. |
| `Binary.Read (Clinical Notes) (R4)` | Clinical Notes DocumentReference ka actual content Binary mein linked hai. |
| `Flag.Read (Isolation) (R4)` / `Flag.Search (Isolation) (R4)` | Recorded isolation precautions dashboard/handoff mein dikhani hain. |
| `Device.Read (Lines, Drains, Airways) (R4)` / `Device.Search (Lines, Drains, Airways) (R4)` | Lines/drains/airways ka documented context include karna hai. |
| `Practitioner.Read (Organizational Directory) (R4)` | Records mein referenced practitioner ki details resolve karni hain. Ye API akeli nurse login authenticate nahi karti. |
| `Location.Read (Organizational Directory) (R4)` | Encounter ke location reference se ward/room/bed context resolve karna hai, jab returned mapping mein zaroorat ho. |

## 3. Task APIs — conditional, generic nursing-task support assume mat karo

| Epic API name | Decision |
| --- | --- |
| `Task.Read (Episode Checklist) (R4)` | Tab select karo jab hospital ka required workflow Episode Checklist tasks expose karta ho. |
| `Task.Search (Episode Checklist) (R4)` | Episode-focused search hai; documented search mein episode `focus` required hai. Generic nurse shift task query nahi hai. |
| `Task.Read (Community Resource) (R4)` / `Task.Search (Community Resource) (R4)` | Community-resource/referral workflow ki requirement ho tab evaluate karo. Current ICU handoff ke liye default selection nahi. |
| `Task.Update (Community Resource) (R4)` | **Abhi select mat karo.** Isse Episode Checklist ya arbitrary ICU medication task update supported assume nahi karna. |

Jab tak correct Epic workflow support verify nahi hota, ShiftWeave nurse assignments, custody acceptance aur local task acknowledgements SQLite mein manage karega. Local acknowledgement ko Epic medication administration ya order modification ke roop mein present nahi karna.

## 4. Optional write-back — reviewed handoff note

**Candidate:** `DocumentReference.Create (Clinical Notes) (R4)`

- Human-reviewed handoff note submit karne ke liye evaluate karo.
- Target hospital ke supported payload, note types, patient/encounter linkage aur write permissions verify karo.
- Clinical note create karna dedicated Epic Handoff record update karne ke barabar assume nahi karna.
- Local draft create hote hi automatically official clinical record publish nahi karna; explicit human review/confirmation chahiye.
- Confirmed response/resource identifier ke bina UI mein “Epic synced” ya “write successful” nahi dikhana.
- Write intent aur progress ko `idempotency_key` aur `workflow_checkpoints` ke saath persist karo. Ambiguous failure par remote commit verify karke hi retry karo; local key se Epic-side deduplication automatically guarantee nahi hoti.

## 5. Conflict detection ke liye actual data kya chahiye?

Example: EHR administration record “completed” bolta hai, aur same patient/order/time window ka nurse note “pending” bolta hai.

1. Medication order identify karo: `MedicationRequest`.
2. Documented administration retrieve karo: `MedicationAdministration`.
3. Actual nurse note/handoff content retrieve karo: `DocumentReference` + linked `Binary`, jab needed ho.
4. Matching records mein disagreement ho to dono values aur provenance `conflicts` mein save karo.
5. Human nurse ko verification ke liye present karo; AI discrepancy automatically resolve nahi karega.

Missing record, failed API call aur confirmed conflicting record ko alag states mein dikhana hai.

## 6. Outgoing APIs — current list mein selection nahi chahiye

Di hui list ke `_AssignChatIntegration`, `_PayerFhirImportClinicalOutgoing`, Bulk Payer-to-Payer, CRD, DTR, PAS aur MyChart Mobile BLE Wayfinding APIs current ShiftWeave handoff scope mein required nahi hain.

Epic mein note write karne ke liye Outgoing API select karna zaroori nahi; relevant Incoming write API use hoti hai.

## 7. Access aur implementation rules

- **Available ≠ authorized access:** API selection, app user type, OAuth permissions aur target Epic environment mein client-ID activation verify karna hai.
- Nurse-facing app aur backend integration ke liye appropriate authorized access flow use karo; keys/tokens source files mein store nahi karne.
- HAPI FHIR public test server ko Epic server ya verified Epic integration label nahi karna.
- Epic HTTP errors, expired token, timeout aur permission denial explicitly UI aur audit log mein surface karo. Silently empty lists ya fake success mat return karo.
- Checkpointing, crash recovery, audit logs, local assignments aur idempotency ShiftWeave backend ki responsibilities hain; inke liye Epic API selection nahi chahiye.
- Agent-to-tool communication MCP minimum `2025-11-25`, Express `/mcp` par Streamable HTTP se rahega. Epic adapter FHIR HTTP APIs ko call karega.
- Default demo free/local/mock mode mein chalega. External Epic integration separately configured aur verified capability hogi.

## 8. Existing project docs mein corrections

- `callapi.md` ki fixed “8 APIs enough” list verified integration contract nahi hai.
- `Binary.Read (Handoff)` zaroorat padne par required hai; ise universally redundant mat maano.
- Encounter/location APIs ko universally unnecessary mat maano; room/bed/admission context mappings verify karo.
- `Task.Update (Community Resource)` generic bedside medication-task completion endpoint nahi hai.
- API list mein naam hone se nurse assignments, custody transfer ya complete ICU roster access prove nahi hota.

## Official references

- [Epic FHIR API catalog](https://fhir.epic.com/)
- [Epic Task.Search — Episode Checklist specification](https://fhir.epic.com/Specifications?api=10296)
- [Epic FHIR overview and Task resource context](https://open.epic.com/Clinical/FHIR?whereTo=patient)
- [Epic Clinical Notes / DocumentReference integration](https://open.epic.com/Clinical/CarePlan)
- [Epic client-ID and API access guide](https://open.epic.com/Tech/GetTechSpec?spec=Client+ID+tutorial.pdf)

Prepared from the supplied app API catalog and official Epic documentation reviewed on 20 October 2026. Final selection depends on the target hospital's enabled APIs and verified workflow support.
