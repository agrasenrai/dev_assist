import 'dotenv/config';
import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export const host = process.env.HOST || '127.0.0.1';
export const publicOrigin = process.env.PUBLIC_ORIGIN || '';
const user = process.env.DEMO_USER || '';
const password = process.env.DEMO_PASSWORD || '';
const token = process.env.MCP_AUTH_TOKEN || '';
const exposed = !['127.0.0.1', 'localhost', '::1'].includes(host);
if ((exposed || process.env.NODE_ENV === 'production') &&
    (!user || password.length < 24 || token.length < 32 || !publicOrigin)) {
  throw new Error('Hosted mode requires PUBLIC_ORIGIN, DEMO_USER, DEMO_PASSWORD (24+ characters), MCP_AUTH_TOKEN (32+ characters)');
}
if ([user, password, token, publicOrigin].some(value => /REPLACE_|example\.com/.test(value))) {
  throw new Error('Replace hosted deployment placeholders before startup');
}
if (publicOrigin && new URL(publicOrigin).origin !== publicOrigin) throw new Error('PUBLIC_ORIGIN must be an exact origin without a trailing slash');
export const allowedOrigins = new Set([
  'http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173',
  ...(publicOrigin ? [publicOrigin] : [])
]);
function equals(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
/** Shared demo gate, not hospital nurse authentication. Tokens only authorize /mcp. */
export const demoAccess: RequestHandler = (req, res, next) => {
  if (!user && !password) return next();
  const authorization = req.headers.authorization || '';
  if (req.path === '/mcp' && token && equals(authorization, `Bearer ${token}`)) return next();
  if (equals(authorization, `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`)) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="ShiftWeave synthetic demo", charset="UTF-8"');
  res.status(401).json({ error: 'Demo access credentials required' });
};
