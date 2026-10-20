import type { IEHRProvider, Patient, Task, TaskEvent, TaskStatus } from './types.js';
import { AuditService } from '../services/audit.service.js';
import { EpicOAuthService } from './epic-oauth.service.js';
import { EpicMappingService, type EpicClinicalContext } from './epic-mapping.service.js';

/**
 * Live FHIR R4 Provider for Epic on FHIR Sandbox (Step 3 Verified).
 * Replaces deliberate configuration placeholders with normalized Patient, Encounter,
 * Condition, Allergy, MedicationRequest, and DocumentReference mappings.
 * All mutations remain locally guarded; reads preserve source provenance, timestamps, and units.
 */
export class LiveFHIRProvider implements IEHRProvider {
  readonly providerId = 'live-fhir-api';
  readonly providerName = 'Epic on FHIR R4 Live Sandbox Adapter';
  readonly isEdgeCache = false;

  constructor(private baseUrl = process.env.EPIC_FHIR_BASE_URL || '') {}

  /**
   * Health & capability check against live Epic CapabilityStatement (metadata).
   */
  async ping(): Promise<boolean> {
    const startTime = Date.now();
    try {
      const metadata = await EpicOAuthService.authorizedFetch<any>('metadata');
      const isOk = metadata?.resourceType === 'CapabilityStatement' && metadata?.status === 'active';
      AuditService.log({
        actorType: 'SYSTEM',
        actorId: 'epic_adapter',
        action: 'FHIR:PING',
        targetResource: 'metadata',
        outcome: isOk ? 'SUCCESS' : 'FAILURE',
        latencyMs: Date.now() - startTime,
        details: { fhirVersion: metadata?.fhirVersion, status: metadata?.status },
      });
      return isOk;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      AuditService.log({
        actorType: 'SYSTEM',
        actorId: 'epic_adapter',
        action: 'FHIR:PING_ERROR',
        targetResource: 'metadata',
        outcome: 'FAILURE',
        latencyMs: Date.now() - startTime,
        details: { message },
      });
      throw new Error(`Epic FHIR sandbox unavailable: ${message}`);
    }
  }

  /**
   * Retrieves active sandbox patients and their encounter/allergy/condition clinical context.
   */
  async getPatientsByUnit(_unitId: string): Promise<Patient[]> {
    const startTime = Date.now();
    const patientIds = EpicMappingService.getTestPatientIds();
    const patients: Patient[] = [];

    for (const pid of patientIds) {
      try {
        const ctx = await EpicMappingService.getPatientClinicalContext(pid);
        patients.push(ctx.patient);
      } catch (err) {
        AuditService.log({
          actorType: 'SYSTEM',
          actorId: 'epic_adapter',
          action: 'FHIR:PATIENT_READ_ERROR',
          targetResource: `Patient/${pid}`,
          outcome: 'FAILURE',
          details: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    }

    AuditService.log({
      actorType: 'SYSTEM',
      actorId: 'epic_adapter',
      action: 'FHIR:GET_PATIENTS',
      targetResource: `patients/unit_${_unitId}`,
      outcome: 'SUCCESS',
      latencyMs: Date.now() - startTime,
      details: { patientsCount: patients.length },
    });

    return patients;
  }

  /**
   * Retrieves live MedicationRequests for sandbox patients as nursing tasks.
   */
  async getTasksForNurse(_nurseId: string, _shiftId: string): Promise<Task[]> {
    const startTime = Date.now();
    const patientIds = EpicMappingService.getTestPatientIds();
    const tasks: Task[] = [];

    for (const pid of patientIds) {
      try {
        const bundle = await EpicOAuthService.authorizedFetch<any>(`MedicationRequest?patient=${pid}`);
        const entries = bundle.entry?.map((e: any) => e.resource) || [];
        for (const med of entries) {
          tasks.push(EpicMappingService.mapMedicationRequestToTask(med));
        }
      } catch (err) {
        // Individual resource query failure is non-fatal for whole bundle
        AuditService.log({
          actorType: 'SYSTEM',
          actorId: 'epic_adapter',
          action: 'FHIR:MEDICATION_QUERY_ERROR',
          targetResource: `MedicationRequest?patient=${pid}`,
          outcome: 'FAILURE',
          details: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    }

    AuditService.log({
      actorType: 'SYSTEM',
      actorId: 'epic_adapter',
      action: 'FHIR:GET_TASKS',
      targetResource: `tasks/nurse_${_nurseId}`,
      outcome: 'SUCCESS',
      latencyMs: Date.now() - startTime,
      details: { tasksCount: tasks.length },
    });

    return tasks;
  }

  /**
   * Retrieves single task details (MedicationRequest) and resolves patient demographics.
   */
  async getTaskDetails(taskId: string): Promise<{ task: Task; patient?: Patient; recentEvents: TaskEvent[] } | null> {
    const cleanId = taskId.replace(/^task_/, '');
    try {
      const medReq = await EpicOAuthService.authorizedFetch<any>(`MedicationRequest/${encodeURIComponent(cleanId)}`);
      if (!medReq || medReq.resourceType !== 'MedicationRequest') return null;

      let patient: Patient | undefined;
      const patientRef = medReq.subject?.reference;
      if (patientRef) {
        const pid = patientRef.replace(/^Patient\//, '');
        try {
          const ctx = await EpicMappingService.getPatientClinicalContext(pid);
          patient = ctx.patient;
        } catch {
          // Patient fetch failure leaves patient undefined
        }
      }

      const task = EpicMappingService.mapMedicationRequestToTask(medReq, patient?.fullName, patient?.roomNumber);
      return {
        task,
        ...(patient ? { patient } : {}),
        recentEvents: [],
      };
    } catch {
      return null;
    }
  }

  /**
   * Retrieves recent clinical events.
   */
  async getRecentEvents(_since: Date): Promise<TaskEvent[]> {
    return [];
  }

  /**
   * Updates task status in EHR.
   * As specified in incomingapikey.md Section 3, generic bedside task update is not
   * supported in Epic sandbox without specific hospital extension workflows;
   * actions remain durably committed in ShiftWeave local edge cache.
   */
  async updateTaskStatus(
    taskId: string,
    _newStatus: TaskStatus,
    _actor: string,
    _key: string,
    _note?: string
  ): Promise<{ success: boolean; committedVersion: string }> {
    AuditService.log({
      actorType: 'SYSTEM',
      actorId: 'epic_adapter',
      action: 'FHIR:TASK_UPDATE_REJECTED',
      targetResource: `Task/${taskId}`,
      outcome: 'FAILURE',
      details: { reason: 'Epic sandbox bedside task write-back requires verified hospital workflow support; writes remain local' },
    });
    throw new Error(
      `Epic task write-back for ${taskId} is not enabled in external sandbox. Task status was coordinated in local edge cache.`
    );
  }

  /**
   * Exposes full unified clinical context aggregator for a patient.
   */
  async getPatientClinicalContext(patientId: string): Promise<EpicClinicalContext> {
    return EpicMappingService.getPatientClinicalContext(patientId);
  }
}
