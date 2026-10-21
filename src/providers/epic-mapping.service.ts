import { EpicOAuthService } from './epic-oauth.service.js';
import type { Patient, Task, TaskPriority, TaskStatus } from './types.js';
import { FieldAuthorityService } from '../services/field-authority.service.js';

export interface EpicClinicalContext {
  patient: Patient;
  rawPatientId: string;
  encounters: Array<{
    id: string;
    status: string;
    classCode?: string | undefined;
    periodStart?: string | undefined;
    periodEnd?: string | undefined;
    locations: string[];
  }>;
  conditions: Array<{
    id: string;
    code: string;
    display: string;
    category: string;
    clinicalStatus: string;
    recordedDate?: string | undefined;
  }>;
  allergies: Array<{
    id: string;
    substance: string;
    clinicalStatus: string;
    verificationStatus: string;
    recordedDate?: string | undefined;
  }>;
  medicationOrders: Array<{
    id: string;
    medicationName: string;
    status: string;
    intent: string;
    authoredOn?: string | undefined;
    dosageInstruction?: string | undefined;
    route?: string | undefined;
    doseQuantity?: {
      value: number;
      unit: string;
      code?: string | undefined;
    } | undefined;
  }>;
  documents: Array<{
    id: string;
    type: string;
    date?: string | undefined;
    status: string;
    contentType?: string | undefined;
    contentExcerpt?: string | undefined;
    binaryUrl?: string | undefined;
  }>;
  sourceSystem: string;
  retrievedAt: string;
}

export class EpicMappingService {
  /**
   * Resolves list of test patient IDs configured for the Epic sandbox environment.
   */
  static getTestPatientIds(): string[] {
    const envIds = process.env.EPIC_TEST_PATIENT_IDS;
    if (envIds) {
      return envIds.split(',').map(s => s.trim()).filter(Boolean);
    }
    // Standard synthetic test patients available in Epic R4 Backend Systems sandbox
    return [
      'erXuFYUfucBZaryVksYEcMg3', // Camila Maria Lopez
      'eq081-VQEgP8drUUqCWzHfw3', // Derrick Lin
      'eAB3mDIBBcyUKviyzrxsnAw3', // Desiree Powell
    ];
  }

  /**
   * Maps an Epic FHIR R4 Patient resource and associated Encounters/Allergies/Conditions
   * to ShiftWeave's canonical Patient model, preserving provenance and explicit missing states.
   */
  static mapToCanonicalPatient(
    epicPatient: any,
    encounters: any[] = [],
    conditions: any[] = [],
    allergies: any[] = []
  ): Patient {
    const id = epicPatient.id || 'unknown';

    // MRN extraction from identifier array
    const mrnObj = epicPatient.identifier?.find((i: any) =>
      i.type?.coding?.some((c: any) => c.code === 'MR') ||
      i.system?.toLowerCase().includes('mrn') ||
      i.use === 'usual'
    ) || epicPatient.identifier?.[0];
    const mrn = mrnObj?.value || `EPIC-${id.slice(0, 8)}`;

    // Full Name extraction
    const officialName = epicPatient.name?.find((n: any) => n.use === 'official') || epicPatient.name?.[0];
    const fullName = officialName?.text ||
      [officialName?.given?.join(' '), officialName?.family].filter(Boolean).join(' ') ||
      'Unknown Patient';

    // Room and Bed extraction from most recent active/planned Encounter location
    let roomNumber = 'Not Documented in FHIR';
    let bedNumber = 'Unassigned Bed';
    let admissionDate = epicPatient.meta?.lastUpdated || new Date().toISOString();

    const activeEncounter = encounters.find((e: any) => e.status === 'in-progress' || e.status === 'active') || encounters[0];
    if (activeEncounter) {
      if (activeEncounter.period?.start) {
        admissionDate = activeEncounter.period.start;
      }
      const locDisplay = activeEncounter.location?.[0]?.location?.display;
      if (locDisplay) {
        roomNumber = locDisplay;
      }
    }

    // Allergies summary
    let allergiesSummary: string | null = null;
    if (allergies.length > 0) {
      allergiesSummary = allergies
        .map((a: any) => {
          const substance = a.code?.text || a.code?.coding?.[0]?.display || 'Unknown allergen';
          const status = a.clinicalStatus?.coding?.[0]?.code || 'documented';
          return `${substance} (${status})`;
        })
        .join(', ');
    } else {
      allergiesSummary = 'No documented allergies on file in Epic';
    }

    // Primary Diagnosis from Condition (encounter-diagnosis or active problem list)
    let primaryDiagnosis = 'Admission Diagnosis Pending';
    if (conditions.length > 0) {
      const diag = conditions.find((c: any) =>
        c.category?.some((cat: any) =>
          cat.coding?.some((cod: any) => cod.code === 'encounter-diagnosis')
        )
      ) || conditions[0];
      primaryDiagnosis = diag?.code?.text || diag?.code?.coding?.[0]?.display || primaryDiagnosis;
    }

    return {
      id,
      namespacedId: FieldAuthorityService.namespaceId('epic', 'Patient', id),
      mrn,
      fullName,
      roomNumber,
      bedNumber,
      admissionDate,
      acuityLevel: conditions.length > 2 ? 3 : 2,
      allergies: allergiesSummary,
      primaryDiagnosis,
      createdAt: epicPatient.meta?.lastUpdated || new Date().toISOString(),
    };
  }

  /**
   * Maps an Epic MedicationRequest resource to ShiftWeave's canonical Task model.
   * Retains source IDs, dosage units, and timestamps.
   */
  static mapMedicationRequestToTask(medReq: any, patientName?: string, roomNumber?: string): Task {
    const id = medReq.id || 'unknown';
    const patientRef = medReq.subject?.reference || '';
    const patientId = patientRef.replace(/^Patient\//, '');

    const medName = medReq.medicationReference?.display ||
      medReq.medicationCodeableConcept?.text ||
      medReq.medicationCodeableConcept?.coding?.[0]?.display ||
      'Prescribed Medication Order';

    const dosageText = medReq.dosageInstruction?.[0]?.text ||
      medReq.dosageInstruction?.[0]?.patientInstruction ||
      null;

    // Status mapping
    let status: TaskStatus = 'PENDING';
    const epicStatus = medReq.status?.toLowerCase();
    if (epicStatus === 'completed') status = 'COMPLETED';
    else if (epicStatus === 'cancelled' || epicStatus === 'stopped') status = 'CANCELLED';
    else if (epicStatus === 'active' || epicStatus === 'draft') status = 'IN_PROGRESS';

    // Priority mapping
    let priority: TaskPriority = 'ROUTINE';
    const epicPriority = medReq.priority?.toLowerCase();
    if (epicPriority === 'stat') priority = 'STAT';
    else if (epicPriority === 'urgent' || epicPriority === 'asap') priority = 'URGENT';

    const scheduledTime = medReq.dosageInstruction?.[0]?.timing?.repeat?.boundsPeriod?.start ||
      medReq.authoredOn ||
      new Date().toISOString();

    const task: Task = {
      id,
      namespacedId: FieldAuthorityService.namespaceId('epic', 'MedicationRequest', id),
      patientId,
      ...(patientName ? { patientName } : {}),
      ...(roomNumber ? { roomNumber } : {}),
      title: medName,
      description: dosageText,
      category: 'MEDICATION_CHECK',
      status,
      priority,
      scheduledTime,
      sourceSystem: 'EPIC_FHIR_R4',
      createdAt: medReq.authoredOn || new Date().toISOString(),
    };
    return task;
  }

  /**
   * Resolves content of an Epic DocumentReference, following linked Binary resources if required.
   */
  static async resolveDocumentContent(docRef: any): Promise<string | null> {
    const attachment = docRef.content?.[0]?.attachment;
    if (!attachment) return null;

    // 1. Inline base64 data
    if (attachment.data) {
      try {
        return Buffer.from(attachment.data, 'base64').toString('utf8');
      } catch {
        return null;
      }
    }

    // 2. Linked Binary URL reference (e.g. /Binary/{id})
    if (attachment.url) {
      try {
        const raw = await EpicOAuthService.authorizedFetch<any>(attachment.url);
        if (typeof raw === 'string') return raw;
        if (raw.resourceType === 'Binary' && raw.data) {
          return Buffer.from(raw.data, 'base64').toString('utf8');
        }
        return JSON.stringify(raw);
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Aggregates full clinical context for a patient across all core Epic R4 resources.
   * Retains full source provenance, timestamps, units, and explicit missing data states.
   */
  static async getPatientClinicalContext(patientId: string): Promise<EpicClinicalContext> {
    const cleanId = patientId.trim();
    if (!/^[A-Za-z0-9.-]+$/.test(cleanId)) throw new Error('Invalid FHIR patient identifier');

    // Parallel fetch of core FHIR resources with resilient per-call isolation
    const [patientRes, encountersRes, conditionsRes, allergiesRes, medRequestsRes, docsRes] =
      await Promise.allSettled([
        EpicOAuthService.readPatient(cleanId),
        EpicOAuthService.authorizedFetch<any>(`Encounter?patient=${cleanId}`),
        EpicOAuthService.authorizedFetch<any>(`Condition?patient=${cleanId}&category=problem-list-item`),
        EpicOAuthService.authorizedFetch<any>(`AllergyIntolerance?patient=${cleanId}`),
        EpicOAuthService.authorizedFetch<any>(`MedicationRequest?patient=${cleanId}`),
        EpicOAuthService.authorizedFetch<any>(`DocumentReference?patient=${cleanId}`),
      ]);

    if (patientRes.status === 'rejected') {
      throw new Error(`Failed to read patient ${cleanId} from Epic: ${patientRes.reason?.message || patientRes.reason}`);
    }

    // Fail visibly: a denied search is not an empty clinical history.
    const sections = [encountersRes, conditionsRes, allergiesRes, medRequestsRes, docsRes];
    const names = ['Encounter', 'Condition', 'AllergyIntolerance', 'MedicationRequest', 'DocumentReference'];
    for (const [index, result] of sections.entries()) {
      if (result.status === 'rejected') throw new Error(`Epic ${names[index]} read failed: ${String(result.reason)}`);
      if (result.value.resourceType !== 'Bundle') throw new Error(`Epic ${names[index]} returned an invalid search response`);
      if (result.value.link?.some((link: any) => link.relation === 'next')) {
        throw new Error(`Epic ${names[index]} result is paginated; complete retrieval is required before presenting this context`);
      }
    }

    const epicPatient = patientRes.value;
    const encounters = encountersRes.status === 'fulfilled' ? (encountersRes.value.entry?.map((e: any) => e.resource) || []) : [];
    const conditions = conditionsRes.status === 'fulfilled' ? (conditionsRes.value.entry?.map((e: any) => e.resource) || []) : [];
    const allergies = allergiesRes.status === 'fulfilled' ? (allergiesRes.value.entry?.map((e: any) => e.resource) || []) : [];
    const medRequests = medRequestsRes.status === 'fulfilled' ? (medRequestsRes.value.entry?.map((e: any) => e.resource) || []) : [];
    const docs = docsRes.status === 'fulfilled' ? (docsRes.value.entry?.map((e: any) => e.resource) || []) : [];

    const canonicalPatient = this.mapToCanonicalPatient(epicPatient, encounters, conditions, allergies);

    return {
      patient: canonicalPatient,
      rawPatientId: cleanId,
      encounters: encounters.map((e: any) => ({
        id: e.id || 'unknown',
        status: e.status || 'unknown',
        classCode: e.class?.code,
        periodStart: e.period?.start,
        periodEnd: e.period?.end,
        locations: (e.location || []).map((l: any) => l.location?.display).filter(Boolean),
      })),
      conditions: conditions.map((c: any) => ({
        id: c.id || 'unknown',
        code: c.code?.coding?.[0]?.code || 'unknown',
        display: c.code?.text || c.code?.coding?.[0]?.display || 'Unspecified Condition',
        category: 'problem-list-item',
        clinicalStatus: c.clinicalStatus?.coding?.[0]?.code || 'active',
        recordedDate: c.recordedDate,
      })),
      allergies: allergies.map((a: any) => ({
        id: a.id || 'unknown',
        substance: a.code?.text || a.code?.coding?.[0]?.display || 'Unspecified Allergen',
        clinicalStatus: a.clinicalStatus?.coding?.[0]?.code || 'active',
        verificationStatus: a.verificationStatus?.coding?.[0]?.code || 'unconfirmed',
        recordedDate: a.recordedDate,
      })),
      medicationOrders: medRequests.map((m: any) => {
        const dose = m.dosageInstruction?.[0]?.doseAndRate?.[0]?.doseQuantity;
        return {
          id: m.id || 'unknown',
          medicationName: m.medicationReference?.display || m.medicationCodeableConcept?.text || m.medicationCodeableConcept?.coding?.[0]?.display || 'Medication Order',
          status: m.status || 'unknown',
          intent: m.intent || 'order',
          authoredOn: m.authoredOn,
          dosageInstruction: m.dosageInstruction?.[0]?.text,
          route: m.dosageInstruction?.[0]?.route?.text || m.dosageInstruction?.[0]?.route?.coding?.[0]?.display,
          doseQuantity: dose ? {
            value: dose.value,
            unit: dose.unit || 'unit',
            code: dose.code,
          } : undefined,
        };
      }),
      documents: docs.map((d: any) => ({
        id: d.id || 'unknown',
        type: d.type?.text || d.type?.coding?.[0]?.display || 'Clinical Document',
        date: d.date,
        status: d.status || 'current',
        contentType: d.content?.[0]?.attachment?.contentType,
        binaryUrl: d.content?.[0]?.attachment?.url,
      })),
      sourceSystem: 'EPIC_FHIR_R4',
      retrievedAt: new Date().toISOString(),
    };
  }
}
