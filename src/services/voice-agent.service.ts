import { VoiceService, voiceIntentSchema, type VoiceInput, type VoiceIntent } from './voice.service.js';
import { ShiftWeaveOrchestrator } from '../agent/orchestrator.js';
import { db } from '../db/connection.js';
import { canonicalJson } from './canonical-json.js';
import { AuditService } from './audit.service.js';
import { MCPClientBridge, type MCPToolDefinition } from '../agent/mcp-client-bridge.js';
import { StaffAuthService } from './staff-auth.service.js';
import { currentStaff, staffAuthRequired } from './staff-context.js';
import { getLLMProvider, type AgentMessage } from '../agent/llm-provider.js';
import { CheckpointService } from './checkpoint.service.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const busy = new Set<string>();
const semanticIntentSchema=voiceIntentSchema.extend({
  after_identification:voiceIntentSchema.refine(value=>value.intent!=='IDENTIFY','Only one identification is permitted').optional(),
  render_backend:z.boolean().optional(),
  introduction:z.enum(['',"Here's what I found.","Here's the breakdown."]).optional()
}).refine(value=>!value.after_identification||(value.intent==='IDENTIFY'&&value.continue_request===true),'A follow-up plan requires combined identification');
function baseIntent(value:unknown) {
  const {after_identification,render_backend,introduction,...intent}=semanticIntentSchema.parse(value);
  return {intent,after_identification,render_backend,introduction};
}

const intentTool: MCPToolDefinition = {name:'interpret_voice_request',description:
  'Understand and execute the current request with render_backend=true. For an introduction plus question, send IDENTIFY, continue_request=true and after_identification with the remaining intent in ONE call. Backend validates identity before the planned request, retrieves current records and speaks the result. Do not invent IDs. Actions are staged for human confirmation.',
  inputSchema: z.toJSONSchema(semanticIntentSchema) as MCPToolDefinition['inputSchema']};
const replySchema = z.object({kind:z.enum(['CONVERSATION','CLARIFICATION','RECORDS','UNSUPPORTED','REFUSAL']),speech:z.string().trim().min(1).max(5000),evidence:z.array(z.string().regex(/^fact:\d+$/)).max(100)}).strict();
const replyTool: MCPToolDefinition = {name:'reply_to_nurse',description:
  'Deliver your natural spoken answer. For RECORDS, reference supplied fact IDs in evidence and put {{fact:N}} placeholders into speech; the server inserts exact source text. General conversation and clarification use empty evidence and no placeholders.',
  inputSchema:z.toJSONSchema(replySchema) as MCPToolDefinition['inputSchema']};
type Display = ReturnType<typeof VoiceService.read>;
type SemanticState = {requestHash:string;messages:AgentMessage[];pendingTool?:{name:string;args:Record<string,unknown>;id:string;command?:string};
  action?:{display:Display;intent:string};plannedIntent?:VoiceIntent;plannedIntroduction?:string;identificationRevision?:number;prefetchedRevision?:number;recordsRead?:boolean;hospitalRefreshed?:boolean;version:string;read:boolean;speech?:string;status?:'SUCCESS'|'FAILED';failureCode?:string;replyRepairs?:number;intentRepairs?:number};
const replyErrors=new Set(['Model cannot claim a workflow action','Clinical advice is outside the voice workflow','Record answer lacks matching source evidence',
  'Record claims must be contained in source evidence','Record answer introduced an unsupported number','Record answer introduced an unsupported status',
  'Record answer omitted source uncertainty','Record claims require a current backend result','Read operation required before a record answer']);
const clinicalBoundarySpeech='I cannot recommend treatment. I cannot modify clinical orders. Please ask your clinical team.';
function sourceFacts(source: string) {return source.split(/(?<=[!?])\s+|(?<!\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr)\.)(?<=\.)\s+/).filter(Boolean).map((text,index)=>({id:`fact:${index}`,text}));}
export function composeRecordReply(speech:string,ids:string[],source:string) {
  const facts=sourceFacts(source), selected=ids.map(id=>facts.find(f=>f.id===id));
  if(selected.some(f=>!f)||!selected.length)throw new Error('Record answer lacks matching source evidence');
  if(ids.some(id=>!speech.includes(`{{${id}}}`)))throw new Error('Record answer lacks matching source evidence');
  const resolved=speech.replace(/\{\{(fact:\d+)\}\}/g,(_match,id:string)=>{
    const fact=selected.find(f=>f?.id===id);if(!fact)throw new Error('Record answer lacks matching source evidence');return fact.text;
  });
  if(/\{\{|\}\}/.test(resolved))throw new Error('Record answer lacks matching source evidence');
  // A grouping heading is an exact source quotation too. It cannot authorize
  // a new patient name or an assertion outside the fact placeholders.
  const headings=[...speech.matchAll(/\bFor ([\p{L}\p{N}'’ .-]{1,150}):/gu)].map(match=>match[1]!.trim());
  if(headings.some(label=>!source.includes(label)))throw new Error('Record answer lacks matching source evidence');
  const warnings=facts.filter(f=>/failed|stale|unavailable|not verified|not inferred|negative allergy history|no .*records|don’t have/i.test(f.text));
  const missing=warnings.filter(f=>!resolved.includes(f.text));
  return{speech:resolved+(missing.length?' '+missing.map(f=>f.text).join(' '):''),evidence:[...new Set([...selected.map(f=>f!.text),...missing.map(f=>f.text),...headings])]};
}

function recordContext(display: Display) {
  return {revision:display.revision,nurse:display.nurse,shift:display.shift,tasks:display.tasks,candidates:display.candidates,availableTasks:display.availableTasks,
    selectedTaskId:display.selectedTaskId,selectedHandoffId:display.selectedHandoffId,pending:display.pending,conflicts:display.conflicts,
    handoffs:display.handoffs.map(({snapshot,...handoff})=>handoff),
    epicRecords:display.epicRecords.map(r=>({patientId:r.patientId,epicPatientId:r.epicPatientId,name:r.name,retrievedAt:r.retrievedAt,status:r.status,error:r.error}))};
}

export function validateReply(speech: string, evidence: string[], source?: string) {
  if (/\b(?:i(?:['’]ve| have)?|we(?:['’]ve| have)?)\s+(?:(?:have|just|successfully)\s+)*(?:updated|marked|saved|assigned|reassigned|transferred|completed|finalized|sent|notified|published|changed)\b/i.test(speech))
    throw new Error('Model cannot claim a workflow action');
  // Only exact, verified source spans may contain record facts. Check generated text
  // separately: a disclaimer elsewhere in the answer must never exempt an assertion.
  if (source && (!evidence.length || evidence.some(quote=>!source.includes(quote)||!speech.includes(quote))))
    throw new Error('Record answer lacks matching source evidence');
  const generated = source ? evidence.reduce((text,quote)=>text.split(quote).join(''),speech) : speech;
  const clinicalTopics = '(?:diagnos(?:is|es)|treatments?|treatment recommendations|clinical orders?|medications?|medication changes|doses?|prescriptions?|medical advice|clinical advice)';
  const refusal = new RegExp(`^(?:i|we|i'm|we're) (?:cannot|can't|do not|don't|will not|won't|am unable to|are unable to|am not able to|are not able to|not able to|unable to) (?:diagnose|prescribe|recommend|provide|give|administer|change|modify|adjust|offer|make)(?: (?:a |any |the |your |specific |personalized )?${clinicalTopics}(?: (?:or|and) (?:a |any |the |your |specific )?${clinicalTopics})*)?(?: for (?:you|your patient|this patient|a patient|patients))?[.!?]?$`,'i');
  const referral=/^(?:please )?(?:ask|consult|contact|speak (?:to|with)|talk (?:to|with)|check with) (?:your|the|a) (?:clinical team|care team|medical team|doctor|physician|qualified clinician|healthcare professional)(?: (?:for|about) (?:treatment|medical advice|clinical advice|treatment recommendations|a diagnosis))?[.!?]?$/i;
  const clinicalBoundary=/^(?:recommending treatment|making a diagnosis|changing clinical orders) is a clinical decision (?:that needs to come from|for) (?:your|the) (?:clinical|care|medical) team,? not me[.!?]?$/i;
  const clarification = /^(?:(?:which|what) (?:patient|task|handoff)(?: do you mean| are you referring to| would you like to discuss)|what (?:is your (?:registered )?nurse name|would you like (?:me )?to check)|please (?:give|tell) me (?:your (?:registered )?nurse name|the patient and task title))[.!?]?$/i;
  const unavailable = /^i (?:don't|do not) have (?:verified|current|available) (?:patient|task|handoff|clinical|medical) (?:information|records|data)[.!?]?$/i;
  for (const clause of generated.replace(/[’]/g,"'").split(/(?<=[.!?])\s+|[;\n—–]|\b(?:but|however|instead)\b/i).map(text=>text.trim()).filter(Boolean)) {
    // Exceptions match a complete refusal/clarification, never an arbitrary suffix.
    const generalFriendly = /^(?:i(?:'m| am| was| can| could| will| would| assist| help| coordinate| support| manage| track| look| check| provide| work| serve)|my\s+(?:\w+\s+)*(?:name|role|purpose|job|goal|task|focus|function|responsibility)\b|i'm designed to|i was built to|i am built to|i'm here to|i am here to|as (?:your|an) (?:assistant|companion|system)|to (?:get started|begin|proceed|access|check|see|view|review|pull|use)|once you|when you|whenever you(?:'re| are)?|if (?:you|you'd|you would|we|someone)|for (?:example|instance)|such as|things like|like\b|you(?:'re| are| can| could| may| might|'ll| will| have only to)|feel free|please (?:ask|tell|share|let|give)|ask me|you'll be able to|just (?:tell|share|let|give|ask|say|provide|speak|call)|simply (?:tell|share|let|give|ask|say|provide)|(?:tell|share|give|let)\s+(?:me|us)|let (?:me|us) know|or\s+(?:you|if|tell|share|let|simply|just)|so\s+(?:i|we|you)\s+can|shiftweave (?:is|helps|supports|coordinates|tracks|provides|was|aims)|the (?:system|platform|app|assistant) (?:is|helps|supports|tracks)|this (?:app|system|project|assistant|tool) (?:is|helps|supports)|how (?:can|is|are|would|do)|what (?:can|would|is|are|kind|do)|which (?:record|task|patient|feature)|is there (?:anything|a)|would you like|do you (?:want|need)|can i (?:help|assist)|shall i|should i|hello|hey+|hi+|good (?:morning|afternoon|evening|day)|welcome|ready to help|let(?:'s| us) (?:focus|get|know|see)|take care|you're welcome|i'm doing well|we are focused|of course|certainly|sure\b|sure thing|glad to help|happy to help|yes|no problem|no worries|anytime|here (?:is|are)|there(?:'s| is| are)|nothing (?:was|were|has|have)|no (?:changes?|records?|actions?)\b|that(?:'s| is| sounds) (?:fine|okay|alright|good|great|what|how))\b/i;
    if (refusal.test(clause) || referral.test(clause) || clinicalBoundary.test(clause)) continue;
    if (/\b(?:recommend\w*|prescrib\w*|administer\w*|increas\w*|decreas\w*|adjust\w*|chang\w*|stop\w*|start\w*|tak(?:e|ing))\b[\s\S]*\b(?:dos(?:e|age)\w*|medicat\w*|treat\w*|prescription\w*|mg)\b/i.test(clause))
      throw new Error('Clinical advice is outside the voice workflow');
    if (clarification.test(clause) || unavailable.test(clause) || generalFriendly.test(clause)) continue;
    if (!source && (
      /\b(?:patients?|tasks?|handoffs?|charts?|records?|allerg\w*|diagnos\w*|conditions?|medicat\w*|treat\w*|dosage\w*|doses?|prescriptions?|vitals?|temperature|blood pressure|oxygen|stable|unstable|admi(?:ssion|tted)|discharg\w*|rooms?|beds?|completed|pending|in progress|cancelled|canceled|assigned|he|she|his|her|their|they)\b/i.test(clause)
      || /\b(?:you|i|we|it|this|that)\s+(?:has|have|had)\b/i.test(clause)
      || (!/\bis (?:a|an) (?:protocol|standard|interface|database|language|tool|format|method|system|technology|framework|concept|process|way)\b/i.test(clause)
        && /\b(?!(?:i|we|you|it|that|this|there|here|what|who|which|how|the|a|an)\b)[\p{L}'-]+(?:\s+[\p{L}'-]+){0,3}\s+(?:is|was|has|had|seems|appears|looks|needs|takes|received)\b/iu.test(clause))
      || /\b(?:needs|received|requires)\s+(?:care|observation|monitoring|therapy)\b|\b(?:aged|age|weighs)\s+\d|\b\d+\s*(?:mg|mmhg|bpm|years? old)\b/i.test(clause)
      || /\b[\p{L}'-]+\s+(?:is|was)\s+\d+\b/iu.test(clause)
    )) throw new Error('Record claims require a current backend result');
  }
  if (source) {
    const connective=evidence.reduce((text,quote)=>text.split(quote).join(''),speech);
    const neutralConnective=connective.replace(/’/g,"'").replace(/\bhere(?:'s| is) the (?:breakdown|full picture)\b|\band one more thing\b/gi,'');
    const neutral=new Set("a about also an and another are as at be bit brief briefly can catch check detail details else for found from got happy have he help her here here's heres hers hi him his how i i've ive i'm im if important in information is it it's its just know latest left let let's lets like look looking me more my no note noted noting nothing now of okay on or our over question questions quick read reading change changes regarding related relevant right said says see share shift snapshot so some something stand stands sure take that that's thats the their theirs them then there's theres these they things this those to up update us useful want was we we've weve well what what's whats when where which with worth would yes you your you're youre yours".split(' '));
    if((neutralConnective.toLowerCase().replace(/’/g,"'").match(/[a-z']+/g)||[]).some(word=>!neutral.has(word))||/\d/.test(neutralConnective))
      throw new Error('Record claims must be contained in source evidence');
    const numbers = speech.match(/\b\d+(?:\.\d+)?\b/g) || [], sourceNumbers=new Set(source.match(/\b\d+(?:\.\d+)?\b/g)||[]);
    if(numbers.some(number=>!sourceNumbers.has(number))) throw new Error('Record answer introduced an unsupported number');
    for(const status of ['completed','in progress','pending','cancelled']) {
      if(new RegExp(`\\b${status}\\b`,'i').test(speech)&&!new RegExp(`\\b${status}\\b`,'i').test(source)) throw new Error('Record answer introduced an unsupported status');
    }
    const warnings=sourceFacts(source).map(f=>f.text).filter(sentence=>/failed|stale|unavailable|not verified|not inferred|negative allergy history|no .*records|don’t have/i.test(sentence));
    if(warnings.some(warning=>!speech.includes(warning))) throw new Error('Record answer omitted source uncertainty');
  } else if (evidence.length || /\b(?:you have \d|your (?:task|patient|handoff) (?:is|has|was)|the task is (?:completed|pending|in progress))\b/i.test(speech)) {
    throw new Error('Record claims require a current backend result');
  }
}

async function refreshHospitalContext(input:VoiceInput,endpoint:string) {
  const context=VoiceService.agentContext(input.session_id,false);
  if(context.dataSource!=='hospital'||!context.nurse||!context.shift)return;
  const bridge=new MCPClientBridge(endpoint);
  try {
    await bridge.initialize();
    const result=await bridge.callTool('refresh_hospital_records',{nurse_id:context.nurse.id,shift_id:context.shift.id,idempotency_key:input.idempotency_key});
    if(result.isError||JSON.parse(result.content[0]!.text).status==='FAILED')throw new Error('Simulation hospital refresh unavailable');
  }finally{await bridge.close();}
}

async function runConversation(input: VoiceInput, endpoint: string) {
  const provider = getLLMProvider();
  const bridge = new MCPClientBridge(endpoint);
  const key = `voice-model:${input.idempotency_key}`;
  const requestHash = createHash('sha256').update(canonicalJson({input,provider:provider.providerId,mode:'semantic-v1'})).digest('hex');
  const checkpoint = CheckpointService.getLatestCheckpoint(key);
  let step = checkpoint?.stepIndex || 0;
  let state = checkpoint?.statePayload.semantic as SemanticState | undefined;
  const context = VoiceService.agentContext(input.session_id,false);
  const actorId = currentStaff()?.id || context.nurse?.id || 'voice-demo';
  if(state && state.requestHash!==requestHash) {provider.close?.();throw new Error('Conversation request key was reused for a different request');}
  if(!state && context.revision!==input.expected_revision) {provider.close?.();throw new Error('Voice session changed. Refresh before speaking again.');}
  state ||= {requestHash,messages:[...context.messages.map(m=>({role:m.role==='nurse'?'user' as const:'assistant' as const,content:m.text})),
    {role:'user',content:input.utterance}],version:`session:${context.revision}`,recordsRead:false,read:false};
  const current = state;
  const version=()=>current.recordsRead===false?`session:${VoiceService.agentContext(input.session_id,false).revision}`:VoiceService.agentVersion(input.session_id);
  const prepareRecords=async(intent:VoiceIntent)=>{
    if(!['IDENTIFY','END'].includes(intent.intent)&&!current.hospitalRefreshed){
      await refreshHospitalContext(input,endpoint);current.hospitalRefreshed=true;
    }
    current.recordsRead=true;current.version=VoiceService.agentVersion(input.session_id);
  };
  const persist = (name:string) => CheckpointService.saveCheckpoint(key,++step,name,{semantic:current},`${key}:step:${step}`);
  const finish = () => {
    const fromRevision=current.action?.display.revision??current.identificationRevision;
    return VoiceService.saveAssistantTurn(input,current.speech!,{provider:provider.providerId,status:current.status!},
      fromRevision!==undefined ? {fromRevision,replaceLast:true,preservePending:true,
        replaceTurns:Number(Boolean(current.action))+Number(current.identificationRevision!==undefined)} : undefined);
  };
  const started = Date.now();
  try {
    if(current.speech) return finish(); // Reconcile a committed model result before making another paid call.
    if(!checkpoint) {
      db.prepare("INSERT OR IGNORE INTO workflow_runs(id,workflow_type,initiated_by,status) VALUES (?,'GENERATE_HANDOFF',?,'IN_PROGRESS')").run(key,actorId);
      persist('VOICE_AGENT_STARTED');
    }
    const tools: MCPToolDefinition[] = [{name:'read_voice_context',description:'Read current nurse-scoped patients, tasks, incoming candidates, handoffs and source metadata through MCP. No records are returned before identification.',
      inputSchema:{type:'object',properties:{},required:[],additionalProperties:false}},intentTool,replyTool];
    try {
      await bridge.initialize();
      const discovered = await bridge.listTools();
      if(!discovered.some(t=>t.name==='get_voice_display')) throw new Error('Voice context tool is unavailable');
      for(let iteration=0;iteration<7;iteration++) {
        if(Date.now()-started>65000) throw new Error('Voice model time budget reached');
        if(!current.pendingTool&&current.plannedIntent) {
          const intent=current.plannedIntent;
          let command:string;
          try {await prepareRecords(intent);command=VoiceService.commandForIntent(input,intent);}
          catch(error) {
            const message=error instanceof Error?error.message:'';
            if(/^(?:Please give|More than one nurse|I couldn’t find that nurse|That task is outside|Which task|I couldn’t find that patient|That handoff is outside|What should I write|No changes were made)/.test(message)) {
              current.speech=message;current.status='SUCCESS';delete current.plannedIntent;break;
            }
            throw error;
          }
          const id=`${key}:planned-request`;
          current.pendingTool={name:'interpret_voice_request',args:{...intent,render_backend:true,introduction:current.plannedIntroduction||''},id,command};
          current.messages.push({role:'assistant',content:'',toolCall:{toolName:'interpret_voice_request',arguments:current.pendingTool.args},toolCallId:id});
          delete current.plannedIntent;persist('VOICE_PLANNED_REQUEST');
        }
        if(!current.pendingTool) {
          const {messages,...scope} = VoiceService.agentContext(input.session_id,false);
          const decisionStarted=Date.now();
          const result = await provider.decideNextStep(current.messages,tools,{voiceWorkflow:true,voiceSinglePass:true,voiceReplyOnly:Boolean(current.action),scope:{...scope,currentUtterance:input.utterance,identityResolved:current.identificationRevision!==undefined}});
          AuditService.log({actorType:'AGENT',actorId,action:'LLM:VOICE_DECISION',targetResource:`voice:${input.session_id}`,outcome:'SUCCESS',
            latencyMs:Date.now()-decisionStarted,details:{provider:provider.providerId,stage:current.action?'reply':'intent',iteration,...result.metrics}});

          if(result.toolCall) {
            const call = result.toolCall;
            if(!tools.some(t=>t.name===call.toolName)) throw new Error('Model requested an unavailable operation');
            if(current.action && call.toolName!=='reply_to_nurse') throw new Error('Only one workflow operation is permitted per utterance');
            let command: string | undefined;
            if(call.toolName==='interpret_voice_request') {
              if(current.identificationRevision!==undefined && call.arguments.intent==='IDENTIFY') throw new Error('Nurse identification is already complete for this request');
              try {const intent=baseIntent(call.arguments).intent;await prepareRecords(intent);command=VoiceService.commandForIntent(input,intent);}
              catch(error) {
                if(error instanceof z.ZodError) throw error;
                const message=error instanceof Error?error.message:'';
                if(message.startsWith('Please give') && !current.intentRepairs){
                  current.intentRepairs=1;
                  const id=result.toolCallId||`${key}:repair:${step}`;
                  current.messages.push({role:'assistant',content:'',toolCall:call,toolCallId:id},{role:'tool',toolName:call.toolName,toolCallId:id,content:JSON.stringify({error:'NURSE_REFERENCE_INVALID',instruction:'Recheck scope.currentUtterance. The speaker and the nurse who left are different roles. For an existing handoff use HANDOFF.source_nurse_name; never DRAFT unless creation was explicitly requested. Use the current name or surname from the speaker, not an old name from history. If unclear ask one concise question about which role the name refers to.'})});
                  persist('VOICE_INTENT_REJECTED');continue;
                }
                if(/^(?:Please give|More than one nurse|I couldn’t find that nurse|That task is outside|Which task|I couldn’t find that patient|That handoff is outside|What should I write|No changes were made)/.test(message)) {
                  current.speech=message;current.status='SUCCESS';break;
                }
                throw new Error('Voice request could not be validated');
              }
            }
            current.pendingTool={name:call.toolName,args:call.arguments,id:result.toolCallId||`${key}:${step}`, ...(command?{command}:{})};
            current.messages.push({role:'assistant',content:'',toolCall:call,toolCallId:current.pendingTool.id});
            persist(`VOICE_INTENT:${call.toolName}`);
          } else {
            // Free dialogue can answer directly. Record replies must cite the current authoritative result.
            if(current.read || current.action) {
              if((current.replyRepairs||0)>=1)throw new Error('Record reply must provide source evidence');
              current.replyRepairs=(current.replyRepairs||0)+1;
              current.messages.push({role:'assistant',content:result.finalSpeech||''},{role:'user',content:
                'Backend response-validation feedback, not a new nurse request: use reply_to_nurse now. Reference the returned fact:N IDs in evidence and {{fact:N}} placeholders in speech. Outside placeholders use only a short neutral phrase such as "Here is what I found." Do not add clinical or priority judgments. The current nurse request is still scope.currentUtterance.'});
              persist('VOICE_REPLY_REJECTED');continue;
            }
            const speech=result.finalSpeech?.trim();if(!speech)throw new Error('Empty model reply');
            validateReply(speech,[]);current.speech=speech;current.status='SUCCESS';break;
          }
        }
        const pending = current.pendingTool!;
        let output: unknown;
        if(pending.name==='read_voice_context') {
          z.object({}).strict().parse(pending.args);
          const result=await bridge.callTool('get_voice_display',{session_id:input.session_id});
          if(result.isError) throw new Error('Current voice records unavailable');
          const display=JSON.parse(result.content[0]!.text) as Display;
          output=recordContext(display);current.read=true;current.recordsRead=true;current.version=VoiceService.agentVersion(input.session_id);
        } else if(pending.name==='interpret_voice_request') {
          const plan=baseIntent(pending.args),intent=plan.intent;
          // This private child receipt makes a crash between service commit and model checkpoint safe to retry.
          const identifyingRequest=intent.intent==='IDENTIFY'&&intent.continue_request===true;
          const child={...input,expected_revision:current.identificationRevision??input.expected_revision,
            idempotency_key:`${input.idempotency_key}:${identifyingRequest?'semantic-identification':'semantic-operation'}`};
          let display: Display;
          const before=VoiceService.read(input.session_id);
          if(['SYNC_EPIC','READ_EPIC'].includes(intent.intent)&&before.nurse&&before.shift) {
            const result=await bridge.callTool(intent.intent==='SYNC_EPIC'?'sync_epic_workspace':'get_epic_patient_context',
              intent.intent==='SYNC_EPIC'?{nurse_id:before.nurse.id,shift_id:before.shift.id,idempotency_key:input.idempotency_key}
              :{patient_id:intent.epic_patient_id,idempotency_key:input.idempotency_key});
            if(result.isError) throw new Error('Epic request failed');
            const data=JSON.parse(result.content[0]!.text);
            const speech=intent.intent==='SYNC_EPIC'?`Epic refresh is ${data.status}. ${data.results.map((r:any)=>`${r.patientId}: ${r.status}.`).join(' ')} No Epic orders were changed.`
              :`Epic returned records for ${data.context.patient.fullName}, retrieved ${data.context.retrievedAt}. ${data.context.encounters.length} encounters and ${data.context.medicationOrders.length} medication orders. Orders do not establish administration.`;
            display=VoiceService.saveAssistantTurn(child,speech);
          } else display=VoiceService.turn(child,pending.command!);
          current.version=VoiceService.agentVersion(input.session_id);
          output={authoritativeAnswer:display.speech,facts:sourceFacts(display.speech),...recordContext(display)};
          if(identifyingRequest && display.nurse && display.shift) {
            current.identificationRevision=display.revision;current.read=false;
            if(plan.after_identification){current.plannedIntent=plan.after_identification;current.plannedIntroduction=plan.introduction||'';}
            output={identificationComplete:true,requestPending:true,instruction:'Read the newly identified nurse context and fulfill the remaining request in scope.currentUtterance. Do not identify again or stop at a greeting.',...recordContext(display)};
          } else {
            current.action={display,intent:intent.intent};
            if(!['TASKS','TASK','PATIENT','HANDOFF','CONFLICTS'].includes(intent.intent)||display.pending||!display.nurse||
              (intent.intent==='HANDOFF'&&!display.selectedHandoffId)) {
              // Human proposals, identity gates and confirmed outcomes stay exactly as validated by the backend.
              current.speech=display.speech;current.status='SUCCESS';
            } else if(plan.render_backend) {
              // Intent is understood by the LLM, but facts come only from the just-executed
              // backend operation. No second inference or generated patient claim is needed.
              const speech=[plan.introduction||'',display.speech].filter(Boolean).join(' ');
              validateReply(speech,[display.speech],display.speech);
              current.speech=speech;current.status='SUCCESS';
            }
          }
        } else {
          try {
            const reply=replySchema.parse(pending.args);
            if(reply.kind==='RECORDS'&&!current.action) throw new Error('Read operation required before a record answer');
            if(current.action&&reply.kind!=='RECORDS')throw new Error('Record answer lacks matching source evidence');
            let composed=reply.kind==='RECORDS'?composeRecordReply(reply.speech,reply.evidence,current.action!.display.speech):{speech:reply.speech,evidence:reply.evidence};
            try {validateReply(composed.speech,composed.evidence,reply.kind==='RECORDS'?current.action?.display.speech:undefined);}
            catch(error){
              if(reply.kind!=='REFUSAL'||current.action||reply.evidence.length||!(error instanceof Error)||error.message!=='Clinical advice is outside the voice workflow')throw error;
              // A model-selected refusal cannot authorize clinical advice. Render the
              // enforced boundary instead of repeatedly asking it to reword that advice.
              // Unsourced record claims still fail their independent evidence check.
              composed={speech:clinicalBoundarySpeech,evidence:[]};validateReply(composed.speech,[]);
            }
            current.speech=composed.speech;current.status='SUCCESS';output={delivered:true};
          } catch(error) {

            const reason=error instanceof Error?error.message:'';
            if(!(error instanceof z.ZodError)&&!replyErrors.has(reason))throw error;
            if((current.replyRepairs||0)>=1)throw error;
            current.replyRepairs=(current.replyRepairs||0)+1;
            current.messages.push({role:'tool',toolName:pending.name,toolCallId:pending.id,content:JSON.stringify({error:error instanceof z.ZodError?'INVALID_REPLY_SCHEMA':reason,
              instruction:current.action?'Reply again using fact IDs from the last operation. Put {{fact:N}} placeholders in speech and matching fact:N IDs in evidence. Do not add clinical or priority judgments. Do not call another operation.':
                'Answer the current user message naturally with empty evidence. Do not use fact IDs or answer patient facts. For treatment, diagnosis or order-change requests, clearly say you cannot recommend treatment or change clinical orders and ask the user to consult their clinical team. A refusal must not include advice. Do not request records for general conversation.'})});
            delete current.pendingTool;persist('VOICE_REPLY_REJECTED');continue;
          }
        }
        current.messages.push({role:'tool',toolName:pending.name,toolCallId:pending.id,content:JSON.stringify(output)});
        delete current.pendingTool;persist(`VOICE_RESULT:${pending.name}`);
        AuditService.log({actorType:'AGENT',actorId,action:'VOICE:SEMANTIC_TOOL',targetResource:`voice:${input.session_id}`,outcome:'SUCCESS',
          details:{tool:pending.name,provider:provider.providerId,...(current.action?{intent:current.action.intent}:{})}});
        if(current.speech) break;
      }
      if(!current.speech) throw new Error('Voice model step budget reached');
      if(current.version!==version()) throw new Error('Source records changed during the answer');
    } catch(error) {

      const changed=current.version!==version();
      const reason=error instanceof Error?error.message:'';
      current.failureCode=changed?'SOURCE_CHANGED':error instanceof z.ZodError?'INVALID_SCHEMA':replyErrors.has(reason)?reason:
        reason==='Record reply must provide source evidence'?'RECORD_REPLY_NEEDS_EVIDENCE':'MODEL_OR_TOOL_UNAVAILABLE';
      current.speech=changed ? 'The records changed while I was answering. Please ask again so I can check the latest information.'
        : current.action ? `${current.action.display.speech} I couldn’t generate a verified conversational reply; that is the backend’s recorded result.`
        : error instanceof z.ZodError ? 'I couldn’t validate that request. Could you clarify what you want to do? No records were changed.'
        : replyErrors.has(reason) ? 'I couldn’t verify that answer safely. Please ask me to check the relevant records, or clarify what you need. No records were changed.'
        : "I couldn't complete that request with Bedrock right now. Please try again. No records were changed.";
      current.status='FAILED';
    }
    db.transaction(() => {
      persist('VOICE_LLM_RESULT');
      if(current.status==='SUCCESS') CheckpointService.completeWorkflowRun(key);
      else db.prepare("UPDATE workflow_runs SET status='FAILED',error_message='Voice model could not produce a verified reply' WHERE id=?").run(key);
      AuditService.log({actorType:'AGENT',actorId,action:'LLM:VOICE_CONVERSATION',targetResource:`voice:${input.session_id}`,
        outcome:current.status==='SUCCESS'?'SUCCESS':'FAILURE',latencyMs:Date.now()-started,
        details:{provider:provider.providerId,toolsEnabled:true,status:current.status,...(current.action?{intent:current.action.intent}:{}),...(current.failureCode?{failureCode:current.failureCode}:{})}});
    }).immediate();
    return finish();
  } finally { provider.close?.();await bridge.close(); }
}

/** Await remote calls outside SQLite transactions; commit the display only at the expected revision. */
export async function runVoiceTurn(input: VoiceInput, endpoint: string) {
  // Authorize even an exact saved-response retry before reading its receipt.
  if (staffAuthRequired()) StaffAuthService.bindVoiceSession(input.session_id);
  if (busy.has(input.session_id)) throw new Error('Voice session busy; retry the same request');
  busy.add(input.session_id);
  const start = Date.now();
  let succeeded = false;
  try {
    const receipt = db.prepare('SELECT request_json, response_json FROM operation_receipts WHERE idempotency_key = ?')
      .get(`voice-turn:${input.idempotency_key}`) as { request_json: string; response_json: string } | undefined;
    if (receipt) {
      if (receipt.request_json !== canonicalJson(input)) throw new Error('Idempotency key was already used for a different request');
      succeeded = true;
      return JSON.parse(receipt.response_json);
    }
    const command = VoiceService.commandText(input.utterance);
    const sourceDisplay=VoiceService.agentContext(input.session_id,false);
    if(sourceDisplay.dataSource==='hospital') {
      if(/\bepic\b/i.test(command)) {
        succeeded=true;return VoiceService.saveAssistantTurn(input,'You are using the synthetic hospital. Select Epic sandbox to use Epic records.');
      }
      // Refresh remote clinical context outside SQLite transactions, through MCP.
      // Reconcile before a confirmation too. The version check excludes only refresh
      // timestamps, so actual changed records still invalidate the proposed action.
      const passive=(!command&&/\bmedi\b/i.test(input.utterance))||/^(?:cancel|no|stop|never mind|no cancel)[.! ]*$/i.test(command);
      const needsRefresh=(process.env.LLM_PROVIDER||'mock').toLowerCase()==='mock'||
        /^(?:yes|confirm|yes confirm|confirm it|yes please|refresh hospital(?: records| patients)?|sync hospital(?: records| patients)?)[.! ]*$/i.test(command);
      if(sourceDisplay.nurse&&sourceDisplay.shift&&!passive&&needsRefresh) {
        const bridge=new MCPClientBridge(endpoint);
        try {
          await bridge.initialize();
          const r=await bridge.callTool('refresh_hospital_records',{nurse_id:sourceDisplay.nurse.id,shift_id:sourceDisplay.shift.id,idempotency_key:input.idempotency_key});
          if(r.isError||JSON.parse(r.content[0]!.text).status==='FAILED') {
            succeeded=true;return VoiceService.saveAssistantTurn(input,'I couldn’t refresh the simulation hospital records. No requested changes were made. Please retry when the connection is available.');
          }
          if(/^(?:refresh|sync) hospital(?: records| patients)?[.!]?$/i.test(command)) {
            succeeded=true;return VoiceService.saveAssistantTurn(input,'The simulation hospital records have been refreshed. Your saved task assignments are unchanged.');
          }
        } finally {await bridge.close();}
      }
    }
    const handoffFollowup=VoiceService.handoffNameFollowup(input);
    if(handoffFollowup){succeeded=true;return handoffFollowup;}
    if((process.env.LLM_PROVIDER||'mock').toLowerCase()!=='mock') {
      // Confirmation/cancellation are human control messages, never model-generated decisions.
      const control=(!command&&/\bmedi\b/i.test(input.utterance)) || /^(?:yes|confirm|yes confirm|confirm it|yes please|cancel|no|stop|never mind|no cancel)[.! ]*$/i.test(command);
      const result=control ? VoiceService.turn(input) : await runConversation(input,endpoint);
      succeeded=true;return result;
    }
    const epic = command.match(/^read epic patient ([A-Za-z0-9.-]+)$/i);
    const syncEpic = /^(?:sync|refresh|connect) epic(?: patients| records| workspace)?[.!]?$/i.test(command);
    if (!epic && !syncEpic && !/^ask assistant[, :]+/i.test(command)) {
      const result = VoiceService.turn(input); succeeded = true; return result;
    }
    const display = VoiceService.read(input.session_id);
    if (display.revision !== input.expected_revision) throw new Error('Voice session changed. Refresh before speaking again.');
    if (!display.nurse || !display.shift) { const result = VoiceService.turn(input); succeeded = true; return result; }
    if (syncEpic) {
      const bridge = new MCPClientBridge(endpoint);
      try {
        await bridge.initialize();
        const response = await bridge.callTool('sync_epic_workspace', { nurse_id: display.nurse.id, shift_id: display.shift.id, idempotency_key: input.idempotency_key });
        if (response.isError) throw new Error(response.content.map(c => c.text).join('\n'));
        const result = JSON.parse(response.content[0]!.text);
        const saved = VoiceService.saveAssistantTurn(input, `Epic workspace sync is ${result.status}. ` +
          result.results.map((r: any) => `${r.patientId}: ${r.status}${r.error ? ` — ${r.error}` : ''}.`).join(' ') +
          ' Source records and local review tasks are on screen. Medication orders are not administration records; existing task custody is unchanged.');
        succeeded = true; return saved;
      } finally { await bridge.close(); }
    }
    if (epic) {
      const bridge = new MCPClientBridge(endpoint);
      try {
        await bridge.initialize();
        const response = await bridge.callTool('get_epic_patient_context', {
          patient_id: epic[1], idempotency_key: input.idempotency_key });
        if (response.isError) throw new Error(response.content.map(c => c.text).join('\n'));
        const { context } = JSON.parse(response.content[0]!.text);
        const saved = VoiceService.saveAssistantTurn(input, `Epic returned source records for ${context.patient.fullName}, retrieved ${context.retrievedAt}. ` +
          `${context.encounters.length} encounters, ${context.medicationOrders.length} medication orders, and ${context.documents.length} document references. ` +
          'These are supplemental records. Document contents and medication administration have not been verified; local nurse assignments are unchanged.');
        succeeded = true; return saved;
      } finally { await bridge.close(); }
    }
    // Read-only planning cannot manufacture human confirmation or change workflow custody.
    const agent = new ShiftWeaveOrchestrator(endpoint, process.env.LLM_PROVIDER || 'mock',
      `voice-agent:${input.session_id}:${display.nurse.id}:${display.shift.id}`, true);
    try {
      await agent.initialize();
      const result = await agent.processUtterance(display.nurse.id,
        command.replace(/^ask assistant[, :]+/i, ''), {
          shiftId: display.shift.id, outgoingNurseId: display.nurse.id, incomingNurseId: display.nurse.id,
          requestKey: input.idempotency_key
        });
      const saved = VoiceService.saveAssistantTurn(input, result.speech);
      succeeded = true; return saved;
    } finally { await agent.close(); }
  } finally {
    busy.delete(input.session_id);
    AuditService.log({ actorType: 'SYSTEM', actorId: currentStaff()?.id || 'voice-gateway', action: 'VOICE:TURN_FINISHED',
      targetResource: `voice:${input.session_id}`, outcome: succeeded ? 'SUCCESS' : 'FAILURE', latencyMs: Date.now() - start,
      details: { metric: 'server_turn_duration_ms', receiptCommitted: Boolean(db.prepare(
        'SELECT 1 FROM operation_receipts WHERE idempotency_key = ?').get(`voice-turn:${input.idempotency_key}`)) } });
  }
}
