import dotenv from 'dotenv';
import { Readable } from 'node:stream';
dotenv.config();

export interface TTSOptions {
  text: string;
  voiceId?: string;
  modelId?: string;
}

export class ElevenLabsService {
  // Default Voice: 'EXAVITQu4vr4xnSDxMaL' (Sarah - mature, reassuring, confident clinical assistant)
  private static defaultVoiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
  // Default Model: 'eleven_flash_v2_5' for ultra-low latency conversational audio (<100ms)
  private static defaultModelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5';

  /**
   * Check if ElevenLabs TTS is configured via environment variables.
   */
  static isConfigured(): boolean {
    const key = process.env.ELEVENLABS_API_KEY;
    return Boolean(key && key.trim().length > 0 && !key.includes('your_elevenlabs_api_key'));
  }

  /**
   * Get configured Conversational AI Agent ID if available.
   */
  static getConvaiAgentId(): string | null {
    const id = process.env.ELEVENLABS_AGENT_ID;
    return id && id.trim().length > 0 ? id.trim() : null;
  }

  /**
   * Get signed WebSocket URL for ElevenLabs Conversational AI if configured.
   */
  static async getSignedConvaiUrl(): Promise<string | null> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId = this.getConvaiAgentId();
    if (!apiKey || !agentId) return null;

    try {
      const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`;
      const res = await fetch(url, {
        headers: { 'xi-api-key': apiKey.trim() }
      });
      if (!res.ok) return null;
      const data = await res.json() as { signed_url?: string };
      return data.signed_url || null;
    } catch {
      return null;
    }
  }

  /**
   * Stream text to speech using ElevenLabs API for instant audio playback.
   * Returns a Node readable stream piping audio chunks as they arrive.
   */
  static async streamSpeech(options: TTSOptions): Promise<{ stream: NodeJS.ReadableStream; contentType: string } | null> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey || !this.isConfigured()) {
      return null;
    }

    const voiceId = options.voiceId || this.defaultVoiceId;
    const modelId = options.modelId || this.defaultModelId;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey.trim(),
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: options.text,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs TTS stream failed (HTTP ${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('ElevenLabs TTS response body is empty');
    }

    return {
      stream: Readable.fromWeb(response.body as any),
      contentType: 'audio/mpeg'
    };
  }

  /**
   * Synthesize text to speech using ElevenLabs API.
   * Returns audio buffer and content-type, or null if unconfigured.
   */
  static async synthesizeSpeech(options: TTSOptions): Promise<{ audioBuffer: Buffer; contentType: string } | null> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey || !this.isConfigured()) {
      return null;
    }

    const voiceId = options.voiceId || this.defaultVoiceId;
    const modelId = options.modelId || this.defaultModelId;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey.trim(),
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: options.text,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs TTS failed (HTTP ${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      audioBuffer: Buffer.from(arrayBuffer),
      contentType: 'audio/mpeg'
    };
  }
}
