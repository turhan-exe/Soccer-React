import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { upcomingMatches } from '@/lib/data';
import { Match } from '@/types';
import { Calendar, MapPin, Trophy, Filter } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const completedMatches: Match[] = [
  {
    id: 'c1',
    opponent: 'Beşiktaş',
    opponentLogo: '🦅',
    date: '2025-08-10',
    time: '20:00',
    venue: 'home',
    status: 'completed',
    score: { home: 2, away: 1 },
    competition: 'Süper Lig'
  },
  {
    id: 'c2',
    opponent: 'Trabzonspor',
    opponentLogo: '🔴',
    date: '2025-08-05',
    time: '19:00',
    venue: 'away',
    status: 'completed',
    score: { home: 1, away: 1 },
    competition: 'Süper Lig'
  },
];

export default function Fixtures() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('upcoming');

  const MatchCard = ({ match }: { match: Match }) => (
    <Card className="hover:shadow-md transition-shadow cursor-pointer">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {match.competition}
            </Badge>
            <Badge variant={match.venue === 'home' ? 'default' : 'secondary'} className="text-xs">
              {match.venue === 'home' ? 'İç Saha' : 'Deplasman'}
            </Badge>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <div>{new Date(match.date).toLocaleDateString('tr-TR')}</div>
            <div>{match.time}</div>
          </div>
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl">{match.venue === 'home' ? '⚽' : match.opponentLogo}</div>
            <div>
              <div className="font-semibold">
                {match.venue === 'home' ? 'Takımım' : match.opponent}
              </div>
              <div className="text-sm text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {match.venue === 'home' ? 'Ev Sahipliği' : 'Deplasman'}
              </div>
            </div>
          </div>

          <div className="text-center">
            <div className="text-2xl font-bold">VS</div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="font-semibold">
                {match.venue === 'home' ? match.opponent : 'Takımım'}
              </div>
              <div className="text-sm text-muted-foreground">
                {match.status === 'completed' && match.score ? (
                  <span className="font-semibold text-foreground">
                    {match.venue === 'home' 
                      ? `${match.score.home}-${match.score.away}`
                      : `${match.score.away}-${match.score.home}`
                    }
                  </span>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    {match.status === 'scheduled' ? 'Planlandı' : 'Canlı'}
                  </Badge>
                )}
              </div>
            </div>
            <div className="text-2xl">{match.venue === 'home' ? match.opponentLogo : '⚽'}</div>
          </div>
        </div>

        {match.status === 'scheduled' && (
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" className="flex-1">
              Detaylar
            </Button>
            <Button size="sm" className="flex-1">
              Maç Önizleme
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950">
      {/* Header */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/')}>←</Button>
            <h1 className="text-xl font-bold">Fikstür</h1>
          </div>
          <Button variant="outline" size="sm">
            <Filter className="h-4 w-4 mr-2" />
            Filtre
          </Button>
        </div>
      </div>

      <div className="p-4">
        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{upcomingMatches.length}</div>
              <div className="text-sm text-muted-foreground">Yaklaşan</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-600">5</div>
              <div className="text-sm text-muted-foreground">Galibiyet</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-purple-600">2</div>
              <div className="text-sm text-muted-foreground">Beraberlik</div>
            </CardContent>
          </Card>
        </div>

        {/* Matches */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upcoming">
              Yaklaşan Maçlar
            </TabsTrigger>
            <TabsTrigger value="completed">
              Tamamlanan
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming" className="space-y-4 mt-4">
            {upcomingMatches.map(match => (
              <MatchCard key={match.id} match={match} />
            ))}
          </TabsContent>

          <TabsContent value="completed" className="space-y-4 mt-4">
            {completedMatches.map(match => (
              <MatchCard key={match.id} match={match} />
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}