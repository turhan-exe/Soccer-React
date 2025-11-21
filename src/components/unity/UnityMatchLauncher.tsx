import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  prepareUnityIframeBridge,
  waitForMatchBridgeAPIOnWindow,
  type BridgeMatchRequest,
  type BridgeMatchResult,
  type PublishTeamsPayload,
  type ShowTeamsPayload,
} from '@/services/unityBridge';
import { Card, CardContent } from '@/components/ui/card';

type Props = {
  title?: string;
  autoPayload?: BridgeMatchRequest | null;
  autoPublishPayload?: PublishTeamsPayload | null;
  autoShowTeamsPayload?: ShowTeamsPayload | null;
  onResult?: (result: BridgeMatchResult) => void;
};

function convertPublishPayloadToShow(payload: PublishTeamsPayload): ShowTeamsPayload {
  return {
    homeTeam: payload.homeTeam,
    awayTeam: payload.awayTeam,
    homeTeamKey: payload.homeTeamKey ?? payload.homeTeam.teamKey,
    awayTeamKey: payload.awayTeamKey ?? payload.awayTeam.teamKey,
    autoStart: false,
  };
}

/**
 * Embeds Unity WebGL and exposes a start button to send a BridgeMatchRequest
 * to Unity's C# MatchBridge.LoadMatchFromJSON. Also listens to
 * `unityMatchFinished` inside the iframe window and forwards results to React.
 */
export function UnityMatchLauncher({
  title = 'Unity WebGL',
  autoPayload = null,
  autoPublishPayload = null,
  autoShowTeamsPayload = null,
  onResult,
}: Props) {
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
    const bridgeInstance = prepareUnityIframeBridge(iframeRef.current, {
      onReady: () => setReady(true),
      onResult: (res) => {
        setLastResult(res);
        onResult?.(res);
      },
    });
    setBridge(bridgeInstance);
    return () => bridgeInstance.dispose();
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
    const derivedShow: ShowTeamsPayload | null =
      autoShowTeamsPayload || (autoPublishPayload ? convertPublishPayloadToShow(autoPublishPayload) : null);
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

  const statusLabel = ready ? 'Hazır' : 'Yükleniyor...';

  return (
    <Card className="flex h-full w-full flex-col border border-border/80 shadow-md">
      <CardContent className="flex h-full flex-col gap-4 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="font-semibold text-base">{title}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{statusLabel}</span>
          </div>
        </div>
        <div
          className="relative w-full overflow-hidden rounded-xl border bg-black aspect-[16/9] min-h-[240px] sm:min-h-[300px] md:min-h-[360px]"
          style={{ maxHeight: 'min(65vh, 520px)' }}
        >
          <iframe ref={iframeRef} src={src} title="Unity Bridge Iframe" className="h-full w-full" />
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
