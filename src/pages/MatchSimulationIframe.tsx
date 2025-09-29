import { useEffect, useRef, useState } from 'react';
import type { MatchBridgeAPI } from '@/services/unityBridge';

function waitForIframeBridge(win: Window & { MatchBridgeAPI?: MatchBridgeAPI }, timeoutMs = 15000): Promise<MatchBridgeAPI> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      const api = win.MatchBridgeAPI;
      if (api && (typeof api.sendTeams === "function" || typeof api.showTeams === "function")) return resolve(api);
      if (Date.now() - start > timeoutMs) return reject(new Error('MatchBridgeAPI timeout'));
      requestAnimationFrame(check);
    }
    check();
  });
}

export default function MatchSimulationIframe() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [api, setApi] = useState<MatchBridgeAPI | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const cw = iframe.contentWindow;
    if (!cw) return;

    (cw as any).onUnityReady = () => {
      waitForIframeBridge(cw as Window & { MatchBridgeAPI?: MatchBridgeAPI })
        .then(setApi)
        .catch(console.error);
    };
    waitForIframeBridge(cw as Window & { MatchBridgeAPI?: MatchBridgeAPI }).then(setApi).catch(() => {});
  }, []);

  useEffect(() => {
    function onFinish(ev: any) {
      console.log('Match finished (iframe):', ev.detail);
    }
    window.addEventListener('unityMatchFinished', onFinish);
    return () => window.removeEventListener('unityMatchFinished', onFinish);
  }, []);

  function sendTeams() {
    if (!api || typeof api.sendTeams !== "function") return;
    api.sendTeams(JSON.stringify({ home: [], away: [], autoStart: true }));
  }

  return (
    <div className="p-4">
      <iframe
        ref={iframeRef}
        src="/Unity/match-viewer/index.html"
        className="w-full h-[720px] border rounded"
      />
      <button onClick={sendTeams} disabled={!api} className="mt-2">
        Send Teams
      </button>
    </div>
  );
}
