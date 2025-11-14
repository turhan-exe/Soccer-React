import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  prepareUnityIframeBridge,
  waitForMatchBridgeAPIOnWindow,
  toUnityFormationEnum,
  type BridgeMatchRequest,
  type BridgeMatchResult,
  type PublishTeamsPayload,
  type ShowTeamsPayload,
} from '@/services/unityBridge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
export function UnityMatchLauncher({ title = 'Unity WebGL', autoPayload = null, autoPublishPayload = null, autoShowTeamsPayload = null, onResult }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [apiReady, setApiReady] = useState(false);
  const [lastResult, setLastResult] = useState<BridgeMatchResult | null>(null);
  const [bridge, setBridge] = useState<ReturnType<typeof prepareUnityIframeBridge> | null>(null);
  const lastSentRef = useRef<{ pub?: string; match?: string; show?: string }>({});
  const [useCssFullscreen, setUseCssFullscreen] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [placeholderHeight, setPlaceholderHeight] = useState<number | null>(null);

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

  // Listen to native fullscreen changes so we can update UI state
  useEffect(() => {
    const handleFullscreenChange = () => {
      const target = containerRef.current;
      const isNative = Boolean(target && document.fullscreenElement === target);
      setNativeFullscreen(isNative);
      if (!document.fullscreenElement) {
        setUseCssFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!useCssFullscreen) {
      setPlaceholderHeight(null);
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUseCssFullscreen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [useCssFullscreen]);

  const exitFullscreen = () => {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    setUseCssFullscreen(false);
  };

  const toggleFullscreen = () => {
    const element = containerRef.current;
    if (!element) return;

    if (nativeFullscreen || useCssFullscreen) {
      exitFullscreen();
      return;
    }

    const attemptNative = element.requestFullscreen?.();
    if (attemptNative && typeof attemptNative.then === 'function') {
      attemptNative.catch(() => {
        setPlaceholderHeight(element.getBoundingClientRect().height);
        setUseCssFullscreen(true);
      });
    } else {
      setPlaceholderHeight(element.getBoundingClientRect().height);
      setUseCssFullscreen(true);
    }
  };

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

  const fullscreenActive = nativeFullscreen || useCssFullscreen;
  const statusLabel = ready ? 'Hazır' : 'Yükleniyor...';
  const fullscreenLabel = fullscreenActive ? 'Tam Ekrandan Çık' : 'Tam Ekran';

  return (
    <>
      {useCssFullscreen && placeholderHeight ? (
        <div style={{ height: placeholderHeight }} aria-hidden="true" />
      ) : null}
      <div
        ref={containerRef}
        className={cn(
          'relative z-10 flex w-full flex-col',
          useCssFullscreen && 'fixed inset-0 z-50 bg-black/95 p-4 md:p-8',
          fullscreenActive && 'text-white'
        )}
      >
        <Card
          className={cn(
            'flex h-full w-full flex-col border border-border/80 shadow-md',
            fullscreenActive && 'bg-black text-white border-white/30 shadow-2xl'
          )}
        >
          <CardContent className={cn('flex h-full flex-col gap-4 p-4 sm:p-6', fullscreenActive && 'text-white')}>
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold text-base">{title}</div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={cn(fullscreenActive && 'text-white/80')}>{statusLabel}</span>
                <Button
                  variant={fullscreenActive ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={toggleFullscreen}
                  className={cn('h-8 px-3', fullscreenActive && 'border-white/50 bg-white/10 text-white hover:bg-white/20')}
                >
                  {fullscreenLabel}
                </Button>
              </div>
            </div>
            <div
              className={cn(
                'relative w-full overflow-hidden rounded-xl border bg-black',
                fullscreenActive ? 'flex-1 min-h-[420px] md:min-h-[520px]' : 'aspect-[16/9] min-h-[360px] sm:min-h-[420px] md:min-h-[520px]'
              )}
            >
              <iframe ref={iframeRef} src={src} title="Unity Bridge Iframe" className="h-full w-full" allowFullScreen />
            </div>
            {lastResult && (
              <div className={cn('text-xs text-muted-foreground', fullscreenActive && 'text-white/70')}>
                Sonuç: {lastResult.homeTeam} {lastResult.homeGoals}-{lastResult.awayGoals} {lastResult.awayTeam}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
