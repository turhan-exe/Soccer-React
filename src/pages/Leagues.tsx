import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { leagueTable } from '@/lib/data';
import { Trophy, TrendingUp, TrendingDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Leagues() {
  const navigate = useNavigate();
  const [selectedLeague, setSelectedLeague] = useState('super-lig');

  const getFormBadge = (result: string) => {
    switch (result) {
      case 'W': return <Badge className="w-6 h-6 p-0 bg-green-500 text-white">G</Badge>;
      case 'D': return <Badge className="w-6 h-6 p-0 bg-yellow-500 text-white">B</Badge>;
      case 'L': return <Badge className="w-6 h-6 p-0 bg-red-500 text-white">M</Badge>;
      default: return <Badge className="w-6 h-6 p-0 bg-gray-500 text-white">-</Badge>;
    }
  };

  const getPositionTrend = (position: number) => {
    if (position <= 4) return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (position >= 18) return <TrendingDown className="h-4 w-4 text-red-500" />;
    return null;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950">
      {/* Header */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/')}>←</Button>
            <h1 className="text-xl font-bold">Ligler</h1>
          </div>
        </div>
      </div>

      <div className="p-4">
        {/* League Selector */}
        <Tabs value={selectedLeague} onValueChange={setSelectedLeague} className="mb-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="super-lig">Süper Lig</TabsTrigger>
            <TabsTrigger value="champions">Şampiyonlar Ligi</TabsTrigger>
          </TabsList>

          <TabsContent value="super-lig">
            {/* My Team Position */}
            <Card className="mb-6">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">⚽</div>
                    <div>
                      <div className="font-bold">Takımım</div>
                      <div className="text-sm text-muted-foreground">3. sırada</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-blue-600">15</div>
                    <div className="text-sm text-muted-foreground">Puan</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* League Table */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5" />
                  Süper Lig Puan Durumu
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {/* Header */}
                  <div className="grid grid-cols-12 gap-2 p-2 text-xs font-semibold text-muted-foreground border-b">
                    <div className="col-span-1">#</div>
                    <div className="col-span-4">Takım</div>
                    <div className="col-span-1">O</div>
                    <div className="col-span-1">P</div>
                    <div className="col-span-2">AV</div>
                    <div className="col-span-3">Form</div>
                  </div>

                  {/* Teams */}
                  {leagueTable.map((team, index) => (
                    <div 
                      key={team.name}
                      className={`grid grid-cols-12 gap-2 p-2 rounded text-sm hover:bg-muted/50 ${
                        team.name === 'Takımım' ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800' : ''
                      }`}
                    >
                      <div className="col-span-1 flex items-center gap-1">
                        <span className="font-semibold">{team.position}</span>
                        {getPositionTrend(team.position)}
                      </div>
                      
                      <div className="col-span-4 flex items-center gap-2">
                        <span className="text-lg">{team.logo}</span>
                        <span className="font-medium truncate">{team.name}</span>
                      </div>
                      
                      <div className="col-span-1 text-center">{team.played}</div>
                      <div className="col-span-1 text-center font-semibold">{team.points}</div>
                      <div className="col-span-2 text-center">
                        <span className={team.goalDifference >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {team.goalDifference > 0 ? '+' : ''}{team.goalDifference}
                        </span>
                      </div>
                      
                      <div className="col-span-3 flex gap-1">
                        {team.form.split('').map((result, i) => (
                          <div key={i}>{getFormBadge(result)}</div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Legend */}
                <div className="mt-4 pt-4 border-t">
                  <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-3 h-3 bg-green-100 border-l-4 border-green-500"></div>
                        <span>Şampiyonlar Ligi (1-4)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-blue-100 border-l-4 border-blue-500"></div>
                        <span>Avrupa Ligi (5-6)</span>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-red-100 border-l-4 border-red-500"></div>
                        <span>Küme Düşme (18-20)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="champions">
            <Card>
              <CardContent className="p-8 text-center">
                <div className="text-4xl mb-4">🏆</div>
                <h3 className="font-semibold mb-2">Şampiyonlar Ligi</h3>
                <p className="text-muted-foreground text-sm">
                  Henüz Şampiyonlar Ligi'ne katılmaya hak kazanmadınız. 
                  Süper Lig'de ilk 4'e girerek Avrupa'ya açılın!
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}