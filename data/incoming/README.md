# Incoming Clinical Data Drop-in Directory

Place your external hospital dataset files in this directory.

### Supported File Formats:
* JSON (e.g. `patients.json`, `nurses.json`, `tasks.json`, `shifts.json`)
* Consolidated JSON (e.g. `hospital_data.json`)
* CSV files with matching column headers

### Canonical Field Reference:
Refer to [`field_schema.md`](file:///C:/Users/siddh/Desktop/dev_assist/field_schema.md) for the exact 11 table field definitions.

### How to Import:
Run the ingestion pipeline command:
```bash
npm run import:data
```
The ingestion pipeline will validate all relations, detect conflicting task records, and load everything into the local SQLite database automatically.
