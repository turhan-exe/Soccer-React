import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getFixturesForTeam, getMyLeagueId, getLeagueTeams } from '@/services/leagues';
import type { ClubTeam, Fixture } from '@/types';
import { UnityMatchLauncher } from '@/components/unity/UnityMatchLauncher';
import type { BridgeMatchRequest, BridgeMatchResult } from '@/services/unityBridge';
import type {
  PublishTeamsPayload,
  ShowTeamsPayload,
  PublishedTeam,
  PublishedPlayer,
  TeamKitColors,
} from '@/services/unityBridge';
import { toUnityFormationEnum, waitForMatchBridgeAPI } from '@/services/unityBridge';
import { getTeam } from '@/services/team';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { Player } from '@/types';
import { BackButton } from '@/components/ui/back-button';
import { formatRatingLabel } from '@/lib/player';

type DisplayFixture = Fixture & { opponent: string; home: boolean };
type SendFeedback = { type: 'success' | 'error'; message: string };

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
  const [lastRequestToken, setLastRequestToken] = useState<string | null>(null);
  const [teamsSent, setTeamsSent] = useState(false);
  const [homeXI, setHomeXI] = useState<string[] | null>(null);
  const [awayXI, setAwayXI] = useState<string[] | null>(null);
  const [homeFormation, setHomeFormation] = useState<string | undefined>(undefined);
  const [awayFormation, setAwayFormation] = useState<string | undefined>(undefined);
  const [homeRoster, setHomeRoster] = useState<Player[] | null>(null);
  const [awayRoster, setAwayRoster] = useState<Player[] | null>(null);
  const [homeTeamData, setHomeTeamData] = useState<ClubTeam | null>(null);
  const [awayTeamData, setAwayTeamData] = useState<ClubTeam | null>(null);
  const [homeBench, setHomeBench] = useState<string[]>([]);
  const [awayBench, setAwayBench] = useState<string[]>([]);
  const [sendingTeams, setSendingTeams] = useState(false);
  const [sendFeedback, setSendFeedback] = useState<SendFeedback | null>(null);

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
      setSendFeedback(null);
      setSendingTeams(false);
      setAutoPublishPayload(null);
      setAutoShowTeamsPayload(null);
      setAutoPayload(null);
      setShowUnity(true);
      setLastResult(null);
      setLastRequestToken(null);
      if (!nextFixture) {
        setHomeRoster(null);
        setAwayRoster(null);
        setHomeTeamData(null);
        setAwayTeamData(null);
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
      setHomeTeamData(homeTeam);
      setAwayTeamData(awayTeam);

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

  const handleSendTeams = async () => {
    if (!nextFixture) return;
    const homeName = teams.find((t) => t.id === nextFixture.homeTeamId)?.name || nextFixture.homeTeamId;
    const awayName = teams.find((t) => t.id === nextFixture.awayTeamId)?.name || nextFixture.awayTeamId;
    const homeKey = deriveTeamKeyValue(nextFixture.homeTeamId, 'HOME');
    const awayKey = deriveTeamKeyValue(nextFixture.awayTeamId, 'AWAY');
    const homeKitColors = deriveTeamKitColors(homeTeamData, homeKey, false);
    const awayKitColors = deriveTeamKitColors(awayTeamData, awayKey, true);

    const homeTeam = buildPublishedTeamFromRoster({
      teamKey: homeKey,
      teamName: homeName,
      formation: homeFormation,
      roster: homeRoster,
      lineupNames: homeXI,
      benchNames: homeBench,
      preferAwayKit: false,
      kitColors: homeKitColors,
    });
    const awayTeam = buildPublishedTeamFromRoster({
      teamKey: awayKey,
      teamName: awayName,
      formation: awayFormation,
      roster: awayRoster,
      lineupNames: awayXI,
      benchNames: awayBench,
      preferAwayKit: true,
      kitColors: awayKitColors,
    });

    const publishPayload: PublishTeamsPayload = {
      homeTeam,
      awayTeam,
      homeTeamKey: homeKey,
      awayTeamKey: awayKey,
      cacheOnly: false,
    };
    const showPayload: ShowTeamsPayload = {
      homeTeam,
      awayTeam,
      homeTeamKey: homeKey,
      awayTeamKey: awayKey,
      aiLevel: 'Legendary',
      userTeam: nextFixture.home ? 'Home' : 'Away',
      dayTime: 'Night',
      autoStart: false,
    };

    setSendingTeams(true);
    setSendFeedback(null);
    setTeamsSent(true);
    setShowUnity(true);
    setAutoPublishPayload(publishPayload);
    setAutoShowTeamsPayload(showPayload);

    try {
      const api = await waitForMatchBridgeAPI(12000);
      let dispatched = false;
      if (typeof api.publishTeams === 'function') {
        api.publishTeams(publishPayload);
        dispatched = true;
      }
      if (typeof api.showTeams === 'function') {
        api.showTeams(showPayload);
        dispatched = true;
      } else if (typeof api.sendTeams === 'function') {
        api.sendTeams(JSON.stringify(showPayload) as any);
        dispatched = true;
      }
      if (!dispatched) {
        throw new Error('Unity MatchBridge publishTeams/showTeams metodu bulunamadı.');
      }
      setSendFeedback({ type: 'success', message: 'Takım verileri Unity köprüsüne gönderildi.' });
    } catch (error) {
      console.error('[MatchSimulationLegacy] Takım verisi gönderilemedi', error);
      setSendFeedback({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Takım verileri gönderilemedi. Unity iframe\'inin yüklü olduğundan emin ol.',
      });
    } finally {
      setSendingTeams(false);
    }
  };

  const ourTeamName = useMemo(() => {
    if (!user || !teams.length || !nextFixture) return '';
    const id = nextFixture.home ? nextFixture.homeTeamId : nextFixture.awayTeamId;
    return teams.find((t) => t.id === id)?.name || id;
  }, [teams, nextFixture, user]);

  const opponentName = nextFixture?.opponent || '';

  const formatKit = (kit?: TeamKitColors | null): string =>
    kit
      ? Object.entries(kit)
          .filter(([, value]) => value != null && value !== '')
          .map(([key, value]) => `${key}=${value}`)
          .join(', ')
      : '';

  const renderKitLine = (kit?: TeamKitColors | null): React.ReactNode => {
    const formatted = formatKit(kit);
    if (!formatted) return null;
    return (
      <div className="mt-1 text-xs text-muted-foreground">
        Forma: {formatted}
      </div>
    );
  };

  const formatPlayerLabel = (player: PublishedPlayer, index: number): string => {
    const tags: string[] = [];
    if (player.position) tags.push(player.position);
    if (typeof player.overall === 'number') tags.push(`OVR ${formatRatingLabel(player.overall)}`);
    return `${index + 1}. ${player.name}${tags.length ? ` (${tags.join(', ')})` : ''}`;
  };

  const formatPlayerMeta = (player: PublishedPlayer): string => {
    const segments: string[] = [player.position || '?'];
    if (typeof player.overall === 'number') segments.push(`OVR ${formatRatingLabel(player.overall)}`);
    return segments.join(' | ');
  };

  const renderPublishedPlayerItem = (
    player: PublishedPlayer,
    index: number,
    prefix: string,
  ): React.ReactElement => {
    const attributeEntries = Object.entries(player.attributes || {});
    return (
      <li key={player.playerId || `${prefix}-${index}`}>
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

  const renderTeamColumn = (team: PublishedTeam | null, label: string, prefix: 'home' | 'away'): React.ReactNode => (
    <div>
      <div className="font-medium">
        {label}: {team?.teamName || '?'}
      </div>
      {team?.teamKey ? (
        <div className="text-xs text-muted-foreground">Key: {team.teamKey}</div>
      ) : null}
      {team?.formation && (
        <div className="text-muted-foreground">
          Dizilis: {team.formation}
        </div>
      )}
      {renderKitLine(team?.kit)}
      {team?.lineup?.length ? (
        <ul className="mt-2 space-y-1">
          {team.lineup.map((player, index) => renderPublishedPlayerItem(player, index, `${prefix}-player`))}
        </ul>
      ) : (
        <div className="mt-2 text-sm text-muted-foreground">Kadrolar hazir degil.</div>
      )}
      {team?.bench?.length ? (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Yedekler
          </div>
          <ul className="mt-1 space-y-1">
            {team.bench.map((player, index) => renderPublishedPlayerItem(player, index, `${prefix}-bench`))}
          </ul>
        </div>
      ) : null}
    </div>
  );
     

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
      <div className="flex min-h-screen w-full flex-col overflow-x-hidden bg-muted/10">
        {header}
        <div className="p-4">Yükleniyor…</div>
      </div>
    );
  }

  if (!nextFixture || !leagueId) {
    return (
      <div className="flex min-h-screen w-full flex-col overflow-x-hidden bg-muted/10">
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
    <div className="flex min-h-screen w-full flex-col overflow-x-hidden bg-muted/10">
      {header}
      <div className="flex-1 w-full px-4 py-4 space-y-4 sm:px-6 lg:px-8">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="text-sm">
              <div className="font-semibold">
                {nextFixture.home ? ourTeamName : opponentName} vs {nextFixture.home ? opponentName : ourTeamName}
              </div>
              <div className="text-muted-foreground">Id: {nextFixture.id}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/team-planning')}>Kadroyu Ayarla</Button>
              <Button variant="ghost" size="sm" onClick={() => navigate('/fixtures')}>Fikstür</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="font-semibold">Simülasyon</div>
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={sendingTeams || !nextFixture} onClick={handleSendTeams}>
                {sendingTeams ? 'Gonderiliyor...' : 'Takim Verilerini Gonder'}
              </Button>
              <Button
                disabled={!teamsSent || !autoPublishPayload}
                onClick={() => {
                  if (!user || !nextFixture || !autoPublishPayload) return;
                  const token = createRequestToken();
                  setLastRequestToken(token);
                  const payload: BridgeMatchRequest = {
                    matchId: nextFixture.id,
                    homeTeamKey: autoPublishPayload.homeTeam.teamKey,
                    awayTeamKey: autoPublishPayload.awayTeam.teamKey,
                    autoStart: true,
                    aiLevel: 'Legendary',
                    userTeam: nextFixture.home ? 'Home' : 'Away',
                    dayTime: 'Night',
                    requestToken: token,
                  };
                  setAutoPayload(payload);
                  setShowUnity(true);
                }}
              >
                Simülasyonu Başlat
              </Button>
            </div>
            {sendFeedback && (
              <div className={`text-xs ${sendFeedback.type === 'success' ? 'text-emerald-500' : 'text-destructive'}`}>
                {sendFeedback.message}
              </div>
            )}

            {showUnity && (
              <div className="pt-2">
                <UnityMatchLauncher title="Unity Köprü" autoPayload={autoPayload} autoPublishPayload={autoPublishPayload} autoShowTeamsPayload={autoShowTeamsPayload} onResult={(res) => setLastResult(res)} />
              </div>
            )}

            {lastResult && (
              <div className="space-y-1 text-xs text-muted-foreground">
                <div>
                  Sonuç: {lastResult.homeTeam} {lastResult.homeGoals}-{lastResult.awayGoals} {lastResult.awayTeam}
                </div>
                {(lastResult.requestToken || lastRequestToken) && (
                  <div className="text-[11px] text-muted-foreground/80">
                    İstek: {lastResult.requestToken || lastRequestToken}
                  </div>
                )}
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
                  {renderTeamColumn(autoPublishPayload.homeTeam, 'Ev Sahibi', 'home')}
                  {renderTeamColumn(autoPublishPayload.awayTeam, 'Deplasman', 'away')}
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

type PublishedTeamBuilderArgs = {
  teamKey: string;
  teamName: string;
  formation?: string;
  roster: Player[] | null;
  lineupNames: string[] | null;
  benchNames: string[];
  preferAwayKit: boolean;
  kitColors?: TeamKitColors;
};

function buildPublishedTeamFromRoster(args: PublishedTeamBuilderArgs): PublishedTeam {
  const roster = args.roster || [];
  const map = new Map(roster.map((player) => [player.name, player]));
  const lineupNames = deriveLineupNames(args.lineupNames, roster);
  while (lineupNames.length < 11) {
    lineupNames.push(`Player ${lineupNames.length + 1}`);
  }
  const lineup = lineupNames.slice(0, 11).map((name, index) =>
    buildPublishedPlayer(name, map, args.teamKey, index + 1),
  );
  const starters = new Set(lineupNames.slice(0, 11));
  const benchNames = deriveBenchNames(args.benchNames, roster, starters);
  const bench = benchNames.map((name, index) =>
    buildPublishedPlayer(name, map, args.teamKey, lineup.length + index + 1),
  );
    return {
      teamKey: args.teamKey,
      teamName: args.teamName,
      formation: normalizeFormationLabel(args.formation),
      kit: args.kitColors ?? fallbackKitFromKey(args.teamKey, Boolean(args.preferAwayKit)),
      lineup,
      bench: bench.length ? bench : undefined,
    };
}

function deriveLineupNames(names: string[] | null | undefined, roster: Player[]): string[] {
  if (names && names.length) return names.slice(0, 11);
  if (roster.length) {
    const starters = roster.filter((p) => p.squadRole === 'starting').map((p) => p.name);
    if (starters.length) return starters.slice(0, 11);
    return roster.slice(0, 11).map((p) => p.name);
  }
  return [];
}

function deriveBenchNames(names: string[] | null | undefined, roster: Player[], starters: Set<string>): string[] {
  if (names && names.length) return names.slice(0, 9);
  return roster
    .filter((p) => !starters.has(p.name))
    .sort((a, b) => {
      const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
      const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
      return ao - bo;
    })
    .slice(0, 9)
    .map((p) => p.name);
}

function buildPublishedPlayer(
  name: string,
  rosterMap: Map<string, Player>,
  teamKey: string,
  order: number
): PublishedPlayer {
  const player = rosterMap.get(name);
  if (!player) {
    return { playerId: `${teamKey}-${order}`, name, order };
  }
  return {
    playerId: player.id || `${teamKey}-${order}`,
    name: player.name,
    order,
    position: player.position,
    overall: player.overall,
    attributes: mapPlayerAttributes(player),
  };
}

const UNITY_ATTRIBUTE_KEYS = [
  'strength',
  'acceleration',
  'topspeed',
  'dribblespeed',
  'jump',
  'tackling',
  'ballkeeping',
  'passing',
  'longball',
  'agility',
  'shooting',
  'shootpower',
  'positioning',
  'reaction',
  'ballcontrol',
  'height',
  'weight',
] as const;

const ZERO_ATTRIBUTES_TEMPLATE: Record<string, number> = UNITY_ATTRIBUTE_KEYS.reduce(
  (acc, key) => {
    acc[key] = 0;
    return acc;
  },
  {} as Record<string, number>
);

function mapPlayerAttributes(player: Player): Record<string, number> {
  const source = player.attributes || {};
  const normalized = new Map<string, number>();
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = rawKey.toLowerCase().replace(/[\s_-]/g, '');
    const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    if (!Number.isFinite(value)) continue;
    normalized.set(key, value);
  }
  const attrs: Record<string, number> = { ...ZERO_ATTRIBUTES_TEMPLATE };
  for (const key of UNITY_ATTRIBUTE_KEYS) {
    attrs[key] = normalized.get(key) ?? 0;
  }
  const topSpeed = Number(player.attributes?.topSpeed ?? 0);
  const acceleration = Number(player.attributes?.acceleration ?? 0);
  attrs.pace = Number(((topSpeed + acceleration) / 2).toFixed(3));
  return attrs;
}

const KIT_COLOR_PALETTE = ['#0EA5E9', '#DC2626', '#16A34A', '#F97316', '#7C3AED', '#0D9488', '#E11D48', '#2563EB'];

function fallbackKitFromKey(teamKey: string, preferAwayKit: boolean): TeamKitColors {
  const hash = Math.abs(hashString(teamKey));
  const primary = KIT_COLOR_PALETTE[hash % KIT_COLOR_PALETTE.length];
  const accent = KIT_COLOR_PALETTE[(hash + 3) % KIT_COLOR_PALETTE.length];
  return {
    primary: preferAwayKit ? accent : primary,
    secondary: preferAwayKit ? '#0F172A' : '#FFFFFF',
    text: preferAwayKit ? '#F8FAFC' : '#0F172A',
    shorts: preferAwayKit ? '#0F172A' : '#F8FAFC',
    socks: preferAwayKit ? accent : primary,
    gkPrimary: preferAwayKit ? '#FFFFFF' : '#111827',
    gkSecondary: preferAwayKit ? accent : '#FFFFFF',
  };
}

function deriveTeamKitColors(team: ClubTeam | null, teamKey: string, preferAwayKit: boolean): TeamKitColors {
  const candidate = findTeamKitSource(team, preferAwayKit);
  const normalized = normalizeTeamKitColors(candidate);
  return normalized ?? fallbackKitFromKey(teamKey, preferAwayKit);
}

function findTeamKitSource(team: ClubTeam | null, preferAwayKit: boolean): Record<string, unknown> | undefined {
  if (!team) return undefined;
  const lookup = team as Record<string, unknown>;
  const suffix = preferAwayKit ? 'away' : 'home';
  const targetedPaths = [`${suffix}KitColors`, `${suffix}Kit`, `${suffix}KitSpec`];

  for (const path of targetedPaths) {
    const candidate = lookup[path];
    if (isKitObject(candidate)) return candidate as Record<string, unknown>;
  }

  const kits = lookup.kits;
  if (isKitObject(kits)) {
    const kitName = lookup[suffix === 'home' ? 'kitHome' : 'kitAway'];
    if (typeof kitName === 'string') {
      const named = (kits as Record<string, unknown>)[kitName];
      if (isKitObject(named)) return named as Record<string, unknown>;
    }
    const fallbackBySide = (kits as Record<string, unknown>)[suffix];
    if (isKitObject(fallbackBySide)) return fallbackBySide as Record<string, unknown>;
  }

  const genericPaths = ['kitColors', 'kit', 'kitSpec'];
  for (const path of genericPaths) {
    const candidate = lookup[path];
    if (isKitObject(candidate)) {
      const nested = (candidate as Record<string, unknown>)[suffix];
      if (isKitObject(nested)) return nested as Record<string, unknown>;
      return candidate as Record<string, unknown>;
    }
    if (isKitObject((candidate as Record<string, unknown>)?.[suffix])) {
      return (candidate as Record<string, unknown>)[suffix] as Record<string, unknown>;
    }
  }

  return undefined;
}

function normalizeTeamKitColors(source: Record<string, unknown> | undefined): TeamKitColors | undefined {
  if (!source) return undefined;
  const kit: TeamKitColors = {};
  const primary = pickColor(source, ['primary', 'primaryColor', 'color1', 'main', 'mainColor']);
  if (primary) kit.primary = primary;
  const secondary = pickColor(source, ['secondary', 'secondaryColor', 'color2']);
  if (secondary) kit.secondary = secondary;
  const text = pickColor(source, ['text', 'textColor']);
  if (text) {
    kit.text = text;
  } else {
    const accent = pickColor(source, ['accent', 'color3']);
    if (accent) kit.text = accent;
  }
  const shorts = pickColor(source, ['shorts', 'shirt', 'shortColor']);
  if (shorts) kit.shorts = shorts;
  const socks = pickColor(source, ['socks', 'sockColor']);
  if (socks) kit.socks = socks;
  const gkPrimary =
    pickColor(source, ['gkPrimary', 'goalkeeperPrimary', 'keeperPrimary']) ??
    kit.primary;
  if (gkPrimary) kit.gkPrimary = gkPrimary;
  const gkSecondary =
    pickColor(source, ['gkSecondary', 'goalkeeperSecondary', 'keeperSecondary']) ??
    kit.secondary ??
    kit.primary;
  if (gkSecondary) kit.gkSecondary = gkSecondary;

  if (!kit.primary && !kit.secondary && !kit.text && !kit.shorts && !kit.socks && !kit.gkPrimary && !kit.gkSecondary) {
    return undefined;
  }
  return kit;
}

function pickColor(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    const normalized = normalizeHexColor(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const hexMatch = trimmed.match(/^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split('')
        .map((char) => char + char)
        .join('');
    }
    return `#${hex.toUpperCase()}`;
  }

  const rgbMatch = trimmed.match(/^rgba?\\(([^)]+)\\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((part) => part.trim());
    if (parts.length >= 3) {
      const clamp255 = (num: number) => Math.max(0, Math.min(255, Math.round(num)));
      const toHex = (num: number) => num.toString(16).padStart(2, '0').toUpperCase();
      const r = clamp255(Number(parts[0]));
      const g = clamp255(Number(parts[1]));
      const b = clamp255(Number(parts[2]));
      let result = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
      const alphaPart = parts[3];
      if (alphaPart !== undefined) {
        const alphaNum = Number(alphaPart);
        if (!Number.isNaN(alphaNum)) {
          const alpha = clamp255(alphaNum <= 1 ? alphaNum * 255 : alphaNum);
          result += toHex(alpha);
        }
      }
      return result;
    }
  }

  return trimmed;
}

function isKitObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function normalizeFormationLabel(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith('_')) return value;
  return value
    .slice(1)
    .split('_')
    .filter(Boolean)
    .join('-');
}

function deriveTeamKeyValue(teamId?: string | null, fallback = 'TEAM'): string {
  if (teamId && teamId.trim().length) return teamId;
  return fallback;
}

function createRequestToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}



