import { EpicOAuthService } from './epic-oauth.service.js';

export type SourceSection = { status: 'AVAILABLE' | 'EMPTY' | 'ERROR'; resources: any[]; warnings: string[]; error?: string };
export type EpicWorkflowSnapshot = {
  source: 'EPIC_FHIR_R4'; endpoint: string; patientId: string; retrievedAt: string;
  patient: any; sections: Record<string, SourceSection>;
  documents: Array<{ id: string; contentType: string; text?: string; status: 'AVAILABLE' | 'UNSUPPORTED' | 'ERROR'; error?: string }>;
};

/** Follows only same-server FHIR paging URLs. OperationOutcome is never a clinical record. */
export async function epicSearch(resourcePath: string, resourceType: string): Promise<SourceSection> {
  const resources: any[] = [], warnings: string[] = [];
  const seen = new Set<string>();
  let next: string | undefined = resourcePath;
  while (next) {
    const url = EpicOAuthService.resolveResourceUrl(next);
    if (seen.has(url) || seen.size >= 20) throw new Error('Epic paging loop or 20-page limit reached; results are incomplete');
    seen.add(url);
    const bundle: any = await EpicOAuthService.authorizedFetch(url);
    if (bundle.resourceType !== 'Bundle') throw new Error(`Expected ${resourceType} search Bundle`);
    for (const entry of bundle.entry || []) {
      const resource = entry.resource;
      if (resource?.resourceType === 'OperationOutcome') {
        for (const issue of resource.issue || []) {
          if (['fatal', 'error'].includes(issue.severity)) throw new Error(issue.details?.text || issue.code || 'FHIR search error');
          warnings.push(issue.details?.text || issue.code || 'FHIR search warning');
        }
      } else if (resource?.resourceType === resourceType) resources.push(resource);
    }
    const nextLink = bundle.link?.find((link: any) => link.relation === 'next');
    if (nextLink && !nextLink.url) throw new Error('Invalid paginated response: next URL is missing');
    next = nextLink?.url;
  }
  return { status: resources.length ? 'AVAILABLE' : 'EMPTY', resources, warnings };
}

export async function fetchEpicWorkflowSnapshot(patientId: string): Promise<EpicWorkflowSnapshot> {
  if (!/^[A-Za-z0-9.-]+$/.test(patientId)) throw new Error('Invalid Epic patient ID');
  const patient: any = await EpicOAuthService.readPatient(patientId);
  if (patient.resourceType !== 'Patient' || patient.id !== patientId) throw new Error('Epic patient identity does not match the requested ID');
  const types = ['Encounter', 'Condition', 'AllergyIntolerance', 'MedicationRequest', 'MedicationAdministration', 'DocumentReference'];
  const sections: Record<string, SourceSection> = {};
  await Promise.all(types.map(async type => {
    try {
      const section = await epicSearch(`${type}?patient=${encodeURIComponent(patientId)}`, type);
      for (const resource of section.resources) {
        const subject = resource.subject?.reference || resource.patient?.reference;
        if (subject && !subject.endsWith(`Patient/${patientId}`)) throw new Error(`${type} returned a record for a different patient`);
      }
      sections[type] = section;
    } catch (error) { sections[type] = { status: 'ERROR', resources: [], warnings: [], error: error instanceof Error ? error.message : String(error) }; }
  }));
  const documents: EpicWorkflowSnapshot['documents'] = [];
  for (const doc of sections.DocumentReference!.resources) {
    for (const content of doc.content || []) {
      const attachment = content.attachment || {};
      const record: EpicWorkflowSnapshot['documents'][number] = { id: doc.id, contentType: attachment.contentType || 'unknown', status: 'UNSUPPORTED' };
      try {
        if (record.contentType.startsWith('text/plain')) {
          let data = attachment.data;
          if (!data && attachment.url) {
            const response = await EpicOAuthService.authorizedFetchResponse(attachment.url);
            if (!response.ok) throw new Error(`Binary read failed: HTTP ${response.status}`);
            if (Number(response.headers.get('content-length') || 0) > 2_000_000) throw new Error('Document exceeds safe display size');
            if (response.headers.get('content-type')?.includes('json')) {
              const binary: any = await response.json();
              if (binary.resourceType !== 'Binary' || !binary.contentType?.startsWith('text/plain')) throw new Error('Unexpected Binary format');
              data = binary.data;
            } else data = Buffer.from(await response.arrayBuffer()).toString('base64');
          }
          if (!data || data.length > 2_700_000) throw new Error('Document data missing or exceeds safe display size');
          const text = Buffer.from(data, 'base64').toString('utf8');
          if (text.length > 20_000) throw new Error('Document exceeds 20,000-character display limit');
          record.text = text; record.status = 'AVAILABLE';
        }
      } catch (error) { record.status = 'ERROR'; record.error = error instanceof Error ? error.message : String(error); }
      documents.push(record);
    }
  }
  return { source: 'EPIC_FHIR_R4', endpoint: EpicOAuthService.getConfig().fhirBaseUrl,
    patientId, retrievedAt: new Date().toISOString(), patient, sections, documents };
}
