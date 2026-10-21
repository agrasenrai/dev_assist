import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { StaffAuthService } from './staff-auth.service.js';
import { staffContext, staffAuthRequired, requireStaff } from './staff-context.js';
import { OperationalSandboxService } from './operational-sandbox.service.js';
import { db } from '../db/connection.js';

function equal(a: string,b: string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function staffMiddleware(req:Request,res:Response,next:NextFunction) {
  if(!staffAuthRequired() || !req.path.startsWith('/api/') && req.path!=='/mcp' || req.path==='/api/staff/config' || req.path==='/api/staff/login')return next();
  const header=req.headers['x-shiftweave-staff-session'];
  const cookie=req.headers.cookie?.split(';').map(c=>c.trim()).find(c=>c.startsWith('shiftweave_staff='))?.slice('shiftweave_staff='.length);
  let token=cookie;
  if(header){
    const bearer=process.env.MCP_AUTH_TOKEN;
    if(!bearer || !equal(req.headers.authorization||'',`Bearer ${bearer}`)){res.status(401).json({error:'Internal staff context requires the MCP service credential'});return;}
    token=String(header);
  }
  try {
    if(!token)throw new Error('Staff sign-in required');
    const principal=StaffAuthService.authenticate(token);
    const legacyAllowed=req.path.startsWith('/api/voice') || req.path.startsWith('/api/operations/') || req.path.startsWith('/api/staff/') || req.path==='/api/execution-trace' || req.path==='/mcp';
    if(!legacyAllowed){res.status(403).json({error:'Authenticated workspace uses scoped operational endpoints'});return;}
    staffContext.run({principal,sessionToken:token},()=>next());
  }catch(error){res.status(401).json({error:error instanceof Error?error.message:String(error)});}
}
export function authorizeMcpTool(name:string,args:any) {
  if(!staffAuthRequired())return;
  const actor=requireStaff();
  if(name==='operational_sandbox')return;
  if(!['STAFF_NURSE','CHARGE_NURSE'].includes(actor.role))throw new Error('This role uses the scoped operational workspace, not nursing custody tools');
  if(['publish_reviewed_handoff_note'].includes(name)&&args.execution_mode&&args.execution_mode!=='live')throw new Error('Simulated Epic writes are disabled in the authenticated workspace');
  for(const key of ['nurse_id','resolved_by','outgoing_nurse_id'])if(args[key]&&args[key]!==actor.id)throw new Error('Tool actor must match the authenticated staff account');
  if(args.task_id)OperationalSandboxService.task(args.task_id);
  if(args.patient_id) {
    const local=db.prepare('SELECT patient_id FROM epic_patient_snapshots WHERE epic_patient_id=? OR patient_id=?').get(args.patient_id,args.patient_id) as any;
    if(!local)throw new Error('Patient is not part of this authenticated workspace');
    OperationalSandboxService.assertPatient(local.patient_id);
  }
  for(const field of ['workflow_run_id','workflowRunId'])if(args[field]){
    const run=db.prepare('SELECT initiated_by FROM workflow_runs WHERE id=?').get(args[field]) as any;
    if(run&&run.initiated_by!==actor.id)throw new Error('Workflow belongs to another staff member');
  }
  if(name==='sync_epic_workspace')requireStaff(['CHARGE_NURSE']);
  if(name==='get_handoff_context'&&args.outgoing_nurse_id!==actor.id)throw new Error('Handoff context is scoped to your outgoing work');
}
