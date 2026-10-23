# Synthetic hospital database population report

Generated 2026-10-23T08:34:17.259Z by a read-only query of the configured application database.

Counts below concern synthetic hospital records. Population is not proof that every field is read by every tool. Event, resolution and recovery fields fill when those workflows execute; unrelated staff-auth and Epic tables are intentionally preserved.

| Table | Hospital rows | Columns with values | Columns currently empty |
|---|---:|---|---|
| nurses | 3 | id, badge_number, full_name, email, department, role, created_at | — |
| shifts | 1 | id, unit_id, shift_type, start_time, end_time, status, created_at | — |
| patients | 3 | id, mrn, full_name, room_number, bed_number, admission_date, allergies, primary_diagnosis, created_at | acuity_level |
| tasks | 9 | id, patient_id, title, description, category, status, priority, scheduled_time, completed_time, source_system, created_at, updated_at | — |
| task_assignments | 9 | id, task_id, nurse_id, shift_id, transfer_status, assigned_at, assigned_by | — |
| task_events | 1 | id, task_id, event_type, previous_value, new_value, source, actor_id, idempotency_key, timestamp, metadata | — |
| conflicts | 1 | id, task_id, conflict_type, system_a_name, system_a_val, system_b_name, system_b_val, status, detected_at | resolution_note, resolved_by, resolved_at |
| handoffs | 1 | id, shift_id, outgoing_nurse_id, incoming_nurse_id, status, summary_markdown, data_snapshot, unresolved_conflicts_count, created_at, external_sync_status | acknowledged_at, external_resource_id, external_sync_error, external_synced_at, external_sync_payload |
| workflow_runs | 126 | id, workflow_type, initiated_by, status, error_message, created_at, updated_at | — |
| workflow_checkpoints | 295 | id, workflow_run_id, step_index, step_name, state_payload, idempotency_key, created_at | — |
| operation_receipts | 102 | idempotency_key, operation, request_json, response_json, created_at | — |
| audit_log | 155 | id, actor_type, actor_id, action, target_resource, outcome, details, latency_ms, timestamp | — |
| hospital_patients | 3 | patient_id, fhir_id, snapshot_json, retrieved_at, status | — |
| hospital_fhir_resources | 17 | resource_type, resource_id, resource_json, updated_at | — |
| simulation_catalog | 6 | id, title, description, steps_json | — |
| simulation_runs | 0 | — | id, scenario_id, voice_session, cursor, created_at, scenario_snapshot, last_result |
| simulation_results | 0 | — | run_id, step_index, result_json |

Expected empty fields include unknown patient acuity, unrecorded historical completion times, unresolved-conflict resolution fields, successful-run error messages and external publication IDs/errors when no Epic publication was requested. No placeholder values are inserted to make coverage appear complete.

MCP execution coverage is tested separately by `npm run test:hospital`: all discovered tools must be exercised, with expected Epic/auth failures recorded as boundary rejections rather than successful hospital capabilities.
