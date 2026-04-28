import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Radio,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { BackButton } from '@/components/ui/back-button';
import { Card } from '@/components/ui/card';
import { useTranslation } from '@/contexts/LanguageContext';
import { formatDateValue, translate } from '@/i18n/runtime';
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

type BracketColumn = {
  round: number;
  title: string;
  subtitle: string;
  matches: KnockoutMatchDoc[];
};

function getBracketSize(teamCount: number) {
  let size = 1;
  while (size < Math.max(1, teamCount)) {
    size *= 2;
  }
  return size;
}

function getMatchStatusMeta(match: KnockoutMatchDoc) {
  if (match.decidedBy === 'bye') {
    return {
      label: translate('championsLeague.byePassed'),
      detail: translate('championsLeague.byeDetail'),
      pillClass:
        'border-emerald-400/30 bg-emerald-400/12 text-emerald-100 shadow-[0_0_24px_rgba(52,211,153,0.18)]',
    };
  }

  if (match.status === 'running') {
    return {
      label: translate('championsLeague.live'),
      detail: translate('championsLeague.liveDetail'),
      pillClass:
        'border-rose-400/35 bg-rose-400/12 text-rose-100 shadow-[0_0_24px_rgba(251,113,133,0.18)]',
    };
  }

  if (match.status === 'completed') {
    return {
      label:
        match.decidedBy === 'penalties'
          ? translate('championsLeague.penaltiesFinished')
          : translate('championsLeague.completed'),
      detail: match.winnerTeamName
        ? translate('championsLeague.winnerPrefix', { name: match.winnerTeamName })
        : translate('championsLeague.resultProcessed'),
      pillClass:
        'border-sky-400/30 bg-sky-400/12 text-sky-100 shadow-[0_0_24px_rgba(56,189,248,0.16)]',
    };
  }

  if (match.homeTeamId && match.awayTeamId) {
    return {
      label: translate('championsLeague.scheduled'),
      detail: translate('championsLeague.scheduledDetail'),
      pillClass: 'border-white/12 bg-white/6 text-slate-100',
    };
  }

  return {
    label: translate('championsLeague.waiting'),
    detail: translate('championsLeague.waitingDetail'),
    pillClass: 'border-white/10 bg-white/5 text-slate-200',
  };
}

function getStageTitle(matches: KnockoutMatchDoc[], round: number) {
  const firstNamed = matches.find((match) => match.roundName)?.roundName?.trim();
  return firstNamed || translate('championsLeague.roundLabel', { round });
}

function shortKickoff(date: Date | null | undefined) {
  if (!date) return translate('championsLeague.ready');
  return formatDateValue(date, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  });
}

function scoreSide(match: KnockoutMatchDoc, side: 'home' | 'away') {
  if (!match.score) return '-';
  return String(side === 'home' ? match.score.home : match.score.away);
}

function teamInitials(name: string | null | undefined) {
  const normalized = (name || '?').trim();
  if (!normalized || normalized === '?') return '?';
  return normalized
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function compactStatusClass(match: KnockoutMatchDoc) {
  if (match.status === 'running') return 'border-emerald-400/25 bg-emerald-400/12 text-emerald-200';
  if (match.status === 'completed' || match.decidedBy === 'bye') {
    return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200';
  }
  return 'border-amber-300/20 bg-amber-300/10 text-amber-200';
}

function compactStatusLabel(match: KnockoutMatchDoc) {
  if (match.decidedBy === 'bye') return translate('championsLeague.byeShort');
  if (match.status === 'running') return translate('championsLeague.live');
  if (match.status === 'completed') {
    return match.decidedBy === 'penalties'
      ? translate('championsLeague.penaltiesShort')
      : translate('championsLeague.completedShort');
  }
  if (match.homeTeamId && match.awayTeamId) return translate('championsLeague.scheduledShort');
  return translate('championsLeague.waitingShort');
}

function StatTile(props: {
  icon: ReactNode;
  eyebrow: string;
  value: string;
  detail: string;
  accent?: 'teal' | 'amber' | 'emerald';
}) {
  const { icon, eyebrow, value, detail, accent = 'teal' } = props;
  const accentClass =
    accent === 'amber'
      ? 'text-amber-300'
      : accent === 'emerald'
        ? 'text-emerald-300'
        : 'text-cyan-300';

  return (
    <div className="flex min-h-[38px] items-center gap-1.5 rounded-md border border-white/10 bg-[#0b1420]/92 px-2 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.28)]">
      <div className={`flex h-5 w-5 shrink-0 items-center justify-center ${accentClass}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[8px] font-semibold leading-3 text-slate-100">{eyebrow}</div>
        <div className={`truncate text-xs font-black leading-4 ${accentClass}`}>{value}</div>
        <div className="truncate text-[8px] leading-3 text-slate-400">{detail}</div>
      </div>
    </div>
  );
}

function CrestMark(props: { name?: string | null; active?: boolean; muted?: boolean }) {
  const { name, active = false, muted = false } = props;

  return (
    <div
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[8px] font-black ${
        active
          ? 'border-cyan-300/55 bg-cyan-300/14 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.18)]'
          : muted
            ? 'border-white/10 bg-white/5 text-slate-500'
            : 'border-emerald-300/28 bg-emerald-300/10 text-emerald-100'
      }`}
    >
      {teamInitials(name)}
    </div>
  );
}

function CompactTeamRow(props: {
  seed: number | null;
  name: string | null | undefined;
  score: string;
  highlighted: boolean;
  winner: boolean;
}) {
  const { seed, name, score, highlighted, winner } = props;

  return (
    <div className="grid h-6 grid-cols-[22px_minmax(0,1fr)_24px] items-center gap-1 text-[12px] leading-6">
      <CrestMark name={name} active={highlighted || winner} muted={!name} />
      <div className="min-w-0">
        <div className={`truncate font-bold ${highlighted || winner ? 'text-cyan-200' : 'text-slate-100'}`}>
          <span className="mr-0.5 text-[11px] font-black text-slate-500">{seed || '-'}</span>
          {name || translate('championsLeague.waiting')}
        </div>
      </div>
      <div className="rounded bg-black/34 px-0.5 text-center text-[11px] font-black text-white">{score}</div>
    </div>
  );
}

function CompactMatchCard(props: {
  match: KnockoutMatchDoc;
  myTeamId: string | null;
  onOpenMatch: (fixtureId: string) => void;
}) {
  const { match, myTeamId, onOpenMatch } = props;
  const canOpenMatch = Boolean(
    match.fixtureId &&
      (match.status === 'running' || match.status === 'completed' || match.status === 'scheduled'),
  );

  return (
    <button
      type="button"
      disabled={!canOpenMatch || !match.fixtureId}
      onClick={() => match.fixtureId && onOpenMatch(match.fixtureId)}
      className="group relative flex h-[86px] w-full flex-col justify-between overflow-hidden rounded-md border border-white/10 bg-[#0d1825]/88 p-2 text-left shadow-[0_10px_26px_rgba(0,0,0,0.24)] transition enabled:hover:border-cyan-300/35 enabled:hover:bg-cyan-300/10 disabled:cursor-default"
    >
      <div className="min-w-0">
        <CompactTeamRow
          seed={match.homeSeed}
          name={match.homeTeamName || match.homeTeamId}
          score={scoreSide(match, 'home')}
          highlighted={Boolean(myTeamId && match.homeTeamId === myTeamId)}
          winner={Boolean(match.winnerTeamId && match.winnerTeamId === match.homeTeamId)}
        />
        <CompactTeamRow
          seed={match.awaySeed}
          name={match.awayTeamName || match.awayTeamId}
          score={scoreSide(match, 'away')}
          highlighted={Boolean(myTeamId && match.awayTeamId === myTeamId)}
          winner={Boolean(match.winnerTeamId && match.winnerTeamId === match.awayTeamId)}
        />
      </div>
      <div className="min-w-0 border-t border-white/8 pt-1">
        <span
          className={`block truncate whitespace-nowrap rounded border px-1.5 py-0.5 text-center text-[11px] font-black leading-4 ${compactStatusClass(match)}`}
        >
          {compactStatusLabel(match)}
        </span>
      </div>
    </button>
  );
}

function CompactBracketColumn(props: {
  column: BracketColumn;
  active: boolean;
  myTeamId: string | null;
  onOpenMatch: (fixtureId: string) => void;
  onSelectRound: (round: number) => void;
}) {
  const { column, active, myTeamId, onOpenMatch, onSelectRound } = props;

  return (
    <div className="relative flex min-w-0 flex-col">
      <div className="mb-1 text-center">
        <button
          type="button"
          onClick={() => onSelectRound(column.round)}
          className={`relative w-full truncate rounded-md border px-1.5 py-0.5 text-[10px] font-black transition ${
            active
              ? 'border-cyan-300/40 bg-cyan-300/12 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.14)]'
              : 'border-transparent text-slate-300 hover:border-cyan-300/25 hover:bg-cyan-300/8 hover:text-cyan-100'
          }`}
        >
          {column.round > 1 && (
            <span className="absolute left-0 top-1/2 hidden h-px w-[30%] -translate-y-1/2 bg-gradient-to-r from-transparent to-cyan-300/45 sm:block" />
          )}
          {column.title}
        </button>
      </div>
      <div className="relative flex min-h-[510px] flex-1 flex-col justify-around gap-2 overflow-visible">
        {column.matches.map((match) => (
          <div key={match.id} className="relative">
            {column.round > 1 && (
              <span className="pointer-events-none absolute -left-2 top-1/2 hidden h-px w-2 -translate-y-1/2 bg-cyan-300/45 shadow-[0_0_10px_rgba(34,211,238,0.18)] sm:block" />
            )}
            {column.round < 4 && (
              <span className="pointer-events-none absolute -right-2 top-1/2 hidden h-px w-2 -translate-y-1/2 bg-cyan-300/28 sm:block" />
            )}
            <CompactMatchCard match={match} myTeamId={myTeamId} onOpenMatch={onOpenMatch} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StageMatchListPanel(props: {
  column: BracketColumn;
  myTeamId: string | null;
  onClose: () => void;
  onOpenMatch: (fixtureId: string) => void;
}) {
  const { column, myTeamId, onClose, onOpenMatch } = props;

  return (
    <div className="absolute inset-x-2 bottom-2 top-14 z-30 flex min-h-0 flex-col overflow-hidden rounded-md border border-cyan-300/22 bg-[#07111d]/96 shadow-[0_24px_80px_rgba(0,0,0,0.46)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2 py-1.5">
        <div className="min-w-0">
          <div className="truncate text-xs font-black text-cyan-100">{column.title}</div>
          <div className="truncate text-[9px] font-semibold text-slate-400">{column.subtitle}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-[12px] font-black text-slate-300 transition hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-cyan-100"
          title={translate('championsLeague.closePanel')}
        >
          X
        </button>
      </div>

      <div
        className="grid min-h-0 flex-1 touch-pan-y grid-cols-2 content-start gap-1.5 overflow-y-auto overscroll-contain p-2 [-webkit-overflow-scrolling:touch]"
        onTouchMove={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        {column.matches.map((match, index) => {
          const canOpenMatch = Boolean(
            match.fixtureId &&
              (match.status === 'running' || match.status === 'completed' || match.status === 'scheduled'),
          );

          return (
            <button
              type="button"
              key={match.id}
              disabled={!canOpenMatch || !match.fixtureId}
              onClick={() => match.fixtureId && onOpenMatch(match.fixtureId)}
              className="min-w-0 rounded-md border border-white/10 bg-[#0d1825]/92 p-2 text-left transition enabled:hover:border-cyan-300/35 enabled:hover:bg-cyan-300/10 disabled:cursor-default"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">
                  #{index + 1}
                </div>
                <span className={`rounded border px-1.5 py-0.5 text-[9px] font-black ${compactStatusClass(match)}`}>
                  {compactStatusLabel(match)}
                </span>
              </div>
              <CompactTeamRow
                seed={match.homeSeed}
                name={match.homeTeamName || match.homeTeamId}
                score={scoreSide(match, 'home')}
                highlighted={Boolean(myTeamId && match.homeTeamId === myTeamId)}
                winner={Boolean(match.winnerTeamId && match.winnerTeamId === match.homeTeamId)}
              />
              <CompactTeamRow
                seed={match.awaySeed}
                name={match.awayTeamName || match.awayTeamId}
                score={scoreSide(match, 'away')}
                highlighted={Boolean(myTeamId && match.awayTeamId === myTeamId)}
                winner={Boolean(match.winnerTeamId && match.winnerTeamId === match.awayTeamId)}
              />
              <div className="mt-1 truncate border-t border-white/8 pt-1 text-[9px] font-semibold text-slate-400">
                {shortKickoff(match.scheduledAt)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ChampionsLeaguePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [state, setState] = useState<OverviewState>({ status: 'loading' });
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [sidePanelView, setSidePanelView] = useState<'path' | 'champions'>('path');
  const [finalPanelOpen, setFinalPanelOpen] = useState(false);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [stageListOpen, setStageListOpen] = useState(false);

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
          message: error?.message || t('championsLeague.errorFallback'),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [t]);

  const content = useMemo(() => {
    if (state.status !== 'ready') {
      return null;
    }

    const bracketSize = getBracketSize(state.entrants.length);
    const totalRounds = Math.max(...state.matches.map((match) => match.round));
    const finalMatch = state.matches.find((match) => match.round === totalRounds) || null;
    const allRounds = Array.from({ length: Math.max(0, totalRounds) }, (_, index) => index + 1);
    const bracketColumns = allRounds.map((round) => {
      const roundMatches = state.matches.filter((match) => match.round === round);
      return {
        round,
        title: getStageTitle(roundMatches, round),
        subtitle: t('championsLeague.matchesCount', { count: roundMatches.length }),
        matches: roundMatches,
      };
    });

    const orderedUpcoming = [...state.matches]
      .filter((match) => match.status !== 'completed' && match.status !== 'failed')
      .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime());

    const nextKickoff = orderedUpcoming[0] || null;
    const liveMatches = state.matches.filter((match) => match.status === 'running').length;
    const myEntrant = state.entrants.find((entrant) => entrant.teamId === state.myTeamId) || null;
    const myActiveMatch =
      orderedUpcoming.find(
        (match) => match.homeTeamId === state.myTeamId || match.awayTeamId === state.myTeamId,
      ) || null;

    return {
      bracketSize,
      finalMatch,
      liveMatches,
      myActiveMatch,
      myEntrant,
      nextKickoff,
      bracketColumns,
      totalRounds,
    };
  }, [state, t]);

  const selectedRoundColumn =
    content && selectedRound
      ? content.bracketColumns.find((column) => column.round === selectedRound) || null
      : null;

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_26%),linear-gradient(180deg,#07111d_0%,#040812_56%,#02040a_100%)] p-1.5 text-slate-100">
      <div className="mx-auto flex h-[calc(100vh-12px)] w-full max-w-none flex-col gap-1.5">
        {state.status === 'loading' && (
          <Card className="overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgba(8,15,28,0.92),rgba(4,8,18,0.98))] p-7 text-slate-200">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-300/25 bg-sky-400/10">
                <Sparkles className="h-5 w-5 text-sky-200" />
              </div>
              <div>
                <div className="text-lg font-black text-white">{t('championsLeague.loadingTitle')}</div>
                <div className="text-sm text-slate-400">{t('championsLeague.loadingDescription')}</div>
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
            <div className="text-2xl font-black text-white">{t('championsLeague.emptyTitle')}</div>
            <div className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              {t('championsLeague.emptyDescription')}
            </div>
            <Button className="mt-6" onClick={() => navigate('/leagues')}>
              {t('championsLeague.backToLeagues')}
            </Button>
          </Card>
        )}

        {state.status === 'ready' && content && (
          <>
            <div className="grid grid-cols-[28px_repeat(4,minmax(0,1fr))] gap-1.5">
              <BackButton
                fallbackPath="/"
                className="h-full min-h-[38px] rounded-md border border-white/10 bg-[#0b1420]/92 px-0 text-cyan-200 shadow-[0_12px_32px_rgba(0,0,0,0.28)] hover:border-cyan-300/35 hover:bg-cyan-300/10 hover:text-cyan-100"
              />
              <StatTile
                icon={<CalendarClock className="h-5 w-5" />}
                eyebrow={t('championsLeague.nextMatchLabel')}
                value={content.nextKickoff ? shortKickoff(content.nextKickoff.scheduledAt) : t('championsLeague.ready')}
                detail={content.nextKickoff ? content.nextKickoff.roundName : t('championsLeague.waiting')}
              />
              <StatTile
                icon={<Users className="h-5 w-5" />}
                eyebrow={String(content.bracketSize)}
                value={t('championsLeague.teamsLabel')}
                detail={t('championsLeague.inTournamentLabel')}
              />
              <StatTile
                icon={<Trophy className="h-5 w-5" />}
                eyebrow={content.nextKickoff?.roundName || t('championsLeague.finalLabel')}
                value={t('championsLeague.stageLabel')}
                detail={t('championsLeague.roundCount', { count: content.totalRounds })}
                accent="amber"
              />
              <StatTile
                icon={<Radio className="h-5 w-5" />}
                eyebrow={t('championsLeague.live')}
                value={String(content.liveMatches)}
                detail={content.liveMatches > 0 ? t('championsLeague.liveDetail') : t('championsLeague.calmFlow')}
                accent="emerald"
              />
            </div>

            <div
              className={`grid min-h-0 flex-1 gap-1.5 transition-[grid-template-columns] duration-200 ${
                sidePanelOpen ? 'grid-cols-[minmax(0,1fr)_270px]' : 'grid-cols-[minmax(0,1fr)_54px]'
              }`}
            >
              <div className="flex min-h-0 flex-col gap-1.5">
                <Card className="relative min-h-0 flex-1 overflow-hidden rounded-md border-white/10 bg-[linear-gradient(180deg,rgba(9,17,29,0.96),rgba(5,11,20,0.98))] p-0 shadow-[0_24px_80px_rgba(0,0,0,0.34)]">
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(180deg,transparent,rgba(21,78,53,0.28))]" />
                  <div className="relative z-10 px-2 py-1.5">
                    <div className="text-xs font-black text-white">{t('championsLeague.eliminationTable')}</div>
                  </div>
                  {stageListOpen && selectedRoundColumn && (
                    <StageMatchListPanel
                      column={selectedRoundColumn}
                      myTeamId={state.myTeamId}
                      onClose={() => setStageListOpen(false)}
                      onOpenMatch={(fixtureId) => navigate(`/match/${fixtureId}`)}
                    />
                  )}
                  <div className="relative z-10 h-[calc(100%-26px)] overflow-y-auto overflow-x-hidden px-1.5 pb-1.5 pr-2">
                    <div className="grid h-full grid-cols-4 gap-2">
                      {content.bracketColumns.map((column) => (
                        <CompactBracketColumn
                          key={column.round}
                          column={column}
                          active={stageListOpen && selectedRound === column.round}
                          myTeamId={state.myTeamId}
                          onSelectRound={(round) => {
                            setSelectedRound(round);
                            setStageListOpen(true);
                          }}
                          onOpenMatch={(fixtureId) => navigate(`/match/${fixtureId}`)}
                        />
                      ))}
                    </div>
                  </div>
                </Card>

                <Card className="mx-auto w-full max-w-[420px] rounded-md border-white/10 bg-[#111d2e]/95 p-0.5 shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
                  <button
                    type="button"
                    onClick={() => setFinalPanelOpen((open) => !open)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-0.5 text-left transition hover:bg-white/[0.04]"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Trophy className="h-5 w-5 shrink-0 text-amber-300" />
                      <div className="min-w-0">
                        <div className="truncate text-[10px] font-black text-white">{t('championsLeague.finalSummaryLabel')}</div>
                        <div className="truncate text-[9px] text-slate-300">
                          {content.finalMatch ? shortKickoff(content.finalMatch.scheduledAt) : t('championsLeague.finalPendingShort')}
                        </div>
                      </div>
                    </div>
                    {finalPanelOpen ? (
                      <ChevronUp className="h-4 w-4 shrink-0 text-cyan-200" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-cyan-200" />
                    )}
                  </button>

                  {finalPanelOpen && (
                    <div className="mt-0.5 grid items-center gap-2 border-t border-white/10 pt-1 grid-cols-[32px_1fr_1fr]">
                      <div className="flex justify-center">
                        <Trophy className="h-6 w-6 text-amber-300" />
                      </div>
                      <div className="border-r border-white/10">
                        <div className="text-[10px] font-black text-white">{t('championsLeague.championLabel')}</div>
                        <div className="mt-0.5 text-[9px] text-slate-300">
                          {content.finalMatch?.winnerTeamName || '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-black text-white">{t('championsLeague.finalLabel')}</div>
                        <div className="mt-0.5 text-[9px] text-slate-300">
                          {content.finalMatch ? shortKickoff(content.finalMatch.scheduledAt) : '-'}
                        </div>
                        <div className="mt-1 text-[9px] text-slate-400">Fikretle Arena</div>
                      </div>
                    </div>
                  )}
                </Card>
              </div>

              <aside className="min-h-0">
                {!sidePanelOpen && (
                  <Card className="flex h-full flex-col items-center gap-2 rounded-md border-white/10 bg-[#0b1420]/95 p-1.5 shadow-[0_18px_55px_rgba(0,0,0,0.32)]">
                    <button
                      type="button"
                      onClick={() => {
                        setSidePanelView('path');
                        setSidePanelOpen(true);
                      }}
                      className={`flex h-10 w-10 items-center justify-center rounded-md border transition ${
                        sidePanelView === 'path'
                          ? 'border-cyan-300/35 bg-cyan-300/12 text-cyan-200'
                          : 'border-white/10 bg-white/[0.04] text-slate-300'
                      }`}
                      title={t('championsLeague.myPathTitle')}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSidePanelView('champions');
                        setSidePanelOpen(true);
                      }}
                      className={`flex h-10 w-10 items-center justify-center rounded-md border transition ${
                        sidePanelView === 'champions'
                          ? 'border-cyan-300/35 bg-cyan-300/12 text-cyan-200'
                          : 'border-white/10 bg-white/[0.04] text-slate-300'
                      }`}
                      title={t('championsLeague.leagueChampionsLabel')}
                    >
                      <Trophy className="h-4 w-4" />
                    </button>
                  </Card>
                )}

                {sidePanelOpen && (
                  <Card className="flex h-full min-h-0 flex-col rounded-md border-white/10 bg-[#0b1420]/95 p-2 shadow-[0_18px_55px_rgba(0,0,0,0.32)]">
                    <div className="mb-2 grid grid-cols-[1fr_1fr_26px] gap-1">
                      <button
                        type="button"
                        onClick={() => setSidePanelView('path')}
                        className={`truncate rounded-md border px-2 py-1 text-[10px] font-black transition ${
                          sidePanelView === 'path'
                            ? 'border-cyan-300/35 bg-cyan-300/12 text-cyan-200'
                            : 'border-white/10 bg-white/[0.04] text-slate-300'
                        }`}
                      >
                        {t('championsLeague.myPathTitle')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSidePanelView('champions')}
                        className={`truncate rounded-md border px-2 py-1 text-[10px] font-black transition ${
                          sidePanelView === 'champions'
                            ? 'border-cyan-300/35 bg-cyan-300/12 text-cyan-200'
                            : 'border-white/10 bg-white/[0.04] text-slate-300'
                        }`}
                      >
                        {t('championsLeague.leagueChampionsLabel')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSidePanelOpen(false)}
                        className="rounded-md border border-white/10 bg-white/[0.04] text-[12px] font-black text-slate-300"
                        title={t('championsLeague.closePanel')}
                      >
                        X
                      </button>
                    </div>

                    {sidePanelView === 'path' && (
                      <div className="min-h-0">
                        <div className="text-xs font-black text-cyan-300">{t('championsLeague.myPathTitle')}</div>

                        {!content.myEntrant && (
                          <div className="mt-1.5 rounded-md border border-white/10 bg-white/[0.04] p-2">
                            <div className="text-[10px] font-black text-white">{t('championsLeague.notInTournamentTitle')}</div>
                            <div className="mt-1 line-clamp-2 text-[9px] leading-3 text-slate-300">{t('championsLeague.myPathDescription')}</div>
                          </div>
                        )}

                        {content.myEntrant && (
                          <div className="mt-2 rounded-md border border-white/10 bg-[#0f1a28] p-2 text-center">
                            <div className="text-xs font-black text-white">
                              {content.myActiveMatch?.roundName || t('championsLeague.waiting')}
                            </div>
                            <div className="mt-0.5 text-[10px] text-slate-300">
                              {content.myActiveMatch ? shortKickoff(content.myActiveMatch.scheduledAt) : t('championsLeague.ready')}
                            </div>

                            <div className="mt-3 grid grid-cols-[1fr_30px_1fr] items-center gap-1.5">
                              <div className="min-w-0">
                                <CrestMark name={content.myActiveMatch?.homeTeamName || content.myEntrant.teamName} active />
                                <div className="mt-1 truncate text-[10px] font-bold text-slate-100">
                                  {content.myActiveMatch?.homeTeamName || content.myEntrant.teamName}
                                </div>
                              </div>
                              <div className="text-xs font-black text-white">VS</div>
                              <div className="min-w-0">
                                <CrestMark name={content.myActiveMatch?.awayTeamName || t('championsLeague.waiting')} active />
                                <div className="mt-1 truncate text-[10px] font-bold text-slate-100">
                                  {content.myActiveMatch?.awayTeamName || t('championsLeague.waiting')}
                                </div>
                              </div>
                            </div>

                            <div className="mt-2 text-[10px] font-semibold text-emerald-300">
                              {content.myActiveMatch?.status === 'running' ? t('championsLeague.live') : t('championsLeague.joined')}
                            </div>

                            {content.myActiveMatch?.fixtureId && (
                              <button
                                type="button"
                                onClick={() => navigate(`/match/${content.myActiveMatch!.fixtureId}`)}
                                className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-cyan-400 to-emerald-400 px-3 py-1.5 text-xs font-black text-slate-950 shadow-[0_14px_34px_rgba(20,184,166,0.24)] transition hover:brightness-110"
                              >
                                <span>{content.myActiveMatch.status === 'running' ? t('championsLeague.openLive') : t('championsLeague.openCard')}</span>
                                <ArrowRight className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {sidePanelView === 'champions' && (
                      <div className="min-h-0 flex-1 overflow-hidden">
                        <div className="mb-1 flex items-center justify-between">
                          <div className="text-xs font-black text-cyan-300">{t('championsLeague.leagueChampionsLabel')}</div>
                          <div className="text-[10px] font-semibold uppercase text-slate-400">Seed</div>
                        </div>
                        <div className="max-h-full overflow-y-auto divide-y divide-white/8 pr-1">
                          {state.entrants.map((entrant, index) => (
                            <div key={entrant.teamId} className="grid grid-cols-[16px_20px_minmax(0,1fr)_24px] items-center gap-1.5 py-0.5 text-[9px]">
                              <div className="text-slate-500">{index + 1}</div>
                              <CrestMark name={entrant.teamName} active={entrant.teamId === state.myTeamId} />
                              <div className="truncate font-semibold text-slate-100">{entrant.teamName}</div>
                              <div className="text-right font-semibold text-slate-300">{entrant.seed}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </Card>
                )}
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
