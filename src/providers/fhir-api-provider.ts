import type { IEHRProvider, Patient, Task, TaskEvent, TaskStatus } from './types.js';
import { AuditService } from '../services/audit.service.js';

/** External transport boundary. Operational mapping must be verified for the target hospital. */
export class LiveFHIRProvider implements IEHRProvider {
  readonly providerId = 'live-fhir-api';
  readonly providerName = 'External FHIR adapter (operational mapping not configured)';
  readonly isEdgeCache = false;
  constructor(private baseUrl = process.env.FHIR_BASE_URL || '') {}
  private async request(resource: string): Promise<unknown> {
    try {
      if (!this.baseUrl) throw new Error('FHIR_BASE_URL is not configured');
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/${resource}`, {
        signal: AbortSignal.timeout(5000), headers: { Accept: 'application/fhir+json',
          ...(process.env.FHIR_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.FHIR_ACCESS_TOKEN}` } : {}) } });
      if (!response.ok) throw new Error(`FHIR HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      AuditService.log({ actorType: 'SYSTEM', actorId: 'fhir_adapter', action: 'FHIR:ERROR',
        targetResource: resource, outcome: 'FAILURE', details: { message } });
      throw new Error(`External FHIR unavailable: ${message}`);
    }
  }
  async ping(): Promise<boolean> { await this.request('metadata'); return true; }
  private unavailable(): never {
    throw new Error('External FHIR operational mapping is not configured. Select local demo explicitly; no external data or writes were used.');
  }
  async getPatientsByUnit(_unitId: string): Promise<Patient[]> { return this.unavailable(); }
  async getTasksForNurse(_nurseId: string, _shiftId: string): Promise<Task[]> { return this.unavailable(); }
  async getTaskDetails(_taskId: string): Promise<{ task: Task; patient?: Patient; recentEvents: TaskEvent[] } | null> { return this.unavailable(); }
  async getRecentEvents(_since: Date): Promise<TaskEvent[]> { return this.unavailable(); }
  async updateTaskStatus(_id: string, _status: TaskStatus, _actor: string, _key: string, _note?: string): Promise<{ success: boolean; committedVersion: string }> {
    return this.unavailable();
  }
}
