import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

const live = process.argv.includes('--live');
const root = fs.realpathSync(os.tmpdir());
const directory = fs.mkdtempSync(path.join(root, 'shiftweave-epic-flow-'));
Object.assign(process.env, { SQLITE_DB_PATH: path.join(directory, 'test.db'), PORT: '0', HOST: '127.0.0.1',
  SHIFTWEAVE_TEST: '1', LLM_PROVIDER: 'mock', EPIC_READS_ENABLED: 'true', EPIC_WRITES_ENABLED: 'false',STAFF_AUTH_REQUIRED:'false',EPIC_CREATE_REVIEW_TASKS:'true',
  EPIC_TEST_PATIENT_IDS: live ? 'erXuFYUfucBZaryVksYEcMg3' : 'fixture', DEMO_USER: '', DEMO_PASSWORD: '', MCP_AUTH_TOKEN: '', NODE_ENV: 'test' });
if (!live) {
  fs.writeFileSync(path.join(directory, 'dummy.pem'), 'fixture-only-not-a-key');
  Object.assign(process.env, { EPIC_CLIENT_ID: 'fixture', PRIVATE_KEY_PATH: path.join(directory, 'dummy.pem'), EPIC_FHIR_BASE_URL: 'https://epic.test/FHIR/R4' });
}
const { appServer } = await import('../src/server.js');
const { db } = await import('../src/db/connection.js');
const { importIncomingData } = await import('../src/db/ingest.js');
const { EpicOAuthService } = await import('../src/providers/epic-oauth.service.js');
const { MCPClientBridge } = await import('../src/agent/mcp-client-bridge.js');
const originalRead = EpicOAuthService.readPatient, originalFetch = EpicOAuthService.authorizedFetch;
let bridge: InstanceType<typeof MCPClientBridge> | undefined;
try {
  if (!live) {
    EpicOAuthService.readPatient = async () => ({ resourceType: 'Patient', id: 'fixture', name: [{ text: 'Epic Fixture Patient' }] });
    EpicOAuthService.authorizedFetch = async <T>(url: string) => {
      if (url === 'Encounter/enc1') return { resourceType: 'Encounter', id: 'enc1', status: 'in-progress', subject: { reference: 'Patient/fixture' }, participant: [{ individual: { reference: 'Practitioner/author1' } }] } as T;
      const type = new URL(url).pathname.split('/').at(-1)!;
      const resource = type === 'MedicationRequest' ? { resourceType: type, id: 'order1', status: 'active', subject: { reference: 'Patient/fixture' } }
        : type === 'Encounter' ? { resourceType: type, id: 'enc1', status: 'in-progress', subject: { reference: 'Patient/fixture' }, participant: [{ individual: { reference: 'Practitioner/author1' } }] }
        : { resourceType: 'OperationOutcome', issue: [{ severity: 'warning', code: 'processing', details: { text: 'No records returned' } }] };
      return { resourceType: 'Bundle', entry: [{ resource }] } as T;
    };
  }
  importIncomingData();
  // Separate integration unit: original synthetic tasks never enter this Epic-only handoff.
  db.prepare("UPDATE nurses SET department='EPIC-DEMO' WHERE id IN ('nurse_seema_01','nurse_reema_02')").run();
  db.prepare(`INSERT INTO shifts (id,unit_id,shift_type,start_time,end_time,status) VALUES ('epic-shift','EPIC-DEMO','DAY',datetime('now'),datetime('now','+12 hours'),'ACTIVE')`).run();
  if (!appServer.listening) await once(appServer, 'listening');
  const address = appServer.address(); assert(address && typeof address !== 'string');
  bridge = new MCPClientBridge(`http://127.0.0.1:${address.port}/mcp`);
  await bridge.initialize();
  const call = async (name: string, args: any) => { const result = await bridge!.callTool(name, args); assert(!result.isError, result.content[0]?.text || 'MCP tool failed'); return JSON.parse(result.content[0]!.text); };
  const input = { nurse_id: 'nurse_seema_01', shift_id: 'epic-shift', idempotency_key: randomUUID() };
  const sync = await call('sync_epic_workspace', input);
  assert.equal(sync.status, 'READY', JSON.stringify(sync));
  assert.deepEqual(await call('sync_epic_workspace', input), sync);
  assert.equal((db.prepare('SELECT count(*) AS n FROM epic_patient_snapshots').get() as any).n, 1);
  const source = JSON.parse((db.prepare('SELECT snapshot_json FROM epic_patient_snapshots').get() as any).snapshot_json);
  assert.equal(source.sections.MedicationAdministration.resources.length, 0);
  assert.equal(source.sections.MedicationAdministration.status, 'EMPTY');
  assert.equal((db.prepare('SELECT acuity_level FROM patients WHERE id=?').get(sync.results[0].patientId) as any).acuity_level, null);
  const session = randomUUID(); let revision = 0;
  const say = async (utterance: string) => { const display = await call('voice_turn', { session_id: session, utterance, expected_revision: revision, idempotency_key: randomUUID() }); revision = display.revision; return display; };
  let display = await say('I am Seema');
  assert.equal(display.epicRecords.length, 1); assert.equal(display.tasks.length, 1);
  display = await say('Show me the latest available information about my patient');
  assert(display.speech.includes(display.epicRecords[0].name));
  assert(display.speech.includes(source.retrievedAt));
  assert.match(display.speech, /MedicationAdministration: EMPTY; 0 records/);
  console.log('PASS patient voice query uses the retrieved Epic snapshot and explicitly preserves empty sections');
  display = await say('Prepare my handoff for Reema');
  const handoff = display.handoffs.find((h: any) => h.id === display.selectedHandoffId);
  assert.match(handoff.summary, /Epic source context/);
  assert.match(handoff.summary, /MedicationAdministration: EMPTY; 0 records/);
  display = await say('I am Reema');
  assert.equal(display.tasks.length, 0); assert.equal(display.candidates.length, 1); assert.equal(display.epicRecords.length, 1);
  await say('Accept all handoff tasks'); display = await say('Confirm');
  assert.equal(display.tasks.length, 1); assert.equal(display.tasks[0].status, 'PENDING');
  await say('Finalize handoff'); display = await say('Confirm');
  assert.equal(display.handoffs[0].status, 'FINALIZED');
  const preview = await call('preview_epic_handoff_note', { handoff_id: handoff.id, nurse_id: 'nurse_reema_02' });
  assert.equal(preview.patientId, live ? 'erXuFYUfucBZaryVksYEcMg3' : 'fixture');
  assert.match(preview.authorReference, /^Practitioner\//);
  if (live && process.argv.includes('--prepare-note')) {
    fs.mkdirSync('backups', { recursive: true });
    await db.backup('backups/epic-reviewed-note-demo.db');
    fs.writeFileSync('deploy/epic-note-preview.json', JSON.stringify(preview, null, 2) + '\n');
    fs.writeFileSync('deploy/epic-note-preview.md', `# Epic sandbox note preview\n\nPatient: ${preview.patientId}\n\nEncounter: ${preview.encounterReference}\n\nAuthor: ${preview.authorReference}\n\n${preview.authorVerification}\n\nReview hash: ${preview.reviewHash}\n\n${preview.note}\n`);
  }
  if (!live) {
    const originalResponse = EpicOAuthService.authorizedFetchResponse;
    process.env.EPIC_WRITES_ENABLED = 'true';
    let posts = 0;
    EpicOAuthService.authorizedFetchResponse = async () => { posts++; return new Response(JSON.stringify({ resourceType: 'DocumentReference', id: 'created1' }), { status: 201 }); };
    try {
      const publication = { handoff_id: handoff.id, nurse_id: 'nurse_reema_02', human_confirmed: true, review_hash: preview.reviewHash, idempotency_key: randomUUID(), execution_mode: 'live' };
      const stale = await bridge.callTool('publish_reviewed_handoff_note', { ...publication, review_hash: 'stale' }); assert(stale.isError); assert.equal(posts, 0);
      const published = await call('publish_reviewed_handoff_note', publication); assert.equal(published.externalSync, 'SYNCED');
      const retried = await call('publish_reviewed_handoff_note', publication); assert.equal(retried.externalResourceId, 'created1'); assert.equal(posts, 1);
      // Separate attempted publication fixture: an ambiguous POST must never be replayed.
      db.prepare("UPDATE handoffs SET external_sync_status='NOT_REQUESTED',external_resource_id=NULL WHERE id=?").run(handoff.id);
      EpicOAuthService.authorizedFetchResponse = async () => { posts++; throw new Error('simulated lost acknowledgement'); };
      const uncertainInput = { ...publication, idempotency_key: randomUUID() };
      assert.equal((await call('publish_reviewed_handoff_note', uncertainInput)).externalSync, 'UNCERTAIN');
      assert.equal((await call('publish_reviewed_handoff_note', uncertainInput)).externalSync, 'UNCERTAIN'); assert.equal(posts, 2);
      const otherKey = await bridge.callTool('publish_reviewed_handoff_note', { ...uncertainInput, idempotency_key: randomUUID() }); assert(otherKey.isError); assert.equal(posts, 2);
      console.log('PASS exact-preview gate, verified identifier, durable publication receipt, and no replay after ambiguous POST');
    } finally { EpicOAuthService.authorizedFetchResponse = originalResponse; process.env.EPIC_WRITES_ENABLED = 'false'; }
  }
  await call('sync_epic_workspace', { ...input, idempotency_key: randomUUID() });
  assert.equal((db.prepare("SELECT nurse_id FROM task_assignments WHERE task_id=? AND transfer_status='ACTIVE'").get(display.tasks[0].id) as any).nurse_id, 'nurse_reema_02');
  assert.equal((db.prepare('SELECT count(*) AS n FROM epic_snapshot_versions').get() as any).n, 2);
  if (!live) {
    EpicOAuthService.authorizedFetch = async () => { throw new Error('simulated denial'); };
    const partial = await call('sync_epic_workspace', { ...input, idempotency_key: randomUUID() });
    assert.equal(partial.status, 'PARTIAL');
    EpicOAuthService.readPatient = async () => { throw new Error('simulated patient denial'); };
    const failed = await call('sync_epic_workspace', { ...input, idempotency_key: randomUUID() }); assert.equal(failed.status, 'FAILED');
    assert.equal((db.prepare('SELECT sync_status FROM epic_patient_snapshots').get() as any).sync_status, 'FAILED');
    const retained = await say('What is the latest update on my patient?');
    assert.match(retained.speech, /Latest refresh failed/);
    assert.match(retained.speech, /may be stale/);
    assert.throws(() => EpicOAuthService.resolveResourceUrl('https://attacker.test/steal'), /outside/);
    console.log('PASS visible partial/failed sync, retained snapshots, and cross-origin token-leak protection');
  }
  const evidence = { verifiedAt: new Date().toISOString(), source: live ? 'LIVE_EPIC_SANDBOX' : 'MOCK_FIXTURES',
    workflow: 'MCP sync -> voice display -> sourced draft -> explicit custody acceptance -> local finalization -> resync preserves custody',
    sections: Object.fromEntries(Object.entries(source.sections).map(([name,s]: any) => [name, { status: s.status, count: s.resources.length }])), externalWrites: 'NOT_PERFORMED' };
  if (live) fs.writeFileSync('deploy/epic-workflow-live-report.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  EpicOAuthService.readPatient = originalRead; EpicOAuthService.authorizedFetch = originalFetch;
  await bridge?.close();
  await new Promise<void>(resolve => appServer.close(() => resolve())); db.close();
  const resolved = fs.realpathSync(directory);
  if (path.dirname(resolved) === root && path.basename(resolved).startsWith('shiftweave-epic-flow-')) fs.rmSync(resolved, { recursive: true });
}
