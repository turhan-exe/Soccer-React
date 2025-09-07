import React, { useEffect, useMemo, useRef, useState } from 'react';
import { prepareUnityIframeBridge, waitForMatchBridgeAPI, type BridgeMatchRequest, type BridgeMatchResult, type PublishTeamsPayload, type ShowTeamsPayload } from '@/services/unityBridge';
import { Card, CardContent } from '@/components/ui/card';

type Props = {
  title?: string;
  autoPayload?: BridgeMatchRequest | null;
  autoPublishPayload?: PublishTeamsPayload | null;
  autoShowTeamsPayload?: ShowTeamsPayload | null;
  onResult?: (result: BridgeMatchResult) => void;
};

/**
 * Embeds Unity WebGL and exposes a start button to send a BridgeMatchRequest
 * to Unity's C# MatchBridge.LoadMatchFromJSON. Also listens to
 * `unityMatchFinished` inside the iframe window and forwards results to React.
 */
export function UnityMatchLauncher({ title = 'Unity WebGL', autoPayload = null, autoPublishPayload = null, autoShowTeamsPayload = null, onResult }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [apiReady, setApiReady] = useState(false);
  const [lastResult, setLastResult] = useState<BridgeMatchResult | null>(null);
  const [bridge, setBridge] = useState<ReturnType<typeof prepareUnityIframeBridge> | null>(null);
  const lastSentRef = useRef<{ pub?: string; match?: string; show?: string }>({});

  const src = useMemo(() => {
    // Use clean viewer, no special params required for SendMessage bridge
    return '/Unity/match-viewer/index.html';
  }, []);

  useEffect(() => {
    if (!iframeRef.current) return;
    const b = prepareUnityIframeBridge(iframeRef.current, {
      onReady: () => setReady(true),
      onResult: (res) => {
        setLastResult(res);
        onResult?.(res);
      },
    });
    setBridge(b);
    return () => b.dispose();
  }, [onResult]);

  // Wait for MatchBridgeAPI inside the iframe window (especially important under iframe usage)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!ready) return;
      const win = iframeRef.current?.contentWindow as (Window & { MatchBridgeAPI?: any }) | null;
      if (!win) return;
      try {
        await waitForMatchBridgeAPI(win, 15000);
        if (!cancelled) setApiReady(true);
      } catch {
        if (!cancelled) setApiReady(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready]);

  // When Unity is ready, optionally showTeams or publishTeams first, then start match
  useEffect(() => {
    if (!ready || !bridge) return;
    const derivedShow: ShowTeamsPayload | null = autoShowTeamsPayload || (autoPublishPayload && autoPublishPayload.home && autoPublishPayload.away
      ? { home: autoPublishPayload.home, away: autoPublishPayload.away, autoStart: false }
      : null);
    const showStr = derivedShow ? JSON.stringify(derivedShow) : '';
    const pubStr = autoPublishPayload ? JSON.stringify(autoPublishPayload) : '';
    const matchStr = autoPayload ? JSON.stringify(autoPayload) : '';

    // For show/publish flows, wait for MatchBridgeAPI to be ready in the iframe
    if (apiReady) {
      if (showStr && lastSentRef.current.show !== showStr) {
        bridge.sendTeams(derivedShow!);
        lastSentRef.current.show = showStr;
      }
      if (pubStr && lastSentRef.current.pub !== pubStr) {
        bridge.publishTeams(autoPublishPayload!);
        lastSentRef.current.pub = pubStr;
      }
    }

    if (matchStr && lastSentRef.current.match !== matchStr) {
      const start = () => {
        bridge.sendMatch(autoPayload!);
        lastSentRef.current.match = matchStr;
      };
      if ((showStr || pubStr) && !apiReady) {
        // If teams were intended to be shown/published but API isn't ready yet, delay a bit
        setTimeout(start, 400);
      } else if (showStr || pubStr) {
        setTimeout(start, 200);
      } else {
        start();
      }
    }
  }, [ready, apiReady, bridge, autoShowTeamsPayload, autoPublishPayload, autoPayload]);

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">{ready ? 'Hazır' : 'Yükleniyor...'}</div>
        </div>
        <div className="w-full h-[480px] border rounded overflow-hidden bg-black">
          <iframe ref={iframeRef} src={src} title="Unity Bridge Iframe" className="w-full h-full" allowFullScreen />
        </div>
        {lastResult && (
          <div className="text-xs text-muted-foreground">
            Sonuç: {lastResult.homeTeam} {lastResult.homeGoals}-{lastResult.awayGoals} {lastResult.awayTeam}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
