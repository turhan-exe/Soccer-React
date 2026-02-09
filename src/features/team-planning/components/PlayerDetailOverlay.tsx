import React from 'react';
import { X, Shirt, Trophy, Zap, Activity, Shield, ArrowUpRight, Briefcase, DollarSign, UserX } from 'lucide-react';
import { Player } from '@/types';
import { Button } from '@/components/ui/button';
import { formatSalary } from '@/lib/contractNegotiation';

interface PlayerDetailOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    player: Player | null;
    onMoveToStarting: (id: string) => void;
    onMoveToBench: (id: string) => void;
    onMoveToReserve: (id: string) => void;
    onRename: (id: string) => void;
    onNegotiateSalary: (id: string) => void;
    onSellPlayer: (id: string) => void;
    onExtendContract: (id: string) => void;
    onFirePlayer: (id: string) => void;
    onReleasePlayer: (id: string) => void;
}

const StatRow = ({ label, value }: { label: string; value: number }) => (
    <div className="flex items-center justify-between py-1.5 border-b border-[#2a2a35] last:border-0">
        <span className="text-xs text-slate-400 font-medium">{label}</span>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-orange-400">◀</span>
            <span className="text-sm font-bold text-orange-400 w-4 text-center">{Math.round(value)}</span>
        </div>
    </div>
);

export function PlayerDetailOverlay({
    isOpen,
    onClose,
    player,
    onMoveToStarting,
    onMoveToBench,
    onMoveToReserve,
    onRename,
    onNegotiateSalary,
    onSellPlayer,
    onExtendContract,
    onFirePlayer,
    onReleasePlayer,
}: PlayerDetailOverlayProps) {
    if (!isOpen || !player) return null;
    return (
        <div className="fixed inset-0 z-[100] h-full w-full bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
            <div className="min-h-full flex flex-col items-center justify-start md:justify-center p-4">
                {/* Mobile Spacer - Force physical space */}
                <div className="w-full h-32 shrink-0 md:hidden" />

                <div
                    className="relative w-full max-w-[850px] bg-[#1a1b26] rounded-[24px] shadow-2xl flex flex-col md:flex-row min-h-[450px] max-h-none overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 z-10 p-2 bg-white/5 hover:bg-white/10 rounded-full text-white/70 hover:text-white transition-colors md:hidden"
                    >
                        <X size={20} />
                    </button>

                    {/* Left Side: Player Info & Stats */}
                    <div className="flex-[1.2] p-8 bg-[#1e1f2e] flex flex-col gap-6 relative">
                        {/* Header */}
                        <div className="flex flex-col items-center md:items-start text-center md:text-left">
                            <div className="w-20 h-20 rounded-2xl border border-indigo-500/30 bg-[#151520] flex items-center justify-center mb-4 shadow-lg shadow-indigo-500/10">
                                {player.avatar ? (
                                    <img src={player.avatar} alt={player.name} className="w-full h-full object-cover rounded-2xl" />
                                ) : (
                                    <Shirt className="w-10 h-10 text-indigo-400" strokeWidth={1.5} />
                                )}
                            </div>

                            <div className="flex flex-col items-center md:items-start">
                                <h2 className="text-3xl font-bold text-white tracking-tight">{player.name}</h2>
                                <div className="flex items-center gap-3 mt-1.5">
                                    <span className="bg-orange-500/10 text-orange-400 px-2.5 py-0.5 rounded text-[11px] font-bold tracking-wide">
                                        {player.position}
                                    </span>
                                    <span className="bg-[#1e2338] text-[#718096] px-2.5 py-0.5 rounded text-[11px] font-bold tracking-wide">
                                        {player.age} Yaş
                                    </span>
                                    <span className="text-slate-500 text-[11px] font-medium">• #{formatSalary(player.contract?.salary || 0)}/yıl</span>
                                </div>
                            </div>
                        </div>

                        {/* Stats Box */}
                        <div className="bg-[#151521] rounded-2xl p-5 border border-[#262732] flex-1">
                            <div className="flex items-center justify-between mb-4 border-b border-[#262732] pb-2">
                                <h3 className="text-xs font-bold text-slate-300">Oyuncu Detayları</h3>
                                <div className="text-[10px] text-slate-500 bg-[#262732] px-2 py-0.5 rounded-full">{player.name}</div>
                            </div>

                            <div className="space-y-1">
                                <StatRow label="Şut" value={player.attributes.shooting * 100} />
                                <StatRow label="İvme" value={player.attributes.acceleration * 100} />
                                <StatRow label="Top Sürme" value={player.attributes.dribbleSpeed * 100} />
                                <StatRow label="Zıplama" value={player.attributes.jump * 100} />
                                <StatRow label="Savunma" value={player.attributes.tackling * 100} />
                                <StatRow label="Top Saklama" value={player.attributes.ballKeeping * 100} />
                            </div>

                            <div className="mt-3 pt-2 border-t border-[#262732] flex justify-center">
                                <div className="w-2 h-2 rounded-full bg-[#262732] animate-pulse"></div>
                            </div>
                        </div>
                    </div>

                    {/* Right Side: Actions Buttons */}
                    <div className="flex-1 p-8 bg-[#1a1b26] flex flex-col justify-center border-l border-[#262732]">
                        <div className="space-y-3">
                            <button
                                onClick={onClose}
                                className="w-full flex items-center justify-between px-4 h-12 bg-white text-[#1a1b26] font-bold text-sm rounded-lg hover:bg-slate-200 transition-colors mb-6"
                            >
                                <span className="flex items-center gap-3">
                                    <ArrowUpRight className="w-4 h-4" strokeWidth={2.5} />
                                    Takım planına dön
                                </span>
                            </button>

                            {player.squadRole !== 'starting' && (
                                <button onClick={() => onMoveToStarting(player.id)} className="w-full group flex items-center gap-4 px-2 py-2 text-slate-400 hover:text-white transition-colors">
                                    <Shirt className="w-4 h-4 text-[#3b82f6] group-hover:scale-110 transition-transform" />
                                    <span className="text-sm font-medium">İlk 11'e Al</span>
                                </button>
                            )}

                            {player.squadRole !== 'bench' && (
                                <button onClick={() => onMoveToBench(player.id)} className="w-full group flex items-center gap-4 px-2 py-2 text-slate-400 hover:text-white transition-colors">
                                    <Activity className="w-4 h-4 text-[#8b5cf6] group-hover:scale-110 transition-transform" />
                                    <span className="text-sm font-medium">Yedek Kulübesine Al</span>
                                </button>
                            )}
                            {player.squadRole !== 'reserve' && (
                                <button onClick={() => onMoveToReserve(player.id)} className="w-full group flex items-center gap-4 px-2 py-2 text-slate-400 hover:text-white transition-colors">
                                    <Shield className="w-4 h-4 text-slate-500 group-hover:scale-110 transition-transform" />
                                    <span className="text-sm font-medium">Rezerve Al</span>
                                </button>
                            )}

                            <div className="h-px bg-[#262732] my-2" />

                            <button onClick={() => onRename(player.id)} className="w-full group flex items-center gap-4 px-2 py-2 text-slate-400 hover:text-white transition-colors">
                                <Briefcase className="w-4 h-4 text-slate-400 group-hover:scale-110 transition-transform" />
                                <span className="text-sm font-medium">Ismi Özelleştir</span>
                            </button>

                            <button onClick={() => onNegotiateSalary(player.id)} className="w-full group flex items-center gap-4 px-2 py-2 text-slate-400 hover:text-white transition-colors">
                                <DollarSign className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
                                <span className="text-sm font-medium">Maaş Pazarlığı</span>
                            </button>

                            <button onClick={() => onSellPlayer(player.id)} className="w-full group flex items-center gap-4 px-2 py-2 text-slate-400 hover:text-white transition-colors">
                                <Trophy className="w-4 h-4 text-yellow-500 group-hover:scale-110 transition-transform" />
                                <span className="text-sm font-medium">Oyuncuyu Sat</span>
                            </button>

                            <button onClick={() => onExtendContract(player.id)} className="w-full group flex items-center gap-4 px-2 py-2 text-slate-400 hover:text-white transition-colors">
                                <Zap className="w-4 h-4 text-white group-hover:scale-110 transition-transform" />
                                <span className="text-sm font-medium">Sözleşmeyi Uzat</span>
                            </button>

                            <div className="h-px bg-[#262732] my-2" />

                            <button onClick={() => onFirePlayer(player.id)} className="w-full group flex items-center gap-4 px-2 py-2 text-red-500/80 hover:text-red-400 transition-colors">
                                <UserX className="w-4 h-4 group-hover:scale-110 transition-transform" />
                                <span className="text-sm font-medium">Oyuncuyu Kov</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

    );
}
