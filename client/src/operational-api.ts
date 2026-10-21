import { safeUUID } from './uuid.js';
export type Staff = {id:string;name:string;username:string;unit:string;role:'ADMIN'|'CHARGE_NURSE'|'STAFF_NURSE'|'PHYSICIAN'};
export async function staffRequest(path:string,body?:unknown){
  const response=await fetch(path,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(120000)});
  const result=await response.json();if(!response.ok){const error=new Error(result.error||`Request failed: ${response.status}`)as Error&{status:number};error.status=response.status;throw error;}return result;
}
export async function operation(action:string,input:Record<string,unknown>={}){return staffRequest(`/api/operations/${encodeURIComponent(action)}`,input);}
export function bindStaffVoice(staffId:string){const key=`shiftweave:staff-voice:${staffId}`;let id=localStorage.getItem(key);if(!id){id=safeUUID();localStorage.setItem(key,id);}localStorage.setItem('shiftweave:voice:display-session',id);}
