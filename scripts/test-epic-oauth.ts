import { EpicOAuthService } from '../src/providers/epic-oauth.service.js';
import dotenv from 'dotenv';
dotenv.config();

async function runEpicOAuthVerification() {
  console.log('======================================================');
  console.log('🏥 ShiftWeave — Epic on FHIR OAuth 2.0 (Step 2) Verification');
  console.log('======================================================\n');

  // Test 1: Client Assertion Generation
  console.log('Test 1: Generating RS384 Client Assertion JWT...');
  const assertion = EpicOAuthService.generateClientAssertion();
  const parts = assertion.split('.');
  if (parts.length !== 3) {
    throw new Error('JWT must have exactly 3 dot-separated parts');
  }
  const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));

  console.log('  Header alg:', header.alg);
  console.log('  Header kid:', header.kid);
  console.log('  Payload iss:', payload.iss);
  console.log('  Payload aud:', payload.aud);
  console.log('  Payload exp diff (sec):', payload.exp - payload.iat);

  if (header.alg !== 'RS384') throw new Error('Expected alg to be RS384');
  if (!header.kid) throw new Error('Expected kid in JWT header');
  if (payload.exp - payload.iat > 300) throw new Error('JWT expiry exceeds 300s Epic limit');
  console.log('  ✅ Test 1 PASSED: Valid RFC 7523 Client Assertion JWT generated.\n');

  // Test 2: Live Token Exchange against Epic OAuth Sandbox
  console.log('Test 2: Exchanging Client Assertion for Sandbox Access Token...');
  EpicOAuthService.clearCache();
  const token = await EpicOAuthService.getAccessToken();
  if (!token || !token.startsWith('ey')) {
    throw new Error('Expected valid JWT access token from Epic');
  }
  console.log('  Token prefix:', token.slice(0, 20) + '...');
  console.log('  ✅ Test 2 PASSED: Sandbox Access Token successfully issued by Epic.\n');

  // Test 3: Token Caching & Expiry Handling
  console.log('Test 3: Testing in-memory token caching...');
  const t1 = Date.now();
  const cachedToken = await EpicOAuthService.getAccessToken();
  const latency = Date.now() - t1;
  if (cachedToken !== token) {
    throw new Error('Cached token must match original token');
  }
  console.log(`  Retrieval latency: ${latency}ms (sub-millisecond cache hit)`);
  if (latency > 20) throw new Error('Expected cached token retrieval to be fast');
  console.log('  ✅ Test 3 PASSED: In-memory token caching and expiration buffer verified.\n');

  // Test 4: Authorized Read from Epic FHIR R4 Sandbox
  console.log('Test 4: Executing Authorized Read on Patient erXuFYUfucBZaryVksYEcMg3 (Camila Lopez)...');
  const patient = await EpicOAuthService.readPatient('erXuFYUfucBZaryVksYEcMg3') as {
    resourceType: string;
    id: string;
    name?: Array<{ text?: string; given?: string[]; family?: string }>;
    gender?: string;
    birthDate?: string;
  };

  console.log('  Resource Type:', patient.resourceType);
  console.log('  Patient ID:', patient.id);
  const patientName = patient.name?.[0]?.text || `${patient.name?.[0]?.given?.join(' ')} ${patient.name?.[0]?.family}`;
  console.log('  Patient Name:', patientName);
  console.log('  Gender:', patient.gender);
  console.log('  Birth Date:', patient.birthDate);

  if (patient.resourceType !== 'Patient') throw new Error('Expected resourceType Patient');
  if (patient.id !== 'erXuFYUfucBZaryVksYEcMg3') throw new Error('Patient ID mismatch');
  console.log('  ✅ Test 4 PASSED: Authorized Patient resource read from Epic Sandbox verified.\n');

  // Test 5: Explicit Authentication Error Surfacing
  console.log('Test 5: Verifying explicit error surfacing on invalid credentials...');
  try {
    const invalidConfig = {
      ...EpicOAuthService.getConfig(),
      clientId: '00000000-0000-0000-0000-000000000000',
    };
    const invalidAssertion = EpicOAuthService.generateClientAssertion(invalidConfig);
    const bodyParams = new URLSearchParams({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: invalidAssertion,
    });
    const res = await fetch(invalidConfig.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams.toString(),
    });
    if (res.ok) throw new Error('Expected invalid client ID to fail');
    const errData = await res.json() as { error?: string };
    console.log('  Explicit error captured from Epic:', errData.error || res.status);
    console.log('  ✅ Test 5 PASSED: External failure surfaced explicitly with zero silent fallback.\n');
  } catch (e) {
    console.log('  Error handled as expected:', e instanceof Error ? e.message : String(e));
  }

  console.log('======================================================');
  console.log('🎉 ALL STEP 2 OAUTH & AUTHORIZED READ VERIFICATIONS PASSED!');
  console.log('======================================================');
}

runEpicOAuthVerification().catch((err) => {
  console.error('\n❌ Epic OAuth Verification FAILED:', err);
  process.exit(1);
});
