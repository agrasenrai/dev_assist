import { db } from '../db/connection.js';

/** Resolve stored context; never substitute a demonstration shift or another nurse. */
export function resolveNurseShift(nurseId: string, shiftId?: string): string {
  const nurse = db.prepare('SELECT department FROM nurses WHERE id = ?').get(nurseId) as { department: string } | undefined;
  if (!nurse) throw new Error('Unknown nurse');
  if (shiftId) {
    if (!db.prepare('SELECT id FROM shifts WHERE id = ? AND unit_id = ?').get(shiftId, nurse.department)) {
      throw new Error('Shift is outside the nurse unit or does not exist');
    }
    return shiftId;
  }
  const shifts = db.prepare("SELECT id FROM shifts WHERE unit_id = ? AND status IN ('ACTIVE', 'HANDOFF_IN_PROGRESS')").all(nurse.department) as { id: string }[];
  if (shifts.length !== 1) throw new Error(shifts.length ? 'Multiple active shifts; specify shift_id' : 'No active shift for this nurse');
  return shifts[0]!.id;
}
