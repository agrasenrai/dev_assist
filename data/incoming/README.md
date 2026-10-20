# Incoming demonstration data

Place consolidated JSON files in this directory, then run `npm run import:data`.

The importer currently supports **JSON only**. CSV and automatic FHIR normalization are not implemented.

Supported groups: nurses, shifts, patients, tasks, task_assignments, and explicit conflicts. See `sample_template.json` and the root `field_schema.md` for field names.

A task marked `FLAGGED_CONFLICT` must include a matching conflict record with actual source names and values. The importer does not fabricate disagreement details. Missing or invalid relations fail the transaction.

Each file is imported atomically with an ingestion receipt/checkpoint. Reimporting identical content is a no-op. Changed content is a new import and can update existing records; review it before importing into a database with human changes.

These fixtures are synthetic demonstration records, not live Epic data.
