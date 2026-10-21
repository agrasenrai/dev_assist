import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BedrockLLMProvider, type AgentMessage } from '../src/agent/llm-provider.js';
import { db } from '../src/db/connection.js';
import { CheckpointService } from '../src/services/checkpoint.service.js';

/** Stub the existing adapter, not the HTTP/MCP gateway or durable voice service. */
export async function verifyVoiceConversation(base:string,check:(name:string,action:()=>unknown)=>void) {
  const original = BedrockLLMProvider.prototype.decideNextStep;
  const originalProvider = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = 'bedrock';
  const session = randomUUID(); let revision=0; let calls=0; let lastMessages:AgentMessage[]=[];
  let mode:'reply'|'failure'|'tool' = 'reply';
  BedrockLLMProvider.prototype.decideNextStep = async (messages,tools,context) => {
    calls++; lastMessages=messages;
    assert.deepEqual(tools,[]); assert.equal(context?.voiceConversation,true);
    if(mode==='failure') throw new Error('fixture-sensitive-provider-error');
    if(mode==='tool') return {toolCall:{toolName:'acknowledge_task',arguments:{}}};
    return {finalSpeech:messages.at(-1)!.content.includes("don't like")
      ? "I understand. I'll give you some space, and I'm here when you want to talk."
      : "I'm sorry you're not feeling well. Would you like to tell me what would help right now?"};
  };
  const post=async(input:unknown)=>{const response=await fetch(base+'/api/voice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(response.status,200);return response.json();};
  const say=async(utterance:string)=>{const result=await post({session_id:session,utterance,expected_revision:revision,idempotency_key:randomUUID()});revision=result.revision;return result;};
  try {
    const input={session_id:session,utterance:'can you do that one thing for me I am just not feeling well',expected_revision:0,idempotency_key:randomUUID()};
    const first=await post(input);revision=first.revision;
    check('ordinary voice conversation calls the configured LLM without a nurse introduction',()=>{
      assert.equal(calls,1);assert.match(first.speech,/not feeling well/);assert.equal(first.nurse,null);
      assert.doesNotMatch(first.speech,/match that name|registered nurse/);
    });
    const retry=await post(input);
    check('conversation retry reuses the committed model response without a second model call',()=>{assert.deepEqual(retry,first);assert.equal(calls,1);});
    const second=await say("okay I don't like to talk to you");
    check('free conversation follows durable dialogue context instead of repeating the name prompt',()=>{
      assert.equal(calls,2);assert.match(second.speech,/space/);
      assert.equal(lastMessages[0]!.content,input.utterance);assert.equal(lastMessages[1]!.content,first.speech);
      assert.equal((CheckpointService.getLatestCheckpoint(`voice:${session}`)?.statePayload.conversationModel as {status:string}|undefined)?.status,'SUCCESS');
    });
    await say('I am Seema');
    check('explicit nurse introduction still uses real profile validation rather than model authority',()=>assert.equal(calls,2));
    await say('I am tired today');
    check('a feeling at the start of a sentence does not clear the selected nurse',()=>{
      assert.equal(calls,3);assert(!lastMessages.some(message=>/assigned tasks|source records|Room 10[12]/.test(message.content)));
    });
    mode='failure';const failed=await say('Can we just talk for a moment?');
    check('model failure is explicit and never silently replaced by a fake successful reply',()=>{
      assert.match(failed.speech,/couldn't reach my conversation model/);assert.doesNotMatch(failed.speech,/fixture-sensitive/);
      assert.equal((CheckpointService.getLatestCheckpoint(`voice:${session}`)?.statePayload.conversationModel as {status:string}|undefined)?.status,'FAILED');
    });
    const events=(db.prepare('SELECT count(*) n FROM task_events').get()as any).n;
    mode='tool';const tool=await say('Do that one thing for me please');
    check('conversation model cannot execute or fabricate unsupported backend actions',()=>{
      assert.match(tool.speech,/No records were changed/);assert.equal((db.prepare('SELECT count(*) n FROM task_events').get()as any).n,events);
    });
    check('model execution trace records the provider without dialogue or sensitive provider errors',()=>{
      const logs=db.prepare("SELECT details FROM audit_log WHERE action='LLM:VOICE_CONVERSATION' AND target_resource=?").all(`voice:${session}`);
      assert(logs.length>=4);assert(!JSON.stringify(logs).includes('fixture-sensitive'));assert(!JSON.stringify(logs).includes('not feeling well'));
    });
  } finally {
    BedrockLLMProvider.prototype.decideNextStep=original;
    if(originalProvider===undefined)delete process.env.LLM_PROVIDER;else process.env.LLM_PROVIDER=originalProvider;
  }
}
