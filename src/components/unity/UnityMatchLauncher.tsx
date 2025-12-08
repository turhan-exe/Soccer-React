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
  onReadyForDisplay?: () => void;
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
  onReadyForDisplay,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [apiReady, setApiReady] = useState(false);
  const [unityBooted, setUnityBooted] = useState(false);
  const [autoTeamsSynced, setAutoTeamsSynced] = useState(false);
  const [lastResult, setLastResult] = useState<BridgeMatchResult | null>(null);
  const [bridge, setBridge] = useState<ReturnType<typeof prepareUnityIframeBridge> | null>(null);
  const lastSentRef = useRef<{ pub?: string; match?: string; show?: string }>({});
  const syncStatusRef = useRef<{ show: boolean; publish: boolean }>({ show: true, publish: true });
  const reportedReadyRef = useRef(false);

  const derivedShowTeamsPayload = useMemo(() => {
    if (autoShowTeamsPayload) return autoShowTeamsPayload;
    if (autoPublishPayload) return convertPublishPayloadToShow(autoPublishPayload);
    return null;
  }, [autoShowTeamsPayload, autoPublishPayload]);

  const showSignature = derivedShowTeamsPayload ? JSON.stringify(derivedShowTeamsPayload) : '';
  const publishSignature = autoPublishPayload ? JSON.stringify(autoPublishPayload) : '';
  const matchSignature = autoPayload ? JSON.stringify(autoPayload) : '';

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
      setUnityBooted(false);
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

  useEffect(() => {
    syncStatusRef.current = {
      show: !showSignature,
      publish: !publishSignature,
    };
    setAutoTeamsSynced(!showSignature && !publishSignature);
  }, [showSignature, publishSignature]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!ready) {
      setUnityBooted(false);
      return;
    }
    if (unityBooted) return;

    let cancelled = false;
    let rafId: number | null = null;

    const probeLoadingBar = () => {
      if (cancelled) return;
      try {
        const doc =
          iframeRef.current?.contentDocument || iframeRef.current?.contentWindow?.document || null;
        const loadingBar = doc?.getElementById('unity-loading-bar');
        if (loadingBar) {
          const computed = window.getComputedStyle(loadingBar);
          const displayValue = computed.display || loadingBar.style.display || '';
          const visibilityValue = computed.visibility || loadingBar.style.visibility || '';
          const opacityValueRaw = computed.opacity || loadingBar.style.opacity || '';
          const opacityValue = Number.parseFloat(opacityValueRaw || '1');
          if (
            displayValue === 'none' ||
            visibilityValue === 'hidden' ||
            (Number.isFinite(opacityValue) && opacityValue === 0)
          ) {
            setUnityBooted(true);
            return;
          }
        }
      } catch (err) {
        console.warn('[UnityMatchLauncher] unity loading bar probe failed', err);
      }
      rafId = window.requestAnimationFrame(probeLoadingBar);
    };

    rafId = window.requestAnimationFrame(probeLoadingBar);
    return () => {
      cancelled = true;
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [ready, unityBooted]);

  const readyForDisplay = ready && apiReady && autoTeamsSynced && unityBooted;

  useEffect(() => {
    if (readyForDisplay && !reportedReadyRef.current) {
      reportedReadyRef.current = true;
      onReadyForDisplay?.();
    } else if (!readyForDisplay) {
      reportedReadyRef.current = false;
    }
  }, [readyForDisplay, onReadyForDisplay]);

  const markTeamsSynced = (type: 'show' | 'publish') => {
    if (syncStatusRef.current[type]) return;
    syncStatusRef.current[type] = true;
    if (syncStatusRef.current.show && syncStatusRef.current.publish) {
      setAutoTeamsSynced(true);
    }
  };

  // When Unity is ready, optionally showTeams or publishTeams first
  useEffect(() => {
    if (!ready || !bridge || !apiReady) return;
    const timers: number[] = [];

    const sendWithRetry = (
      key: 'show' | 'pub',
      signature: string,
      sender: () => boolean,
      onSuccess: () => void
    ) => {
      if (!signature) return;
      if (lastSentRef.current[key] === signature) return;
      const attempt = (retries = 0) => {
        try {
          const ok = sender();
          if (ok) {
            lastSentRef.current[key] = signature;
            onSuccess();
            return;
          }
        } catch (err) {
          console.warn('[UnityMatchLauncher] auto send failed', err);
        }
        const delay = Math.min(2000, 400 + retries * 200);
        const timer = window.setTimeout(() => attempt(retries + 1), delay);
        timers.push(timer);
      };
      attempt();
    };

    sendWithRetry(
      'show',
      showSignature,
      () => (derivedShowTeamsPayload ? bridge.sendTeams(derivedShowTeamsPayload) : true),
      () => markTeamsSynced('show')
    );

    sendWithRetry(
      'pub',
      publishSignature,
      () => (autoPublishPayload ? bridge.publishTeams(autoPublishPayload) : true),
      () => markTeamsSynced('publish')
    );

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [ready, apiReady, bridge, derivedShowTeamsPayload, autoPublishPayload, showSignature, publishSignature]);

  // Once team payloads sync, kick off match payload
  useEffect(() => {
    if (!ready || !bridge || !apiReady || !autoTeamsSynced) return;
    if (!autoPayload || !matchSignature) return;
    if (lastSentRef.current.match === matchSignature) return;

    const timers: number[] = [];

    const attempt = (retries = 0) => {
      try {
        const ok = bridge.sendMatch(autoPayload);
        if (ok) {
          lastSentRef.current.match = matchSignature;
          return;
        }
      } catch (err) {
        console.warn('[UnityMatchLauncher] auto match send failed', err);
      }
      const delay = Math.min(3000, 600 + retries * 300);
      const timer = window.setTimeout(() => attempt(retries + 1), delay);
      timers.push(timer);
    };

    attempt();

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [ready, apiReady, bridge, autoPayload, autoTeamsSynced, matchSignature]);

  let statusLabel = 'Unity yukleniyor...';
  if (ready && !apiReady) {
    statusLabel = 'Bridge hazirlaniyor...';
  } else if (ready && apiReady && !autoTeamsSynced) {
    statusLabel = 'Takim verileri aktariliyor...';
  } else if (ready && apiReady && autoTeamsSynced) {
    statusLabel = 'Hazir';
  }
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
