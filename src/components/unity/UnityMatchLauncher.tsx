import React, { useEffect, useMemo, useRef, useState } from 'react';
import { prepareUnityIframeBridge, waitForMatchBridgeAPIOnWindow, type BridgeMatchRequest, type BridgeMatchResult, type PublishTeamsPayload, type ShowTeamsPayload } from '@/services/unityBridge';
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
    if (!ready) {
      setApiReady(false);
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const attempt = () => {
      if (cancelled) return;

      const win = iframeRef.current?.contentWindow as (Window & { MatchBridgeAPI?: any }) | null;
      if (!win) {
        retryTimer = window.setTimeout(attempt, 200);
        return;
      }

      waitForMatchBridgeAPIOnWindow(win, 15000)
        .then(() => {
          if (!cancelled) setApiReady(true);
        })
        .catch(() => {
          if (cancelled) return;
          setApiReady(false);
          retryTimer = window.setTimeout(attempt, 500);
        });
    };

    setApiReady(false);
    attempt();

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [ready]);


  // When Unity is ready, optionally showTeams or publishTeams first, then start match
  useEffect(() => {
    if (!ready || !bridge || !apiReady) return;
    const derivedShow: ShowTeamsPayload | null = autoShowTeamsPayload || (autoPublishPayload && autoPublishPayload.home && autoPublishPayload.away
      ? { home: autoPublishPayload.home, away: autoPublishPayload.away, autoStart: false }
      : null);
    const showStr = derivedShow ? JSON.stringify(derivedShow) : '';
    const pubStr = autoPublishPayload ? JSON.stringify(autoPublishPayload) : '';
    const matchStr = autoPayload ? JSON.stringify(autoPayload) : '';

    const timers: number[] = [];

    if (showStr && lastSentRef.current.show !== showStr) {
      bridge.sendTeams(derivedShow!);
      lastSentRef.current.show = showStr;
    }

    if (pubStr && lastSentRef.current.pub !== pubStr) {
      bridge.publishTeams(autoPublishPayload!);
      lastSentRef.current.pub = pubStr;
    }

    if (matchStr && lastSentRef.current.match !== matchStr) {
      const start = () => {
        bridge.sendMatch(autoPayload!);
        lastSentRef.current.match = matchStr;
      };
      if (showStr || pubStr) {
        timers.push(window.setTimeout(start, 200));
      } else {
        start();
      }
    }

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
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
