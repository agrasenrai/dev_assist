import 'dotenv/config';
import {once} from 'node:events';
const {appServer}=await import('../src/server.js');
const {db}=await import('../src/db/connection.js');
try{
  if(!appServer.listening)await once(appServer,'listening');
  const address=appServer.address();if(!address||typeof address==='string')throw new Error('Worker server unavailable');
  const response=await fetch(`http://127.0.0.1:${address.port}/api/operations/workspace`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:process.env.OPERATIONAL_RESTART_COOKIE||''},body:'{}'});
  const workspace=await response.json()as any;if(!response.ok)throw new Error(workspace.error);
  console.log('OPERATIONAL_RESTART_RESULT:'+JSON.stringify({role:workspace.principal.role,patients:workspace.patients.length,documents:workspace.documents.map((d:any)=>d.id),handoffs:workspace.handoffs.map((h:any)=>h.status)}));
}finally{await new Promise<void>(resolve=>appServer.close(()=>resolve()));db.close();}
