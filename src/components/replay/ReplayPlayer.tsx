import { useEffect, useRef, useState } from 'react';

type Replay = {
  schemaVersion?: number;
  meta?: any;
  initial?: any;
  events: { ts: number; type: string; payload?: any }[];
  final?: { score?: { h: number; a: number }; stats?: any; hash?: string };
};

export function ReplayPlayer({ url }: { url: string }) {
  const [data, setData] = useState<Replay | null>(null);
  const [clock, setClock] = useState(0);
  const iRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        const txt = await res.text();
        if (!cancelled) setData(JSON.parse(txt));
      } catch (e) {
        console.warn('[ReplayPlayer] fetch failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!data) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      setClock(t);
      while (iRef.current < data.events.length && data.events[iRef.current].ts <= t) {
        const ev = data.events[iRef.current++];
        // TODO: Render event to scene/animation layer
        // For now, log as a placeholder
        // eslint-disable-next-line no-console
        console.log('replay event', ev);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data]);

  if (!data) return <div>Replay yükleniyor…</div>;
  const score = data.final?.score;
  return (
    <div>
      {score && (
        <div className="mb-2">Skor: {score.h} - {score.a}</div>
      )}
      <div className="text-sm text-muted-foreground">Zaman: {clock.toFixed(1)}s</div>
      {/* TODO: Canvas/Three.js/Unity WebGL scene here */}
    </div>
  );
}

