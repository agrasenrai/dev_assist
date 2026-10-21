import { AsyncLocalStorage } from 'node:async_hooks';

export type StaffRole = 'ADMIN' | 'CHARGE_NURSE' | 'STAFF_NURSE' | 'PHYSICIAN';
export type StaffPrincipal = { id: string; name: string; role: StaffRole; unit: string; username: string };
export const staffContext = new AsyncLocalStorage<{ principal: StaffPrincipal; sessionToken: string }>();
export const staffAuthRequired = () => process.env.STAFF_AUTH_REQUIRED === 'true';
export function currentStaff(): StaffPrincipal | undefined { return staffContext.getStore()?.principal; }
export function requireStaff(roles?: StaffRole[]): StaffPrincipal {
  const principal = currentStaff();
  if (!principal) throw new Error('Staff authentication is required');
  if (roles && !roles.includes(principal.role)) throw new Error('Your staff role does not permit this action');
  return principal;
}
