import type { EpicClinicalContext } from '../providers/epic-mapping.service.js';
import type { Task } from '../providers/types.js';

export type FieldAuthoritySystem = 'EPIC_FHIR_R4' | 'LOCAL_SHIFTWEAVE';

export interface FieldAuthorityDefinition {
  field: string;
  authoritativeSystem: FieldAuthoritySystem;
  description: string;
  reconciliationRule: string;
}

/**
 * Field Authority Matrix: Defines single source of truth boundaries between
 * EHR Master Records (Epic FHIR R4) and Bedside Nursing Execution (ShiftWeave SQLite Edge Cache).
 */
export const FIELD_AUTHORITY_MATRIX: Record<string, FieldAuthorityDefinition> = {
  'patient.demographics': {
    field: 'patient.demographics',
    authoritativeSystem: 'EPIC_FHIR_R4',
    description: 'Patient master registration, legal name, MRN, and date of birth.',
    reconciliationRule: 'EHR is authoritative; local cache reflects master records on read.',
  },
  'patient.primaryDiagnosis': {
    field: 'patient.primaryDiagnosis',
    authoritativeSystem: 'EPIC_FHIR_R4',
    description: 'Documented problem list items and encounter diagnoses.',
    reconciliationRule: 'EHR is authoritative; nursing assistant does not alter clinical diagnoses.',
  },
  'patient.allergies': {
    field: 'patient.allergies',
    authoritativeSystem: 'EPIC_FHIR_R4',
    description: 'Master allergy list and adverse drug reactions.',
    reconciliationRule: 'EHR is authoritative; missing records are explicitly surfaced as not documented.',
  },
  'task.medicationOrder': {
    field: 'task.medicationOrder',
    authoritativeSystem: 'EPIC_FHIR_R4',
    description: 'Physician medication order parameters, dosage text, dose quantity, unit, and route.',
    reconciliationRule: 'EHR is source of clinical truth for order parameters; bedside changes require physician orders.',
  },
  'task.nursingCustody': {
    field: 'task.nursingCustody',
    authoritativeSystem: 'LOCAL_SHIFTWEAVE',
    description: 'Shift nurse assignment, active shift binding, and transfer custody status (ACTIVE/CARRIED_FORWARD/TRANSFERRED).',
    reconciliationRule: 'ShiftWeave local SQLite is authoritative. External EHR does not track bedside shift transfers.',
  },
  'task.workflowStatus': {
    field: 'task.workflowStatus',
    authoritativeSystem: 'LOCAL_SHIFTWEAVE',
    description: 'Bedside execution progress (PENDING, IN_PROGRESS, COMPLETED, CANCELLED).',
    reconciliationRule: 'ShiftWeave is authoritative for bedside nursing execution; divergence from EHR order state triggers human conflict review.',
  },
  'task.acknowledgementAndEvents': {
    field: 'task.acknowledgementAndEvents',
    authoritativeSystem: 'LOCAL_SHIFTWEAVE',
    description: 'Nurse acknowledgement receipts, escalation notes, and conflict resolution events.',
    reconciliationRule: 'Committed locally with idempotency keys; never overwritten by remote EHR reads.',
  },
  'handoff.custodyTransfer': {
    field: 'handoff.custodyTransfer',
    authoritativeSystem: 'LOCAL_SHIFTWEAVE',
    description: 'Shift handoff synthesis, candidate task carry-forward, and explicit incoming nurse custody acceptance.',
    reconciliationRule: 'Requires two-party human review; draft creation does not transfer custody until accepted by incoming nurse.',
  },
};

export class FieldAuthorityService {
  /**
   * Namespaces an external identifier to prevent collision with local synthetic IDs.
   * e.g. namespaceId('epic', 'Patient', 'erXuFYUfucBZaryVksYEcMg3') -> 'epic:Patient:erXuFYUfucBZaryVksYEcMg3'
   */
  static namespaceId(system: 'epic' | 'local', resourceType: string, rawId: string): string {
    const cleanId = rawId.replace(/^epic:[^:]+:/, '').replace(/^Patient\//, '').replace(/^MedicationRequest\//, '');
    return `${system}:${resourceType}:${cleanId}`;
  }

  /**
   * Parses a namespaced identifier into its constituent system, resourceType, and rawId.
   */
  static parseNamespacedId(id: string): { system: string; resourceType: string; rawId: string } | null {
    if (!id.includes(':')) return null;
    const parts = id.split(':');
    if (parts.length >= 3) {
      return {
        system: parts[0]!,
        resourceType: parts[1]!,
        rawId: parts.slice(2).join(':'),
      };
    }
    return null;
  }

  /**
   * Returns true if an identifier is an external EHR namespaced identifier.
   */
  static isExternalId(id: string): boolean {
    return id.startsWith('epic:');
  }

  /**
   * Retrieves the field authority definition for a given field key.
   */
  static getAuthority(fieldKey: string): FieldAuthorityDefinition | undefined {
    return FIELD_AUTHORITY_MATRIX[fieldKey];
  }

  /**
   * Constructs a grounded SBAR narrative combining local bedside assignments and events
   * with imported Epic FHIR R4 clinical context, embedding namespaced identifiers and field authority.
   */
  static buildIntegratedHandoffNarrative(params: {
    outgoingNurseName: string;
    incomingNurseName: string;
    shiftUnit: string;
    tasks: Array<{
      id: string;
      title: string;
      status: string;
      priority: string;
      patientName: string;
      roomNumber: string;
      sourceSystem?: string;
    }>;
    carriedForwardIds: string[];
    unresolvedConflictsCount: number;
    epicContext?: EpicClinicalContext[];
  }): string {
    const {
      outgoingNurseName,
      incomingNurseName,
      shiftUnit,
      tasks,
      carriedForwardIds,
      unresolvedConflictsCount,
      epicContext = [],
    } = params;

    const sections: string[] = [];

    // 1. Situation
    sections.push(`## Situation\nUnit: ${shiftUnit}\nOutgoing Nurse: ${outgoingNurseName}\nIncoming Nurse: ${incomingNurseName}\nTotal assigned tasks: ${tasks.length} (${carriedForwardIds.length} candidate(s) for carry-forward).`);

    // 2. Clinical Context (Epic on FHIR R4) - if external context is available
    if (epicContext.length > 0) {
      const clinicalLines: string[] = [];
      clinicalLines.push('## Clinical Context (Epic on FHIR R4)');
      clinicalLines.push('*Field Authority: Master patient demographics, active problem list, documented allergies, and physician medication orders are authoritative from Epic on FHIR R4.*\n');

      for (const ctx of epicContext) {
        const p = ctx.patient;
        const patientNamespacedId = this.namespaceId('epic', 'Patient', p.id);
        clinicalLines.push(`### Patient: ${p.fullName} (ID: \`${patientNamespacedId}\`, MRN: ${p.mrn})`);
        clinicalLines.push(`- **Location**: ${p.roomNumber} (Bed ${p.bedNumber})`);
        clinicalLines.push(`- **Primary Diagnosis**: ${p.primaryDiagnosis}`);
        clinicalLines.push(`- **Allergies**: ${p.allergies || 'No documented allergies on file in Epic'}`);

        if (ctx.encounters.length > 0) {
          const enc = ctx.encounters[0]!;
          clinicalLines.push(`- **Active Encounter**: \`${this.namespaceId('epic', 'Encounter', enc.id)}\` (Status: ${enc.status}, Locations: ${enc.locations.join(', ') || 'General Ward'})`);
        }

        if (ctx.medicationOrders.length > 0) {
          clinicalLines.push('- **Active Medication Orders (Physician Authority)**:');
          for (const med of ctx.medicationOrders) {
            const medNamespacedId = this.namespaceId('epic', 'MedicationRequest', med.id);
            const doseText = med.dosageInstruction || (med.doseQuantity ? `${med.doseQuantity.value} ${med.doseQuantity.unit}` : 'Routine schedule');
            clinicalLines.push(`  * \`${medNamespacedId}\`: **${med.medicationName}** — ${doseText} (Status: ${med.status}, Intent: ${med.intent})`);
          }
        }
        clinicalLines.push('');
      }
      sections.push(clinicalLines.join('\n'));
    }

    // 3. Recorded Bedside Workflow State (Local ShiftWeave Authority)
    const workflowLines: string[] = [];
    workflowLines.push('## Recorded Bedside Workflow State (ShiftWeave Local Authority)');
    workflowLines.push('*Field Authority: Bedside nursing execution status, custody transfer state, and human acknowledgements are authoritative in ShiftWeave local edge cache.*\n');
    for (const t of tasks) {
      const isCarried = carriedForwardIds.includes(t.id);
      const flag = isCarried ? ' [CANDIDATE FOR CARRY-FORWARD]' : '';
      workflowLines.push(`- **${t.patientName}** (${t.roomNumber}): ${t.title} — **${t.status}** (Priority: ${t.priority})${flag}`);
    }
    sections.push(workflowLines.join('\n'));

    // 4. Assessment & Discrepancies
    sections.push(`## Assessment & Discrepancies\n- **Unresolved Documentation Discrepancies**: ${unresolvedConflictsCount}\n- *Clinical Boundary*: Strictly nursing workflow coordination. Absolutely no autonomous clinical diagnosis, treatment recommendations, or medication orders are generated.`);

    // 5. Recommendation & Workflow Follow-up
    sections.push(`## Workflow Follow-up & Custody\n- **Carry-Forward Candidates**: ${carriedForwardIds.length} unfinished task(s) require explicit spoken or interactive custody acceptance by ${incomingNurseName}.\n- **Custody Status**: Draft creation does NOT transfer task custody. Outgoing nurse remains accountable until incoming nurse explicitly accepts custody.\n- **Sign-Off Condition**: All discrepancies must be resolved and candidate tasks accepted prior to final sign-off.`);

    return sections.join('\n\n');
  }
}
