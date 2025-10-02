import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
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
  Moon,
  Sun,
  LogOut,
  Bell,
  ShoppingCart,
  Star
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getMyLeagueId, listLeagueStandings, getFixturesForTeam } from '@/services/leagues';
import { getTeam } from '@/services/team';
import { getUnviewedTrainingCount } from '@/services/training';
import { getYouthCandidates } from '@/services/youth';

const menuItems = [
  { id: 'team-planning', label: 'Takım Planı', icon: Users, color: 'bg-blue-500' },
  { id: 'youth', label: 'Altyapı', icon: UserPlus, color: 'bg-green-500' },
  { id: 'transfer-market', label: 'Transfer Pazarı', icon: ShoppingCart, color: 'bg-teal-500' },
  { id: 'fixtures', label: 'Fikstür', icon: Calendar, color: 'bg-purple-500' },
  { id: 'leagues', label: 'Ligler', icon: Trophy, color: 'bg-yellow-500' },
  { id: 'training', label: 'Antrenman', icon: Dumbbell, color: 'bg-orange-500' },
  { id: 'match-preview', label: 'Maç Önizleme', icon: Play, color: 'bg-red-500' },
  { id: 'match-simulation', label: 'Maç Simülasyonu', icon: Play, color: 'bg-red-600' },
  { id: 'match-history', label: 'Geçmiş Maçlar', icon: History, color: 'bg-gray-500' },
  { id: 'finance', label: 'Finans', icon: DollarSign, color: 'bg-emerald-500' },
  { id: 'profile', label: 'Kişisel Bilgiler', icon: User, color: 'bg-indigo-500' },
  { id: 'settings', label: 'Ayarlar', icon: Settings, color: 'bg-slate-500' },
  { id: 'legend-pack', label: 'Nostalji Paket', icon: Star, color: 'bg-pink-500' },
];

export default function MainMenu() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [leaguePosition, setLeaguePosition] = useState<number | null>(null);
  const [leaguePoints, setLeaguePoints] = useState<number | null>(null);
  const [hoursToNextMatch, setHoursToNextMatch] = useState<number | null>(null);
  const [teamOverall, setTeamOverall] = useState<number | null>(null);
  const [teamForm, setTeamForm] = useState<string | null>(null);
  const [hasUnseenTrainingResults, setHasUnseenTrainingResults] = useState(false);
  const [hasYouthCandidates, setHasYouthCandidates] = useState(false);

  useEffect(() => {
    const loadQuickStats = async () => {
      if (!user) return;
      try {
        const team = await getTeam(user.id);
        if (team) {
          const starters = team.players.filter(p => p.squadRole === 'starting');
          if (starters.length) {
            const avg =
              starters.reduce((sum, p) => sum + p.overall, 0) / starters.length;
            setTeamOverall(Number(avg.toFixed(3)));
          } else {
            setTeamOverall(null);
          }
        }

        const leagueId = await getMyLeagueId(user.id);
        if (!leagueId) {
          setLeaguePosition(null);
          setLeaguePoints(null);
          setHoursToNextMatch(null);
          setTeamForm(null);
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

        const played = fixtures.filter((f) => f.status === 'played' && f.score);
        const last5 = played.slice(-5).map((f) => {
          const isHome = f.homeTeamId === user.id;
          const { home, away } = f.score!;
          if (home === away) return 'D';
          return (isHome && home > away) || (!isHome && away > home) ? 'W' : 'L';
        });
        setTeamForm(last5.join(''));
      } catch (e) {
        console.warn('[MainMenu] quick stats load failed', e);
      }
    };

    loadQuickStats();
  }, [user]);

  useEffect(() => {
    const loadNotifications = async () => {
      if (!user) {
        setHasUnseenTrainingResults(false);
        setHasYouthCandidates(false);
        return;
      }

      try {
        const unseenCount = await getUnviewedTrainingCount(user.id);
        setHasUnseenTrainingResults(unseenCount > 0);
      } catch (err) {
        console.warn('[MainMenu] training notifications failed', err);
        setHasUnseenTrainingResults(false);
      }

      try {
        const youthList = await getYouthCandidates(user.id);
        setHasYouthCandidates(youthList.length > 0);
      } catch (err) {
        console.warn('[MainMenu] youth notifications failed', err);
        setHasYouthCandidates(false);
      }
    };

    loadNotifications();
  }, [user]);

  const notifications: {
    id: string;
    message: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [];

  if (hasUnseenTrainingResults) {
    notifications.push({
      id: 'training',
      message: 'Görmediğiniz antrenman sonuçları hazır.',
      icon: Dumbbell,
    });
  }

  if (hasYouthCandidates) {
    notifications.push({
      id: 'youth',
      message: 'Altyapıdan takıma katılabilecek oyuncular var.',
      icon: UserPlus,
    });
  }

  const handleMenuClick = (itemId: string) => {
    navigate(`/${itemId}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950">
      {/* Header */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl">{user?.teamLogo}</div>
            <div>
              <h1 className="font-bold text-lg">{user?.teamName}</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary">Overall: {teamOverall ?? '-'}</Badge>
                <Badge variant="outline">Form: {teamForm ?? '-'}</Badge>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={toggleTheme}>
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm">
              <div className="relative">
                <Bell className="h-4 w-4" />
                {notifications.length > 0 && (
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
                )}
              </div>
            </Button>
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {notifications.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800 p-3">
          <div className="flex flex-col gap-2 text-sm">
            {notifications.map(({ id, message, icon: Icon }) => (
              <div key={id} className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
                <Icon className="h-4 w-4" />
                <span>{message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Menu Grid */}
      <div className="p-4">
        <div className="grid grid-cols-2 gap-4 max-w-2xl mx-auto">
          {menuItems.map((item) => (
            <Card 
              key={item.id}
              className="hover:shadow-lg transition-all duration-200 cursor-pointer hover:scale-105"
              onClick={() => handleMenuClick(item.id)}
            >
              <CardContent className="p-6 text-center">
                <div className={`w-12 h-12 ${item.color} rounded-full flex items-center justify-center mx-auto mb-3`}>
                  <item.icon className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-semibold text-sm">{item.label}</h3>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick Stats */}
        <div className="mt-8 max-w-2xl mx-auto">
          <h2 className="text-lg font-semibold mb-4">Hızlı Bakış</h2>
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-green-600">{leaguePosition ?? '-'}{leaguePosition ? '.' : ''}</div>
                <div className="text-sm text-muted-foreground">Lig Sırası</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-blue-600">{leaguePoints ?? '-'}</div>
                <div className="text-sm text-muted-foreground">Puan</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-purple-600">{hoursToNextMatch ?? '-'}</div>
                <div className="text-sm text-muted-foreground">Saat Sonra</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
