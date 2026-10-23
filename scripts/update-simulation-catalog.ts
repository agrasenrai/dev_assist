import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
if(!process.argv[2]&&!process.env.SQLITE_DB_PATH)throw new Error('Set SQLITE_DB_PATH or supply a database path');
const target=path.resolve(process.argv[2]||process.env.SQLITE_DB_PATH!);
if(!fs.existsSync(target))throw new Error('Review database not found');
Object.assign(process.env,{SQLITE_DB_PATH:target,SIMULATION_MODE:'true',NODE_ENV:'development',STAFF_AUTH_REQUIRED:'false'});
const {db}=await import('../src/db/connection.js');
const {MutationService}=await import('../src/services/mutation.service.js');
try {
 if(!db.prepare("SELECT name FROM sqlite_master WHERE name='simulation_catalog'").get()||!db.prepare("SELECT idempotency_key FROM operation_receipts WHERE operation='SIMULATION_SEED'").get())throw new Error('Explicitly provision the simulation catalog first');
 const schema=z.array(z.object({id:z.string().min(1),title:z.string().min(1),description:z.string(),steps:z.array(z.object({title:z.string(),input:z.string(),processing:z.string(),expected:z.string(),kind:z.enum(['voice','interrupt','resume','unavailable']),nurse_id:z.string().optional(),recipient_id:z.string().optional()})).min(1)}));
 const catalog=schema.parse(JSON.parse(fs.readFileSync('data/simulations/catalog.json','utf8')));
 const hash=createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
 MutationService.execute('SIMULATION_CATALOG',`simulation-catalog:${hash}`,{catalog},'simulation-reviewer',()=>{
  for(const s of catalog)db.prepare('INSERT INTO simulation_catalog VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,steps_json=excluded.steps_json').run(s.id,s.title,s.description,JSON.stringify(s.steps));
  return {updated:catalog.length};
 });
 console.log(`Updated ${catalog.length} database scenarios; patient records and saved run snapshots preserved`);
} finally{db.close();}
