import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Play, Pause, FastForward, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface MatchEvent {
  minute: number;
  type: 'goal' | 'yellow' | 'red' | 'substitution' | 'shot' | 'corner';
  team: 'home' | 'away';
  player: string;
  description: string;
}

export default function MatchSimulation() {
  const navigate = useNavigate();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentMinute, setCurrentMinute] = useState(0);
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [half, setHalf] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [stats, setStats] = useState({
    home: { shots: 0, corners: 0, possession: 50 },
    away: { shots: 0, corners: 0, possession: 50 }
  });

  const matchEvents: MatchEvent[] = [
    { minute: 12, type: 'shot', team: 'home', player: 'Volkan Tekin', description: 'Volkan Tekin\'in şutu direkten döndü!' },
    { minute: 23, type: 'goal', team: 'away', player: 'Icardi', description: 'GOOOL! Icardi muhteşem bir vuruşla skoru açtı!' },
    { minute: 34, type: 'yellow', team: 'home', player: 'Ali Yılmaz', description: 'Ali Yılmaz sarı kart gördü' },
    { minute: 67, type: 'goal', team: 'home', player: 'Murat Koç', description: 'GOOOL! Murat Koç eşitliği sağladı!' },
    { minute: 78, type: 'substitution', team: 'home', player: 'Deniz Akın', description: 'Deniz Akın oyuna girdi' },
    { minute: 89, type: 'goal', team: 'home', player: 'Kemal Arslan', description: 'GOOOL! Son dakika golü! Kemal Arslan takımını öne geçirdi!' }
  ];

  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentMinute(prev => {
          const newMinute = prev + 1 * speed;
          
          // Check for events at this minute
          const currentEvents = matchEvents.filter(event => 
            event.minute === Math.floor(newMinute) && !events.find(e => e.minute === event.minute)
          );
          
          if (currentEvents.length > 0) {
            setEvents(prev => [...prev, ...currentEvents]);
            
            // Update scores and stats
            currentEvents.forEach(event => {
              if (event.type === 'goal') {
                if (event.team === 'home') {
                  setHomeScore(prev => prev + 1);
                } else {
                  setAwayScore(prev => prev + 1);
                }
              } else if (event.type === 'shot') {
                setStats(prev => ({
                  ...prev,
                  [event.team]: { ...prev[event.team], shots: prev[event.team].shots + 1 }
                }));
              } else if (event.type === 'corner') {
                setStats(prev => ({
                  ...prev,
                  [event.team]: { ...prev[event.team], corners: prev[event.team].corners + 1 }
                }));
              }
            });
          }
          
          // Handle half time and full time
          if (newMinute >= 45 && half === 1) {
            setHalf(2);
            return 45;
          } else if (newMinute >= 90) {
            setIsPlaying(false);
            return 90;
          }
          
          return newMinute;
        });
      }, 1000 / speed);
    }
    
    return () => clearInterval(interval);
  }, [isPlaying, speed, events, half]);

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  const changeSpeed = () => {
    const speeds = [1, 2, 4];
    const currentIndex = speeds.indexOf(speed);
    setSpeed(speeds[(currentIndex + 1) % speeds.length]);
  };

  const resetMatch = () => {
    setIsPlaying(false);
    setCurrentMinute(0);
    setHomeScore(0);
    setAwayScore(0);
    setHalf(1);
    setEvents([]);
    setStats({
      home: { shots: 0, corners: 0, possession: 50 },
      away: { shots: 0, corners: 0, possession: 50 }
    });
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'goal': return '⚽';
      case 'yellow': return '🟨';
      case 'red': return '🟥';
      case 'substitution': return '🔄';
      case 'shot': return '🎯';
      case 'corner': return '📐';
      default: return '⚽';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950">
      {/* Header */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/')}>←</Button>
            <h1 className="text-xl font-bold">Maç Simülasyonu</h1>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Score Display */}
        <Card>
          <CardContent className="p-6">
            <div className="text-center mb-4">
              <Badge variant="outline">{half}. Devre • {Math.floor(currentMinute)}'</Badge>
            </div>
            
            <div className="flex items-center justify-between text-center">
              <div className="flex-1">
                <div className="text-2xl mb-1">⚽</div>
                <div className="font-bold">Takımım</div>
                <div className="text-3xl font-bold text-blue-600">{homeScore}</div>
              </div>
              
              <div className="px-4">
                <div className="text-2xl font-bold text-muted-foreground">-</div>
              </div>
              
              <div className="flex-1">
                <div className="text-2xl mb-1">🦁</div>
                <div className="font-bold">Galatasaray</div>
                <div className="text-3xl font-bold text-red-600">{awayScore}</div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-4">
              <Progress value={(currentMinute / 90) * 100} className="h-2" />
            </div>
          </CardContent>
        </Card>

        {/* Controls */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={togglePlay}
                disabled={currentMinute >= 90}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              
              <Button variant="outline" size="sm" onClick={changeSpeed}>
                <FastForward className="h-4 w-4 mr-1" />
                {speed}x
              </Button>
              
              <Button variant="outline" size="sm" onClick={resetMatch}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Stadium Atmosphere */}
        <Card>
          <CardContent className="p-4">
            <div className="bg-gradient-to-r from-orange-400 via-red-500 to-orange-400 rounded-lg p-4 text-white text-center">
              <div className="text-2xl mb-2">🏟️</div>
              <div className="font-semibold">Türk Telekom Stadyumu</div>
              <div className="text-sm opacity-90">52,280 taraftar coşkuyla destekliyor!</div>
            </div>
          </CardContent>
        </Card>

        {/* Match Stats */}
        <Card>
          <CardHeader>
            <CardTitle>Maç İstatistikleri</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">Şutlar</span>
                <div className="flex items-center gap-2">
                  <span>{stats.home.shots}</span>
                  <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500" 
                      style={{ width: `${(stats.home.shots / (stats.home.shots + stats.away.shots || 1)) * 100}%` }}
                    />
                  </div>
                  <span>{stats.away.shots}</span>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="font-medium">Korner</span>
                <div className="flex items-center gap-2">
                  <span>{stats.home.corners}</span>
                  <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500" 
                      style={{ width: `${(stats.home.corners / (stats.home.corners + stats.away.corners || 1)) * 100}%` }}
                    />
                  </div>
                  <span>{stats.away.corners}</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="font-medium">Top Hakimiyeti</span>
                <div className="flex items-center gap-2">
                  <span>%{stats.home.possession}</span>
                  <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500" 
                      style={{ width: `${stats.home.possession}%` }}
                    />
                  </div>
                  <span>%{stats.away.possession}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Live Events */}
        <Card>
          <CardHeader>
            <CardTitle>Canlı Olaylar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-60 overflow-y-auto">
              {events.length === 0 ? (
                <div className="text-center text-muted-foreground py-4">
                  Henüz bir olay gerçekleşmedi
                </div>
              ) : (
                events.reverse().map((event, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                    <div className="text-lg">{getEventIcon(event.type)}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">{event.minute}'</Badge>
                        <span className="text-sm font-medium">{event.player}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{event.description}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Match End */}
        {currentMinute >= 90 && (
          <Card>
            <CardContent className="p-6 text-center">
              <div className="text-2xl font-bold mb-2">
                {homeScore > awayScore ? '🎉 Tebrikler! Galibiyete ulaştınız!' :
                 homeScore < awayScore ? '😔 Maalesef mağlup oldunuz' :
                 '🤝 Berabere kaldınız'}
              </div>
              <p className="text-muted-foreground mb-4">
                Final skoru: {homeScore} - {awayScore}
              </p>
              <div className="flex gap-2 justify-center">
                <Button onClick={() => navigate('/match-history')}>
                  Maç Detayları
                </Button>
                <Button variant="outline" onClick={() => navigate('/')}>
                  Ana Menü
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}