import 'dotenv/config';
import '../src/runtime-config.js';
import { existsSync } from 'node:fs';

const provider = process.env.LLM_PROVIDER || 'mock';
if (!['mock', 'bedrock'].includes(provider)) throw new Error('LLM_PROVIDER must be mock or bedrock');
if (provider === 'bedrock' && !process.env.BEDROCK_MODEL_ID) throw new Error('Set BEDROCK_MODEL_ID to an accessible tool-capable model or inference profile');
if (process.env.EPIC_READS_ENABLED === 'true' && (!process.env.EPIC_CLIENT_ID || !process.env.EPIC_KID || !existsSync(process.env.PRIVATE_KEY_PATH || './keys/private_key.pem'))) {
  throw new Error('Epic requires EPIC_KID and a readable PRIVATE_KEY_PATH matching the registered public JWKS');
}
console.log(`Configuration valid. LLM=${provider}; Epic=${process.env.EPIC_CLIENT_ID ? 'configured, not verified' : 'disabled'}. No external calls made.`);
