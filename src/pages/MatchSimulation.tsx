import { useEffect, useState } from 'react';
import { waitForMatchBridgeAPI, type MatchBridgeAPI } from '@/services/unityBridge';

export default function MatchSimulation() {
  const [api, setApi] = useState<MatchBridgeAPI | null>(null);

  useEffect(() => {
    const handleReady = () => {
      waitForMatchBridgeAPI().then(setApi).catch(console.error);
    };
    (window as any).onUnityReady = handleReady;
    waitForMatchBridgeAPI().then(setApi).catch(() => {});
    return () => {
      if ((window as any).onUnityReady === handleReady) {
        delete (window as any).onUnityReady;
      }
    };
  }, []);

  useEffect(() => {
    function onFinish(ev: any) {
      const resultJson = ev.detail;
      try {
        const result = JSON.parse(resultJson);
        console.log('Match finished:', result);
      } catch {
        console.log('Match finished (raw):', resultJson);
      }
    }
    window.addEventListener('unityMatchFinished', onFinish);
    return () => window.removeEventListener('unityMatchFinished', onFinish);
  }, []);

  function sendTeams() {
    if (!api || typeof api.sendTeams !== 'function') return;
    const payload = {
      formationHome: '4-3-3',
      formationAway: '4-2-3-1',
      autoStart: true,
      home: [
        { id: 'H1', name: 'GK A', pos: 'GK', overall: 80 },
        { id: 'H9', name: 'ST A', pos: 'ST', overall: 85 }
      ],
      away: [
        { id: 'A1', name: 'GK B', pos: 'GK', overall: 78 },
        { id: 'A9', name: 'ST B', pos: 'ST', overall: 83 }
      ]
    };
    api.sendTeams(JSON.stringify(payload));
  }

  return (
    <div className="p-4">
      <button onClick={sendTeams} disabled={!api}>
        Send Teams & Start
      </button>
    </div>
  );
}
