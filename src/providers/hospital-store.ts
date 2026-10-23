import { createHash } from 'node:crypto';
import { db } from '../db/connection.js';
import { MutationService } from '../services/mutation.service.js';

export const hospitalResourceSchema=`CREATE TABLE IF NOT EXISTS hospital_fhir_resources (
 resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, resource_json TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(resource_type,resource_id));`;
const allowed=new Set(['Patient','Encounter','Location','Condition','AllergyIntolerance','MedicationRequest','MedicationAdministration','DocumentReference']);

/** Explicit synthetic FHIR store in the configured application DB. Not an Epic fallback. */
export function hospitalStoreFetch(resource:string,init:RequestInit={}):any {
  const url=new URL(resource,'http://synthetic.invalid/fhir/');
  if(url.origin!=='http://synthetic.invalid'||!url.pathname.startsWith('/fhir/'))throw new Error('Invalid synthetic resource path');
  const [type,id]=url.pathname.slice('/fhir/'.length).split('/');
  if(type==='metadata')return {resourceType:'CapabilityStatement',status:'active',kind:'instance',fhirVersion:'4.0.1',format:['json']};
  const method=init.method||'GET';
  if(method==='POST'||method==='PUT') {
    const body=JSON.parse(String(init.body));
    const entries=method==='POST'?body.entry:[{resource:body,request:{method:'PUT',url:`${type}/${id}`}}];
    if(method==='POST'&&(type||body.resourceType!=='Bundle'||body.type!=='transaction'))throw new Error('Expected a synthetic FHIR transaction');
    if(!Array.isArray(entries)||!entries.length||entries.length>10000)throw new Error('Invalid FHIR import size');
    for(const e of entries){const r=e.resource;if(!r||!allowed.has(r.resourceType)||!/^[A-Za-z0-9.-]{1,64}$/.test(r.id)||e.request?.method!=='PUT'||e.request.url!==`${r.resourceType}/${r.id}`)throw new Error('Invalid synthetic FHIR import resource');}
    const digest=createHash('sha256').update(JSON.stringify(entries)).digest('hex');
    const key=new Headers(init.headers).get('Idempotency-Key');
    if(!key?.trim())throw new Error('Synthetic FHIR writes require an Idempotency-Key');
    MutationService.execute('HOSPITAL_FHIR_STORE',`hospital-store:${key}`,{digest,count:entries.length},'hospital-setup',()=>{
      for(const e of entries)db.prepare(`INSERT INTO hospital_fhir_resources(resource_type,resource_id,resource_json) VALUES(?,?,?)
        ON CONFLICT(resource_type,resource_id) DO UPDATE SET resource_json=excluded.resource_json,updated_at=CURRENT_TIMESTAMP`).run(e.resource.resourceType,e.resource.id,JSON.stringify(e.resource));
      return {stored:entries.length};
    });
    return method==='PUT'?body:{resourceType:'Bundle',type:'transaction-response',entry:entries.map(()=>({response:{status:'200 OK'}}))};
  }
  if(method!=='GET'||!type||!allowed.has(type))throw new Error('Unsupported synthetic FHIR request');
  if(id){const row=db.prepare('SELECT resource_json FROM hospital_fhir_resources WHERE resource_type=? AND resource_id=?').get(type,id) as any;if(!row)throw new Error('Synthetic FHIR record not found');return JSON.parse(row.resource_json);}
  const patient=url.searchParams.get('patient');
  if(!patient)throw new Error('Patient scope is required');
  const rows=db.prepare('SELECT resource_json FROM hospital_fhir_resources WHERE resource_type=? ORDER BY resource_id').all(type) as {resource_json:string}[];
  return {resourceType:'Bundle',type:'searchset',entry:rows.map(r=>JSON.parse(r.resource_json)).filter(r=>(r.subject?.reference||r.patient?.reference)===`Patient/${patient}`).map(resource=>({resource}))};
}
