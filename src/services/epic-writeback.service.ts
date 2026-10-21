import crypto from 'node:crypto';
import { db } from '../db/connection.js';
import { AuditService } from './audit.service.js';
import { EpicNoteService } from './epic-note.service.js';

export interface DocumentReferenceAttachment {
  contentType: string;
  data: string;
  title?: string;
}

export interface DocumentReferencePayload {
  resourceType: 'DocumentReference';
  status: 'current';
  docStatus: 'final' | 'preliminary';
  category: Array<{
    coding: Array<{
      system: string;
      code: string;
      display?: string;
    }>;
  }>;
  type: {
    coding: Array<{
      system: string;
      code: string;
      display: string;
    }>;
  };
  subject: {
    reference: string;
    display?: string;
  };
  date: string;
  author: Array<{
    display: string;
  }>;
  description: string;
  content: Array<{
    attachment: DocumentReferenceAttachment;
  }>;
}

export interface PublishNoteInput {
  handoffId: string;
  nurseId: string;
  idempotencyKey: string;
  humanConfirmed: boolean;
  reviewHash?: string | undefined;
  patientId?: string | undefined;
  executionMode?: 'live' | 'mock' | 'simulate_uncertain' | undefined;
}

export interface PublishNoteResult {
  handoffId: string;
  externalSync: 'SYNCED' | 'FAILED' | 'UNCERTAIN';
  externalResourceId?: string | undefined;
  reconciled?: boolean | undefined;
  error?: string | undefined;
  warning?: string | undefined;
  docUrl?: string | undefined;
}

/**
 * In-memory remote EHR store used for mock verification and remote reconciliation simulation
 */
const mockRemoteEhrStore = new Map<string, { id: string; patientId: string; handoffId: string; contentHash: string; createdAt: string }>();

export class EpicWriteBackService {
  /**
   * Resets mock remote EHR store (for testing)
   */
  static resetMockRemoteStore(): void {
    mockRemoteEhrStore.clear();
  }

  /**
   * Builds a canonical US Core FHIR R4 DocumentReference payload
   */
  static buildDocumentReferencePayload(args: {
    patientId: string;
    patientName?: string;
    nurseName: string;
    summaryMarkdown: string;
    noteTitle?: string;
  }): DocumentReferencePayload {
    const base64Data = Buffer.from(args.summaryMarkdown, 'utf8').toString('base64');
    return {
      resourceType: 'DocumentReference',
      status: 'current',
      docStatus: 'final',
      category: [
        {
          coding: [
            {
              system: 'http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category',
              code: 'clinical-note',
              display: 'Clinical Note',
            },
          ],
        },
      ],
      type: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '11506-3',
            display: 'Progress note',
          },
        ],
      },
      subject: {
        reference: `Patient/${args.patientId.replace(/^epic:Patient:/, '')}`,
        ...(args.patientName ? { display: args.patientName } : {}),
      },
      date: new Date().toISOString(),
      author: [
        {
          display: args.nurseName,
        },
      ],
      description: args.noteTitle || 'ShiftWeave Nursing Shift Handoff SBAR Summary',
      content: [
        {
          attachment: {
            contentType: 'text/plain; charset=utf-8',
            data: base64Data,
            title: 'Handoff SBAR Narrative',
          },
        },
      ],
    };
  }

  /**
   * Reconciles whether a note for this handoff was already committed to the remote EHR,
   * avoiding duplicate note creation during network retry or uncertain recovery.
   */
  static async reconcileRemoteNote(patientId: string, handoffId: string): Promise<{ id: string; remoteUrl: string } | null> {
    const normalizedPatientId = patientId.replace(/^epic:Patient:/, '');
    
    // Check mock remote store first
    for (const record of mockRemoteEhrStore.values()) {
      if (record.patientId === normalizedPatientId && record.handoffId === handoffId) {
        return { id: record.id, remoteUrl: `mock://DocumentReference/${record.id}` };
      }
    }

    return null;
  }

  /**
   * Evaluates and executes reviewed Clinical Note creation with explicit human approval,
   * durable external sync state machine, and remote reconciliation before retries.
   */
  static async publishReviewedNote(input: PublishNoteInput): Promise<PublishNoteResult> {
    if (input.executionMode !== 'mock' && input.executionMode !== 'simulate_uncertain') return EpicNoteService.publish(input);
    // 1. Explicit Human Review Gate
    if (!input.humanConfirmed) {
      throw new Error('Explicit human review and confirmation is required before publishing external clinical notes');
    }

    // 2. Fetch Handoff & Invariant Checks
    const handoff = db.prepare('SELECT * FROM handoffs WHERE id = ?').get(input.handoffId) as {
      id: string;
      shift_id: string;
      outgoing_nurse_id: string;
      incoming_nurse_id: string;
      status: string;
      summary_markdown: string;
      data_snapshot: string;
      unresolved_conflicts_count: number;
      external_sync_status: string;
      external_resource_id?: string | null;
    } | undefined;

    if (!handoff) {
      throw new Error(`Handoff record ${input.handoffId} not found`);
    }

    // 3. Clinical Safety Boundary: Unresolved discrepancies block external publishing
    if (handoff.unresolved_conflicts_count > 0) {
      throw new Error('Cannot publish clinical note with unresolved documentation discrepancies; human discrepancy review required');
    }

    // 4. Custody Boundary: Incoming nurse must have accepted custody
    const activeCustody = db.prepare(`SELECT id FROM task_assignments WHERE nurse_id = ? AND shift_id = ?
      AND transfer_status = 'ACTIVE'`).get(input.nurseId, handoff.shift_id);
    if (!activeCustody) {
      throw new Error('Custody must be accepted by incoming nurse before publishing clinical notes');
    }

    // 5. Already Synced Check (Idempotency)
    if (handoff.external_sync_status === 'SYNCED' && handoff.external_resource_id) {
      return {
        handoffId: input.handoffId,
        externalSync: 'SYNCED',
        externalResourceId: handoff.external_resource_id,
        reconciled: true,
      };
    }

    const nurse = db.prepare('SELECT full_name FROM nurses WHERE id = ?').get(input.nurseId) as { full_name: string } | undefined;
    const nurseName = nurse?.full_name || input.nurseId;

    // Resolve patient ID (from input or from handoff snapshot)
    let patientId = input.patientId || 'erXuFYUfucBZaryVksYEcMg3'; // Camila Lopez default in sandbox
    let patientName = 'Camila Maria Lopez';
    try {
      const snap = JSON.parse(handoff.data_snapshot) as { tasks?: Array<{ patientName?: string; patient_id?: string }> };
      if (snap.tasks?.[0]?.patient_id) {
        patientId = snap.tasks[0].patient_id;
      }
      if (snap.tasks?.[0]?.patientName) {
        patientName = snap.tasks[0].patientName;
      }
    } catch {}

    const payload = this.buildDocumentReferencePayload({
      patientId,
      patientName,
      nurseName,
      summaryMarkdown: handoff.summary_markdown,
      noteTitle: `ShiftWeave Nursing Shift Handoff SBAR Summary (${input.handoffId})`,
    });

    const payloadJson = JSON.stringify(payload);
    const contentHash = crypto.createHash('sha256').update(handoff.summary_markdown).digest('hex');

    // 6. Durable Pre-flight: Set status to PENDING
    db.prepare(`UPDATE handoffs SET external_sync_status = 'PENDING', external_sync_payload = ? WHERE id = ?`)
      .run(payloadJson, input.handoffId);

    // 7. Remote Reconciliation Before Retry (Check if already committed remotely)
    const existingRemote = await this.reconcileRemoteNote(patientId, input.handoffId);
    if (existingRemote) {
      db.prepare(`UPDATE handoffs SET external_sync_status = 'SYNCED', external_resource_id = ?,
        external_synced_at = CURRENT_TIMESTAMP, external_sync_error = NULL WHERE id = ?`)
        .run(existingRemote.id, input.handoffId);

      AuditService.log({
        actorType: 'NURSE',
        actorId: input.nurseId,
        action: 'EXTERNAL_SYNC:RECONCILED',
        targetResource: `DocumentReference/${existingRemote.id}`,
        outcome: 'RECOVERED',
        details: { handoffId: input.handoffId, patientId, externalResourceId: existingRemote.id },
      });

      return {
        handoffId: input.handoffId,
        externalSync: 'SYNCED',
        externalResourceId: existingRemote.id,
        reconciled: true,
        docUrl: existingRemote.remoteUrl,
      };
    }

    // 8. Simulated Network Timeout / Ambiguity Test Mode
    if (input.executionMode === 'simulate_uncertain') {
      db.prepare(`UPDATE handoffs SET external_sync_status = 'UNCERTAIN',
        external_sync_error = 'Network timeout waiting for remote EHR acknowledgment' WHERE id = ?`)
        .run(input.handoffId);

      // Pre-commit mock remote record to test subsequent remote reconciliation
      const simulatedRemoteId = `doc_reconciled_${crypto.randomBytes(4).toString('hex')}`;
      mockRemoteEhrStore.set(simulatedRemoteId, {
        id: simulatedRemoteId,
        patientId: patientId.replace(/^epic:Patient:/, ''),
        handoffId: input.handoffId,
        contentHash,
        createdAt: new Date().toISOString(),
      });

      AuditService.log({
        actorType: 'NURSE',
        actorId: input.nurseId,
        action: 'EXTERNAL_SYNC:TIMEOUT',
        targetResource: 'DocumentReference',
        outcome: 'FAILURE',
        details: { handoffId: input.handoffId, reason: 'Simulated network timeout; remote commit status uncertain' },
      });

      return {
        handoffId: input.handoffId,
        externalSync: 'UNCERTAIN',
        warning: 'Remote EHR write outcome is ambiguous; remote reconciliation required before retry',
        error: 'Network timeout waiting for remote EHR acknowledgment',
      };
    }

    // 9. Mock Mode (Free local execution)
    if (input.executionMode === 'mock' || (!process.env.EPIC_CLIENT_ID && input.executionMode !== 'live')) {
      const mockDocId = `doc_mock_${crypto.randomBytes(6).toString('hex')}`;
      mockRemoteEhrStore.set(mockDocId, {
        id: mockDocId,
        patientId: patientId.replace(/^epic:Patient:/, ''),
        handoffId: input.handoffId,
        contentHash,
        createdAt: new Date().toISOString(),
      });

      db.prepare(`UPDATE handoffs SET external_sync_status = 'SYNCED', external_resource_id = ?,
        external_synced_at = CURRENT_TIMESTAMP, external_sync_error = NULL WHERE id = ?`)
        .run(mockDocId, input.handoffId);

      AuditService.log({
        actorType: 'NURSE',
        actorId: input.nurseId,
        action: 'EXTERNAL_SYNC:COMMITTED',
        targetResource: `DocumentReference/${mockDocId}`,
        outcome: 'SUCCESS',
        details: { handoffId: input.handoffId, patientId, externalResourceId: mockDocId, provider: 'MOCK_FHIR' },
      });

      return {
        handoffId: input.handoffId,
        externalSync: 'SYNCED',
        externalResourceId: mockDocId,
        docUrl: `mock://DocumentReference/${mockDocId}`,
      };
    }

    throw new Error('Unsupported simulation mode');
  }
}
