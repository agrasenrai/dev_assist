export interface VoiceTask {
  id: string; patientName: string; roomNumber: string; title: string; status: string; priority: string; source: string;
}
export interface VoiceDisplay {
  dataSource?: 'existing'|'hospital'|'epic';
  revision: number;
  nurse: { id: string; name: string; department: string } | null;
  shift: { id: string; unit: string; type: string; start: string; end: string } | null;
  speech: string; focus: 'tasks' | 'conflicts' | 'handoff';
  selectedTaskId: string | null; selectedHandoffId: string | null;
  pending: { prompt: string; ready: boolean; expiresAt: number } | null;
  messages: Array<{ role: 'nurse' | 'assistant'; text: string }>;
  tasks: VoiceTask[]; candidates: VoiceTask[];
  handoffs: Array<{ id: string; incomingName: string; outgoingName: string; status: string; summary: string }>;
  conflicts: Array<{ id: string; taskId: string; patientName?: string; patientRoom?: string;
    systemAName: string; systemAVal: string; systemBName: string; systemBVal: string }>;
  source: string; identityMode: string; updatedAt: string;
  epicRecords?: Array<{ patientId: string; epicPatientId: string; name: string; retrievedAt: string; status: string; error: string | null;
    snapshot: { sections: Record<string, { status: string; resources: unknown[]; warnings: string[]; error?: string }>;
      documents: Array<{ id: string; contentType: string; text?: string; status: string; error?: string }> } }>;
}
