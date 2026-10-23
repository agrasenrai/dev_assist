/** Separate synthetic FHIR R4 adapter. Never uses Epic credentials or falls back to fixtures. */
import { hospitalStoreFetch } from './hospital-store.js';
export const hospitalUsesSQLite=()=> (process.env.HOSPITAL_DATA_SOURCE||'sqlite')==='sqlite';
export function hospitalConfig() {
  if(hospitalUsesSQLite())return {base:'urn:shiftweave:configured-sqlite:synthetic-fhir-r4',token:''};
  if(process.env.HOSPITAL_DATA_SOURCE!=='fhir')throw new Error('HOSPITAL_DATA_SOURCE must be sqlite or fhir');
  const raw = process.env.HOSPITAL_FHIR_BASE_URL;
  if (!raw) throw new Error('Simulation hospital FHIR endpoint is not configured');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Invalid simulation hospital FHIR endpoint');
  return { base: url.href.replace(/\/$/, ''), token: process.env.HOSPITAL_FHIR_TOKEN || '' };
}
export async function hospitalFetch(resource: string, init: RequestInit = {}): Promise<any> {
  if(hospitalUsesSQLite())return hospitalStoreFetch(resource,init);
  const {base,token} = hospitalConfig();
  const url = new URL(resource, `${base}/`);
  if (url.origin !== new URL(base).origin || !url.pathname.startsWith(`${new URL(base).pathname.replace(/\/$/,'')}/`))
    throw new Error('FHIR link is outside the configured simulation hospital');
  let response: Response;
  try { response = await fetch(url, { ...init, redirect:'error', signal:AbortSignal.timeout(12000),
    headers:{Accept:'application/fhir+json',...(token?{Authorization:`Bearer ${token}`} : {}),...init.headers} }); }
  catch { throw new Error('Simulation hospital is unavailable. Check its connection and retry.'); }
  if (!response.ok) throw new Error(`Simulation hospital request failed (HTTP ${response.status})`);
  const data:any = await response.json();
  if (data.resourceType === 'OperationOutcome') throw new Error('Simulation hospital returned a FHIR operation error');
  return data;
}
export async function hospitalSearch(type: string, patientId: string) {
  const resources:any[] = [], seen = new Set<string>();
  let next:string|undefined = `${type}?patient=${encodeURIComponent(patientId)}&_count=100`;
  while (next) {
    if (seen.has(next) || seen.size >= 20) throw new Error('Simulation hospital paging is incomplete');
    seen.add(next);
    const bundle = await hospitalFetch(next);
    if (bundle.resourceType !== 'Bundle' || bundle.type !== 'searchset') throw new Error('Expected a FHIR search result');
    for (const entry of bundle.entry || []) {
      const r = entry.resource;
      if (r?.resourceType === 'OperationOutcome') {
        if (r.issue?.some((i:any)=>['fatal','error'].includes(i.severity))) throw new Error('FHIR search returned an error');
        continue;
      }
      if (r?.resourceType !== type) throw new Error('Unexpected FHIR resource in search');
      const ref = r.subject?.reference || r.patient?.reference;
      if (ref !== `Patient/${patientId}` && ref !== `${hospitalConfig().base}/Patient/${patientId}`)
        throw new Error('Simulation hospital returned a record for another patient');
      resources.push(r);
    }
    const link = bundle.link?.find((l:any)=>l.relation==='next');
    if (link && !link.url) throw new Error('Invalid FHIR next page');
    next = link?.url;
  }
  return resources;
}
export async function hospitalCapability() {
  const result = await hospitalFetch('metadata');
  if (result.resourceType !== 'CapabilityStatement' || result.fhirVersion !== '4.0.1')
    throw new Error('Simulation hospital must serve FHIR R4 (4.0.1)');
  return {source:'SYNTHETIC_FHIR_R4',status:'CONNECTED',fhirVersion:result.fhirVersion};
}
