import React from 'react';
import { PagesHeader } from '@/components/layout/PagesHeader';
import { Trophy, CalendarClock, Shield, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ChampionsLeaguePage() {
     const navigate = useNavigate();

     return (
          <div className="min-h-screen bg-slate-950 p-4 md:p-6 lg:p-8 font-sans text-slate-100 flex flex-col gap-6 relative overflow-hidden">
               {/* Background Effects */}
               <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                    <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[128px]" />
                    <div className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[128px]" />
               </div>

               <div className="relative z-10 flex flex-col gap-6 h-full">
                    <PagesHeader title="Şampiyonlar Ligi" description="Avrupa'nın en büyüğü olmaya hazır mısın?" />

                    <div className="flex-1 flex items-center justify-center">
                         <div className="w-full max-w-4xl bg-[#13111c]/90 border border-white/10 rounded-[40px] p-8 md:p-16 flex flex-col items-center text-center shadow-2xl backdrop-blur-md relative overflow-hidden">

                              {/* Decorative Elements */}
                              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
                              <div className="absolute bottom-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl" />

                              <div className="mb-8 relative">
                                   <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full animate-pulse" />
                                   <Trophy size={120} className="text-yellow-400 drop-shadow-[0_0_15px_rgba(250,204,21,0.5)] relative z-10" />
                                   <Star size={40} className="text-white absolute -top-2 -right-4 animate-bounce" />
                                   <Star size={24} className="text-blue-300 absolute bottom-0 -left-6 animate-pulse delay-75" />
                              </div>

                              <h1 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white via-blue-200 to-blue-400 tracking-tight mb-6">
                                   ŞAMPİYONLAR LİGİ
                              </h1>

                              <p className="text-slate-400 text-lg md:text-xl max-w-2xl leading-relaxed mb-10">
                                   Dünyanın en prestijli turnuvası çok yakında kapılarını açıyor.
                                   Kendi ligini zirvede tamamla ve bu büyük arenada yerini ayırt!
                              </p>

                              <div className="flex flex-col md:flex-row items-center gap-6 w-full max-w-lg">
                                   <div className="flex-1 bg-gradient-to-br from-slate-900 to-slate-800 p-6 rounded-2xl border border-white/5 flex flex-col items-center gap-3">
                                        <CalendarClock size={32} className="text-blue-400" />
                                        <span className="text-sm font-bold text-slate-300 uppercase tracking-wider">Başlangıç</span>
                                        <span className="text-white font-black text-lg">LİG BİTİMİNDE</span>
                                   </div>

                                   <div className="flex-1 bg-gradient-to-br from-slate-900 to-slate-800 p-6 rounded-2xl border border-white/5 flex flex-col items-center gap-3">
                                        <Shield size={32} className="text-purple-400" />
                                        <span className="text-sm font-bold text-slate-300 uppercase tracking-wider">Katılım</span>
                                        <span className="text-white font-black text-lg">LİG ŞAMPİYONLARI</span>
                                   </div>
                              </div>

                              <div className="mt-12">
                                   <button
                                        onClick={() => navigate('/leagues')}
                                        className="px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-800 hover:from-blue-500 hover:to-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-900/40 transition-all hover:scale-105 active:scale-95 flex items-center gap-3"
                                   >
                                        <Shield size={20} />
                                        LİGİNE GERİ DÖN VE HAZIRLAN
                                   </button>
                              </div>

                         </div>
                    </div>
               </div>
          </div>
     );
}
