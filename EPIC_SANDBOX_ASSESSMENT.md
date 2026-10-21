# Epic sandbox dataset assessment

Assessment date: 22 October 2026 (Asia/Kolkata). Bounded read-only testing of seven patients from Epic's published test directory using the configured backend client. No clinical writes or changes to the active workspace were made. Evidence: `deploy/epic-dataset-audit.json`.

## Decision

Epic's public sandbox is usable for actual clinical API interoperability and a small patient cohort. **Current access and tested records do not fulfill all ShiftWeave requirements as the sole sandbox.** This is a conclusion about this client and bounded sample, not proof that no other Epic customer sandbox could support the missing workflows.

Do not replace absent Epic data with sample-template records and label the result Epic-sourced. Do not discard workflow features because an external sandbox lacks the necessary records.

## Verified cohort

| Published patient | Encounters | Condition records | Allergy records | Medication orders | Administrations | Documents |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Camila Lopez | 10 | 7 | 1 | 1 | 0 | 0 |
| Derrick Lin | 1 | 2 | 1 | 1 | 0 | 0 |
| Desiree Powell | 1 | 0 | 1 | 2 | 0 | 0 |
| Elijah Davis | 2 | 3 | 2 | 1 | 0 | 0 |
| Linda Ross | 1 | 2 | 1 | 2 | 0 | 0 |
| Olivia Roberts | 1 | 2 | 1 | 0 | 0 | 0 |
| Warren McGinnis | 1 | 2 | 2 | 0 | 0 | 0 |
| Total | 17 | 18 | 9 | 7 | 0 | 0 |

All seven Patient reads matched the requested identity. These are counts of returned resource records, not distinct diagnoses or confirmed positive allergies. For example, an allergy resource can record an unknown history. Warning OperationOutcomes were excluded from counts.

The published directory advertises documents/Binary for some patients, but this client's tested R4 searches returned none. Directory coverage across APIs/versions does not establish the content available through this exact client/query. Dates in retrieved encounters include 2019 and 2023; an `in-progress` status alone does not prove a current admission or a continually evolving hospital feed.

Seven patients can support a focused workflow demonstration. There is no established patient-count threshold for hackathon credibility, statistical validation, or clinical representativeness. Scenario coverage and verifiable outcomes matter more than inflating patient counts.

## Requirement coverage

| Requirement | Observation | Result |
| --- | --- | --- |
| Patient identity and clinical background | Seven accessible patients; conditions, allergies and orders returned | Covered for this cohort |
| Current unit/bed census | Encounter location references returned; four linked Location reads returned 403 | Partial; exact room/bed/ward mapping not verified |
| Nursing directory | Five linked Practitioner reads returned 403 | Blocked by current access; professional roles not verified |
| Practitioner roles | One linked PractitionerRole search returned 403 | Blocked |
| Care-team relationships | Patient-scoped CareTeam searches returned 403 | Blocked |
| Patient-list roster | Patient-scoped List search returned 400 requiring `code` | Not verified; not evidence that the sandbox contains no lists |
| Nurse shift schedule and patient duty assignments | No verified staff/shift/assignment dataset or integration | Missing |
| Bedside nursing tasks | Patient-scoped Task search returned 403; Episode Checklist is not assumed to be generic medication tasks | Missing verified mapping/access |
| Vitals and labs | Two bounded Observation searches returned 403 | Blocked |
| Medication administration reconciliation | Zero MedicationAdministration records across all seven tested patients | Missing demonstrated cases |
| Previous notes and medication-note disagreements | Zero DocumentReference records across all seven tested patients | Missing demonstrated cases |
| Reviewed note write-back | Previous explicitly approved create attempt returned 403; no new write in this assessment | Unverified/blocked; leave writes disabled |
| Authenticated nurse identity | Backend client credentials authenticate the application; voice names select demo profiles | Missing clinician identity integration |
| Handoff draft, custody acceptance, checkpoints and recovery | These are ShiftWeave-owned operations already implemented locally | Keep as real application operations; do not claim they were imported from Epic |

CapabilityStatement advertised resource types/search fields. Advertisement does not prove authorization, sub-API semantics, returned data, or operational workflow support. A 403 does not identify its precise configuration cause or prove universal unavailability.

## Ways forward without removing features

1. **Epic-only attempt:** enable the relevant practitioner, role, care-team, location, observation and note APIs, then retest after Epic's registration sync. Obtain an actual configured patient-list identifier/search contract and a verified nursing task dataset. Permissions may unblock access but do not create missing administrations, notes, nursing shifts or realistic disagreement cases. Full coverage must be proven before selecting Epic as the sole source.
2. **Recommended: explicit two-source simulation:** retain Epic as the clinical interoperability source, and use a separately named, writable workflow sandbox for synthetic staff identities, roles, shifts, assignments, task events, nursing notes and controlled discrepancies. Store those records through actual APIs and durable state. Clearly tag their source; never auto-switch sources after a failed Epic call. Preserve original Epic timestamps and IDs; any simulated clock/episode mapping must be explicit.
3. **Single controlled sandbox alternative:** use a private FHIR R4 environment such as self-hosted Medplum, with Synthea-generated clinical data plus deliberately constructed nursing workflow scenarios. Synthea supplies clinical histories, not proof of a complete nurse roster or shift-handoff dataset. Practitioner/PractitionerRole, CareTeam and Task relationships, login mapping and scenario events still need implementation and validation. This would be a custom FHIR sandbox, not Epic. Keep the Epic adapter for separate interoperability evidence.

The writable sandbox must support real read/write operations for the simulation: explicit incoming custody, human conflict review, blocked premature finalization, per-patient note preview/publication, stable idempotency, restart recovery, source-version checks and visible failure states. It must not use canned successful responses. No feature needs to be removed merely because the public Epic sample is incomplete.

Suggested acceptance target, not an implemented dataset or hackathon rule: 6–12 patients, at least two incoming/outgoing staff identities with verified sandbox login mapping, two shifts, and scenarios covering normal handoff, missing data, genuine source disagreement, refusal before review, lost response, restart, custody acceptance and note write/readback. Validate these relationships rather than counting isolated records.

## Reproduce

```sh
npx tsx scripts/audit-epic-dataset.ts
npx tsx scripts/audit-epic-operational.ts
npm run typecheck
```

The operational audit deliberately records a rejected preliminary List query. Resolve the documented `code`/patient-list search contract before making any roster-availability claim. Both scripts use temporary databases and do not import patients into the current nurse workspace.

## Official references

- Epic Sandbox Test Data: https://fhir.epic.com/Documentation?docId=testpatients
- Epic Developer Testing Guide, including responsible sandbox testing and application synchronization: https://fhir.epic.com/Documentation?docId=testing
- Epic patient-list context: https://fhir.epic.com/Documentation?docId=patientfacingfhirapps
- Medplum platform and self-hosting: https://www.medplum.com/docs
- Medplum teams, roles and task ownership: https://www.medplum.com/docs/careplans/teams-and-delegation
- Synthea patient generator and supported record categories: https://github.com/synthetichealth/synthea
