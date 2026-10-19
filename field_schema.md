# Field Schema

## PATIENTS
- id
- mrn
- full_name
- room_number
- bed_number
- admission_date
- acuity_level
- allergies
- primary_diagnosis
- created_at

## NURSES
- id
- badge_number
- full_name
- email
- department
- role
- created_at

## SHIFTS
- id
- unit_id
- shift_type
- start_time
- end_time
- status
- created_at

## TASKS
- id
- patient_id
- title
- description
- category
- status
- priority
- scheduled_time
- completed_time
- source_system
- created_at
- updated_at

## TASK_ASSIGNMENTS
- id
- task_id
- nurse_id
- shift_id
- transfer_status
- assigned_at
- assigned_by

## TASK_EVENTS
- id
- task_id
- event_type
- previous_value
- new_value
- source
- actor_id
- idempotency_key
- timestamp
- metadata

## CONFLICTS
- id
- task_id
- conflict_type
- system_a_name
- system_a_val
- system_b_name
- system_b_val
- status
- resolution_note
- resolved_by
- resolved_at
- detected_at

## HANDOFFS
- id
- shift_id
- outgoing_nurse_id
- incoming_nurse_id
- status
- summary_markdown
- data_snapshot
- unresolved_conflicts_count
- created_at
- acknowledged_at

## WORKFLOW_RUNS
- id
- workflow_type
- initiated_by
- status
- error_message
- created_at
- updated_at

## WORKFLOW_CHECKPOINTS
- id
- workflow_run_id
- step_index
- step_name
- state_payload
- idempotency_key
- created_at

## AUDIT_LOG
- id
- actor_type
- actor_id
- action
- target_resource
- outcome
- details
- latency_ms
- timestamp
