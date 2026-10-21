import 'dotenv/config';
import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export const host = process.env.HOST || '127.0.0.1';
export const publicOrigin = process.env.PUBLIC_ORIGIN || '';
const user = process.env.DEMO_USER || '';
const password = process.env.DEMO_PASSWORD || '';
const token = process.env.MCP_AUTH_TOKEN || '';
const exposed = !['127.0.0.1', 'localhost', '::1'].includes(host);
if(process.env.STAFF_AUTH_REQUIRED==='true'){
  if((process.env.SANDBOX_SESSION_SECRET||'').length<32||token.length<32)throw new Error('Authenticated sandbox requires persistent random SANDBOX_SESSION_SECRET and MCP_AUTH_TOKEN values of at least 32 characters');
  if(process.env.SHIFTWEAVE_TEST!=='1'&&!['gemini','bedrock'].includes(process.env.LLM_PROVIDER||''))throw new Error('Authenticated sandbox requires an explicitly configured Gemini or Bedrock provider; no mock fallback is enabled');
}
if ((exposed || process.env.NODE_ENV === 'production') &&
    (token.length < 32 || !publicOrigin || process.env.STAFF_AUTH_REQUIRED!=='true'&&(!user || password.length < 24))) {
  throw new Error('Hosted mode requires PUBLIC_ORIGIN and MCP_AUTH_TOKEN (32+ characters); legacy demo mode also requires DEMO_USER and DEMO_PASSWORD (24+ characters)');
}
if ([...(process.env.STAFF_AUTH_REQUIRED==='true' ? [process.env.SANDBOX_SESSION_SECRET||''] : [user,password]), token, publicOrigin].some(value => /REPLACE_|example\.com/.test(value))) {
  throw new Error('Replace hosted deployment placeholders before startup');
}
let parsedOrigin: URL | null = null;
if (publicOrigin) {
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
  'http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173',
  ...(!exposed && /^\d+$/.test(process.env.PORT || '') && Number(process.env.PORT) > 0 && Number(process.env.PORT) <= 65535
    ? [`http://localhost:${Number(process.env.PORT)}`, `http://127.0.0.1:${Number(process.env.PORT)}`] : []),
  ...(publicOrigin ? [publicOrigin] : []),
  ...(parsedOrigin && process.env.NODE_ENV !== 'production' ? [`${parsedOrigin.protocol}//${parsedOrigin.hostname}:5173`] : [])
]);
function equals(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
/** Shared demo gate, not hospital nurse authentication. Tokens only authorize /mcp. */
export const demoAccess: RequestHandler = (req, res, next) => {
  if(process.env.STAFF_AUTH_REQUIRED==='true')return next();
  if (!user && !password) return next();
  const authorization = req.headers.authorization || '';
  if (req.path === '/mcp' && token && equals(authorization, `Bearer ${token}`)) return next();
  if (equals(authorization, `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`)) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="ShiftWeave synthetic demo", charset="UTF-8"');
  res.status(401).json({ error: 'Demo access credentials required' });
};
