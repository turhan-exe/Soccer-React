import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UnityMatchLauncher } from '@/components/unity/UnityMatchLauncher';
import { makeMockTeam } from '@/lib/mockTeam';
import type { ClubTeam, Player } from '@/types';
import { runtimeTeamToPublishedTeam } from '@/services/unityBridge';
import type { ShowTeamsPayload, RuntimePlayer, RuntimeTeam } from '@/services/unityBridge';

function mapPlayerToRuntime(p: Player): RuntimePlayer {
  const a: any = p.attributes || {};
  const attrs: Record<string, number> = {
    strength: a?.strength ?? 0,
    acceleration: a?.acceleration ?? 0,
    topSpeed: a?.topSpeed ?? 0,
    dribbleSpeed: a?.dribbleSpeed ?? 0,
    jump: a?.jump ?? 0,
    tackling: a?.tackling ?? 0,
    ballKeeping: a?.ballKeeping ?? 0,
    passing: a?.passing ?? 0,
    longBall: a?.longBall ?? 0,
    agility: a?.agility ?? 0,
    shooting: a?.shooting ?? 0,
    shootPower: a?.shootPower ?? 0,
    positioning: a?.positioning ?? 0,
    reaction: a?.reaction ?? 0,
    ballControl: a?.ballControl ?? 0,
    // common aliases Unity accepts
    speed: a?.topSpeed ?? 0,
    pace: Number((((a?.topSpeed ?? 0) + (a?.acceleration ?? 0)) / 2).toFixed(3)),
    accel: a?.acceleration ?? 0,
    power: a?.shootPower ?? 0,
    shotPower: a?.shootPower ?? 0,
    pass: a?.passing ?? 0,
    longPass: a?.longBall ?? 0,
    control: a?.ballControl ?? 0,
    dribbling: a?.dribbleSpeed ?? 0,
    tackle: a?.tackling ?? 0,
    reactions: a?.reaction ?? 0,
  };
  return { id: p.id, name: p.name, position: p.position, overall: p.overall, age: (p as any).age, attributes: attrs };
}

function mapMockTeam(team: ClubTeam, formation = '4-4-2'): RuntimeTeam {
  // Keep the initial creation order for XI; mockTeam marks first 11 as 'starting' in that order.
  const xi = team.players.filter((p) => p.squadRole === 'starting').slice(0, 11);
  const players = xi.map((p) => p.name);
  const playersData = xi.map(mapPlayerToRuntime);
  return {
    name: team.name,
    formation,
    players,
    playersData,
    homeKit: { color1: '#1b5e20', color2: '#ffffff' },
    awayKit: { color1: '#0d47a1', color2: '#ffffff' },
  };
}

export default function UnityAutoSeed() {
  const [seed, setSeed] = useState(1);

  const payload: ShowTeamsPayload = useMemo(() => {
    const homeClub = makeMockTeam(`H${seed}`, 'Catalagna');
    const awayClub = makeMockTeam(`A${seed}`, 'Royal');
    const homeRuntime = mapMockTeam(homeClub, '4-4-2');
    const awayRuntime = mapMockTeam(awayClub, '4-4-2');
    const homeKey = `auto-home-${seed}`;
    const awayKey = `auto-away-${seed}`;
    return {
      homeTeam: runtimeTeamToPublishedTeam(homeRuntime, { teamKey: homeKey, preferAwayKit: false }),
      awayTeam: runtimeTeamToPublishedTeam(awayRuntime, { teamKey: awayKey, preferAwayKit: true }),
      homeTeamKey: homeKey,
      awayTeamKey: awayKey,
      autoStart: false,
      openMenu: true,
      select: true,
      userTeam: 'Home',
    };
  }, [seed]);

  return (
    <div className="min-h-screen p-4 space-y-4">
      <Card>
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <div className="font-semibold">Unity Mock Takım Seçimi</div>
            <div className="text-xs text-muted-foreground">Sayfa açılınca iki takım seçim ekranına otomatik basılır ve seçilir.</div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setSeed((s) => s + 1)}>Yeni Kadrolar</Button>
          </div>
        </CardContent>
      </Card>

      <UnityMatchLauncher title="Unity Köprü (Auto Seed)" autoShowTeamsPayload={payload} />
    </div>
  );
}
