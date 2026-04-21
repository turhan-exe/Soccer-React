import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  HeartPulse,
  MessageCircle,
  Shield,
  Swords,
  Trophy,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/LanguageContext';
import { PrivateChatWindow } from '@/components/chat/PrivateChatWindow';
import { checkFriendStatus, sendFriendRequest, type FriendStatus } from '@/services/friends';
import { getTeam } from '@/services/team';
import { getTeamStrength } from '@/services/finance';
import type { ClubTeam, Friend, Player, User } from '@/types';
import { formatRatingLabel } from '@/lib/player';
import { formatClubCurrency } from '@/lib/clubFinance';
import {
  calculateTeamValue,
  getTeamDisplayFormation,
  getTeamSquadSummary,
  getTeamVitalAverages,
  getTopPlayers,
  resolveFriendActionState,
} from '@/lib/teamProfile';

const getLogoUrl = (value?: string | null): string | null => {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (/^(https?:|data:image\/)/i.test(normalized)) return normalized;
  return null;
};

const getInitials = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'FC';

const toTargetUser = (teamId: string, team: ClubTeam): User => ({
  id: teamId,
  teamName: team.name || 'Bilinmeyen Takim',
  username: team.manager || team.name || 'Menajer',
  email: '',
  teamLogo: team.logo || null,
  connectedAccounts: { google: false, apple: false },
  contactPhone: null,
  contactCrypto: null,
});

const toFriend = (teamId: string, team: ClubTeam): Friend => ({
  id: teamId,
  teamName: team.name || 'Bilinmeyen Takim',
  managerName: team.manager || team.name || 'Menajer',
  avatar: team.logo || team.manager || team.name,
  addedAt: '',
});

const StatBlock = ({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Trophy;
}) => (
  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-4">
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      <Icon className="h-4 w-4 text-emerald-300" />
      {label}
    </div>
    <div className="mt-2 text-2xl font-black text-white">{value}</div>
  </div>
);

const PlayerRow = ({ player, index }: { player: Player; index: number }) => (
  <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-3">
    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-sm font-bold text-emerald-200">
      {index + 1}
    </div>
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm font-bold text-slate-100">{player.name}</div>
      <div className="text-xs text-slate-500">
        {player.position} · {player.age} yas
      </div>
    </div>
    <div className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-sm font-black text-amber-200">
      {formatRatingLabel(player.overall)}
    </div>
  </div>
);

export default function TeamDetailPage() {
  const { teamId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [team, setTeam] = useState<ClubTeam | null>(null);
  const [friendStatus, setFriendStatus] = useState<FriendStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingRequest, setSendingRequest] = useState(false);
  const [chatFriend, setChatFriend] = useState<Friend | null>(null);

  const loadTeam = useCallback(async () => {
    const normalizedTeamId = teamId.trim();
    if (!normalizedTeamId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [teamData, status] = await Promise.all([
        getTeam(normalizedTeamId),
        user?.id && user.id !== normalizedTeamId
          ? checkFriendStatus(user.id, normalizedTeamId)
          : Promise.resolve<FriendStatus | null>(null),
      ]);
      setTeam(teamData);
      setFriendStatus(status);
    } catch (error) {
      console.error('Team detail load failed', error);
      toast.error(t('teamDetail.toasts.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, teamId, user?.id]);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  const metrics = useMemo(() => {
    const players = team?.players ?? [];
    return {
      formation: getTeamDisplayFormation(team),
      value: calculateTeamValue(players),
      strength: getTeamStrength(players),
      squad: getTeamSquadSummary(players),
      vitals: getTeamVitalAverages(players),
      topPlayers: getTopPlayers(players, 5),
    };
  }, [team]);

  const actionState = resolveFriendActionState({
    currentUserId: user?.id,
    targetTeamId: teamId,
    friendStatus,
  });

  const handleSendRequest = async () => {
    if (!user || !team || !teamId || sendingRequest) return;
    setSendingRequest(true);
    try {
      await sendFriendRequest(user, toTargetUser(teamId, team));
      setFriendStatus('request_sent');
      toast.success(t('friends.toasts.requestSent'));
    } catch (error) {
      console.error('Team detail friend request failed', error);
      toast.error(t('friends.toasts.requestFailed'));
    } finally {
      setSendingRequest(false);
    }
  };

  const handleFriendlyMatch = () => {
    if (!team || !teamId) return;
    const query = new URLSearchParams({
      opponentUserId: teamId,
      opponentName: team.name || team.manager || teamId,
    });
    navigate(`/friendly-match?${query.toString()}`);
  };

  const logoUrl = getLogoUrl(team?.logo);
  const teamName = team?.name || t('teamDetail.unknownTeam');
  const managerName = team?.manager || t('teamDetail.unknownManager');

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-white">
        <div className="mx-auto max-w-6xl rounded-lg border border-slate-800 bg-slate-900/70 p-8 text-slate-300">
          {t('common.loading')}
        </div>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-white">
        <div className="mx-auto max-w-3xl rounded-lg border border-slate-800 bg-slate-900/70 p-8">
          <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4 text-slate-300">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('common.back')}
          </Button>
          <h1 className="text-2xl font-bold">{t('teamDetail.notFoundTitle')}</h1>
          <p className="mt-2 text-slate-400">{t('teamDetail.notFoundDescription')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 pb-24 text-white sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="text-slate-400 hover:text-white">
            <ArrowLeft size={22} />
          </Button>
          <div>
            <h1 className="text-2xl font-black">{t('teamDetail.title')}</h1>
            <p className="text-sm text-slate-500">{t('teamDetail.subtitle')}</p>
          </div>
        </div>

        <section className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar className="h-16 w-16 border border-emerald-400/30 bg-slate-950">
                {logoUrl ? <AvatarImage src={logoUrl} /> : null}
                <AvatarFallback className="bg-slate-800 text-lg font-black text-emerald-200">
                  {getInitials(teamName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <h2 className="truncate text-3xl font-black tracking-tight">{teamName}</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {t('teamDetail.manager', { name: managerName })}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {actionState === 'self' ? (
                <Button disabled className="bg-slate-800 text-slate-300">
                  <UserCheck className="mr-2 h-4 w-4" />
                  {t('teamDetail.actions.yourTeam')}
                </Button>
              ) : actionState === 'friend' ? (
                <>
                  <Button onClick={() => setChatFriend(toFriend(teamId, team))} className="bg-blue-600 hover:bg-blue-500">
                    <MessageCircle className="mr-2 h-4 w-4" />
                    {t('friends.actions.chat')}
                  </Button>
                  <Button onClick={handleFriendlyMatch} className="bg-emerald-600 hover:bg-emerald-500">
                    <Swords className="mr-2 h-4 w-4" />
                    {t('friends.actions.friendly')}
                  </Button>
                </>
              ) : actionState === 'request_sent' ? (
                <Button disabled className="bg-slate-800 text-slate-300">
                  {t('friends.actions.requestSent')}
                </Button>
              ) : actionState === 'request_received' ? (
                <Button onClick={() => navigate('/friends?tab=requests')} className="bg-amber-600 hover:bg-amber-500">
                  {t('teamDetail.actions.openRequest')}
                </Button>
              ) : (
                <Button onClick={handleSendRequest} disabled={sendingRequest} className="bg-emerald-600 hover:bg-emerald-500">
                  <UserPlus className="mr-2 h-4 w-4" />
                  {sendingRequest ? t('common.loading') : t('friends.actions.sendRequest')}
                </Button>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatBlock label={t('teamDetail.metrics.formation')} value={metrics.formation} icon={Shield} />
          <StatBlock label={t('teamDetail.metrics.value')} value={formatClubCurrency(metrics.value)} icon={Wallet} />
          <StatBlock label={t('teamDetail.metrics.strength')} value={`${metrics.strength}`} icon={Trophy} />
          <StatBlock label={t('teamDetail.metrics.players')} value={`${metrics.squad.total}`} icon={Users} />
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">
            <h3 className="text-lg font-black">{t('teamDetail.sections.topPlayers')}</h3>
            <div className="mt-4 space-y-3">
              {metrics.topPlayers.length ? (
                metrics.topPlayers.map((player, index) => (
                  <PlayerRow key={player.id} player={player} index={index} />
                ))
              ) : (
                <p className="rounded-lg border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                  {t('teamDetail.empty.players')}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">
              <h3 className="text-lg font-black">{t('teamDetail.sections.squad')}</h3>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <StatBlock label={t('teamDetail.squad.starters')} value={`${metrics.squad.starters}`} icon={Users} />
                <StatBlock label={t('teamDetail.squad.bench')} value={`${metrics.squad.bench}`} icon={Users} />
                <StatBlock label={t('teamDetail.squad.reserve')} value={`${metrics.squad.reserve}`} icon={Users} />
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">
              <h3 className="flex items-center gap-2 text-lg font-black">
                <HeartPulse className="h-5 w-5 text-emerald-300" />
                {t('teamDetail.sections.vitals')}
              </h3>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <StatBlock label={t('teamDetail.vitals.condition')} value={`%${metrics.vitals.condition}`} icon={HeartPulse} />
                <StatBlock label={t('teamDetail.vitals.motivation')} value={`%${metrics.vitals.motivation}`} icon={HeartPulse} />
                <StatBlock label={t('teamDetail.vitals.health')} value={`%${metrics.vitals.health}`} icon={HeartPulse} />
              </div>
            </div>
          </div>
        </section>
      </div>

      {chatFriend ? (
        <PrivateChatWindow friend={chatFriend} onClose={() => setChatFriend(null)} />
      ) : null}
    </div>
  );
}
