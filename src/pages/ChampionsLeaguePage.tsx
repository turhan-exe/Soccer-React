import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CalendarClock,
  Clock3,
  Medal,
  Shield,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  Tv,
} from 'lucide-react';

import { PagesHeader } from '@/components/layout/PagesHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getLatestChampionsLeagueOverview } from '@/services/championsLeague';
import { auth } from '@/services/firebase';
import { getTeam } from '@/services/team';
import type { ChampionsLeagueEntrantDoc, KnockoutMatchDoc, League } from '@/types';

type OverviewState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      league: League;
      entrants: ChampionsLeagueEntrantDoc[];
      matches: KnockoutMatchDoc[];
      myTeamId: string | null;
    };

type ColumnSide = 'left' | 'right';

function asDate(value: unknown): Date | null {
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  return null;
}

function getBracketSize(teamCount: number) {
  let size = 1;
  while (size < Math.max(1, teamCount)) {
    size *= 2;
  }
  return size;
}

function formatKickoff(date: Date, withWeekday = false) {
  return new Intl.DateTimeFormat('tr-TR', {
    weekday: withWeekday ? 'short' : undefined,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  }).format(date);
}

function formatStageDay(date: Date) {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'long',
    timeZone: 'Europe/Istanbul',
  }).format(date);
}

function scoreLabel(match: KnockoutMatchDoc) {
  if (!match.score) return null;
  const base = `${match.score.home} - ${match.score.away}`;
  if (match.decidedBy === 'penalties' && match.penalties) {
    return `${base} • P ${match.penalties.home}-${match.penalties.away}`;
  }
  if (match.decidedBy === 'bye') {
    return 'Bay geçti';
  }
  return base;
}

function getMatchStatusMeta(match: KnockoutMatchDoc) {
  if (match.decidedBy === 'bye') {
    return {
      label: 'Bay geçti',
      detail: 'Rakipsiz tur atladı',
      pillClass:
        'border-emerald-400/30 bg-emerald-400/12 text-emerald-100 shadow-[0_0_24px_rgba(52,211,153,0.18)]',
    };
  }

  if (match.status === 'running') {
    return {
      label: 'Canlı',
      detail: 'Maç şu anda oynanıyor',
      pillClass:
        'border-rose-400/35 bg-rose-400/12 text-rose-100 shadow-[0_0_24px_rgba(251,113,133,0.18)]',
    };
  }

  if (match.status === 'completed') {
    return {
      label: match.decidedBy === 'penalties' ? 'Penaltılarla bitti' : 'Tamamlandı',
      detail: match.winnerTeamName ? `Kazanan: ${match.winnerTeamName}` : 'Tur sonucu işlendi',
      pillClass:
        'border-sky-400/30 bg-sky-400/12 text-sky-100 shadow-[0_0_24px_rgba(56,189,248,0.16)]',
    };
  }

  if (match.homeTeamId && match.awayTeamId) {
    return {
      label: 'Planlandı',
      detail: 'Kart hazır, kickoff saati bekleniyor',
      pillClass: 'border-white/12 bg-white/6 text-slate-100',
    };
  }

  return {
    label: 'Eşleşme bekleniyor',
    detail: 'Kaynak maç sonucu gelecek',
    pillClass: 'border-white/10 bg-white/5 text-slate-200',
  };
}

function getStageTitle(matches: KnockoutMatchDoc[], round: number) {
  const firstNamed = matches.find((match) => match.roundName)?.roundName?.trim();
  return firstNamed || `Tur ${round}`;
}

function TeamSlot(props: {
  seed: number | null;
  name: string | null | undefined;
  leagueName: string | null | undefined;
  highlighted: boolean;
  winner: boolean;
}) {
  const { seed, name, leagueName, highlighted, winner } = props;

  return (
    <div
      className={`flex items-center gap-3 rounded-[22px] border px-3 py-3 transition ${
        highlighted
          ? 'border-amber-300/45 bg-amber-300/14 text-amber-50 shadow-[0_0_30px_rgba(252,211,77,0.12)]'
          : winner
            ? 'border-emerald-300/30 bg-emerald-300/10 text-white'
            : 'border-white/10 bg-white/6 text-white'
      }`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border text-[11px] font-black tracking-[0.18em] ${
          highlighted
            ? 'border-amber-200/55 bg-amber-100/10 text-amber-100'
            : winner
              ? 'border-emerald-200/35 bg-emerald-100/10 text-emerald-50'
              : 'border-white/10 bg-slate-950/70 text-white/70'
        }`}
      >
        {seed ? `#${seed}` : '?'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{name || 'Bekleniyor'}</div>
        <div className="truncate text-[11px] uppercase tracking-[0.22em] text-white/50">
          {leagueName || 'Kaynak maç bekleniyor'}
        </div>
      </div>
      {winner && <Medal className="h-4 w-4 shrink-0 text-emerald-300" />}
    </div>
  );
}

function BracketMatchCard(props: {
  match: KnockoutMatchDoc;
  myTeamId: string | null;
  side?: ColumnSide | 'center';
  compact?: boolean;
  onOpenMatch: (fixtureId: string) => void;
}) {
  const { match, myTeamId, side = 'left', compact = false, onOpenMatch } = props;
  const homeHighlighted = Boolean(myTeamId && match.homeTeamId === myTeamId);
  const awayHighlighted = Boolean(myTeamId && match.awayTeamId === myTeamId);
  const canOpenMatch = Boolean(
    match.fixtureId &&
      (match.status === 'running' || match.status === 'completed' || match.status === 'scheduled'),
  );
  const statusMeta = getMatchStatusMeta(match);
  const isCenter = side === 'center';
  const winnerName = match.winnerTeamName || null;

  return (
    <div
      className={`relative w-full ${isCenter ? 'max-w-[360px]' : 'max-w-[300px]'} ${
        side === 'left' ? 'self-end' : side === 'right' ? 'self-start' : 'mx-auto'
      }`}
    >
      {!isCenter && (
        <div
          className={`pointer-events-none absolute top-1/2 hidden h-px w-7 -translate-y-1/2 lg:block ${
            side === 'left'
              ? '-right-7 bg-gradient-to-r from-white/35 to-transparent'
              : '-left-7 bg-gradient-to-l from-white/35 to-transparent'
          }`}
        />
      )}

      <div
        className={`relative overflow-hidden rounded-[30px] border ${
          isCenter
            ? 'border-amber-300/30 bg-[radial-gradient(circle_at_top,rgba(250,204,21,0.16),transparent_38%),linear-gradient(180deg,rgba(35,23,49,0.96),rgba(9,14,28,0.98))] shadow-[0_28px_80px_rgba(250,204,21,0.12)]'
            : 'border-white/10 bg-[linear-gradient(180deg,rgba(10,17,33,0.96),rgba(4,9,18,0.98))] shadow-[0_18px_60px_rgba(2,6,23,0.48)]'
        } px-4 ${compact ? 'py-4' : 'py-5'} backdrop-blur-2xl`}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
        <div
          className={`mb-4 flex items-start justify-between gap-3 ${
            compact ? 'text-[10px]' : 'text-[11px]'
          } uppercase tracking-[0.28em] text-white/48`}
        >
          <div className="flex items-center gap-2">
            {isCenter ? <Trophy className="h-4 w-4 text-amber-300" /> : <Swords className="h-4 w-4 text-sky-300" />}
            <span>{match.roundName}</span>
          </div>
          <span>{formatKickoff(match.scheduledAt)}</span>
        </div>

        <div className="space-y-2.5">
          <TeamSlot
            seed={match.homeSeed}
            name={match.homeTeamName || match.homeTeamId}
            leagueName={match.homeLeagueName}
            highlighted={homeHighlighted}
            winner={Boolean(winnerName && match.homeTeamName === winnerName)}
          />
          <TeamSlot
            seed={match.awaySeed}
            name={match.awayTeamName || match.awayTeamId}
            leagueName={match.awayLeagueName}
            highlighted={awayHighlighted}
            winner={Boolean(winnerName && match.awayTeamName === winnerName)}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-black tracking-tight text-white">{scoreLabel(match) || statusMeta.label}</div>
            <div className="mt-1 text-xs text-white/55">{statusMeta.detail}</div>
          </div>
          <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] ${statusMeta.pillClass}`}>
            {statusMeta.label}
          </span>
        </div>

        {match.winnerTeamName && (
          <div className="mt-4 rounded-2xl border border-white/8 bg-black/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-100/80">
            Tur atlayan: {match.winnerTeamName}
          </div>
        )}

        {canOpenMatch && match.fixtureId && (
          <button
            type="button"
            onClick={() => onOpenMatch(match.fixtureId!)}
            className="mt-4 flex w-full items-center justify-between rounded-[20px] border border-white/10 bg-white/6 px-3 py-3 text-sm font-semibold text-white transition hover:border-sky-300/35 hover:bg-sky-300/10"
          >
            <span>
              {match.status === 'running' ? 'Canlı maça git' : match.status === 'completed' ? 'Maç kaydını aç' : 'Maç kartını aç'}
            </span>
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function StageColumn(props: {
  title: string;
  subtitle: string;
  matches: KnockoutMatchDoc[];
  myTeamId: string | null;
  side: ColumnSide;
  onOpenMatch: (fixtureId: string) => void;
}) {
  const { title, subtitle, matches, myTeamId, side, onOpenMatch } = props;

  return (
    <div className={`relative flex min-w-[300px] flex-col ${side === 'left' ? 'items-end' : 'items-start'}`}>
      <div className={`mb-4 w-full max-w-[300px] ${side === 'left' ? 'text-right' : 'text-left'}`}>
        <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-white/60">
          {title}
        </div>
        <div className="mt-3 text-sm font-medium text-white/50">{subtitle}</div>
      </div>

      <div className="relative flex min-h-[640px] w-full flex-1 flex-col justify-around gap-8">
        <div
          className={`pointer-events-none absolute inset-y-4 hidden w-px lg:block ${
            side === 'left'
              ? 'right-[-14px] bg-gradient-to-b from-transparent via-sky-300/28 to-transparent'
              : 'left-[-14px] bg-gradient-to-b from-transparent via-sky-300/28 to-transparent'
          }`}
        />
        {matches.map((match) => (
          <BracketMatchCard
            key={match.id}
            match={match}
            myTeamId={myTeamId}
            side={side}
            compact={matches.length > 2}
            onOpenMatch={onOpenMatch}
          />
        ))}
      </div>
    </div>
  );
}

export default function ChampionsLeaguePage() {
  const navigate = useNavigate();
  const [state, setState] = useState<OverviewState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [overview, myTeam] = await Promise.all([
          getLatestChampionsLeagueOverview(),
          auth.currentUser ? getTeam(auth.currentUser.uid).catch(() => null) : Promise.resolve(null),
        ]);

        if (cancelled) return;

        if (!overview) {
          setState({ status: 'empty' });
          return;
        }

        setState({
          status: 'ready',
          league: overview.league,
          entrants: overview.entrants,
          matches: overview.matches,
          myTeamId: myTeam?.id || auth.currentUser?.uid || null,
        });
      } catch (error: any) {
        if (cancelled) return;

        setState({
          status: 'error',
          message: error?.message || 'Şampiyonlar Ligi verisi alınamadı.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const content = useMemo(() => {
    if (state.status !== 'ready') {
      return null;
    }

    const competitionStart = asDate(state.league.startDate);
    const bracketSize = getBracketSize(state.entrants.length);
    const byeCount = Math.max(0, bracketSize - state.entrants.length);
    const totalRounds = Math.max(...state.matches.map((match) => match.round));
    const finalMatch = state.matches.find((match) => match.round === totalRounds) || null;
    const roundsBeforeFinal = Array.from({ length: Math.max(0, totalRounds - 1) }, (_, index) => index + 1);
    const leftColumns = roundsBeforeFinal.map((round) => {
      const roundMatches = state.matches.filter((match) => match.round === round);
      const half = Math.ceil(roundMatches.length / 2);
      const matches = roundMatches.filter((match) => match.slot <= half);
      return {
        round,
        title: getStageTitle(matches, round),
        subtitle: `${matches.length} eşleşme`,
        matches,
      };
    });
    const rightColumns = [...roundsBeforeFinal]
      .reverse()
      .map((round) => {
        const roundMatches = state.matches.filter((match) => match.round === round);
        const half = Math.ceil(roundMatches.length / 2);
        const matches = roundMatches.filter((match) => match.slot > half);
        return {
          round,
          title: getStageTitle(matches, round),
          subtitle: `${matches.length} eşleşme`,
          matches,
        };
      });

    const orderedUpcoming = [...state.matches]
      .filter((match) => match.status !== 'completed' && match.status !== 'failed')
      .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime());

    const nextKickoff = orderedUpcoming[0] || null;
    const completedMatches = state.matches.filter((match) => match.status === 'completed').length;
    const liveMatches = state.matches.filter((match) => match.status === 'running').length;
    const myEntrant = state.entrants.find((entrant) => entrant.teamId === state.myTeamId) || null;
    const myActiveMatch =
      orderedUpcoming.find(
        (match) => match.homeTeamId === state.myTeamId || match.awayTeamId === state.myTeamId,
      ) || null;
    const myLastCompleted =
      [...state.matches]
        .reverse()
        .find(
          (match) =>
            (match.homeTeamId === state.myTeamId || match.awayTeamId === state.myTeamId) &&
            match.status === 'completed',
        ) || null;

    return {
      bracketSize,
      byeCount,
      competitionStart,
      completedMatches,
      finalMatch,
      leftColumns,
      liveMatches,
      myActiveMatch,
      myEntrant,
      myLastCompleted,
      nextKickoff,
      rightColumns,
      totalRounds,
      topSeeds: state.entrants.slice(0, 6),
    };
  }, [state]);

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.2),transparent_28%),radial-gradient(circle_at_top_right,rgba(245,158,11,0.12),transparent_22%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.14),transparent_24%),linear-gradient(180deg,#081120_0%,#050912_48%,#02050b_100%)] px-4 py-6 text-slate-100 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-6">
        <PagesHeader
          title="Şampiyonlar Ligi"
          description="Lig şampiyonları sabah 11:00 slotunda tek maç eleme ile kupaya ilerliyor."
        />

        {state.status === 'loading' && (
          <Card className="overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgba(8,15,28,0.92),rgba(4,8,18,0.98))] p-7 text-slate-200">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-300/25 bg-sky-400/10">
                <Sparkles className="h-5 w-5 text-sky-200" />
              </div>
              <div>
                <div className="text-lg font-black text-white">Turnuva sahnesi yükleniyor</div>
                <div className="text-sm text-slate-400">Bracket, eşleşmeler ve kulübünün yolu hazırlanıyor.</div>
              </div>
            </div>
          </Card>
        )}

        {state.status === 'error' && (
          <Card className="border-red-400/20 bg-red-950/30 p-6 text-sm text-red-100">{state.message}</Card>
        )}

        {state.status === 'empty' && (
          <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.1),transparent_32%),linear-gradient(180deg,rgba(7,13,24,0.96),rgba(3,7,15,0.98))] p-8 text-center">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full border border-amber-300/20 bg-amber-300/10">
              <Trophy className="h-10 w-10 text-amber-300" />
            </div>
            <div className="text-2xl font-black text-white">Henüz aktif bir Şampiyonlar Ligi yok</div>
            <div className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Turnuva ayın son gününde oluşturulur. Lig şampiyonları kesinleşince sahne burada açılır ve tüm eleme ağacı gerçek zamanlı turnuva verisiyle görünür.
            </div>
            <Button className="mt-6" onClick={() => navigate('/leagues')}>
              Liglere dön
            </Button>
          </Card>
        )}

        {state.status === 'ready' && content && (
          <>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_380px]">
              <Card className="relative overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.22),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.14),transparent_24%),linear-gradient(135deg,rgba(12,20,38,0.98),rgba(7,11,22,0.98))] p-6 shadow-[0_30px_90px_rgba(2,6,23,0.36)]">
                <div className="pointer-events-none absolute inset-y-0 right-[-80px] w-[280px] rounded-full bg-[radial-gradient(circle,rgba(250,204,21,0.16),transparent_62%)] blur-3xl" />
                <div className="pointer-events-none absolute left-0 top-0 h-px w-full bg-gradient-to-r from-transparent via-white/30 to-transparent" />

                <div className="relative z-10">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-100">
                      {state.league.sourceMonth || 'Aylık Turnuva'}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/65">
                      {state.entrants.length} şampiyon
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/65">
                      {content.totalRounds} tur
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/65">
                      Sabah 11:00
                    </span>
                  </div>

                  <div className="mt-5 max-w-3xl">
                    <div className="text-4xl font-black tracking-tight text-white md:text-[2.8rem]">
                      Karanlık sahnede net akış, tek merkezde final.
                    </div>
                    <div className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                      Turlar iki günde bir açılır. Her eşleşme aynı sahne diliyle okunur; seed, kaynak lig, sonuç ve canlı bağlantı tek kartta kalır. Amaç boşluk değil, turnuva tansiyonu hissettiren yoğun bir okuma akışı.
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[26px] border border-white/10 bg-black/15 p-4">
                      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/48">
                        <CalendarClock className="h-4 w-4 text-sky-300" />
                        Sonraki kickoff
                      </div>
                      <div className="mt-3 text-2xl font-black text-white">
                        {content.nextKickoff ? formatKickoff(content.nextKickoff.scheduledAt) : 'Hazır'}
                      </div>
                      <div className="mt-1 text-sm text-slate-400">
                        {content.nextKickoff ? content.nextKickoff.roundName : 'Yeni tur bekleniyor'}
                      </div>
                    </div>

                    <div className="rounded-[26px] border border-white/10 bg-black/15 p-4">
                      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/48">
                        <Shield className="h-4 w-4 text-emerald-300" />
                        Bracket boyutu
                      </div>
                      <div className="mt-3 text-2xl font-black text-white">{content.bracketSize}</div>
                      <div className="mt-1 text-sm text-slate-400">
                        {content.byeCount > 0 ? `${content.byeCount} bay slotu` : 'Tam dolu eleme ağacı'}
                      </div>
                    </div>

                    <div className="rounded-[26px] border border-white/10 bg-black/15 p-4">
                      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/48">
                        <Clock3 className="h-4 w-4 text-amber-300" />
                        Tur ritmi
                      </div>
                      <div className="mt-3 text-2xl font-black text-white">
                        {state.league.roundSpacingDays || 2} günde 1
                      </div>
                      <div className="mt-1 text-sm text-slate-400">
                        {content.competitionStart ? `${formatStageDay(content.competitionStart)} başlangıç` : 'Başlangıç hazır'}
                      </div>
                    </div>

                    <div className="rounded-[26px] border border-white/10 bg-black/15 p-4">
                      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/48">
                        <ShieldCheck className="h-4 w-4 text-violet-300" />
                        Turnuva durumu
                      </div>
                      <div className="mt-3 text-2xl font-black text-white">{content.completedMatches}/{state.matches.length}</div>
                      <div className="mt-1 text-sm text-slate-400">
                        {content.liveMatches > 0 ? `${content.liveMatches} canlı eşleşme var` : 'Skor akışı sakin'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap gap-2">
                    {content.topSeeds.map((entrant) => (
                      <div
                        key={entrant.teamId}
                        className={`rounded-2xl border px-3 py-2 ${
                          entrant.teamId === state.myTeamId
                            ? 'border-amber-300/35 bg-amber-300/12 text-amber-50'
                            : 'border-white/10 bg-white/5 text-white'
                        }`}
                      >
                        <div className="text-xs font-black uppercase tracking-[0.18em]">Seed #{entrant.seed}</div>
                        <div className="mt-1 text-sm font-semibold">{entrant.teamName}</div>
                        <div className="text-[11px] uppercase tracking-[0.22em] text-white/48">{entrant.leagueName}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>

              <Card className="relative overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top,rgba(250,204,21,0.14),transparent_30%),linear-gradient(180deg,rgba(11,18,34,0.98),rgba(5,9,18,0.98))] p-6 shadow-[0_24px_70px_rgba(2,6,23,0.32)]">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />
                <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/48">Benim Yolum</div>

                {!content.myEntrant && (
                  <div className="mt-5 rounded-[28px] border border-white/10 bg-white/5 p-5">
                    <div className="text-xl font-black text-white">Bu ay turnuvada yoksun</div>
                    <div className="mt-3 text-sm leading-6 text-slate-300">
                      Kendi ligini lider bitirdiğinde burada seed kartın, bir sonraki maçın ve kupaya giden özel yolun görünür.
                    </div>
                  </div>
                )}

                {content.myEntrant && (
                  <>
                    <div className="mt-4 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-3xl font-black tracking-tight text-white">{content.myEntrant.teamName}</div>
                        <div className="mt-2 text-sm text-slate-300">
                          Seed #{content.myEntrant.seed} • {content.myEntrant.leagueName}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.2em] text-amber-100">
                        Katıldı
                      </div>
                    </div>

                    {content.myActiveMatch && (
                      <div className="mt-5 rounded-[30px] border border-amber-300/22 bg-amber-300/10 p-5 shadow-[0_18px_50px_rgba(250,204,21,0.08)]">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-100/78">Sıradaki maçım</div>
                        <div className="mt-2 text-xl font-black text-white">{content.myActiveMatch.roundName}</div>
                        <div className="mt-2 text-sm text-amber-50/85">{formatKickoff(content.myActiveMatch.scheduledAt, true)}</div>
                        <div className="mt-4 text-sm text-amber-50/70">
                          {content.myActiveMatch.homeTeamName || 'Bekleniyor'} vs {content.myActiveMatch.awayTeamName || 'Bekleniyor'}
                        </div>
                        {content.myActiveMatch.fixtureId && (
                          <button
                            type="button"
                            onClick={() => navigate(`/match/${content.myActiveMatch!.fixtureId}`)}
                            className="mt-5 flex w-full items-center justify-between rounded-[20px] border border-white/12 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
                          >
                            <span>{content.myActiveMatch.status === 'running' ? 'Canlı maça git' : 'Maç kartını aç'}</span>
                            <Tv className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}

                    {!content.myActiveMatch && content.myLastCompleted && (
                      <div className="mt-5 rounded-[26px] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                        Son durum:{' '}
                        {content.myLastCompleted.winnerTeamId === state.myTeamId
                          ? 'tur atladın, yeni eşleşme bekleniyor'
                          : 'turnuva yolculuğun sona erdi'}
                      </div>
                    )}

                    {state.league.championTeamId === state.myTeamId && (
                      <div className="mt-5 rounded-[26px] border border-emerald-300/28 bg-emerald-300/12 p-4 text-sm font-semibold text-emerald-50">
                        Kupa sende. Final kazanıldı.
                      </div>
                    )}
                  </>
                )}
              </Card>
            </div>

            <Card className="relative overflow-hidden border-white/10 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.06),transparent_34%),linear-gradient(180deg,rgba(7,12,23,0.98),rgba(2,6,13,0.98))] p-5 shadow-[0_30px_90px_rgba(2,6,23,0.38)]">
              <div className="pointer-events-none absolute left-1/2 top-12 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(250,204,21,0.09),transparent_64%)] blur-3xl" />
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/28 to-transparent" />

              <div className="relative z-10 mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/48">Turnuva Akışı</div>
                  <div className="mt-2 text-3xl font-black tracking-tight text-white">Merkezde final, iki yanda net eleme akışı</div>
                  <div className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                    Her kolon kendi turunu taşır; maç kartları seed, lig ve skor bilgisini aynı yoğunlukta verir. Final kartı ayrı sahnelenir, böylece göz doğrudan kupaya giden merkeze akar.
                  </div>
                </div>

                {content.finalMatch?.winnerTeamName ? (
                  <div className="rounded-[28px] border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-right">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-100/75">Son şampiyon</div>
                    <div className="mt-1 text-lg font-black text-white">{content.finalMatch.winnerTeamName}</div>
                  </div>
                ) : null}
              </div>

              <div className="overflow-x-auto pb-3">
                <div className="relative flex min-w-[1540px] items-stretch gap-8 px-2 py-4">
                  <div className="pointer-events-none absolute inset-y-10 left-1/2 hidden w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-amber-300/25 to-transparent xl:block" />

                  <div className="flex gap-8">
                    {content.leftColumns.map((column) => (
                      <StageColumn
                        key={`left-${column.round}`}
                        title={column.title}
                        subtitle={column.subtitle}
                        matches={column.matches}
                        myTeamId={state.myTeamId}
                        side="left"
                        onOpenMatch={(fixtureId) => navigate(`/match/${fixtureId}`)}
                      />
                    ))}
                  </div>

                  <div className="relative flex min-w-[380px] items-center justify-center px-2">
                    <div className="absolute inset-x-0 top-1/2 hidden h-px -translate-y-1/2 bg-gradient-to-r from-white/0 via-amber-300/18 to-white/0 xl:block" />
                    {content.finalMatch ? (
                      <div className="relative w-full">
                        <div className="mb-4 text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-100/70">
                          Final sahnesi
                        </div>
                        <BracketMatchCard
                          match={content.finalMatch}
                          myTeamId={state.myTeamId}
                          side="center"
                          onOpenMatch={(fixtureId) => navigate(`/match/${fixtureId}`)}
                        />
                      </div>
                    ) : (
                      <div className="w-full rounded-[34px] border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-300">
                        Final eşleşmesi henüz oluşmadı.
                      </div>
                    )}
                  </div>

                  <div className="flex gap-8">
                    {content.rightColumns.map((column) => (
                      <StageColumn
                        key={`right-${column.round}`}
                        title={column.title}
                        subtitle={column.subtitle}
                        matches={column.matches}
                        myTeamId={state.myTeamId}
                        side="right"
                        onOpenMatch={(fixtureId) => navigate(`/match/${fixtureId}`)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
