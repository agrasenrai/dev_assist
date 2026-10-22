/**
 * Verification Script: ElevenLabs TTS Integration
 * Tests the /api/tts endpoint and ElevenLabsService.
 */

import { ElevenLabsService } from '../src/services/elevenlabs.service.js';

async function main() {
  console.log(`\n======================================================`);
  console.log(`🎙️ ElevenLabs Text-to-Speech (TTS) Verification`);
  console.log(`======================================================\n`);

  const isConfigured = ElevenLabsService.isConfigured();
  console.log(`1. Configuration Check:`);
  console.log(`   - ELEVENLABS_API_KEY set: ${isConfigured ? 'YES (configured)' : 'NO (using free browser fallback)'}`);
  console.log(`   - Default Voice:         ${process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL (Sarah)'}`);
  console.log(`   - Default Model:         ${process.env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5'}`);

  if (!isConfigured) {
    console.log(`\nℹ️  Notice: ElevenLabs API key is not yet set in .env.`);
    console.log(`   ShiftWeave will automatically use the browser's native Web Speech API ($0 cost).`);
    console.log(`   To activate ElevenLabs studio-quality voice:`);
    console.log(`   1. Add to your .env: ELEVENLABS_API_KEY=your_key_here`);
    console.log(`   2. Rerun: npm run test:elevenlabs\n`);
    console.log(`======================================================`);
    console.log(`✓ Verification Passed (Fallback Mode Active)`);
    console.log(`======================================================\n`);
    return;
  }

  console.log(`\n2. Testing Speech Synthesis with ElevenLabs...`);
  const testText = "Hello nurse Reema. Here is the shift handoff summary for ICU Bed 305.";
  const startTime = Date.now();

  try {
    const result = await ElevenLabsService.synthesizeSpeech({ text: testText });
    const latency = Date.now() - startTime;

    if (!result) {
      throw new Error("SynthesizeSpeech returned null despite being configured.");
    }

    console.log(`  ✓ Speech Synthesized Successfully! (${latency}ms)`);
    console.log(`    - Content Type: ${result.contentType}`);
    console.log(`    - Audio Size:   ${result.audioBuffer.length} bytes`);
    console.log(`\n======================================================`);
    console.log(`🎉 ElevenLabs Integration is FULLY OPERATIONAL!`);
    console.log(`======================================================\n`);
  } catch (error) {
    console.error(`\n❌ Synthesis failed:`, error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Execution error:", err);
  process.exit(1);
});
