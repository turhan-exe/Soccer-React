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
    <div className="flex min-h-screen w-full flex-col gap-4 overflow-x-hidden p-4 sm:p-6">
      <div className="flex w-full flex-col gap-4">
        <div className="aspect-[16/9] w-full min-h-[360px] overflow-hidden rounded-xl border bg-black sm:min-h-[420px] md:min-h-[520px]">
          <iframe
            ref={iframeRef}
            src="/Unity/match-viewer/index.html"
            className="h-full w-full"
          />
        </div>
        <button
          onClick={sendTeams}
          disabled={!api}
          className="self-start rounded border border-primary px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Send Teams
        </button>
      </div>
    </div>
  );
}
