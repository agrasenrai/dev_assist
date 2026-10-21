import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Bounded, read-only sample from Epic's published Sandbox Test Data directory.
// No enumeration, clinical writes, user/password output, or changes to the active workspace.
const candidates = [
  ['Camila Lopez', 'erXuFYUfucBZaryVksYEcMg3'],
  ['Derrick Lin', 'eq081-VQEgP8drUUqCWzHfw3'],
  ['Desiree Powell', 'eAB3mDIBBcyUKviyzrxsnAw3'],
  ['Elijah Davis', 'egqBHVfQlt4Bw3XGXoxVxHg3'],
  ['Linda Ross', 'eIXesllypH3M9tAA5WdJftQ3'],
  ['Olivia Roberts', 'eh2xYHuzl9nkSFVvV3osUHg3'],
  ['Warren McGinnis', 'e0w0LEDCYtfckT6N.CkJKCw3'],
];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiftweave-dataset-audit-'));
process.env.SQLITE_DB_PATH = path.join(directory, 'audit.db');
const { db } = await import('../src/db/connection.js');
const { initializeDatabase } = await import('../src/db/schema.js');
const { EpicOAuthService } = await import('../src/providers/epic-oauth.service.js');
const { fetchEpicWorkflowSnapshot, epicSearch } = await import('../src/providers/epic-workflow-source.js');
initializeDatabase();
const safeError = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1200);
try {
  const metadata = await EpicOAuthService.authorizedFetch<any>('metadata');
  const resources = metadata.rest?.flatMap((r: any) => r.resource || []) || [];
  const advertised = resources.filter((r: any) => ['Patient','Practitioner','PractitionerRole','CareTeam','List','Location','Task','Schedule','Encounter','Observation','DocumentReference'].includes(r.type))
    .map((r: any) => ({ type: r.type, interactions: r.interaction?.map((i: any) => i.code), searchParameters: r.searchParam?.map((p: any) => p.name) }));
  console.log(JSON.stringify({ advertised }));
  const patients: any[] = [];
  const practitionerReferences = new Set<string>();
  const locationReferences = new Set<string>();
  for (const [publishedName, id] of candidates) {
    try {
      const snapshot = await fetchEpicWorkflowSnapshot(id!);
      const sections = Object.fromEntries(Object.entries(snapshot.sections).map(([type, s]) => [type, { status: s.status, count: s.resources.length, warnings: s.warnings, ...(s.error ? { error: s.error } : {}) }]));
      const encounters = snapshot.sections.Encounter?.resources || [];
      for (const encounter of encounters) {
        for (const p of encounter.participant || []) if (/^Practitioner\/[A-Za-z0-9.-]+$/.test(p.individual?.reference || '')) practitionerReferences.add(p.individual.reference);
        for (const l of encounter.location || []) if (/^Location\/[A-Za-z0-9.-]+$/.test(l.location?.reference || '')) locationReferences.add(l.location.reference);
      }
      const resource = resources.find((r: any) => r.type === 'CareTeam');
      let careTeam: any = { status: 'NOT_ADVERTISED_WITH_PATIENT_SEARCH' };
      if (resource?.searchParam?.some((p: any) => p.name === 'patient')) {
        try { const s = await epicSearch(`CareTeam?patient=${encodeURIComponent(id!)}`, 'CareTeam'); careTeam = { status: s.status, count: s.resources.length, warnings: s.warnings }; }
        catch (e) { careTeam = { status: 'ERROR', error: safeError(e) }; }
      }
      const item = { publishedName, id, identityVerified: snapshot.patient.id === id, sections,
        encounters: { statuses: [...new Set(encounters.map(e => e.status))], periods: encounters.map(e => e.period).filter(Boolean), withLocation: encounters.filter(e => e.location?.length).length },
        documents: snapshot.documents.map(d => ({ id: d.id, contentType: d.contentType, status: d.status, error: d.error })), careTeam };
      patients.push(item); console.log(JSON.stringify(item));
    } catch (error) { const item = { publishedName, id, error: safeError(error) }; patients.push(item); console.log(JSON.stringify(item)); }
  }
  const practitioners: any[] = [];
  for (const reference of [...practitionerReferences].slice(0, 8)) {
    try { const p = await EpicOAuthService.authorizedFetch<any>(reference); practitioners.push({ reference, resourceType: p.resourceType, active: p.active, qualifications: p.qualification?.map((q: any) => q.code?.text || q.code?.coding?.map((c: any) => c.display).join(', ')) }); }
    catch (e) { practitioners.push({ reference, error: safeError(e) }); }
  }
  const locations: any[] = [];
  for (const reference of [...locationReferences].slice(0, 4)) {
    try { const l = await EpicOAuthService.authorizedFetch<any>(reference); locations.push({ reference, resourceType: l.resourceType, status: l.status, physicalType: l.physicalType }); }
    catch (e) { locations.push({ reference, error: safeError(e) }); }
  }
  const report = { checkedAt: new Date().toISOString(), source: 'EPIC_OFFICIAL_PUBLIC_SANDBOX',
    directory: 'https://fhir.epic.com/Documentation?docId=testpatients', endpoint: EpicOAuthService.getConfig().fhirBaseUrl,
    candidateCount: candidates.length, accessiblePatientCount: patients.filter(p => p.identityVerified).length,
    advertised, patients, practitioners, locations, externalWrites: 'NONE', activeWorkspaceChanges: 'NONE' };
  fs.writeFileSync('deploy/epic-dataset-audit.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ accessiblePatientCount: report.accessiblePatientCount, report: 'deploy/epic-dataset-audit.json' }));
} finally {
  db.close();
  const resolved = fs.realpathSync(directory);
  if (path.dirname(resolved) === fs.realpathSync(os.tmpdir()) && path.basename(resolved).startsWith('shiftweave-dataset-audit-')) fs.rmSync(resolved, { recursive: true });
}
