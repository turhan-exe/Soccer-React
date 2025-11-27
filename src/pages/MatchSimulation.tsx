import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackButton } from '@/components/ui/back-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { UnityMatchLauncher } from '@/components/unity/UnityMatchLauncher';
import { useAuth } from '@/contexts/AuthContext';
import { getFixturesForTeam, getMyLeagueId } from '@/services/leagues';
import { getTeam } from '@/services/team';
import type { ClubTeam, Fixture, Player } from '@/types';
import type {
  BridgeMatchRequest,
  BridgeMatchResult,
  GoalTimelineEntry,
  PublishTeamsPayload,
  RuntimePlayer,
  RuntimeTeam,
  ShowTeamsPayload,
  TeamBadge,
  TeamKitAssets,
} from '@/services/unityBridge';
import { runtimeTeamToPublishedTeam, toUnityFormationEnum } from '@/services/unityBridge';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type UserSide = 'Home' | 'Away' | 'None';

const POSITION_ORDER: Player['position'][] = ['GK', 'LB', 'CB', 'RB', 'LM', 'CM', 'RM', 'CAM', 'LW', 'ST', 'RW'];
const DEFAULT_AI_LEVEL = 'Legendary';

export default function MatchSimulation() {
  const { user } = useAuth();
  const [status, setStatus] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [homeTeam, setHomeTeam] = useState<ClubTeam | null>(null);
  const [awayTeam, setAwayTeam] = useState<ClubTeam | null>(null);
  const [autoPublishPayload, setAutoPublishPayload] = useState<PublishTeamsPayload | null>(null);
  const [autoShowPayload, setAutoShowPayload] = useState<ShowTeamsPayload | null>(null);
  const [autoMatchPayload, setAutoMatchPayload] = useState<BridgeMatchRequest | null>(null);
  const [lastResult, setLastResult] = useState<BridgeMatchResult | null>(null);
  const [lastRequestToken, setLastRequestToken] = useState<string | null>(null);
  const [useGoalTimeline, setUseGoalTimeline] = useState(true);
  const [homeGoalMinutes, setHomeGoalMinutes] = useState('15,85');
  const [awayGoalMinutes, setAwayGoalMinutes] = useState('25');

  useEffect(() => {
    if (!user) {
      setStatus('error');
      setError('Simülasyon için önce giriş yapmalısın.');
      setFixture(null);
      setHomeTeam(null);
      setAwayTeam(null);
      return;
    }
    let mounted = true;
    setStatus('loading');
    setError(null);
    setLastResult(null);
    setAutoMatchPayload(null);

    (async () => {
      try {
        const leagueId = await getMyLeagueId(user.id);
        if (!mounted) return;
        if (!leagueId) {
          throw new Error('Lig bilgisi bulunamadı. Takımın bir lige bağlı mı?');
        }
        const fixtures = await getFixturesForTeam(leagueId, user.id);
        if (!mounted) return;
        const upcoming = fixtures
          .filter((f) => f.status !== 'played')
          .sort((a, b) => (a.date as Date).getTime() - (b.date as Date).getTime())[0];
        if (!upcoming) {
          throw new Error('Yaklaşan maç bulunamadı.');
        }
        const [home, away] = await Promise.all([getTeam(upcoming.homeTeamId), getTeam(upcoming.awayTeamId)]);
        if (!mounted) return;
        if (!home || !away) {
          throw new Error('Takım kadroları alınamadı. Firestore yetkilerini kontrol et.');
        }
        setFixture(upcoming);
        setHomeTeam(home);
        setAwayTeam(away);
        setStatus('ready');
      } catch (err) {
        if (!mounted) return;
        console.error('[MatchSimulation] Kadrolar yüklenemedi', err);
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Simülasyon verisi alınamadı.');
      }
    })();

    return () => {
      mounted = false;
    };
  }, [user]);

  const userSide: UserSide = useMemo(() => {
    if (!fixture || !user) return 'None';
    return fixture.homeTeamId === user.id ? 'Home' : 'Away';
  }, [fixture, user]);

  const homeRuntime = useMemo(() => buildRuntimeTeam(homeTeam, 'Ev Sahibi'), [homeTeam]);
  const awayRuntime = useMemo(() => buildRuntimeTeam(awayTeam, 'Deplasman'), [awayTeam]);

  useEffect(() => {
    if (!fixture || !homeRuntime || !awayRuntime) {
      setAutoPublishPayload(null);
      setAutoShowPayload(null);
      return;
    }
    const homeKey = deriveTeamKey(fixture.homeTeamId, homeRuntime, 'HOME');
    const awayKey = deriveTeamKey(fixture.awayTeamId, awayRuntime, 'AWAY');
    const homeTeam = runtimeTeamToPublishedTeam(homeRuntime, { teamKey: homeKey, preferAwayKit: false });
    const awayTeam = runtimeTeamToPublishedTeam(awayRuntime, { teamKey: awayKey, preferAwayKit: true });
    const publishPayload: PublishTeamsPayload = {
      homeTeamKey: homeKey,
      awayTeamKey: awayKey,
      homeTeam,
      awayTeam,
      cacheOnly: false,
    };
    setAutoPublishPayload(publishPayload);
    setAutoShowPayload({
      homeTeam,
      awayTeam,
      homeTeamKey: homeKey,
      awayTeamKey: awayKey,
      aiLevel: DEFAULT_AI_LEVEL,
      userTeam: userSide,
      autoStart: false,
    });
  }, [fixture, homeRuntime, awayRuntime, userSide]);

  useEffect(() => {
    setAutoMatchPayload(null);
    setLastRequestToken(null);
  }, [fixture?.id]);

  const startSimulation = useCallback(() => {
    if (!fixture || !homeRuntime || !awayRuntime) return;
    const token = createRequestToken();
    setLastRequestToken(token);
    const timeline = useGoalTimeline ? buildGoalTimelineEntries(homeGoalMinutes, awayGoalMinutes) : [];
    const homeKey =
      autoPublishPayload?.homeTeam.teamKey ?? deriveTeamKey(fixture.homeTeamId, homeRuntime, 'HOME');
    const awayKey =
      autoPublishPayload?.awayTeam.teamKey ?? deriveTeamKey(fixture.awayTeamId, awayRuntime, 'AWAY');
    const payload: BridgeMatchRequest = {
      matchId: fixture.id,
      homeTeamKey: homeKey,
      awayTeamKey: awayKey,
      aiLevel: DEFAULT_AI_LEVEL,
      userTeam: userSide,
      dayTime: 'Night',
      autoStart: true,
      requestToken: token,
      goalTimeline: timeline.length ? timeline : undefined,
    };
    setAutoMatchPayload(payload);
  }, [fixture, homeRuntime, awayRuntime, userSide, autoPublishPayload, useGoalTimeline, homeGoalMinutes, awayGoalMinutes]);

  const homeName = homeRuntime?.name || homeTeam?.name || fixture?.homeTeamId || 'Ev Sahibi';
  const awayName = awayRuntime?.name || awayTeam?.name || fixture?.awayTeamId || 'Deplasman';
  const startDisabled = status !== 'ready' || !homeRuntime || !awayRuntime;

  const header = (
    <div className="border-b bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3">
        <BackButton />
        <div className="flex flex-col">
          <span className="text-base font-semibold">Maç Simülasyonu (Unity)</span>
          <span className="text-xs text-muted-foreground">Kadroları Unity TeamSelection ekranına bas ve sonucu geri al.</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen w-full flex-col bg-muted/10">
      {header}
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-4">
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1 text-sm">
              <div className="font-semibold text-base">
                {homeName} vs {awayName}
              </div>
              {fixture?.date && (
                <div className="text-muted-foreground">
                  {fixture.date instanceof Date ? fixture.date.toLocaleString() : String(fixture.date)}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                Durum: {status === 'loading' ? 'Veriler yükleniyor...' : status === 'ready' ? 'Hazır' : error || 'Bilinmiyor'}
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" disabled={status === 'loading'} onClick={() => window.location.reload()}>
                Verileri Yenile
              </Button>
              <Button onClick={startSimulation} disabled={startDisabled}>
                Simülasyonu Başlat
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-6 p-4 md:grid-cols-2">
            <TeamSnapshot label="Ev Sahibi" runtime={homeRuntime} />
            <TeamSnapshot label="Deplasman" runtime={awayRuntime} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="font-semibold">Gol zamanlamasi</div>
                <div className="text-xs text-muted-foreground">
                  Dakikalari virgul ile ayir (ornegin: 15,85). Aktifken Unity'ye goalTimeline olarak gonderilir.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Aktif</span>
                <Switch checked={useGoalTimeline} onCheckedChange={setUseGoalTimeline} />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="home-goal-minutes">Ev gol dakikalari</Label>
                <Input
                  id="home-goal-minutes"
                  value={homeGoalMinutes}
                  onChange={(e) => setHomeGoalMinutes(e.target.value)}
                  placeholder="15,85"
                  disabled={!useGoalTimeline}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="away-goal-minutes">Deplasman gol dakikalari</Label>
                <Input
                  id="away-goal-minutes"
                  value={awayGoalMinutes}
                  onChange={(e) => setAwayGoalMinutes(e.target.value)}
                  placeholder="25"
                  disabled={!useGoalTimeline}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setHomeGoalMinutes('15,85');
                  setAwayGoalMinutes('25');
                  setUseGoalTimeline(true);
                }}
              >
                2-1 senaryosunu yukle
              </Button>
              <div className="text-xs text-muted-foreground">
                Ornek: Ev 15' ve 85', deplasman 25'. Negatif dakikalar otomatik filtrelenir.
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-col gap-1">
              <div className="font-semibold">Unity Köprü</div>
              <div className="text-xs text-muted-foreground">
                Bu iframe `/Unity/match-viewer` içindeki WebGL build'i yükler. React tarafı `MatchBridgeAPI` hazır olunca otomatik olarak kadroları basar.
              </div>
            </div>
            <UnityMatchLauncher
              title="Unity Simülatörü"
              autoPublishPayload={autoPublishPayload}
              autoShowTeamsPayload={autoShowPayload}
              autoPayload={autoMatchPayload}
              onResult={(res) => setLastResult(res)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 p-4 text-sm">
            <div className="font-semibold">Son Simülasyon</div>
            {lastResult ? (
              <>
                <div>
                  {lastResult.homeTeam ?? homeName} {lastResult.homeGoals ?? '-'} - {lastResult.awayGoals ?? '-'}{' '}
                  {lastResult.awayTeam ?? awayName}
                </div>
                {lastResult.scorers?.length ? (
                  <div className="text-xs text-muted-foreground">Goller: {lastResult.scorers.join(', ')}</div>
                ) : null}
                {lastResult.requestToken || lastRequestToken ? (
                  <div className="text-xs text-muted-foreground">
                    İstek: {lastResult.requestToken || lastRequestToken}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="text-muted-foreground">Henüz sonuç alınmadı.</div>
            )}
          </CardContent>
        </Card>

        {status === 'error' && error ? (
          <Card>
            <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function parseGoalMinutes(input: string): number[] {
  return input
    .split(/[^0-9]+/)
    .map((token) => Number.parseInt(token, 10))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function buildGoalTimelineEntries(homeInput: string, awayInput: string): GoalTimelineEntry[] {
  const entries: GoalTimelineEntry[] = [];
  for (const minute of parseGoalMinutes(homeInput)) {
    entries.push({ minute, team: 'home', type: 'goal' });
  }
  for (const minute of parseGoalMinutes(awayInput)) {
    entries.push({ minute, team: 'away', type: 'goal' });
  }
  return entries.sort((a, b) => {
    if (a.minute !== b.minute) return a.minute - b.minute;
    if (a.team === b.team) return 0;
    return a.team === 'home' ? -1 : 1;
  });
}

function TeamSnapshot({ label, runtime }: { label: string; runtime: RuntimeTeam | null }) {
  if (!runtime) {
    return (
      <div className="rounded border border-dashed border-muted px-3 py-6 text-center text-sm text-muted-foreground">
        {label} kadrosu hazırlanamadı.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold">{runtime.name || label}</div>
        {runtime.formation && (
          <div className="text-xs uppercase text-muted-foreground">
            Diziliş: {runtime.formation.replace(/_/g, ' ')}
          </div>
        )}
      </div>
      {runtime.players?.length ? (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">İlk 11</div>
          <ol className="mt-1 space-y-1 text-sm">
            {runtime.players.map((name, index) => (
              <li key={`${runtime.name}-player-${index}`} className="flex items-center justify-between gap-2">
                <span>
                  {index + 1}. {name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {runtime.playersData?.[index]?.position ?? runtime.playersData?.[index]?.id ?? ''}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {runtime.bench?.length ? (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Yedekler</div>
          <ol className="mt-1 space-y-1 text-sm">
            {runtime.bench.map((name, index) => (
              <li key={`${runtime.name}-bench-${index}`} className="flex items-center justify-between gap-2">
                <span>
                  {index + 1}. {name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {runtime.benchData?.[index]?.position ?? runtime.benchData?.[index]?.id ?? ''}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function buildRuntimeTeam(team: ClubTeam | null, fallbackName: string): RuntimeTeam | null {
  if (!team || !Array.isArray(team.players) || !team.players.length) {
    return null;
  }

  const lineup = pickStartingXI(team.players);
  const starters = new Set(lineup.map((p) => p.id));
  const benchPlayers = selectBench(team.players, starters);
  const ensureNames = (list: Player[], min = 11) => {
    const names = list.map((p) => p.name);
    while (names.length < min) {
      names.push(`Player ${names.length + 1}`);
    }
    return names;
  };

  const players = ensureNames(lineup);
  const playersData = lineup.map(mapPlayerToRuntime);
  while (playersData.length < players.length) {
    const idx = playersData.length;
    playersData.push({ name: players[idx] } as RuntimePlayer);
  }
  const bench = benchPlayers.map((p) => p.name);
  const benchData = benchPlayers.map(mapPlayerToRuntime);

  const badge: TeamBadge | undefined =
    team.badge ?? (team.logo ? { url: team.logo, alt: `${team.name} logo` } : undefined);
  const kitAssets: TeamKitAssets | undefined = team.kit ?? undefined;

  return {
    name: team.name || fallbackName,
    players,
    playersData,
    bench,
    benchData,
    formation: guessFormation(lineup),
    badge,
    kitAssets,
  };
}

function pickStartingXI(players: Player[]): Player[] {
  if (!players.length) return [];
  const starters = players
    .filter((p) => p.squadRole === 'starting')
    .sort(sortPlayersByLine)
    .slice(0, 11);
  if (starters.length >= 11) {
    return starters;
  }
  const used = new Set(starters.map((p) => p.id));
  const fillers = players
    .filter((p) => !used.has(p.id))
    .sort((a, b) => {
      const bucketDiff = bucketPosition(a.position) - bucketPosition(b.position);
      if (bucketDiff !== 0) return bucketDiff;
      return b.overall - a.overall;
    });
  return [...starters, ...fillers].slice(0, 11);
}

function selectBench(players: Player[], starters: Set<string>, limit = 9): Player[] {
  const benchPreferred = players
    .filter((p) => p.squadRole === 'bench' && !starters.has(p.id))
    .sort(compareBench);
  if (benchPreferred.length >= limit) {
    return benchPreferred.slice(0, limit);
  }
  const used = new Set([...starters, ...benchPreferred.map((p) => p.id)]);
  const rest = players
    .filter((p) => !used.has(p.id))
    .sort(compareBench);
  return [...benchPreferred, ...rest].slice(0, limit);
}

function compareBench(a: Player, b: Player): number {
  const aOrder = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
  const bOrder = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return bucketPosition(a.position) - bucketPosition(b.position);
}

function sortPlayersByLine(a: Player, b: Player): number {
  const bucketDiff = bucketPosition(a.position) - bucketPosition(b.position);
  if (bucketDiff !== 0) return bucketDiff;
  const orderDiff = POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position);
  if (orderDiff !== 0) return orderDiff;
  return a.name.localeCompare(b.name);
}

function bucketPosition(pos: Player['position']): number {
  if (pos === 'GK') return 0;
  if (pos === 'LB' || pos === 'CB' || pos === 'RB') return 1;
  if (pos === 'LM' || pos === 'CM' || pos === 'RM' || pos === 'CAM') return 2;
  return 3;
}

function guessFormation(players: Player[]): string | undefined {
  if (!players.length) return undefined;
  const defenders = players.filter((p) => ['LB', 'RB', 'CB'].includes(p.position)).length;
  const forwards = players.filter((p) => ['LW', 'RW', 'ST'].includes(p.position)).length;
  const midfielders = Math.max(0, 11 - defenders - forwards);
  const label = `${defenders}-${midfielders}-${forwards || 3}`;
  return toUnityFormationEnum(label) || toUnityFormationEnum('4-3-3');
}

function mapPlayerToRuntime(p: Player): RuntimePlayer {
  const a: Record<string, number> | undefined = p.attributes as any;
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

function createRequestToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function deriveTeamKey(teamId?: string | null, team?: RuntimeTeam | null, fallback = 'TEAM'): string {
  if (teamId && teamId.trim().length) return teamId;
  if (team?.name && team.name.trim().length) {
    return team.name.trim().toUpperCase().replace(/\s+/g, '_');
  }
  return fallback;
}
