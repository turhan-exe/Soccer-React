import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, PlusCircle } from 'lucide-react';
import { Player } from '@/types';


interface CreateListingProps {
    availablePlayers: Player[];
    selectedPlayerId: string;
    price: string;
    isListing: boolean;
    onSelectPlayer: (id: string) => void;
    onPriceChange: (price: string) => void;
    onSubmit: () => void;
}

export function CreateListing({
    availablePlayers,
    selectedPlayerId,
    price,
    isListing,
    onSelectPlayer,
    onPriceChange,
    onSubmit,
}: CreateListingProps) {
    return (
        <div className="rounded-[24px] border border-white/10 bg-[#1e1f2e]/80 backdrop-blur-md p-5 pb-6">
            <h3 className="mb-4 text-base font-bold text-white flex items-center gap-2">
                <div className="h-6 w-1 bg-gradient-to-b from-pink-500 to-purple-600 rounded-full" />
                Oyuncu İlanı Oluştur
            </h3>

            <div className="flex flex-col gap-4">
                {/* Player Select */}
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-400 ml-1">Oyuncu Seç</label>
                    <Select value={selectedPlayerId} onValueChange={onSelectPlayer}>
                        <SelectTrigger className="h-11 w-full bg-[#14151f] border-white/10 text-slate-200 focus:ring-purple-500/50 rounded-xl">
                            <SelectValue placeholder="Satılacak oyuncuyu seç..." />
                        </SelectTrigger>
                        <SelectContent className="bg-[#1e1f2e] border-white/10 max-h-[240px]">
                            {availablePlayers.length === 0 ? (
                                <div className="p-3 text-center text-sm text-muted-foreground">
                                    Satılabilir oyuncu yok.
                                </div>
                            ) : (
                                availablePlayers.map((player) => (
                                    <SelectItem key={player.id} value={player.id} className="text-slate-200 focus:bg-white/5 focus:text-white cursor-pointer">
                                        <span className="font-bold">{player.name}</span>{' '}
                                        <span className="text-xs text-muted-foreground ml-1">
                                            ({player.position} - {Math.round(player.overall)})
                                        </span>
                                    </SelectItem>
                                ))
                            )}
                        </SelectContent>
                    </Select>
                </div>

                {/* Price Input */}
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-400 ml-1">Satış Fiyatı</label>
                    <div className="relative">
                        <Input
                            type="number"
                            placeholder="Örn: 50.000"
                            value={price}
                            onChange={(e) => onPriceChange(e.target.value)}
                            className="h-11 bg-[#14151f] border-white/10 text-white placeholder:text-slate-600 rounded-xl pr-8"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span>
                    </div>
                </div>

                {/* Submit Button */}
                <Button
                    onClick={onSubmit}
                    disabled={!selectedPlayerId || !price || isListing}
                    className="h-11 mt-2 w-full bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-bold rounded-xl shadow-lg shadow-purple-900/20 active:scale-[0.98] transition-all"
                >
                    {isListing ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            İlan Oluşturuluyor...
                        </>
                    ) : (
                        <>
                            Pazara Ekle <span className="ml-1 opacity-80">»</span>
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}
