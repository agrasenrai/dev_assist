import 'dotenv/config';
import type { RequestHandler } from 'express';

export const host = process.env.HOST || '127.0.0.1';
export const publicOrigin = process.env.PUBLIC_ORIGIN || '';
const token = process.env.MCP_AUTH_TOKEN || '';
const exposed = !['127.0.0.1', 'localhost', '::1'].includes(host);
if(process.env.STAFF_AUTH_REQUIRED==='true'){
  if((process.env.SANDBOX_SESSION_SECRET||'').length<32||token.length<32)throw new Error('Authenticated sandbox requires persistent random SANDBOX_SESSION_SECRET and MCP_AUTH_TOKEN values of at least 32 characters');
  if(process.env.SHIFTWEAVE_TEST!=='1'&&process.env.LLM_PROVIDER!=='bedrock')throw new Error('Authenticated sandbox requires an explicitly configured Bedrock provider; no mock fallback is enabled');
}
if ((exposed || process.env.NODE_ENV === 'production') && (token.length < 32 || !publicOrigin)) {
  throw new Error('Hosted mode requires PUBLIC_ORIGIN and MCP_AUTH_TOKEN (32+ characters)');
}
if ([...(process.env.STAFF_AUTH_REQUIRED==='true' ? [process.env.SANDBOX_SESSION_SECRET||''] : []), token, publicOrigin].some(value => /REPLACE_|example\.com/.test(value))) {
  throw new Error('Replace hosted deployment placeholders before startup');
}
let parsedOrigin: URL | null = null;
if (publicOrigin && publicOrigin !== '*') {
  try {
    parsedOrigin = new URL(publicOrigin);
  } catch {
    throw new Error('PUBLIC_ORIGIN must be a valid URL with protocol (e.g. http://10.118.249.165:3000 or https://shiftweave.example.com) without a trailing slash');
  }
  if (parsedOrigin.origin !== publicOrigin) {
    throw new Error('PUBLIC_ORIGIN must be an exact origin without a trailing slash');
  }
}
export const allowedOrigins = new Set([
  '*',
  'http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173',
  ...(!exposed && /^\d+$/.test(process.env.PORT || '') && Number(process.env.PORT) > 0 && Number(process.env.PORT) <= 65535
    ? [`http://localhost:${Number(process.env.PORT)}`, `http://127.0.0.1:${Number(process.env.PORT)}`] : []),
  ...(publicOrigin ? [publicOrigin] : []),
  ...(parsedOrigin && process.env.NODE_ENV !== 'production' ? [`${parsedOrigin.protocol}//${parsedOrigin.hostname}:5173`] : [])
]);

export const demoAccess: RequestHandler = (_req, _res, next) => next();
