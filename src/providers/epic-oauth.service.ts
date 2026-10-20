import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AuditService } from '../services/audit.service.js';

export interface EpicTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface CachedToken {
  accessToken: string;
  tokenType: string;
  expiresAtMs: number;
  scope: string;
}

export interface EpicOAuthConfig {
  clientId: string;
  tokenUrl: string;
  fhirBaseUrl: string;
  privateKeyPath: string;
  privateKeyPassphrase?: string | undefined;
  keyId: string;
}

/**
 * Epic on FHIR Backend Systems OAuth 2.0 Client (RFC 7523)
 * Handles RS384 Client Assertion JWT signing, token exchange, caching/expiry,
 * and authorized FHIR R4 resource retrieval with explicit failure surfacing.
 */
export class EpicOAuthService {
  private static cachedToken: CachedToken | null = null;

  static getConfig(): EpicOAuthConfig {
    const clientId = process.env.EPIC_CLIENT_ID;
    const tokenUrl = process.env.EPIC_TOKEN_URL || 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
    const fhirBaseUrl = process.env.EPIC_FHIR_BASE_URL || 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4';
    const privateKeyPath = process.env.PRIVATE_KEY_PATH || './keys/private_key.pem';
    const privateKeyPassphrase = process.env.PRIVATE_KEY_PASSPHRASE;
    const keyId = process.env.EPIC_KID || '691586d6-d0fe-4efc-800d-d5316d69128c';

    if (!clientId) {
      throw new Error('EPIC_CLIENT_ID is not configured in server environment');
    }
    const resolvedKeyPath = path.resolve(process.cwd(), privateKeyPath);
    if (!fs.existsSync(resolvedKeyPath)) {
      throw new Error(`Private key file not found at: ${resolvedKeyPath}`);
    }

    return {
      clientId,
      tokenUrl,
      fhirBaseUrl,
      privateKeyPath: resolvedKeyPath,
      privateKeyPassphrase,
      keyId,
    };
  }

  /**
   * Generates a signed RFC 7523 Client Assertion JWT using RS384.
   * Header: { alg: "RS384", typ: "JWT", kid: keyId }
   * Payload: { iss, sub, aud, jti, exp, nbf, iat }
   */
  static generateClientAssertion(config = this.getConfig()): string {
    const keyPem = fs.readFileSync(config.privateKeyPath, 'utf8');

    let privateKey: crypto.KeyObject;
    try {
      privateKey = crypto.createPrivateKey({
        key: keyPem,
        format: 'pem',
        passphrase: config.privateKeyPassphrase,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to decrypt private key for Epic assertion: ${msg}`);
    }

    const header = {
      alg: 'RS384',
      typ: 'JWT',
      kid: config.keyId,
    };

    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      iss: config.clientId,
      sub: config.clientId,
      aud: config.tokenUrl,
      jti: crypto.randomUUID(),
      exp: nowSec + 300, // Epic requires <= 5 minutes
      nbf: nowSec,
      iat: nowSec,
    };

    const toBase64Url = (obj: Record<string, unknown>) =>
      Buffer.from(JSON.stringify(obj)).toString('base64url');

    const signingInput = `${toBase64Url(header)}.${toBase64Url(payload)}`;

    const signer = crypto.createSign('RSA-SHA384');
    signer.update(signingInput);
    const signature = signer.sign(privateKey, 'base64url');

    return `${signingInput}.${signature}`;
  }

  /**
   * Obtains a valid Epic sandbox OAuth 2.0 access token via Client Credentials grant.
   * Caches active token in-memory and refreshes 60 seconds before expiration.
   */
  static async getAccessToken(forceRefresh = false): Promise<string> {
    const now = Date.now();
    // Return cached token if valid (with 60-second safety window)
    if (!forceRefresh && this.cachedToken && this.cachedToken.expiresAtMs > now + 60000) {
      return this.cachedToken.accessToken;
    }

    const startTime = Date.now();
    const config = this.getConfig();
    const clientAssertion = this.generateClientAssertion(config);

    const bodyParams = new URLSearchParams({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion,
    });

    let response: Response;
    try {
      response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: bodyParams.toString(),
        signal: AbortSignal.timeout(15000),
      });
    } catch (netErr) {
      const msg = netErr instanceof Error ? netErr.message : String(netErr);
      AuditService.log({
        actorType: 'SYSTEM',
        actorId: 'epic_oauth',
        action: 'OAUTH:TOKEN_EXCHANGE',
        targetResource: config.tokenUrl,
        outcome: 'FAILURE',
        details: { error: msg },
        latencyMs: Date.now() - startTime,
      });
      throw new Error(`Epic OAuth token endpoint network failure: ${msg}`);
    }

    const rawText = await response.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { raw: rawText };
    }

    if (!response.ok) {
      const errCode = (data.error as string) || `HTTP_${response.status}`;
      const errDesc = (data.error_description as string) || rawText;
      AuditService.log({
        actorType: 'SYSTEM',
        actorId: 'epic_oauth',
        action: 'OAUTH:TOKEN_EXCHANGE',
        targetResource: config.tokenUrl,
        outcome: 'FAILURE',
        details: { error: errCode, description: errDesc },
        latencyMs: Date.now() - startTime,
      });
      throw new Error(`Epic OAuth token exchange failed (${response.status}): ${errCode} - ${errDesc}`);
    }

    const tokenResponse = data as unknown as EpicTokenResponse;
    const expiresInSec = Number(tokenResponse.expires_in) || 300;

    this.cachedToken = {
      accessToken: tokenResponse.access_token,
      tokenType: tokenResponse.token_type || 'Bearer',
      expiresAtMs: Date.now() + expiresInSec * 1000,
      scope: tokenResponse.scope || '',
    };

    AuditService.log({
      actorType: 'SYSTEM',
      actorId: 'epic_oauth',
      action: 'OAUTH:TOKEN_EXCHANGE',
      targetResource: config.tokenUrl,
      outcome: 'SUCCESS',
      details: {
        expiresIn: expiresInSec,
        scope: this.cachedToken.scope,
      },
      latencyMs: Date.now() - startTime,
    });

    return this.cachedToken.accessToken;
  }

  /**
   * Clears in-memory token cache (useful for testing or forced revocation).
   */
  static clearCache(): void {
    this.cachedToken = null;
  }

  /**
   * Executes an authorized FHIR R4 HTTP request against Epic sandbox.
   * Injects Bearer authorization header and surfaces explicit FHIR errors.
   */
  static async authorizedFetch<T = Record<string, unknown>>(
    resourcePath: string,
    options: RequestInit = {}
  ): Promise<T> {
    const config = this.getConfig();
    const token = await this.getAccessToken();

    const cleanPath = resourcePath.replace(/^\//, '');
    const fullUrl = cleanPath.startsWith('http')
      ? cleanPath
      : `${config.fhirBaseUrl.replace(/\/$/, '')}/${cleanPath}`;

    const headers = {
      Accept: 'application/fhir+json',
      ...options.headers,
      Authorization: `Bearer ${token}`,
    };

    const startTime = Date.now();
    let response: Response;
    try {
      response = await fetch(fullUrl, {
        ...options,
        headers,
        signal: options.signal || AbortSignal.timeout(20000),
      });
    } catch (netErr) {
      const msg = netErr instanceof Error ? netErr.message : String(netErr);
      AuditService.log({
        actorType: 'SYSTEM',
        actorId: 'epic_fhir',
        action: 'FHIR:READ',
        targetResource: cleanPath,
        outcome: 'FAILURE',
        details: { error: msg },
        latencyMs: Date.now() - startTime,
      });
      throw new Error(`Epic FHIR request failed: ${msg}`);
    }

    // Auto-refresh token if 401 Unauthorized returned
    if (response.status === 401) {
      AuditService.log({
        actorType: 'SYSTEM',
        actorId: 'epic_fhir',
        action: 'FHIR:UNAUTHORIZED_RETRY',
        targetResource: cleanPath,
        outcome: 'FAILURE',
        details: { status: 401 },
      });
      const freshToken = await this.getAccessToken(true);
      const retryHeaders = {
        ...headers,
        Authorization: `Bearer ${freshToken}`,
      };
      response = await fetch(fullUrl, {
        ...options,
        headers: retryHeaders,
        signal: options.signal || AbortSignal.timeout(20000),
      });
    }

    const responseText = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    if (!response.ok) {
      AuditService.log({
        actorType: 'SYSTEM',
        actorId: 'epic_fhir',
        action: 'FHIR:READ',
        targetResource: cleanPath,
        outcome: 'FAILURE',
        details: { status: response.status, body: data },
        latencyMs: Date.now() - startTime,
      });
      throw new Error(`Epic FHIR ${cleanPath} failed with HTTP ${response.status}: ${JSON.stringify(data)}`);
    }

    AuditService.log({
      actorType: 'SYSTEM',
      actorId: 'epic_fhir',
      action: 'FHIR:READ',
      targetResource: cleanPath,
      outcome: 'SUCCESS',
      details: {
        resourceType: (data as { resourceType?: string }).resourceType,
        id: (data as { id?: string }).id,
      },
      latencyMs: Date.now() - startTime,
    });

    return data as T;
  }

  /**
   * High-level typed helper to read an Epic Patient resource.
   */
  static async readPatient(patientId: string): Promise<Record<string, unknown>> {
    return this.authorizedFetch(`Patient/${encodeURIComponent(patientId)}`);
  }

  /**
   * High-level typed helper to read an Epic Encounter resource.
   */
  static async readEncounter(encounterId: string): Promise<Record<string, unknown>> {
    return this.authorizedFetch(`Encounter/${encodeURIComponent(encounterId)}`);
  }
}
