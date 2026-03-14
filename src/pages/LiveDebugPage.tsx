import React, { useEffect, useRef, useState } from 'react';
import { subscribeLive, type LiveEvent } from '@/services/live';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function LiveDebugPage() {
  const [matchId, setMatchId] = useState('MDEMO');
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const unsubRef = useRef<() => void>();

  function start() {
    unsubRef.current?.();
    setEvents([]);
    unsubRef.current = subscribeLive(matchId, (e) => {
      setEvents((prev) => [...prev, e]);
    });
  }
  function stop() {
    unsubRef.current?.();
    unsubRef.current = undefined;
  }

  useEffect(() => () => stop(), []);

  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-2 items-center">
        <Input
          value={matchId}
          onChange={(e) => setMatchId(e.target.value)}
          placeholder="matchId"
          className="max-w-xs"
        />
        <Button onClick={start}>Bağlan</Button>
        <Button variant="outline" onClick={stop}>
          Kes
        </Button>
      </div>

      <Card className="p-4">
        <div className="text-sm text-muted-foreground mb-2">Events ({events.length})</div>
        <div className="space-y-1 max-h-[60vh] overflow-auto">
          {events.map((ev, i) => (
            <div key={i} className="text-sm font-mono">
              {new Date(ev.ts).toLocaleTimeString('tr-TR')} - {(ev as any).eventType || (ev as any).type}
              {ev.seq ? ` #${ev.seq}` : ''} {ev.payload ? JSON.stringify(ev.payload) : ''}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
