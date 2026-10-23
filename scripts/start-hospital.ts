import 'dotenv/config';
import path from 'node:path';
import { spawn } from 'node:child_process';

// This prepares the configured DB and starts the existing MCP server; no cloud provisioning.
process.env.SQLITE_DB_PATH ||= path.resolve('data/shiftweave.db');
process.env.HOSPITAL_SIMULATION_ENABLED='true';
process.env.HOSPITAL_DATA_SOURCE ||= 'sqlite';
if(process.env.STAFF_AUTH_REQUIRED==='true')throw new Error('Use the existing staff startup command; this command prepares synthetic voice/MCP records only');
const {initializeDatabase}=await import('../src/db/schema.js');
initializeDatabase();
await new Promise<void>((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx','scripts/setup-hospital.ts'],{env:process.env,stdio:'inherit'});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Hospital setup exited ${code}`)));
});
if(!process.argv.includes('--prepare-only')) await import('../src/server.js');
