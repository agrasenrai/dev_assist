import { useEffect, useState } from 'react';
import { OneThreadWorkspace } from './components/OneThreadWorkspace.js';
import { WorkspaceEntry } from './components/OperationalWorkspace.js';
import { staffRequest, type Staff } from './operational-api.js';
import { startFreshVoiceSession } from './voice-api.js';
import { SimulationWorkspace } from './components/SimulationWorkspace.js';

function VoiceEntry() {
  const [ready, setReady] = useState(false);
  const [staff, setStaff] = useState<Staff>();
  const [error, setError] = useState('');
  useEffect(() => {
    startFreshVoiceSession();
    let disposed = false;
    void (async () => {
      try {
        const config = await staffRequest('/api/staff/config');
        if (disposed) return;
        if (config.required) {
          const result = await staffRequest('/api/staff/me');
          if (disposed) return;
          if (!result.principal) throw new Error('Your existing staff sign-in is required to access voice records.');
          setStaff(result.principal);
        }
      } catch (error) {
        if (!disposed) setError(error instanceof Error ? error.message : String(error));
      } finally { if (!disposed) setReady(true); }
    })();
    return () => { disposed = true; };
  }, []);
  if (!ready) return <p role="status">Opening voice workspace…</p>;
  return <><OneThreadWorkspace authenticatedStaff={staff}/>{error && <p className="voice-entry-error" role="alert">{error} <a href="/staff">Sign in</a></p>}</>;
}

export function App() {
  const [simulation,setSimulation]=useState(false);
  useEffect(()=>{if(window.location.pathname!=='/staff')void fetch('/api/simulations').then(r=>r.ok?r.json():{}).then((c:{enabled?:boolean;hosted?:boolean})=>setSimulation(c.enabled===true&&(!c.hosted||new URLSearchParams(window.location.search).get('workspace')==='simulations'))).catch(()=>{});},[]);
  if(simulation && new URLSearchParams(window.location.search).get('workspace')!=='voice')return <SimulationWorkspace/>;
  return window.location.pathname === '/staff' ? <WorkspaceEntry/> : <VoiceEntry/>;
}
export default App;
