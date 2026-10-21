import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BedrockLLMProvider, type AgentMessage } from '../src/agent/llm-provider.js';
import { db } from '../src/db/connection.js';
import { CheckpointService } from '../src/services/checkpoint.service.js';
import { VoiceService, type VoiceIntent } from '../src/services/voice.service.js';

/** Adapter fixtures exercise real HTTP/MCP and durable services; live inference is checked separately. */
export async function verifyVoiceConversation(base:string,check:(name:string,action:()=>unknown)=>void) {
  const original=BedrockLLMProvider.prototype.decideNextStep, originalProvider=process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER='bedrock';
  const session=randomUUID();let revision=0,calls=0;let lastMessages:AgentMessage[]=[];
  let intent:VoiceIntent|undefined;
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
    const steps=messages.slice(userIndex+1).filter(m=>m.role==='tool');
    if(mode==='chat')return{finalSpeech:utterance.includes("don't like")?"I understand. I'll give you some space."
      :utterance.includes('confused')?"That's okay. We can take it one step at a time."
      :"I'm sorry you're not feeling well. What would you like help with?"};
    if(intent?.intent==='IDENTIFY')return{toolCall:{toolName:'interpret_voice_request',arguments:intent}};
    if(!steps.some(m=>m.toolName==='read_voice_context'))return{toolCall:{toolName:'read_voice_context',arguments:{}}};
    const result=steps.find(m=>m.toolName==='interpret_voice_request');
    if(!result)return{toolCall:{toolName:'interpret_voice_request',arguments:intent!}};
    const facts=JSON.parse(result.content).facts as Array<{id:string;text:string}>;
    if(mode==='source-change')db.prepare("UPDATE tasks SET priority=CASE WHEN priority='STAT' THEN 'URGENT' ELSE 'STAT' END WHERE id=?").run(taskId);
    return{toolCall:{toolName:'reply_to_nurse',arguments:{kind:'RECORDS',speech:`Here’s what I found. ${facts.map(f=>`{{${f.id}}}`).join(' ')}${mode==='fabricate'?' The task is completed.':''}`,evidence:facts.map(f=>f.id)}}};
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
    const beforeWake=calls;const awake=await say('Alexa');
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
  }finally{BedrockLLMProvider.prototype.decideNextStep=original;if(originalProvider===undefined)delete process.env.LLM_PROVIDER;else process.env.LLM_PROVIDER=originalProvider;}
}
