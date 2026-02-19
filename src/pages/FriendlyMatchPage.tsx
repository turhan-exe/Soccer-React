import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Wifi } from 'lucide-react';
import { unityBridge } from '@/services/unityBridge';
import { toast } from 'sonner';

export default function FriendlyMatchPage() {
     const navigate = useNavigate();
     const [ip, setIp] = useState('127.0.0.1');
     const [port, setPort] = useState('7777');
     const [homeId, setHomeId] = useState('team_gs');
     const [awayId, setAwayId] = useState('team_fb');

     const handleConnect = () => {
          toast.info(`Native Unity - Mac Baslatiliyor: ${homeId} vs ${awayId}`);
          unityBridge.launchMatchActivity(ip, parseInt(port), { homeId, awayId });
     };

     return (
          <div className="min-h-screen bg-slate-950 text-white p-4 flex flex-col items-center justify-center">
               {/* Header */}
               <div className="absolute top-4 left-4">
                    <Button variant="ghost" onClick={() => navigate(-1)} className="text-slate-400 hover:text-white">
                         <ArrowLeft className="mr-2 h-4 w-4" /> Geri
                    </Button>
               </div>

               {/* Connection Card */}
               <Card className="w-full max-w-md bg-slate-900 border-slate-800 shadow-2xl">
                    <CardHeader>
                         <CardTitle className="flex items-center gap-2 text-purple-400">
                              <Wifi className="w-6 h-6" />
                              <span>Dostluk Maçı (Milestone 2)</span>
                         </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                         <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                   <label className="text-xs text-slate-500 uppercase font-bold">Ev Sahibi (ID)</label>
                                   <Input
                                        value={homeId}
                                        onChange={(e) => setHomeId(e.target.value)}
                                        className="bg-slate-950 border-emerald-900/50 text-emerald-400 font-mono text-center"
                                   />
                              </div>
                              <div className="space-y-2">
                                   <label className="text-xs text-slate-500 uppercase font-bold">Deplasman (ID)</label>
                                   <Input
                                        value={awayId}
                                        onChange={(e) => setAwayId(e.target.value)}
                                        className="bg-slate-950 border-blue-900/50 text-blue-400 font-mono text-center"
                                   />
                              </div>
                         </div>

                         <div className="space-y-2 pt-2 border-t border-slate-800">
                              <label className="text-sm text-slate-400">Sunucu IP Adresi</label>
                              <Input
                                   value={ip}
                                   onChange={(e) => setIp(e.target.value)}
                                   className="bg-slate-950 border-slate-700 font-mono"
                              />
                         </div>

                         <div className="space-y-2">
                              <label className="text-sm text-slate-400">Port (UDP)</label>
                              <Input
                                   value={port}
                                   onChange={(e) => setPort(e.target.value)}
                                   className="bg-slate-950 border-slate-700 font-mono"
                              />
                         </div>

                         <div className="pt-4">
                              <Button onClick={handleConnect} className="w-full bg-emerald-600 hover:bg-emerald-500 font-bold h-12">
                                   BAĞLAN (Native)
                              </Button>
                              <p className="text-xs text-slate-500 text-center mt-3">
                                   Bu islem, telefonda Unity penceresini acar.<br />
                                   Mobilde: KCP (UDP) kullanilir.<br />
                                   PC'de: Mock Alert gosterir.
                              </p>
                         </div>
                    </CardContent>
               </Card>
          </div>
     );
}
