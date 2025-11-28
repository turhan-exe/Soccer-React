import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { fetchFinishedMatchesForClub, MatchListItem } from '@/services/replays';

const ACTIVE_SEASON_ID = import.meta.env.VITE_ACTIVE_SEASON_ID || 'current-season';

const formatDateTime = (value?: Date) => {
  if (!value) return 'Tarih yok';
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
};

const scoreline = (match: MatchListItem) => {
  if (!match.result) return 'vs';
  return `${match.result.homeGoals} - ${match.result.awayGoals}`;
};

const clubName = (match: MatchListItem, clubId: string) =>
  match.homeClubId === clubId ? 'Ev Sahibi' : match.awayClubId === clubId ? 'Deplasman' : 'Kulüp';

const MatchesHistoryPage: React.FC = () => {
  const { user } = useAuth();
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const clubId = useMemo(() => user?.id ?? '', [user]);

  useEffect(() => {
    if (!clubId) return;
    setLoading(true);
    fetchFinishedMatchesForClub(ACTIVE_SEASON_ID, clubId)
      .then(setMatches)
      .catch((err) => setError(err?.message || 'Maçlar alınamadı'))
      .finally(() => setLoading(false));
  }, [clubId]);

  if (!clubId) {
    return <div className="p-6">Önce giriş yapıp bir kulüp seçmelisin.</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Geçmiş Maçlar</h1>
      {loading && <div>Yükleniyor...</div>}
      {error && <div className="text-red-500">{error}</div>}
      {!loading && matches.length === 0 && <div>Henüz oynanmış maç yok.</div>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {matches.map((m) => (
          <div
            key={m.matchId}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="text-xs text-slate-500">{formatDateTime(m.kickoffDate)}</div>
            <div className="mt-1 text-sm text-slate-600">
              {m.homeClubId} vs {m.awayClubId}
            </div>
            <div className="text-xl font-semibold">{scoreline(m)}</div>
            <div className="text-xs text-slate-500">
              {clubName(m, clubId)} · Round {m.round}
            </div>
            <button
              className="mt-3 inline-flex items-center rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              onClick={() =>
                navigate(`/match-replay?seasonId=${encodeURIComponent(m.seasonId)}&matchId=${encodeURIComponent(m.matchId)}`)
              }
            >
              Maçı izle
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MatchesHistoryPage;
