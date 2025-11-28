import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchReplayPayload } from '@/types/matchReplay';

type UnityReplayViewerProps = {
  payload: MatchReplayPayload | null;
  height?: number;
};

const IFRAME_SRC =
  (import.meta.env.VITE_UNITY_REPLAY_IFRAME as string | undefined) ||
  '/Unity/match-viewer/index.html';

const UnityReplayViewer: React.FC<UnityReplayViewerProps> = ({ payload, height = 520 }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [positionMs, setPositionMs] = useState(0);

  const durationMs = useMemo(() => payload?.durationMs ?? 0, [payload]);

  useEffect(() => {
    if (!payload) return;
    setPositionMs(0);
    setIsPlaying(false);
    try {
      iframeRef.current?.contentWindow?.postMessage({ type: 'LOAD_REPLAY', payload }, '*');
    } catch (err) {
      console.error('postMessage LOAD_REPLAY failed', err);
    }
  }, [payload]);

  const post = (message: any) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(message, '*');
    } catch (err) {
      console.error('postMessage failed', err);
    }
  };

  const togglePlay = () => {
    const next = !isPlaying;
    setIsPlaying(next);
    post({ type: next ? 'PLAY' : 'PAUSE' });
  };

  const changeSpeed = (value: number) => {
    setSpeed(value);
    post({ type: 'SET_SPEED', speed: value });
  };

  const handleSeek = (value: number) => {
    setPositionMs(value);
    post({ type: 'SEEK', t: value });
  };

  return (
    <div className="w-full space-y-3">
      <iframe
        ref={iframeRef}
        src={IFRAME_SRC}
        title="Unity Replay"
        style={{ width: '100%', height }}
        className="overflow-hidden rounded-lg border border-slate-200 shadow-sm"
      />
      <div className="flex items-center gap-3">
        <button
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          onClick={togglePlay}
          disabled={!payload}
        >
          {isPlaying ? 'Durdur' : 'Oynat'}
        </button>
        <div className="flex items-center gap-1 text-sm">
          <span className="text-slate-500">Hız</span>
          {[1, 2, 4].map((v) => (
            <button
              key={v}
              onClick={() => changeSpeed(v)}
              className={`rounded border px-2 py-1 ${speed === v ? 'border-emerald-500 text-emerald-600' : 'border-slate-200 text-slate-700'}`}
              disabled={!payload}
            >
              {v}x
            </button>
          ))}
        </div>
        <div className="flex flex-1 items-center gap-2">
          <input
            type="range"
            min={0}
            max={durationMs || 1}
            value={positionMs}
            onChange={(e) => handleSeek(Number(e.target.value))}
            disabled={!payload}
            className="w-full"
          />
          <span className="w-20 text-right text-xs text-slate-500">
            {(positionMs / 1000).toFixed(1)}s / {(durationMs / 1000).toFixed(1)}s
          </span>
        </div>
      </div>
    </div>
  );
};

export default UnityReplayViewer;
