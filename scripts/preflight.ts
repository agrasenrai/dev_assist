import 'dotenv/config';
import '../src/runtime-config.js';
import { existsSync } from 'node:fs';
import { hospitalCapability } from '../src/providers/hospital-fhir.js';

const provider = process.env.LLM_PROVIDER || 'mock';
if (!['mock', 'bedrock'].includes(provider)) throw new Error('LLM_PROVIDER must be mock or bedrock');
if (provider === 'bedrock' && !process.env.BEDROCK_MODEL_ID) throw new Error('Set BEDROCK_MODEL_ID to an accessible tool-capable model or inference profile');
if (process.env.EPIC_READS_ENABLED === 'true' && (!process.env.EPIC_CLIENT_ID || !process.env.EPIC_KID || !existsSync(process.env.PRIVATE_KEY_PATH || './keys/private_key.pem'))) {
  throw new Error('Epic requires EPIC_KID and a readable PRIVATE_KEY_PATH matching the registered public JWKS');
}
if(process.env.HOSPITAL_SIMULATION_ENABLED==='true') {
  if(process.env.STAFF_AUTH_REQUIRED==='true')throw new Error('Hosted hospital source is separate from the authenticated staff deployment');
  await hospitalCapability();
  console.log('Synthetic hospital FHIR R4 connection verified.');
}
console.log(`Configuration valid. LLM=${provider}; Epic=${process.env.EPIC_CLIENT_ID ? 'configured, not verified' : 'disabled'}.`);
