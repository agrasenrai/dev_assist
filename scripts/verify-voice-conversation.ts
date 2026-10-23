import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BedrockLLMProvider, type AgentMessage } from '../src/agent/llm-provider.js';
import { db } from '../src/db/connection.js';
import { CheckpointService } from '../src/services/checkpoint.service.js';
import { VoiceService, type VoiceIntent } from '../src/services/voice.service.js';
import { composeRecordReply, validateReply } from '../src/services/voice-agent.service.js';

/** Adapter fixtures exercise real HTTP/MCP and durable services; live inference is checked separately. */
export async function verifyVoiceConversation(base:string,check:(name:string,action:()=>unknown)=>void) {
  const original=BedrockLLMProvider.prototype.decideNextStep, originalProvider=process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER='bedrock';
  const session=randomUUID();let revision=0,calls=0;let lastMessages:AgentMessage[]=[];
  let intent:VoiceIntent|undefined;
  let continuationIntent:VoiceIntent|undefined;
  let invalidNameOnce=false;
  let generatedReply:{speech:string;kind:string;viaTool:boolean;readFirst?:boolean}|undefined;
  let mode:'chat'|'intent'|'failure'|'tool'|'fabricate'|'source-change'|'false-confirm'='chat';
  const taskId='voice_task';
  BedrockLLMProvider.prototype.decideNextStep=async(messages,tools,context)=>{
    calls++;lastMessages=messages;
    assert.equal(context?.voiceWorkflow,true);
    assert.deepEqual(tools.map(t=>t.name),['read_voice_context','interpret_voice_request','reply_to_nurse']);
    if(mode==='failure')throw new Error('fixture-sensitive-provider-error');
    if(mode==='tool')return{toolCall:{toolName:'acknowledge_task',arguments:{human_confirmed:true}}};
    if(mode==='false-confirm')return{toolCall:{toolName:'interpret_voice_request',arguments:{intent:'CONFIRM'}}};
    const userIndex=messages.findLastIndex(m=>m.role==='user'),utterance=messages[userIndex]!.content;
    const steps=messages.slice(userIndex+1).filter(m=>m.role==='tool'&&!m.content.includes('NURSE_REFERENCE_INVALID'));
    if(invalidNameOnce){invalidNameOnce=false;return{toolCall:{toolName:'interpret_voice_request',arguments:{intent:'IDENTIFY',nurse_name:'Someone Else'}}};}
    if(generatedReply) {
      if(generatedReply.readFirst&&!steps.some(m=>m.toolName==='read_voice_context'))return{toolCall:{toolName:'read_voice_context',arguments:{}}};
      return generatedReply.viaTool
        ? {toolCall:{toolName:'reply_to_nurse',arguments:{kind:generatedReply.kind,speech:generatedReply.speech,evidence:[]}}}
        : {finalSpeech:generatedReply.speech};
    }
    if(mode==='chat')return{finalSpeech:utterance.includes("don't like")?"I understand. I'll give you some space."
      :utterance.includes('confused')?"That's okay. We can take it one step at a time."
      :"I'm sorry you're not feeling well. What would you like help with?"};
    const identifiedIndex=steps.findIndex(m=>m.toolName==='interpret_voice_request'&&JSON.parse(m.content).identificationComplete);
    if(intent?.intent==='IDENTIFY'&&identifiedIndex<0)return{toolCall:{toolName:'interpret_voice_request',arguments:intent}};
    const requestSteps=steps.slice(identifiedIndex+1);
    if(!requestSteps.some(m=>m.toolName==='read_voice_context'))return{toolCall:{toolName:'read_voice_context',arguments:{}}};
    const result=requestSteps.find(m=>m.toolName==='interpret_voice_request');
    if(!result)return{toolCall:{toolName:'interpret_voice_request',arguments:identifiedIndex>=0?continuationIntent!:intent!}};
    const facts=JSON.parse(result.content).facts as Array<{id:string;text:string}>;
    if(mode==='source-change')db.prepare("UPDATE tasks SET priority=CASE WHEN priority='STAT' THEN 'URGENT' ELSE 'STAT' END WHERE id=?").run(taskId);
    return{toolCall:{toolName:'reply_to_nurse',arguments:{kind:'RECORDS',speech:`Here’s what I found${identifiedIndex>=0?' for your shift':''}. ${facts.map(f=>`{{${f.id}}}`).join(' ')}${mode==='fabricate'?' The task is completed.':''}`,evidence:facts.map(f=>f.id)}}};
  };
  const post=async(input:unknown)=>{const response=await fetch(base+'/api/voice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return{status:response.status,data:await response.json()};};
  const say=async(utterance:string)=>{const response=await post({session_id:session,utterance,expected_revision:revision,idempotency_key:randomUUID()});assert.equal(response.status,200,JSON.stringify(response.data));revision=response.data.revision;return response.data;};
  const modelStatus=()=>((CheckpointService.getLatestCheckpoint(`voice:${session}`)?.statePayload.conversationModel)as any)?.status;
  try{
    const input={session_id:session,utterance:'can you do that one thing for me I am just not feeling well',expected_revision:0,idempotency_key:randomUUID()};
    const first=await post(input);revision=first.data.revision;
    check('ordinary speech reaches Bedrock with workflow tools before nurse selection',()=>{assert.equal(calls,1);assert.equal(first.data.nurse,null);assert.match(first.data.speech,/not feeling well/);});
    const retry=await post(input);
    check('exact voice retry returns the saved model response without another call',()=>{assert.deepEqual(retry,first);assert.equal(calls,1);});
    const second=await say("okay I don't like to talk to you");
    check('free dialogue uses the saved shared history',()=>{assert.match(second.speech,/space/);assert.equal(lastMessages[0]!.content,input.utterance);assert.equal(lastMessages[1]!.content,first.data.speech);});
    mode='intent';intent={intent:'IDENTIFY',nurse_name:'Maya'};
    const introduced=await say('Maya here, ready to get started');
    check('semantic introduction validates the existing nurse without an I-am keyword',()=>assert.equal(introduced.nurse.id,'voice_maya'));
    check('speaker validation accepts a nurse title and does not select the departing colleague',()=>{
      const input={session_id:session,utterance:'I am nurse Maya and Nora has left',expected_revision:revision,idempotency_key:randomUUID()};
      assert.equal(VoiceService.commandForIntent(input,{intent:'IDENTIFY',nurse_name:'Maya Test'}),'I am Maya Test');
      assert.throws(()=>VoiceService.commandForIntent(input,{intent:'IDENTIFY',nurse_name:'Nora Test'}),/Please give/);
    });
    mode='chat';const feeling=await say('I am confused');
    check('feelings do not reset the selected nurse',()=>{assert.equal(feeling.nurse.id,'voice_maya');assert.match(feeling.speech,/one step/);});
    mode='intent';intent={intent:'DRAFT',recipient_name:'Nora Test'};
    const beforeDrafts=(db.prepare('SELECT count(*) n FROM handoffs').get()as any).n;
    const negated=await say('Do not prepare a handoff for Nora Test');
    check('explicit negation blocks a model-misclassified mutation before any write',()=>{
      assert.match(negated.speech,/No changes were made/);assert.equal((db.prepare('SELECT count(*) n FROM handoffs').get()as any).n,beforeDrafts);assert.equal(negated.pending,null);
    });
    mode='intent';intent={intent:'TASKS',status:'UNFINISHED'};
    const focus=await say('What should I focus on today?');
    check('keyword-free workflow request reads MCP context and preserves model wording',()=>{
      assert.match(focus.speech,/Here’s what I found/);assert.match(focus.speech,/Review documented shift checklist/);assert.match(focus.speech,/in progress/);assert.equal(modelStatus(),'SUCCESS');
      assert.equal(focus.messages.filter((m:any)=>m.role==='nurse'&&m.text==='What should I focus on today?').length,1);
    });
    check('general and workflow turns share one durable history',()=>assert(lastMessages.some(m=>m.content==='I am confused')));
    intent={intent:'CONFLICTS'};const discrepancies=await say('Do the records line up?');
    check('semantic discrepancy reads do not start a resolution action',()=>{assert.match(discrepancies.speech,/No unresolved discrepancy/);assert.equal(discrepancies.pending,null);});
    db.prepare("UPDATE conflicts SET status='UNRESOLVED' WHERE id='voice_conflict'").run();
    db.prepare("UPDATE tasks SET status='FLAGGED_CONFLICT' WHERE id=?").run(taskId);
    intent={intent:'RESOLVE',task_id:taskId,status:'IN_PROGRESS',note:'I used start and finish timestamps to review both sources'};
    const review=await say('I used start and finish timestamps to review both sources');
    check('status words inside a structured review note cannot select another operation',()=>{
      const voice=CheckpointService.getLatestCheckpoint(`voice:${session}`)?.statePayload.voice as any;
      assert.equal(voice.pending.kind,'RESOLVE');assert.equal(review.pending.ready,true);assert.equal((db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId)as any).status,'FLAGGED_CONFLICT');
    });
    await say('Cancel');
    db.prepare("UPDATE conflicts SET status='VERIFIED_RESOLVED' WHERE id='voice_conflict'").run();
    db.prepare("UPDATE tasks SET status='IN_PROGRESS' WHERE id=?").run(taskId);
    intent={intent:'TASK',task_id:taskId};const status=await say('Did that get done?');
    check('indirect follow-up reads status without fabricating completion',()=>{assert.match(status.speech,/in progress/);assert.doesNotMatch(status.speech,/is completed/);});
    mode='fabricate';const fabricated=await say('How is it coming along?');
    check('unsupported generated task status is rejected explicitly',()=>{assert.equal(modelStatus(),'FAILED');assert.match(fabricated.speech,/couldn’t generate a verified/);assert.doesNotMatch(fabricated.speech,/The task is completed/);});
    mode='intent';intent={intent:'STATUS',task_id:taskId,status:'COMPLETED'};const proposed=await say('I’m finished with that checklist');
    check('semantic completion stages confirmation without writing',()=>{assert.equal(proposed.pending.ready,true);assert.match(proposed.speech,/Say “confirm”/);assert.equal((db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId)as any).status,'IN_PROGRESS');});
    const beforeWake=calls;const awake=await say('Medi');
    check('wake-only control preserves the pending semantic proposal',()=>{assert.equal(awake.pending.ready,true);assert.equal(calls,beforeWake);assert.equal(awake.nurse.id,'voice_maya');});
    mode='false-confirm';await say('Tell me a little more');
    check('model cannot manufacture human confirmation',()=>{assert.equal(modelStatus(),'FAILED');assert.equal((db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId)as any).status,'IN_PROGRESS');});
    mode='intent';intent={intent:'STATUS',task_id:taskId,status:'COMPLETED'};await say('Wrap up that checklist');
    const beforeConfirm=calls;const confirmed=await say('Confirm');
    check('only a human control message commits the task change',()=>{assert.equal(calls,beforeConfirm);assert.match(confirmed.speech,/now completed/);assert.equal((db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId)as any).status,'COMPLETED');});
    intent={intent:'TASK',task_id:taskId};const completed=await say('Did that get done?');
    check('semantic follow-up reflects the persisted update',()=>assert.match(completed.speech,/is completed/));
    intent={intent:'TASK',task_id:'task_outside_current_view'};const outside=await say('Check that other item');
    check('model IDs cannot bypass record scoping',()=>assert.match(outside.speech,/outside your current view/));
    mode='source-change';intent={intent:'TASK',task_id:taskId};const stale=await say('Read that back to me');
    check('changed records invalidate an answer during generation',()=>assert.match(stale.speech,/records changed while/));
    mode='failure';const failed=await say('Can we talk for a moment?');
    check('Bedrock failure has no silent mock fallback or sensitive error',()=>{assert.match(failed.speech,/Bedrock right now/);assert.doesNotMatch(failed.speech,/fixture-sensitive/);assert.equal(modelStatus(),'FAILED');});
    const events=(db.prepare('SELECT count(*) n FROM task_events').get()as any).n;mode='tool';const tool=await say('Do that one thing for me please');
    check('unavailable model tools cannot execute writes',()=>{assert.match(tool.speech,/No records were changed/);assert.equal((db.prepare('SELECT count(*) n FROM task_events').get()as any).n,events);});
    mode='intent';intent={intent:'TASK',task_id:taskId};
    const recoveryInput={session_id:session,utterance:'Tell me how that checklist stands',expected_revision:revision,idempotency_key:randomUUID()};
    const save=VoiceService.saveAssistantTurn;
    VoiceService.saveAssistantTurn=(...args:Parameters<typeof save>)=>{if(args[0].idempotency_key===recoveryInput.idempotency_key)throw new Error('simulated lost final display commit');return save.apply(VoiceService,args);};
    try{assert.equal((await post(recoveryInput)).status,409);}finally{VoiceService.saveAssistantTurn=save;}
    const recoveryCalls=calls;const restored=await post(recoveryInput);revision=restored.data.revision;
    check('saved semantic result recovers without redoing model or tools',()=>{assert.equal(restored.status,200);assert.equal(calls,recoveryCalls);assert.match(restored.data.speech,/completed/);});
    check('semantic traces omit dialogue and raw provider errors',()=>{
      const logs=db.prepare("SELECT details FROM audit_log WHERE action IN ('VOICE:SEMANTIC_TOOL','LLM:VOICE_CONVERSATION') AND target_resource=?").all(`voice:${session}`);
      assert(logs.length>10);assert(!JSON.stringify(logs).includes('fixture-sensitive'));assert(!JSON.stringify(logs).includes('not feeling well'));
    });
    const rejectedReplies=[
      'The patient has a latex allergy.',
      'He has no allergies.',
      'James is doing well.',
      'james is doing well.',
      'You have a documented sensitivity.',
      'The task is completed.',
      'I cannot access the chart. I recommend a medication treatment.',
      'I cannot see it, but increase the medication dose.',
      'I cannot recommend treatment. Increase the medication dose.',
      'I do not know; start the medication treatment.'
    ];
    const beforeUnsafeEvents=(db.prepare('SELECT count(*) n FROM task_events').get()as any).n;
    for(const viaTool of [false,true])for(const speech of rejectedReplies) {
      generatedReply={speech,kind:'CONVERSATION',viaTool};
      const rejected=await say('Please answer my question');
      check(`unsafe or unsourced reply is blocked through ${viaTool?'reply tool':'direct speech'}: ${rejectedReplies.indexOf(speech)}`,()=>{
        assert.equal(modelStatus(),'FAILED');assert.doesNotMatch(rejected.speech,/latex allergy|James is doing well|Increase the medication dose|recommend a medication treatment/i);
        assert.notEqual(rejected.speech,speech);
      });
    }
    generatedReply={speech:'The patient has a latex allergy.',kind:'REFUSAL',viaTool:true,readFirst:true};
    await say('Please check again');
    check('reply kind and context-only reads do not authorize unsourced patient claims',()=>assert.equal(modelStatus(),'FAILED'));
    for(const speech of ["I'm sorry you're not feeling well. What would you like help with?",'Which patient do you mean?',
      'I cannot recommend treatment. Please ask your clinical team.',"I don't have verified patient information."]) {
      generatedReply={speech,kind:'CONVERSATION',viaTool:true};
      const accepted=await say('Can you help me?');
      check(`safe general reply remains available: ${speech}`,()=>{assert.equal(modelStatus(),'SUCCESS');assert.equal(accepted.speech,speech);});
    }
    check('response validation never modifies task records',()=>assert.equal((db.prepare('SELECT count(*) n FROM task_events').get()as any).n,beforeUnsafeEvents));
    check('backend facts require exact matching evidence and allow sourced clinical context',()=>{
      const fact='The patient has a latex allergy.';
      assert.doesNotThrow(()=>validateReply(`Here is what I found. ${fact}`,[fact],fact));
      assert.throws(()=>validateReply(fact,[fact],'No verified allergy records are available.'),/matching source evidence/);
      assert.throws(()=>validateReply(`${fact} I cannot see the chart. Increase the medication dose.`,[fact],fact),/Clinical advice/);
      assert.throws(()=>validateReply('Do not increase the medication dose.',[]),/Clinical advice/);
    });
    check('source-backed patient headings and neutral Bedrock transitions pass without weakening fact validation',()=>{
      const source='You have 1 assigned task. Review transport for Dr. Rowan Demo is pending. Location not verified.';
      const reply=composeRecordReply("Here's the breakdown. For Dr. Rowan Demo: {{fact:1}} And one more thing — {{fact:0}}",['fact:1','fact:0'],source);
      assert.match(reply.speech,/Review transport for Dr\. Rowan Demo is pending\./);
      assert.match(reply.speech,/Location not verified/);
      assert.doesNotThrow(()=>validateReply(reply.speech,reply.evidence,source));
      assert.throws(()=>composeRecordReply('For Invented Patient: {{fact:1}}',['fact:1'],source),/matching source evidence/);
      for(const addition of [' The patient has a latex allergy.',' The task is completed.',' Here is the breakdown: increase the medication dose.',' You have 9 tasks.']){
        const unsafe=composeRecordReply(`{{fact:1}}${addition}`,['fact:1'],source);
        assert.throws(()=>validateReply(unsafe.speech,unsafe.evidence,source));
      }
    });
    generatedReply=undefined;mode='intent';
    const compoundInput={session_id:randomUUID(),utterance:'Hii I am Maya and Nora left off so I want to know about my tasks',expected_revision:0,idempotency_key:randomUUID()};
    intent={intent:'IDENTIFY',nurse_name:'Maya',continue_request:true};continuationIntent={intent:'TASKS',status:'ALL'};
    const compound=await post(compoundInput);
    check('introduction plus task question completes both parts in one voice turn',()=>{
      assert.equal(compound.status,200);assert.equal(compound.data.nurse.id,'voice_maya');
      assert.match(compound.data.speech,/Review documented shift checklist/);assert.doesNotMatch(compound.data.speech,/What can I help/);
      assert.equal(compound.data.messages.filter((m:any)=>m.role==='nurse'&&m.text===compoundInput.utterance).length,1);
      assert.equal(compound.data.pending,null);
    });
    const compoundCalls=calls;assert.deepEqual(await post(compoundInput),compound);
    check('combined introduction retry reuses both saved operations',()=>assert.equal(calls,compoundCalls));
    check('mentioning a departing nurse does not change task custody',()=>assert.equal((db.prepare('SELECT count(*) n FROM task_events').get()as any).n,beforeUnsafeEvents));
    const patientId=(db.prepare('SELECT patient_id FROM tasks WHERE id=?').get(taskId)as {patient_id:string}).patient_id;
    continuationIntent={intent:'PATIENT',patient_id:patientId};
    const combinedPatientInput={...compoundInput,session_id:randomUUID(),utterance:'Hi I am Maya, tell me the latest information about my patient',idempotency_key:randomUUID()};
    const combinedPatient=await post(combinedPatientInput);
    check('introduction plus patient question also continues into a sourced answer',()=>{
      assert.equal(combinedPatient.status,200);assert.equal(combinedPatient.data.nurse.id,'voice_maya');
      assert.equal((CheckpointService.getLatestCheckpoint(`voice:${combinedPatientInput.session_id}`)?.statePayload.voice as any)?.selectedPatientId,patientId);
      assert.match(combinedPatient.data.speech,/Demo Patient/);assert.doesNotMatch(combinedPatient.data.speech,/What can I help|couldn’t verify|Bedrock right now/);
    });
    continuationIntent={intent:'STATUS',task_id:taskId,status:'PENDING'};
    const combinedUpdate=await post({...compoundInput,session_id:randomUUID(),utterance:'Hi I am Maya, set my checklist to pending',idempotency_key:randomUUID()});
    check('introduction plus update still stages human confirmation without a write',()=>{
      assert.equal(combinedUpdate.status,200);assert.equal(combinedUpdate.data.pending.ready,true);
      assert.equal((db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId)as any).status,'COMPLETED');
      assert.equal((db.prepare('SELECT count(*) n FROM task_events').get()as any).n,beforeUnsafeEvents);
    });
    intent={intent:'IDENTIFY',nurse_name:'Unknown Nurse',continue_request:true};
    const unknown=await post({...compoundInput,session_id:randomUUID(),utterance:'Hi I am Unknown Nurse and show my tasks',idempotency_key:randomUUID()});
    check('failed combined identification reveals no records or follow-up results',()=>{
      assert.equal(unknown.status,200);assert.equal(unknown.data.nurse,null);assert.deepEqual(unknown.data.tasks,[]);assert.match(unknown.data.speech,/couldn’t find that name/);
    });
    intent={intent:'IDENTIFY',nurse_name:'Maya',continue_request:true};continuationIntent={intent:'TASK',task_id:taskId};
    const combinedRecovery={...compoundInput,session_id:randomUUID(),utterance:'I am Maya, did that checklist get done?',idempotency_key:randomUUID()};
    VoiceService.saveAssistantTurn=(...args:Parameters<typeof save>)=>{if(args[0].idempotency_key===combinedRecovery.idempotency_key)throw new Error('simulated lost combined response');return save.apply(VoiceService,args);};
    try{assert.equal((await post(combinedRecovery)).status,409);}finally{VoiceService.saveAssistantTurn=save;}
    const combinedCalls=calls, recovered=await post(combinedRecovery);
    check('combined introduction recovers its final answer without repeating identification or reads',()=>{
      assert.equal(recovered.status,200);assert.equal(calls,combinedCalls);assert.match(recovered.data.speech,/completed/);
      assert.equal(recovered.data.messages.filter((m:any)=>m.role==='nurse').length,1);
    });
    db.prepare("INSERT INTO nurses(id,badge_number,full_name,email,department) VALUES('voice_harper','VOICE-HARPER','Harper Lane','harper@example.test','VOICE')").run();
    intent={intent:'HANDOFF',source_nurse_name:'Lane'};
    const priorHandoffs=db.prepare('SELECT * FROM handoffs ORDER BY id').all();
    const priorAssignments=db.prepare('SELECT * FROM task_assignments ORDER BY id').all();
    const beforeMissingCalls=calls;
    const missing=await say('Lane has left. Where did they leave off?');
    check('missing handoff returns grounded guidance without a model rewrite or identity switch',()=>{
      assert.equal(missing.nurse.id,'voice_maya');assert.match(missing.speech,/saved handoff from Harper Lane/);
      assert.match(missing.speech,/assigned tasks/);assert.doesNotMatch(missing.speech,/couldn.t generate|say .prepare|Please give the nurse/i);
      assert.equal(calls-beforeMissingCalls,1);assert.equal(modelStatus(),'SUCCESS');
    });
    const followed=await say('Harper Lane');
    check('surname and full-name colleague follow-ups preserve the speaker and source reference',()=>{
      assert.equal(followed.nurse.id,'voice_maya');assert.match(followed.speech,/Harper Lane/);
      assert.equal(VoiceService.agentContext(session).handoffSourceNurseId,'voice_harper');
    });
    invalidNameOnce=true;
    const repaired=await say('Harper Lane is the nurse who left');
    check('invalid model name gets one durable repair instead of trapping the nurse in a name loop',()=>{
      assert.equal(repaired.nurse.id,'voice_maya');assert.match(repaired.speech,/Harper Lane/);assert.equal(modelStatus(),'SUCCESS');
    });
    intent={intent:'HANDOFF',source_nurse_name:'Test'};
    const ambiguous=await say('Test');
    check('ambiguous colleague surname asks for clarification without guessing or transferring custody',()=>{
      assert.match(ambiguous.speech,/More than one nurse/);assert.equal(ambiguous.nurse.id,'voice_maya');
      assert.deepEqual(db.prepare('SELECT * FROM handoffs ORDER BY id').all(),priorHandoffs);
      assert.deepEqual(db.prepare('SELECT * FROM task_assignments ORDER BY id').all(),priorAssignments);
    });
    const availableHandoff=VoiceService.read(session).handoffs[0];assert(availableHandoff);
    intent={intent:'HANDOFF',handoff_id:availableHandoff.id};
    const explicitHandoff=await say(`Review handoff ${availableHandoff.id}`);
    check('explicit scoped handoff selection replaces a previous missing-source filter',()=>{
      assert.equal(explicitHandoff.selectedHandoffId,availableHandoff.id);assert.match(explicitHandoff.speech,/Handoff from/);
    });
  }finally{BedrockLLMProvider.prototype.decideNextStep=original;if(originalProvider===undefined)delete process.env.LLM_PROVIDER;else process.env.LLM_PROVIDER=originalProvider;}
}
