import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import {
  Users,
  UserPlus,
  Calendar,
  Trophy,
  Dumbbell,
  Play,
  History,
  DollarSign,
  User,
  Settings,
  ShoppingCart,
  Star,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getMyLeagueId, listLeagueStandings, getFixturesForTeam } from '@/services/leagues';
import '@/styles/nostalgia-theme.css';

const menuItems = [
  { id: 'team-planning', label: 'Takim Plani', icon: Users, accent: 'sky' },
  { id: 'youth', label: 'Altyapi', icon: UserPlus, accent: 'emerald' },
  { id: 'transfer-market', label: 'Transfer Pazari', icon: ShoppingCart, accent: 'teal' },
  { id: 'fixtures', label: 'Fikstur', icon: Calendar, accent: 'violet' },
  { id: 'leagues', label: 'Ligler', icon: Trophy, accent: 'gold' },
  { id: 'training', label: 'Antrenman', icon: Dumbbell, accent: 'orange' },
  { id: 'match-preview', label: 'Mac Onizleme', icon: Play, accent: 'rose' },
  { id: 'match-simulation', label: 'Mac Simulasyonu', icon: Play, accent: 'purple' },
  { id: 'match-history', label: 'Gecmis Maclar', icon: History, accent: 'slate' },
  { id: 'finance', label: 'Finans', icon: DollarSign, accent: 'cyan' },
  { id: 'profile', label: 'Kisisel Bilgiler', icon: User, accent: 'indigo' },
  { id: 'settings', label: 'Ayarlar', icon: Settings, accent: 'teal' },
  { id: 'legend-pack', label: 'Nostalji Paket', icon: Star, accent: 'pink' },
];

export default function MainMenu() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [leaguePosition, setLeaguePosition] = useState<number | null>(null);
  const [leaguePoints, setLeaguePoints] = useState<number | null>(null);
  const [hoursToNextMatch, setHoursToNextMatch] = useState<number | null>(null);

  useEffect(() => {
    const loadQuickStats = async () => {
      if (!user) return;
      try {
        const leagueId = await getMyLeagueId(user.id);
        if (!leagueId) {
          setLeaguePosition(null);
          setLeaguePoints(null);
          setHoursToNextMatch(null);
          return;
        }

        const standings = await listLeagueStandings(leagueId);
        const myIndex = standings.findIndex((s) => s.id === user.id);
        if (myIndex >= 0) {
          setLeaguePosition(myIndex + 1);
          setLeaguePoints(standings[myIndex].Pts);
        } else {
          setLeaguePosition(null);
          setLeaguePoints(null);
        }

        const fixtures = await getFixturesForTeam(leagueId, user.id);
        const upcoming = fixtures.find((f) => f.status !== 'played');
        if (upcoming && upcoming.date) {
          const matchTime = new Date(upcoming.date).getTime();
          const now = Date.now();
          const diffMs = Math.max(0, matchTime - now);
          const hours = Math.ceil(diffMs / 36e5);
          setHoursToNextMatch(hours);
        } else {
          setHoursToNextMatch(null);
        }
      } catch (error) {
        console.warn('[MainMenu] quick stats load failed', error);
      }
    };

    loadQuickStats();
  }, [user]);

  const handleMenuClick = (itemId: string) => {
    navigate(`/${itemId}`);
  };

  return (
    <div className="nostalgia-screen">
      <div className="nostalgia-screen__gradient" aria-hidden />
      <div className="nostalgia-screen__orb nostalgia-screen__orb--left" aria-hidden />
      <div className="nostalgia-screen__orb nostalgia-screen__orb--right" aria-hidden />
      <div className="nostalgia-screen__noise" aria-hidden />
      <div className="nostalgia-screen__content">
        <header className="nostalgia-main-menu__header">
          <div>
            <h1 className="nostalgia-main-menu__title">Ana Menü</h1>
            <p className="nostalgia-main-menu__subtitle">
              Kulübünün tüm kritik operasyonlarına tek ekrandan ulaş.
            </p>
          </div>
        </header>

        <section className="nostalgia-main-menu__grid">
          {menuItems.map((item) => (
            <Card
              key={item.id}
              className="nostalgia-card cursor-pointer"
              onClick={() => handleMenuClick(item.id)}
            >
              <CardContent className="nostalgia-card__content">
                <div className={`nostalgia-menu-icon nostalgia-menu-icon--${item.accent}`}>
                  <item.icon />
                </div>
                <h3 className="nostalgia-card__label">{item.label}</h3>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="nostalgia-quick-panel">
          <h2 className="nostalgia-quick-panel__title">Hızlı Bakış</h2>
          <div className="nostalgia-quick-grid">
            <div className="nostalgia-quick-card">
              <span className="nostalgia-quick-card__value text-emerald-300">
                {leaguePosition ?? '-'}
                {leaguePosition ? '.' : ''}
              </span>
              <span className="nostalgia-quick-card__label">Lig Sırası</span>
            </div>
            <div className="nostalgia-quick-card">
              <span className="nostalgia-quick-card__value text-sky-300">{leaguePoints ?? '-'}</span>
              <span className="nostalgia-quick-card__label">Puan</span>
            </div>
            <div className="nostalgia-quick-card">
              <span className="nostalgia-quick-card__value text-fuchsia-300">{hoursToNextMatch ?? '-'}</span>
              <span className="nostalgia-quick-card__label">Saat Sonra</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}


