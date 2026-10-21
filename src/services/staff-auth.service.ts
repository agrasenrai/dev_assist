import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from '../db/connection.js';
import { MutationService } from './mutation.service.js';
import { staffContext, type StaffPrincipal, type StaffRole, requireStaff } from './staff-context.js';

export class StaffAuthService {
  static hashPassword(password: string) {
    if (password.length < 12 || password.length > 200) throw new Error('Use a staff password between 12 and 200 characters');
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  }
  static verify(password: string, stored: string) {
    if (typeof password !== 'string' || password.length > 200) return false;
    const [salt, expected] = stored.split(':');
    if (!salt || !expected) return false;
    const actual = scryptSync(password, salt, 64); const bytes = Buffer.from(expected, 'hex');
    return actual.length === bytes.length && timingSafeEqual(actual, bytes);
  }
  static tokenHash(token: string) { return createHash('sha256').update(token).digest('hex'); }
  static principal(staffId: string): StaffPrincipal {
    const staff = db.prepare(`SELECT n.id,n.full_name AS name,n.role,n.department AS unit,a.username FROM nurses n JOIN staff_accounts a ON a.staff_id=n.id WHERE n.id=? AND a.active=1`).get(staffId) as StaffPrincipal | undefined;
    if (!staff) throw new Error('Active staff account required');
    return staff;
  }
  static authenticate(token: string) {
    const session = db.prepare(`SELECT s.staff_id FROM staff_sessions s JOIN staff_accounts a ON a.staff_id=s.staff_id
      WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>? AND a.active=1 AND s.password_version=a.password_version`).get(this.tokenHash(token), Date.now()) as { staff_id: string } | undefined;
    if (!session) throw new Error('Staff session expired or invalid. Sign in again');
    return this.principal(session.staff_id);
  }
  static login(username: string, password: string, key: string) {
    if (!/^[A-Za-z0-9._-]{3,80}$/.test(username) || !key?.trim()) throw new Error('Valid username and request key required');
    const account = db.prepare('SELECT * FROM staff_accounts WHERE username=?').get(username) as any;
    const valid = this.verify(password, account?.password_hash || 'unmatched:00');
    if (!account || !account.active || account.locked_until > Date.now() || !valid) {
      if (account) MutationService.execute('STAFF_LOGIN_DENIED', `staff-login-denied:${key}`, { username }, account.staff_id, () => {
        db.prepare('UPDATE staff_accounts SET failed_attempts=failed_attempts+1,locked_until=? WHERE staff_id=?').run(account.failed_attempts >= 4 ? Date.now() + 5 * 60_000 : account.locked_until, account.staff_id);
        return { denied: true };
      });
      throw new Error('Invalid staff credentials or temporarily locked account');
    }
    const secret = process.env.SANDBOX_SESSION_SECRET || '';
    if (secret.length < 32) throw new Error('Configure SANDBOX_SESSION_SECRET with at least 32 random characters');
    const token = createHmac('sha256', secret).update(`${account.staff_id}:${account.password_version}:${key}`).digest('hex');
    const principal = this.principal(account.staff_id);
    const result = MutationService.execute('STAFF_LOGIN', `staff-login:${key}`, { username, passwordVersion: account.password_version }, account.staff_id, () => {
      const expiresAt = Date.now() + 8 * 60 * 60_000;
      db.prepare('INSERT INTO staff_sessions (token_hash,staff_id,expires_at,password_version) VALUES (?,?,?,?)').run(this.tokenHash(token), principal.id, expiresAt, account.password_version);
      db.prepare('UPDATE staff_accounts SET failed_attempts=0,locked_until=0 WHERE staff_id=?').run(principal.id);
      return { principal, expiresAt };
    });
    this.authenticate(token);
    return { ...result, token };
  }
  static logout(key: string) {
    const context = staffContext.getStore(); if (!context) throw new Error('Staff authentication required');
    return MutationService.execute('STAFF_LOGOUT', key, { staffId: context.principal.id }, context.principal.id, () => {
      db.prepare('UPDATE staff_sessions SET revoked=1 WHERE token_hash=?').run(this.tokenHash(context.sessionToken)); return { signedOut: true };
    });
  }
  static createAccount(input: { username: string; password: string; fullName: string; role: StaffRole; unit: string; badge: string; idempotency_key: string }, bootstrap = false) {
    const actor = bootstrap ? 'sandbox-bootstrap' : requireStaff(['ADMIN']).id;
    if (bootstrap && (db.prepare('SELECT count(*) n FROM staff_accounts').get() as any).n) throw new Error('Bootstrap is only permitted for an empty staff directory');
    if (!/^[A-Za-z0-9._-]{3,80}$/.test(input.username) || !input.fullName.trim() || !input.unit.trim() || !input.badge.trim()) throw new Error('Valid staff name, username, unit and badge required');
    if (!['ADMIN','CHARGE_NURSE','STAFF_NURSE','PHYSICIAN'].includes(input.role)) throw new Error('Unsupported staff role');
    const staffId = `staff:${input.username}`;
    const passwordHash = this.hashPassword(input.password);
    return MutationService.execute('STAFF_ACCOUNT_CREATE', input.idempotency_key, { username: input.username, name: input.fullName, role: input.role, unit: input.unit, badge: input.badge }, actor, () => {
      db.prepare('INSERT INTO nurses (id,badge_number,full_name,email,department,role) VALUES (?,?,?,?,?,?)').run(staffId, input.badge, input.fullName, `${input.username}@workflow-sandbox.invalid`, input.unit, input.role);
      db.prepare('INSERT INTO staff_accounts (staff_id,username,password_hash) VALUES (?,?,?)').run(staffId, input.username, passwordHash);
      return { staffId, username: input.username, role: input.role, source: 'SHIFTWEAVE_OPERATIONAL_SANDBOX' };
    });
  }
  static bindVoiceSession(sessionId: string) {
    const principal = requireStaff(['STAFF_NURSE','CHARGE_NURSE']);
    const prior = db.prepare('SELECT staff_id FROM staff_voice_sessions WHERE session_id=?').get(sessionId) as any;
    if (prior && prior.staff_id !== principal.id) throw new Error('Voice session belongs to another staff account');
    if (!prior) MutationService.execute('STAFF_VOICE_BIND', `staff-voice:${sessionId}`, { sessionId, staffId: principal.id }, principal.id, () => {
      db.prepare('INSERT INTO staff_voice_sessions (session_id,staff_id) VALUES (?,?)').run(sessionId, principal.id); return { bound: true };
    });
    return principal;
  }
  static updateAccount(input:{staffId:string;active:boolean;newPassword?:string|undefined;idempotency_key:string}){
    const actor=requireStaff(['ADMIN']);
    const passwordHash=input.newPassword?this.hashPassword(input.newPassword):undefined;
    return MutationService.execute('STAFF_ACCOUNT_UPDATE',input.idempotency_key,{staffId:input.staffId,active:input.active,passwordReset:Boolean(passwordHash)},actor.id,()=>{
      const target=db.prepare('SELECT n.role,a.active FROM nurses n JOIN staff_accounts a ON a.staff_id=n.id WHERE n.id=?').get(input.staffId)as any;
      if(!target)throw new Error('Staff account not found');
      if(target.role==='ADMIN'&&target.active&&!input.active&&(db.prepare("SELECT count(*) n FROM staff_accounts a JOIN nurses n ON n.id=a.staff_id WHERE n.role='ADMIN' AND a.active=1").get()as any).n<=1)throw new Error('The last active administrator cannot be deactivated');
      db.prepare('UPDATE staff_accounts SET active=?,password_hash=COALESCE(?,password_hash),password_version=password_version+? WHERE staff_id=?').run(input.active?1:0,passwordHash||null,passwordHash?1:0,input.staffId);
      if(passwordHash||!input.active)db.prepare('UPDATE staff_sessions SET revoked=1 WHERE staff_id=?').run(input.staffId);
      return{staffId:input.staffId,active:input.active,sessionsRevoked:Boolean(passwordHash)||!input.active};
    });
  }
}
