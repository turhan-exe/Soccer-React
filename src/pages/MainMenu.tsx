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

const menuItems = [
  { id: 'team-planning', label: 'Takim Plani', icon: Users, color: 'bg-blue-500' },
  { id: 'youth', label: 'Altyapi', icon: UserPlus, color: 'bg-green-500' },
  { id: 'transfer-market', label: 'Transfer Pazari', icon: ShoppingCart, color: 'bg-teal-500' },
  { id: 'fixtures', label: 'Fikstur', icon: Calendar, color: 'bg-purple-500' },
  { id: 'leagues', label: 'Ligler', icon: Trophy, color: 'bg-yellow-500' },
  { id: 'training', label: 'Antrenman', icon: Dumbbell, color: 'bg-orange-500' },
  { id: 'match-preview', label: 'Mac Onizleme', icon: Play, color: 'bg-red-500' },
  { id: 'match-simulation', label: 'Mac Simulasyonu', icon: Play, color: 'bg-red-600' },
  { id: 'match-history', label: 'Gecmis Maclar', icon: History, color: 'bg-gray-500' },
  { id: 'finance', label: 'Finans', icon: DollarSign, color: 'bg-emerald-500' },
  { id: 'profile', label: 'Kisisel Bilgiler', icon: User, color: 'bg-indigo-500' },
  { id: 'settings', label: 'Ayarlar', icon: Settings, color: 'bg-slate-500' },
  { id: 'legend-pack', label: 'Nostalji Paket', icon: Star, color: 'bg-pink-500' },
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
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950">
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

        <div className="mt-8 max-w-2xl mx-auto">
          <h2 className="text-lg font-semibold mb-4">Hizli Bakis</h2>
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-green-600">{leaguePosition ?? '-'}{leaguePosition ? '.' : ''}</div>
                <div className="text-sm text-muted-foreground">Lig Sirasi</div>
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


