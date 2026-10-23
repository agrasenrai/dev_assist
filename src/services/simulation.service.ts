import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/connection.js';
import { MutationService } from './mutation.service.js';
import { CheckpointService } from './checkpoint.service.js';
import { MCPClientBridge } from '../agent/mcp-client-bridge.js';
import { ShiftWeaveOrchestrator } from '../agent/orchestrator.js';
import { hospitalEnabled, HospitalService } from './hospital.service.js';

export const simulationSchema = `
CREATE TABLE IF NOT EXISTS simulation_catalog (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, steps_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS simulation_runs (id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL REFERENCES simulation_catalog(id), voice_session TEXT NOT NULL UNIQUE, cursor INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS simulation_results (run_id TEXT NOT NULL REFERENCES simulation_runs(id), step_index INTEGER NOT NULL, result_json TEXT NOT NULL, PRIMARY KEY(run_id,step_index));
`;
export function migrateSimulationRuns() {
  const columns=db.pragma('table_info(simulation_runs)') as {name:string}[];
  for(const column of ['scenario_snapshot','last_result']) if(!columns.some(c=>c.name===column))db.exec(`ALTER TABLE simulation_runs ADD COLUMN ${column} TEXT`);
}
export const simulationInput = z.object({ action: z.enum(['list','start','read','step','ask']), scenario_id: z.string().max(100).optional(), run_id: z.string().uuid().optional(), expected_cursor: z.number().int().nonnegative().optional(), utterance: z.string().trim().min(1).max(2000).optional(), idempotency_key: z.string().uuid().optional() });
export type SimulationStep = { title: string; input: string; processing: string; expected: string; kind: 'voice'|'interrupt'|'resume'|'unavailable'; nurse_id?:string; recipient_id?:string };
const busy = new Set<string>();
export function assertSimulationDatabase() {
  if(hospitalEnabled()&&process.env.STAFF_AUTH_REQUIRED!=='true') {
    if(!HospitalService.provisioned()||!db.prepare("SELECT name FROM sqlite_master WHERE name='simulation_catalog'").get()
      ||!db.prepare("SELECT id FROM simulation_catalog WHERE id LIKE 'hospital-%' LIMIT 1").get())throw new Error('Run hospital:setup before enabling hosted hospital scenarios');
    migrateSimulationRuns();return;
  }
  if (process.env.SIMULATION_MODE !== 'true' || process.env.NODE_ENV === 'production' || process.env.STAFF_AUTH_REQUIRED === 'true') throw new Error('Guided simulations require local review mode');
  if (!db.prepare("SELECT name FROM sqlite_master WHERE name='simulation_catalog'").get()) throw new Error('Run simulation:setup first');
  const shared=db.prepare("SELECT idempotency_key FROM operation_receipts WHERE operation='SIMULATION_SHARED_DATABASE'").get();
  if (!shared && db.prepare("SELECT id FROM patients WHERE id NOT LIKE 'review:%' LIMIT 1").get()) throw new Error('Explicit simulation:setup -- --configured import required for a shared database');
  if (!shared && db.prepare("SELECT id FROM nurses WHERE id NOT LIKE 'review:%' LIMIT 1").get()) throw new Error('Explicit simulation:setup -- --configured import required for a shared database');
  if(!db.prepare("SELECT idempotency_key FROM operation_receipts WHERE operation='SIMULATION_SEED'").get())throw new Error('Review database was not explicitly provisioned');
  if(!shared&&(db.prepare('SELECT staff_id FROM staff_accounts LIMIT 1').get()||db.prepare('SELECT patient_id FROM epic_patient_snapshots LIMIT 1').get()))throw new Error('Explicit shared database provisioning required');
  migrateSimulationRuns();
}
function read(id: string) {
  const run = db.prepare('SELECT * FROM simulation_runs WHERE id=?').get(id) as {id:string;scenario_id:string;voice_session:string;cursor:number;scenario_snapshot:string|null;last_result:string|null}|undefined;
  if (!run) throw new Error('Simulation run not found');
  const scenario = (run.scenario_snapshot?JSON.parse(run.scenario_snapshot):db.prepare('SELECT * FROM simulation_catalog WHERE id=?').get(run.scenario_id)) as {id:string;title:string;description:string;steps_json:string};
  const results = (db.prepare('SELECT step_index,result_json FROM simulation_results WHERE run_id=? ORDER BY step_index').all(id) as {step_index:number;result_json:string}[]).map(r=>({step:r.step_index,...JSON.parse(r.result_json)}));
  return { ...run, last:run.last_result?JSON.parse(run.last_result):undefined, scenario: {...scenario,steps:JSON.parse(scenario.steps_json) as SimulationStep[]}, results,
    records: db.prepare(`SELECT t.id,t.title,t.status,p.full_name AS patient,p.allergies FROM tasks t JOIN patients p ON p.id=t.patient_id WHERE p.id LIKE ? ORDER BY t.id`).all(run.scenario_id.startsWith('hospital-')?'hospital:%':'review:%') };
}
export async function simulationDispatch(raw: unknown, endpoint: string): Promise<any> {
  assertSimulationDatabase(); const input=simulationInput.parse(raw);
  if(input.action==='list') return { mode:process.env.LLM_PROVIDER||'mock', source:hospitalEnabled()?'SYNTHETIC_FHIR_R4':'SYNTHETIC_REVIEW_DATABASE', scenarios:db.prepare('SELECT id,title,description FROM simulation_catalog WHERE id LIKE ? ORDER BY rowid').all(hospitalEnabled()?'hospital-%':'%') };
  if(input.action==='start') {
    if(!input.idempotency_key || !input.scenario_id) throw new Error('Scenario and retry key required');
    if(hospitalEnabled()&&!input.scenario_id.startsWith('hospital-'))throw new Error('Choose a hosted hospital scenario');
    if(!db.prepare('SELECT id FROM simulation_catalog WHERE id=?').get(input.scenario_id)) throw new Error('Scenario not found');
    return MutationService.execute('SIMULATION_START',input.idempotency_key,input,'simulation-reviewer',()=>{
      const snapshot=db.prepare('SELECT * FROM simulation_catalog WHERE id=?').get(input.scenario_id);
      const id=randomUUID(); db.prepare('INSERT INTO simulation_runs(id,scenario_id,voice_session,scenario_snapshot) VALUES(?,?,?,?)').run(id,input.scenario_id,randomUUID(),JSON.stringify(snapshot)); return read(id);
    });
  }
  if(!input.run_id) throw new Error('Run identifier required');
  const state=read(input.run_id);
  if(hospitalEnabled()&&!state.scenario_id.startsWith('hospital-'))throw new Error('This run belongs to a different simulation source');
  if(input.action==='read') return state;
  if(!input.idempotency_key) throw new Error('Retry key required');
  const receipt=db.prepare('SELECT request_json,response_json FROM operation_receipts WHERE idempotency_key=?').get(input.idempotency_key) as {request_json:string;response_json:string}|undefined;
  // MutationService validates request equality and ownership when replaying.
  if(receipt) return MutationService.execute('SIMULATION_RESULT',input.idempotency_key,input,'simulation-reviewer',()=>{throw new Error('Unexpected receipt');});
  if(input.action==='step'&&input.expected_cursor!==state.cursor)throw new Error('Scenario progress changed; reload before running the next step');
  if(busy.has(state.id)) throw new Error('Simulation is busy; retry the same request');
  busy.add(state.id);
  const bridge=new MCPClientBridge(endpoint);
  try {
    await bridge.initialize();
    const call=async(name:string,args:Record<string,unknown>)=>{const r=await bridge.callTool(name,args); if(r.isError)throw new Error(r.content.map(c=>c.text).join(' '));return JSON.parse(r.content[0]!.text);};
    const step=state.scenario.steps[state.cursor];
    if(input.action==='step'&&!step)throw new Error('Scenario is complete; use follow-up questions');
    let output:unknown; let outcome='COMPLETED';
    const kind=input.action==='ask'?'voice':step!.kind;
    if(kind==='voice') {
      const current=await call('get_voice_display',{session_id:state.voice_session});
      const utterance=input.action==='ask'?input.utterance:step!.input;
      if(!utterance)throw new Error('Question required');
      const voiceRequest=MutationService.execute('SIMULATION_VOICE_INTENT',`simulation-intent:${input.idempotency_key}`,input,'simulation-reviewer',()=>({session_id:state.voice_session,utterance,expected_revision:current.revision,idempotency_key:input.idempotency_key}));
      output=await call('voice_turn',voiceRequest);
    } else if(kind==='unavailable') {
      if(process.env.EPIC_READS_ENABLED==='true')throw new Error('This scenario requires Epic reads disabled; no external failure will be injected');
      const result=await bridge.callTool('get_epic_patient_context',{patient_id:'review-unavailable',idempotency_key:input.idempotency_key});
      if(!result.isError)throw new Error('Expected the configured-disabled integration to report an error');
      output={error:result.content.map(c=>c.text).join(' '),externalCallsPerformed:false}; outcome='EXPECTED_SERVICE_ERROR';
    } else {
      const actor=db.prepare('SELECT id FROM nurses WHERE id=?').get(step!.nurse_id||'') as {id:string}|undefined;
      const recipient=db.prepare('SELECT id FROM nurses WHERE id=?').get(step!.recipient_id||'') as {id:string}|undefined;
      if(!actor||!recipient)throw new Error('Review nurse records missing');
      const workflow=`review-recovery:${state.id}`;
      const agent=new ShiftWeaveOrchestrator(endpoint,'mock',workflow);
      try {
        await agent.initialize();
        const saved=CheckpointService.getLatestCheckpoint(workflow);
        const interrupted=(db.prepare('SELECT status FROM workflow_runs WHERE id=?').get(workflow) as {status:string}|undefined)?.status==='INTERRUPTED';
        try {
          if(kind==='interrupt'&&saved&&interrupted){outcome='INTERRUPTED';output={message:'Recovered the already committed interruption',checkpoint:saved};}
          else output=await agent.processUtterance(actor.id,kind==='interrupt'?'Prepare handoff':'Resume handoff',kind==='interrupt'?{incomingNurseId:recipient.id,simulateInterruptionAtStep:3}:{});
        }
        catch(error) {
          if(kind!=='interrupt'||!(error instanceof Error)||!error.message.includes('[CHAOS SIMULATION]'))throw error;
          outcome='INTERRUPTED';output={message:'Deliberate interruption after committed reads',checkpoint:CheckpointService.getLatestCheckpoint(workflow)};
        }
      } finally { await agent.close(); }
    }
    return MutationService.execute('SIMULATION_RESULT',input.idempotency_key,input,'simulation-reviewer',()=>{
      db.prepare('UPDATE simulation_runs SET last_result=? WHERE id=?').run(JSON.stringify({outcome,output}),state.id);
      if(input.action==='step') {
        db.prepare('INSERT INTO simulation_results(run_id,step_index,result_json) VALUES(?,?,?)').run(state.id,state.cursor,JSON.stringify({outcome,output}));
        db.prepare('UPDATE simulation_runs SET cursor=cursor+1 WHERE id=?').run(state.id);
      }
      return {...read(state.id),last:{outcome,output}};
    });
  } finally { await bridge.close();busy.delete(state.id); }
}
