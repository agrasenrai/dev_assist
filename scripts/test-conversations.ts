import { VoiceService } from '../src/services/voice.service.js';
import { randomUUID } from 'crypto';

const session = randomUUID();

function testQuery(utterance: string) {
  const current = VoiceService.read(session);
  const res = VoiceService.turn({
    session_id: session,
    utterance,
    expected_revision: current.revision,
    idempotency_key: randomUUID()
  });
  console.log(`\n🗣️  Query:    "${utterance}"`);
  console.log(`🤖 Response: "${res.speech}"`);
}

console.log('======================================================');
console.log('Testing "Medi" Wake Word & Fast Flow');
console.log('======================================================');

testQuery("Medi");
testQuery("Medi what's your name");
testQuery("Medi what can you do");
testQuery("Hey Medi, how are you doing?");
testQuery("Medi, tell me about ShiftWeave");
testQuery("Medi I am Seema and show my tasks");
testQuery("thanks Medi");

console.log('\n======================================================');
console.log('Done testing Medi turns!');
console.log('======================================================');
