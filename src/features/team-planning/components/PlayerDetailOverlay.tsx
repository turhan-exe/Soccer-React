import React from 'react';
import {
  X,
  Shirt,
  Trophy,
  Zap,
  Activity,
  Shield,
  ArrowUpRight,
  Briefcase,
  DollarSign,
  UserX,
  HeartPulse,
} from 'lucide-react';

import { Player } from '@/types';
import { formatSalary } from '@/lib/contractNegotiation';
import { getPositionShortLabel } from '@/features/team-planning/teamPlanningUtils';

interface PlayerDetailOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  player: Player | null;
  onMoveToStarting: (id: string) => void;
  moveToStartingLabel?: string;
  onMoveToBench: (id: string) => void;
  onMoveToReserve: (id: string) => void;
  onRename: (id: string) => void;
  onUseKits: (id: string) => void;
  onNegotiateSalary: (id: string) => void;
  onSellPlayer: (id: string) => void;
  onExtendContract: (id: string) => void;
  onFirePlayer: (id: string) => void;
  onReleasePlayer: (id: string) => void;
}

const StatRow = ({ label, value }: { label: string; value: number }) => (
  <div className="flex items-center justify-between border-b border-[#2a2a35] py-1.5 last:border-0">
    <span className="text-xs font-medium text-slate-400">{label}</span>
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-orange-400">&lt;</span>
      <span className="w-4 text-center text-sm font-bold text-orange-400">
        {Math.round(value)}
      </span>
    </div>
  </div>
);

export function PlayerDetailOverlay({
  isOpen,
  onClose,
  player,
  onMoveToStarting,
  moveToStartingLabel,
  onMoveToBench,
  onMoveToReserve,
  onRename,
  onUseKits,
  onNegotiateSalary,
  onSellPlayer,
  onExtendContract,
  onFirePlayer,
  onReleasePlayer,
}: PlayerDetailOverlayProps) {
  if (!isOpen || !player) return null;

  return (
    <div className="fixed inset-0 z-[100] h-full w-full overflow-y-auto bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex min-h-full flex-col items-center justify-start p-4 md:justify-center">
        <div className="h-32 w-full shrink-0 md:hidden" />

        <div
          className="relative flex min-h-[450px] w-full max-w-[850px] flex-col overflow-hidden rounded-[24px] bg-[#1a1b26] shadow-2xl md:flex-row"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-10 rounded-full bg-white/5 p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white md:hidden"
          >
            <X size={20} />
          </button>

          <div className="relative flex flex-[1.2] flex-col gap-6 bg-[#1e1f2e] p-8">
            <div className="flex flex-col items-center text-center md:items-start md:text-left">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl border border-indigo-500/30 bg-[#151520] shadow-lg shadow-indigo-500/10">
                {player.avatar ? (
                  <img
                    src={player.avatar}
                    alt={player.name}
                    className="h-full w-full rounded-2xl object-cover"
                  />
                ) : (
                  <Shirt className="h-10 w-10 text-indigo-400" strokeWidth={1.5} />
                )}
              </div>

              <div className="flex flex-col items-center md:items-start">
                <h2 className="text-3xl font-bold tracking-tight text-white">{player.name}</h2>
                <div className="mt-1.5 flex items-center gap-3">
                  <span className="rounded bg-orange-500/10 px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-orange-400">
                    {getPositionShortLabel(player.position)}
                  </span>
                  <span className="rounded bg-[#1e2338] px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-[#718096]">
                    {player.age} Yas
                  </span>
                  <span className="text-[11px] font-medium text-slate-500">
                    - #{formatSalary(player.contract?.salary || 0)}/yil
                  </span>
                </div>
              </div>
            </div>

            <div className="flex-1 rounded-2xl border border-[#262732] bg-[#151521] p-5">
              <div className="mb-4 flex items-center justify-between border-b border-[#262732] pb-2">
                <h3 className="text-xs font-bold text-slate-300">Oyuncu Detaylari</h3>
                <div className="rounded-full bg-[#262732] px-2 py-0.5 text-[10px] text-slate-500">
                  {player.name}
                </div>
              </div>

              <div className="space-y-1">
                <StatRow label="Saglik" value={player.health * 100} />
                <StatRow label="Kondisyon" value={player.condition * 100} />
                <StatRow label="Motivasyon" value={player.motivation * 100} />
                <StatRow label="Sut" value={player.attributes.shooting * 100} />
                <StatRow label="Ivme" value={player.attributes.acceleration * 100} />
                <StatRow label="Top Surme" value={player.attributes.dribbleSpeed * 100} />
                <StatRow label="Ziplama" value={player.attributes.jump * 100} />
                <StatRow label="Savunma" value={player.attributes.tackling * 100} />
                <StatRow label="Top Saklama" value={player.attributes.ballKeeping * 100} />
              </div>

              <div className="mt-3 flex justify-center border-t border-[#262732] pt-2">
                <div className="h-2 w-2 animate-pulse rounded-full bg-[#262732]" />
              </div>
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-center border-l border-[#262732] bg-[#1a1b26] p-8">
            <div className="space-y-3">
              <button
                onClick={onClose}
                className="mb-6 flex h-12 w-full items-center justify-between rounded-lg bg-white px-4 text-sm font-bold text-[#1a1b26] transition-colors hover:bg-slate-200"
              >
                <span className="flex items-center gap-3">
                  <ArrowUpRight className="h-4 w-4" strokeWidth={2.5} />
                  Takim planina don
                </span>
              </button>

              {player.squadRole !== 'starting' && (
                <button
                  onClick={() => onMoveToStarting(player.id)}
                  className="group flex w-full items-center gap-4 px-2 py-2 text-slate-400 transition-colors hover:text-white"
                >
                  <Shirt className="h-4 w-4 text-[#3b82f6] transition-transform group-hover:scale-110" />
                  <span className="text-sm font-medium">
                    {moveToStartingLabel || "Ilk 11'e Al"}
                  </span>
                </button>
              )}

              {player.squadRole !== 'bench' && (
                <button
                  onClick={() => onMoveToBench(player.id)}
                  className="group flex w-full items-center gap-4 px-2 py-2 text-slate-400 transition-colors hover:text-white"
                >
                  <Activity className="h-4 w-4 text-[#8b5cf6] transition-transform group-hover:scale-110" />
                  <span className="text-sm font-medium">Yedek Kulubesine Al</span>
                </button>
              )}

              {player.squadRole !== 'reserve' && (
                <button
                  onClick={() => onMoveToReserve(player.id)}
                  className="group flex w-full items-center gap-4 px-2 py-2 text-slate-400 transition-colors hover:text-white"
                >
                  <Shield className="h-4 w-4 text-slate-500 transition-transform group-hover:scale-110" />
                  <span className="text-sm font-medium">Reserve Al</span>
                </button>
              )}

              <div className="my-2 h-px bg-[#262732]" />

              <button
                onClick={() => onRename(player.id)}
                className="group flex w-full items-center gap-4 px-2 py-2 text-slate-400 transition-colors hover:text-white"
              >
                <Briefcase className="h-4 w-4 text-slate-400 transition-transform group-hover:scale-110" />
                <span className="text-sm font-medium">Ismi Ozellestir</span>
              </button>

              <button
                onClick={() => onUseKits(player.id)}
                className="group flex w-full items-center gap-4 px-2 py-2 text-slate-400 transition-colors hover:text-white"
              >
                <HeartPulse className="h-4 w-4 text-emerald-400 transition-transform group-hover:scale-110" />
                <span className="text-sm font-medium">Kitleri Kullan</span>
              </button>

              <button
                onClick={() => onNegotiateSalary(player.id)}
                className="group flex w-full items-center gap-4 px-2 py-2 text-slate-400 transition-colors hover:text-white"
              >
                <DollarSign className="h-4 w-4 text-amber-400 transition-transform group-hover:scale-110" />
                <span className="text-sm font-medium">Maas Pazarligi</span>
              </button>

              <button
                onClick={() => onSellPlayer(player.id)}
                className="group flex w-full items-center gap-4 px-2 py-2 text-slate-400 transition-colors hover:text-white"
              >
                <Trophy className="h-4 w-4 text-yellow-500 transition-transform group-hover:scale-110" />
                <span className="text-sm font-medium">Oyuncuyu Sat</span>
              </button>

              <button
                onClick={() => onExtendContract(player.id)}
                className="group flex w-full items-center gap-4 px-2 py-2 text-slate-400 transition-colors hover:text-white"
              >
                <Zap className="h-4 w-4 text-white transition-transform group-hover:scale-110" />
                <span className="text-sm font-medium">Sozlesmeyi Uzat</span>
              </button>

              <div className="my-2 h-px bg-[#262732]" />

              <button
                onClick={() => onFirePlayer(player.id)}
                className="group flex w-full items-center gap-4 px-2 py-2 text-red-500/80 transition-colors hover:text-red-400"
              >
                <UserX className="h-4 w-4 transition-transform group-hover:scale-110" />
                <span className="text-sm font-medium">Oyuncuyu Kov</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
