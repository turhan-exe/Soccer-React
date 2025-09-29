import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getFixturesForTeam, getMyLeagueId, getLeagueTeams } from '@/services/leagues';
import type { Fixture } from '@/types';
import { UnityMatchLauncher } from '@/components/unity/UnityMatchLauncher';
import type { BridgeMatchRequest, BridgeMatchResult } from '@/services/unityBridge';
import type { PublishTeamsPayload, RuntimePlayer, ShowTeamsPayload, KitSpec } from '@/services/unityBridge';
import { toUnityFormationEnum } from '@/services/unityBridge';
import { getTeam } from '@/services/team';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { Player } from '@/types';
import { BackButton } from '@/components/ui/back-button';

type DisplayFixture = Fixture & { opponent: string; home: boolean };

export default function MatchSimulation() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [nextFixture, setNextFixture] = useState<DisplayFixture | null>(null);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [showUnity, setShowUnity] = useState(true);
  const [autoPayload, setAutoPayload] = useState<BridgeMatchRequest | null>(null);
  const [autoPublishPayload, setAutoPublishPayload] = useState<PublishTeamsPayload | null>(null);
  const [autoShowTeamsPayload, setAutoShowTeamsPayload] = useState<ShowTeamsPayload | null>(null);
  const [lastResult, setLastResult] = useState<BridgeMatchResult | null>(null);
  const [teamsSent, setTeamsSent] = useState(false);
  const [homeXI, setHomeXI] = useState<string[] | null>(null);
  const [awayXI, setAwayXI] = useState<string[] | null>(null);
  const [homeFormation, setHomeFormation] = useState<string | undefined>(undefined);
  const [awayFormation, setAwayFormation] = useState<string | undefined>(undefined);
  const [homeRoster, setHomeRoster] = useState<Player[] | null>(null);
  const [awayRoster, setAwayRoster] = useState<Player[] | null>(null);
  const [homeBench, setHomeBench] = useState<string[]>([]);
  const [awayBench, setAwayBench] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      if (!user) return;
      setLoading(true);
      try {
        const lid = await getMyLeagueId(user.id);
        if (!lid) {
          setLeagueId(null);
          setNextFixture(null);
          return;
        }
        setLeagueId(lid);
        const [fixtures, teamsList] = await Promise.all([
          getFixturesForTeam(lid, user.id),
          getLeagueTeams(lid),
        ]);
        setTeams(teamsList);
        const teamMap = new Map(teamsList.map((t) => [t.id, t.name]));
        const upcoming = fixtures
          .filter((f) => f.status !== 'played')
          .sort((a, b) => (a.date as Date).getTime() - (b.date as Date).getTime())[0];
        if (!upcoming) {
          setNextFixture(null);
          return;
        }
        const home = upcoming.homeTeamId === user.id;
        const opponentId = home ? upcoming.awayTeamId : upcoming.homeTeamId;
        setNextFixture({
          ...upcoming,
          opponent: teamMap.get(opponentId) || opponentId,
          home,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  // Load both teams' rosters and compute XI sorted GK → FW
  useEffect(() => {
    (async () => {
      setTeamsSent(false);
      setAutoPublishPayload(null);
      setAutoShowTeamsPayload(null);
      setAutoPayload(null);
      setShowUnity(true);
      setLastResult(null);
      if (!nextFixture) {
        setHomeRoster(null);
        setAwayRoster(null);
        setHomeXI(null);
        setAwayXI(null);
        setHomeBench([]);
        setAwayBench([]);
        setHomeFormation(undefined);
        setAwayFormation(undefined);
        return;
      }
      const [homeTeam, awayTeam] = await Promise.all([
        getTeam(nextFixture.homeTeamId).catch(() => null),
        getTeam(nextFixture.awayTeamId).catch(() => null),
      ]);
      setHomeRoster(homeTeam?.players || null);
      setAwayRoster(awayTeam?.players || null);

      const pickXI = (players: Player[] | undefined | null): string[] => {
        if (!players || !players.length) return [];
        const starters = players.filter(p => p.squadRole === 'starting');
        const pool = starters.length ? starters : players;

        const bucket = (pos: Player['position']): number => {
          if (pos === 'GK') return 0;
          if (pos === 'LB' || pos === 'RB' || pos === 'CB') return 1; // DEF
          if (pos === 'LM' || pos === 'CM' || pos === 'RM' || pos === 'CAM') return 2; // MID
          return 3; // LW, RW, ST → FWD
        };

        const ordered = [...pool]
          .sort((a, b) => {
            const da = bucket(a.position);
            const db = bucket(b.position);
            if (da !== db) return da - db;
            // secondary consistent order within bucket
            const sec = ['GK','LB','CB','RB','LM','CM','RM','CAM','LW','ST','RW'] as Player['position'][];
            return sec.indexOf(a.position) - sec.indexOf(b.position);
          })
          .slice(0, 11)
          .map(p => p.name);
        return ordered;
      };

      const pickBench = (players: Player[] | undefined | null, starters: string[]): string[] => {
        if (!players || !players.length) return [];
        const starterSet = new Set(starters);
        const byOrder = (a: Player, b: Player) => {
          const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
          const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
          return ao - bo;
        };
        const primary = players
          .filter(p => p.squadRole === 'bench' && !starterSet.has(p.name))
          .sort(byOrder)
          .map(p => p.name);
        if (primary.length) return primary.slice(0, 9);
        return players
          .filter(p => !starterSet.has(p.name))
          .sort(byOrder)
          .map(p => p.name)
          .slice(0, 9);
      };

      const deriveFormation = (players: Player[] | undefined | null): string | undefined => {
        if (!players || !players.length) return toUnityFormationEnum('4-3-3');
        const starters = players.filter(p => p.squadRole === 'starting');
        const pool = starters.length ? starters : players.slice(0, 11);
        const cnt = (set: Set<Player['position']>) => pool.filter(p => set.has(p.position)).length;
        const def = cnt(new Set(['LB','RB','CB'] as Player['position'][]));
        const fwd = cnt(new Set(['LW','RW','ST'] as Player['position'][]));
        const mid = Math.max(0, 11 - def - fwd);
        // Map to a simple D-M-F shape
        const label = `${def}-${mid}-${fwd}`;
        return toUnityFormationEnum(label) || toUnityFormationEnum('4-3-3');
      };

      const homeXIList = pickXI(homeTeam?.players);
      const awayXIList = pickXI(awayTeam?.players);
      setHomeXI(homeXIList.length ? homeXIList : null);
      setAwayXI(awayXIList.length ? awayXIList : null);
      setHomeBench(pickBench(homeTeam?.players, homeXIList));
      setAwayBench(pickBench(awayTeam?.players, awayXIList));
      setHomeFormation(deriveFormation(homeTeam?.players));
      setAwayFormation(deriveFormation(awayTeam?.players));
    })();
  }, [nextFixture]);

  const ourTeamName = useMemo(() => {
    if (!user || !teams.length || !nextFixture) return '';
    const id = nextFixture.home ? nextFixture.homeTeamId : nextFixture.awayTeamId;
    return teams.find((t) => t.id === id)?.name || id;
  }, [teams, nextFixture, user]);

  const opponentName = nextFixture?.opponent || '';

  const formatKit = (kit?: KitSpec | null): string =>
    kit
      ? Object.entries(kit)
          .filter(([, value]) => value != null && value !== '')
          .map(([key, value]) => `${key}=${value}`)
          .join(', ')
      : '';

  const renderKitLine = (label: string, kit?: KitSpec | null): React.ReactNode => {
    const formatted = formatKit(kit);
    if (!formatted) return null;
    return (
      <div className="mt-1 text-xs text-muted-foreground">
        {label}: {formatted}
      </div>
    );
  };

  const formatPlayerLabel = (player: RuntimePlayer, index: number): string => {
    const tags: string[] = [];
    if (player.position) tags.push(player.position);
    if (typeof player.overall === 'number') tags.push(`OVR ${player.overall}`);
    return `${index + 1}. ${player.name}${tags.length ? ` (${tags.join(', ')})` : ''}`;
  };

  const formatPlayerMeta = (player: RuntimePlayer): string => {
    const segments: string[] = [player.position || '?'];
    if (typeof player.overall === 'number') segments.push(`OVR ${player.overall}`);
    if (typeof player.age === 'number') segments.push(`Age ${player.age}`);
    return segments.join(' | ');
  };

  const renderRuntimePlayerItem = (
    player: RuntimePlayer,
    index: number,
    prefix: string,
  ): React.ReactElement => {
    const attributeEntries = Object.entries(player.attributes || {});
    return (
      <li key={player.id || `${prefix}-${index}`}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">{formatPlayerLabel(player, index)}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <div className="font-medium mb-1">{player.name}</div>
            <div className="text-xs text-muted-foreground mb-1">
              {formatPlayerMeta(player)}
            </div>
            {attributeEntries.length ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {attributeEntries.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="capitalize">{k}</span>
                    <span className="tabular-nums">
                      {typeof v === 'number' ? v.toFixed(3) : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </TooltipContent>
        </Tooltip>
      </li>
    );
  };

  const renderTeamColumn = (
    team: PublishTeamsPayload['home'],
    label: string,
    prefix: 'home' | 'away',
  ): React.ReactNode => {
    const runtime = team || null;
    return (
      <div>
        <div className="font-medium">
          {label}: {runtime?.name || '?'}
        </div>
        {runtime?.formation && (
          <div className="text-muted-foreground">
            Diziliş: {runtime.formation}
          </div>
        )}
        {renderKitLine('Home Kit', runtime?.homeKit)}
        {renderKitLine('Away Kit', runtime?.awayKit)}
        {runtime?.playersData?.length ? (
          <ul className="mt-1 list-disc list-inside space-y-0.5">
            {runtime.playersData.map((player, index) =>
              renderRuntimePlayerItem(player, index, `${prefix}-player`),
            )}
          </ul>
        ) : runtime?.players?.length ? (
          <ul className="mt-1 list-disc list-inside space-y-0.5">
            {runtime.players.map((name, index) => (
              <li key={`${prefix}-player-name-${index}`}>{`${index + 1}. ${name}`}</li>
            ))}
          </ul>
        ) : null}
        {runtime?.benchData?.length || runtime?.bench?.length ? (
          <div className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Yedekler
            </div>
            {runtime?.benchData?.length ? (
              <ul className="mt-1 list-disc list-inside space-y-0.5">
                {runtime.benchData.map((player, index) =>
                  renderRuntimePlayerItem(player, index, `${prefix}-bench`),
                )}
              </ul>
            ) : runtime?.bench?.length ? (
              <ul className="mt-1 list-disc list-inside space-y-0.5">
                {runtime.bench.map((name, index) => (
                  <li key={`${prefix}-bench-name-${index}`}>{`${index + 1}. ${name}`}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const header = (
    <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BackButton />
          <h1 className="text-xl font-bold">Maç Simülasyonu</h1>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen">
        {header}
        <div className="p-4">Yükleniyor…</div>
      </div>
    );
  }

  if (!nextFixture || !leagueId) {
    return (
      <div className="min-h-screen">
        {header}
        <div className="p-4">
          <Card>
            <CardContent className="p-4">
              Yaklaşan maç bulunamadı veya lig bilgisi eksik.
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {header}
      <div className="p-4 space-y-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="text-sm">
              <div className="font-semibold">
                {nextFixture.home ? ourTeamName : opponentName} vs {nextFixture.home ? opponentName : ourTeamName}
              </div>
              <div className="text-muted-foreground">Id: {nextFixture.id}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/team-planning')}>Kadroyu Ayarla</Button>
              <Button variant="ghost" size="sm" onClick={() => navigate('/fixtures')}>Fikstür</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="font-semibold">Simülasyon</div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  if (!nextFixture) return;
                  const homeName = teams.find((t) => t.id === nextFixture.homeTeamId)?.name || nextFixture.homeTeamId;
                  const awayName = teams.find((t) => t.id === nextFixture.awayTeamId)?.name || nextFixture.awayTeamId;
                  // Build playersData arrays aligned with players order (with full attributes)
                  const mapDetail = (names: string[] | null, roster: Player[] | null, limit?: number): RuntimePlayer[] | undefined => {
                    if (!names || !roster) return undefined;
                    const byName = new Map(roster.map(p => [p.name, p]));
                    const trimmed = typeof limit === 'number' ? names.slice(0, limit) : names.slice();
                    if (!trimmed.length) return undefined;
                    const ensure = (nm: string): RuntimePlayer => {
                      const p = byName.get(nm);
                      if (!p) return { name: nm };
                      const a = p.attributes as any;
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
                        speed: a?.topSpeed ?? 0,
                        accel: a?.acceleration ?? 0,
                        power: a?.shootPower ?? 0,
                        shotPower: a?.shootPower ?? 0,
                        pass: a?.passing ?? 0,
                        longPass: a?.longBall ?? 0,
                        control: a?.ballControl ?? 0,
                        dribbling: a?.dribbleSpeed ?? 0,
                        tackle: a?.tackling ?? 0,
                        reactions: a?.reaction ?? 0,
                        pace: Number((((a?.topSpeed ?? 0) + (a?.acceleration ?? 0)) / 2).toFixed(3)),
                      };
                      return { id: p.id, name: p.name, position: p.position, overall: p.overall, age: (p as any).age, attributes: attrs };
                    };
                    return trimmed.map(ensure);
                  };
                  const payload: PublishTeamsPayload = {
                    home: {
                      name: homeName,
                      players: (homeXI && homeXI.length === 11) ? homeXI : (homeXI || []).concat(Array.from({ length: Math.max(0, 11 - (homeXI?.length || 0)) }, (_, i) => `Player ${i + 1}`)).slice(0, 11),
                      playersData: mapDetail(homeXI, homeRoster, 11),
                      bench: homeBench.length ? [...homeBench] : [],
                      benchData: mapDetail(homeBench, homeRoster),
                      formation: homeFormation,
                    },
                    away: {
                      name: awayName,
                      players: (awayXI && awayXI.length === 11) ? awayXI : (awayXI || []).concat(Array.from({ length: Math.max(0, 11 - (awayXI?.length || 0)) }, (_, i) => `Player ${i + 1}`)).slice(0, 11),
                      playersData: mapDetail(awayXI, awayRoster, 11),
                      bench: awayBench.length ? [...awayBench] : [],
                      benchData: mapDetail(awayBench, awayRoster),
                      formation: awayFormation,
                    },
                    openMenu: false,
                    select: false,
                  };
                  setAutoPublishPayload(payload);
                  const showPayload: ShowTeamsPayload = {
                    home: payload.home!,
                    away: payload.away!,
                    aiLevel: 'Legendary',
                    userTeam: nextFixture.home ? 'Home' : 'Away',
                    dayTime: 'Night',
                    autoStart: false,
                  };
                  setAutoShowTeamsPayload(showPayload);
                  setTeamsSent(true);
                }}
              >
                Kadroları Gönder
              </Button>
              <Button
                disabled={!teamsSent}
                onClick={() => {
                  if (!user || !nextFixture) return;
                  const homeName = teams.find((t) => t.id === nextFixture.homeTeamId)?.name || nextFixture.homeTeamId;
                  const awayName = teams.find((t) => t.id === nextFixture.awayTeamId)?.name || nextFixture.awayTeamId;
                  const payload: BridgeMatchRequest = {
                    matchId: nextFixture.id,
                    homeTeamKey: homeName,
                    awayTeamKey: awayName,
                    autoStart: true,
                    aiLevel: 'Legendary',
                    userTeam: nextFixture.home ? 'Home' : 'Away',
                    dayTime: 'Night',
                    homeAltKit: false,
                    awayAltKit: true,
                  };
                  setAutoPayload(payload);
                  setShowUnity(true);
                }}
              >
                Simülasyonu Başlat
              </Button>
            </div>

            {showUnity && (
              <div className="pt-2">
                <UnityMatchLauncher title="Unity Köprü" autoPayload={autoPayload} autoPublishPayload={autoPublishPayload} autoShowTeamsPayload={autoShowTeamsPayload} onResult={(res) => setLastResult(res)} />
              </div>
            )}

  	            {lastResult && (
                <div className="text-xs text-muted-foreground">
                  Sonuç: {lastResult.homeTeam} {lastResult.homeGoals}-{lastResult.awayGoals} {lastResult.awayTeam}
                </div>
              )}

            {autoPublishPayload && (
              <div className="mt-3 border-t pt-3">
                <div className="font-semibold mb-2">Gönderilen Takım Verileri</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  {renderTeamColumn(autoPublishPayload.home, 'Ev Sahibi', 'home')}
                  {renderTeamColumn(autoPublishPayload.away, 'Deplasman', 'away')}
                </div>
              </div>
            )}
            {(autoShowTeamsPayload || autoPublishPayload) && (
              <div className="mt-3 border-t pt-3 space-y-2">
                <div className="font-semibold">WebGL'e Gönderilen Format</div>
                {autoShowTeamsPayload && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">showTeams(payload)</div>
                    <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-64">{JSON.stringify(autoShowTeamsPayload, null, 2)}</pre>
                  </div>
                )}
                {autoPublishPayload && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">publishTeams(payload)</div>
                    <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-64">{JSON.stringify(autoPublishPayload, null, 2)}</pre>
                  </div>
                )}
                {autoPayload && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">loadMatchFromJSON(payload)</div>
                    <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-64">{JSON.stringify(autoPayload, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}
            <div className="mt-2 text-xs text-muted-foreground">
              Ayarlar: AI=Legendary, Kullanıcı Takımı={nextFixture.home ? 'Home' : 'Away'}, Zaman=Night
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
