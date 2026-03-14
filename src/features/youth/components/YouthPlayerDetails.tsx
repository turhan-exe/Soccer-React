import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Player } from '@/types';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface YouthPlayerDetailsProps {
    player: Player | null;
    isOpen: boolean;
    onClose: () => void;
}

export function YouthPlayerDetails({ player, isOpen, onClose }: YouthPlayerDetailsProps) {
    if (!player) return null;

    const attributes = [
        { label: 'Hız', value: Math.round(player.attributes.topSpeed * 20), color: 'text-yellow-400' }, // Scaled dummy
        { label: 'Şut', value: Math.round(player.attributes.shooting * 20), color: 'text-emerald-400' },
        { label: 'İvme', value: Math.round(player.attributes.acceleration * 20), color: 'text-yellow-400' },
        { label: 'Top Sürme', value: Math.round(player.attributes.dribbleSpeed * 20), color: 'text-emerald-400' },
        { label: 'Zıplama', value: Math.round(player.attributes.jump * 20), color: 'text-yellow-400' },
        { label: 'Savunma', value: Math.round(player.attributes.tackling * 20), color: 'text-yellow-400' },
        { label: 'Top Saklama', value: Math.round(player.attributes.ballKeeping * 20), color: 'text-yellow-400' },
    ];

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-[320px] border-none bg-transparent shadow-none p-0 overflow-hidden">
                <div className="bg-[#1a1b2e] rounded-[24px] border border-white/10 p-5 relative overflow-hidden">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-base font-bold text-white">Oyuncu Detayları</h2>
                        <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6 text-slate-400 hover:text-white">
                            <ChevronDown className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="space-y-1.5">
                        {attributes.map((attr) => (
                            <div key={attr.label} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-1.5 border border-white/5">
                                <span className="text-slate-300 font-medium text-xs">{attr.label}</span>
                                <div className="flex items-center gap-2">
                                    <ChevronLeft className="h-2.5 w-2.5 text-yellow-500 fill-current" />
                                    <span className={`text-sm font-bold font-mono ${attr.color}`}>{attr.value}</span>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="flex justify-center mt-3">
                        <ChevronDown className="h-4 w-4 text-slate-600 animate-bounce" />
                    </div>

                    {/* Background Blob */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-indigo-500/5 blur-3xl pointer-events-none -z-10" />
                </div>
            </DialogContent>
        </Dialog>
    );
}
