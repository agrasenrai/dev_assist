import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export type SourceRealm='epic'|'preview'|'legacy';
export const sourceContext=new AsyncLocalStorage<SourceRealm>();
export const sourceRealm=():SourceRealm=>sourceContext.getStore()||'legacy';
// Private server-to-server capability. Never returned to browsers or external assistants.
// Test workers inherit it; normal deployments generate a fresh key at process start.
const capability=process.env.SHIFTWEAVE_TEST==='1'&&process.env.SHIFTWEAVE_TEST_SOURCE_CAPABILITY
  ?process.env.SHIFTWEAVE_TEST_SOURCE_CAPABILITY:randomBytes(32).toString('hex');
if(process.env.SHIFTWEAVE_TEST==='1')process.env.SHIFTWEAVE_TEST_SOURCE_CAPABILITY=capability;
export function internalSourceHeaders(realm:SourceRealm) {return {'x-shiftweave-source':realm,'x-shiftweave-source-capability':capability};}
export function trustedSource(headers:Record<string,unknown>):SourceRealm|undefined {
  const value=String(headers['x-shiftweave-source-capability']||'');const a=Buffer.from(value),b=Buffer.from(capability);
  if(a.length!==b.length||!timingSafeEqual(a,b))return undefined;
  const realm=headers['x-shiftweave-source'];return realm==='epic'||realm==='preview'||realm==='legacy'?realm:undefined;
}
