import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { useInventory } from '@/contexts/InventoryContext';
import { Button } from '@/components/ui/button';
import { BackButton } from '@/components/ui/back-button';
import InfoPopupButton from '@/components/ui/info-popup-button';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import LegendCard from './LegendCard';
import { LEGEND_PLAYERS, type LegendPlayer } from './players';
import { drawLegend } from './drawLegend';
import { getLegendIdFromPlayer, getRentedLegends, rentLegend } from '@/services/legends';
import { getTeam } from '@/services/team';
import type { Player } from '@/types';
import './legend-pack.css';

const PACK_COST = 250;
const RENT_DURATION_DAYS = 30;
const RENT_DURATION_MS = 1000 * 60 * 60 * 24 * RENT_DURATION_DAYS;
const TOTAL_LEGENDS = LEGEND_PLAYERS.length;
const STORAGE_KEY_PREFIX = 'legend-pack-current';

const getStorageKey = (userId: string) => `${STORAGE_KEY_PREFIX}:${userId}`;

interface RentedLegend extends LegendPlayer {
  playerId: string;
  expiresAt: Date;
}

const LegendPackPage = () => {
  const { user } = useAuth();
  const { balance, spend } = useDiamonds();
  const { vipNostalgiaFreeAvailable, consumeVipNostalgiaReward } = useInventory();
  const [current, setCurrent] = useState<LegendPlayer | null>(null);
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [rented, setRented] = useState<RentedLegend[]>([]);
  const [ownedLegendIds, setOwnedLegendIds] = useState<number[]>([]);
  const [isLoadingTeam, setIsLoadingTeam] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handlePackClick = () => {
    if (!user) {
      toast.error('Giris yapmalisin');
      return;
    }
    if (current) {
      toast.info('Önce mevcut kartın için karar vermelisin');
      return;
    }

    // If free, just open
    if (vipNostalgiaFreeAvailable) {
      handleOpen();
    } else {
      setShowConfirm(true);
    }
  };

  const legendById = useMemo(() => {
    const map = new Map<number, LegendPlayer>();
    LEGEND_PLAYERS.forEach(legend => {
      map.set(legend.id, legend);
    });
    return map;
  }, []);

  useEffect(() => {
    let isActive = true;

    const resetState = () => {
      if (isActive) {
        setOwnedLegendIds([]);
        setRented([]);
        setCurrent(null);
      }
    };

    if (!user) {
      resetState();
      setIsLoadingTeam(false);
      return () => {
        isActive = false;
      };
    }

    setIsLoadingTeam(true);
    setRented([]);
    setCurrent(null);

    const loadData = async () => {
      try {
        const [team, rentals] = await Promise.all([
          getTeam(user.id),
          getRentedLegends(user.id),
        ]);
        if (!isActive) return;
        if (!team?.players) {
          setOwnedLegendIds([]);
        } else {
          const legendIds = extractLegendIds(team.players);
          setOwnedLegendIds(legendIds);
        }

        const normalizedRentals = rentals
          .map(({ legendId, playerId, expiresAt }) => {
            const legend = legendById.get(legendId);
            if (!legend) {
              return null;
            }
            return { ...legend, expiresAt, playerId } as RentedLegend;
          })
          .filter((value): value is RentedLegend => Boolean(value))
          .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
        setRented(normalizedRentals);
      } catch (err) {
        console.warn(err);
      } finally {
        if (isActive) {
          setIsLoadingTeam(false);
        }
      }
    };

    loadData();

    return () => {
      isActive = false;
    };
  }, [legendById, user]);

  const ownedLegendSet = useMemo(() => new Set(ownedLegendIds), [ownedLegendIds]);

  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    if (current) {
      setDialogOpen(true);
    } else {
      setDialogOpen(false);
    }
  }, [current]);

  useEffect(() => {
    if (!user || typeof window === 'undefined') {
      return;
    }

    const key = getStorageKey(user.id);
    const storedId = window.localStorage.getItem(key);
    if (!storedId) {
      return;
    }

    const legendId = Number.parseInt(storedId, 10);
    if (Number.isNaN(legendId) || ownedLegendSet.has(legendId)) {
      window.localStorage.removeItem(key);
      return;
    }

    const legend = legendById.get(legendId);
    if (!legend) {
      window.localStorage.removeItem(key);
      return;
    }

    setCurrent((prev) => (prev?.id === legend.id ? prev : legend));
  }, [legendById, ownedLegendSet, user]);

  useEffect(() => {
    if (!user || typeof window === 'undefined') {
      return;
    }

    const key = getStorageKey(user.id);
    if (current) {
      window.localStorage.setItem(key, String(current.id));
    } else {
      window.localStorage.removeItem(key);
    }
  }, [current, user]);

  const allCollected = useMemo(
    () => LEGEND_PLAYERS.every((legend) => ownedLegendSet.has(legend.id)),
    [ownedLegendSet],
  );

  const ownedCount = ownedLegendIds.length;

  const handleOpen = async () => {
    if (!user) {
      toast.error('Giris yapmalisin');
      return;
    }
    if (current) {
      toast.info('Önce mevcut kartın için karar vermelisin');
      return;
    }

    const isFree = Boolean(vipNostalgiaFreeAvailable);
    if (!isFree && balance < PACK_COST) {
      toast.error('Yeterli elmas yok');
      return;
    }

    const availableLegends = LEGEND_PLAYERS.filter(
      (legend) => !ownedLegendSet.has(legend.id),
    );

    if (availableLegends.length === 0) {
      toast.info('Tüm nostalji oyuncularını topladın');
      return;
    }

    // Start Animation
    setIsOpening(true);

    try {
      // Wait for animation (e.g. 2 seconds)
      await new Promise(resolve => setTimeout(resolve, 2000));

      if (!isFree) {
        await spend(PACK_COST);
      }

      const p = drawLegend(availableLegends);
      setCurrent(p);

      if (isFree) {
        consumeVipNostalgiaReward();
        toast.success('VIP nostalji paketi ucretsiz acildi.');
      }
    } catch (err) {
      console.warn(err);
      toast.error('Islem basarisiz');
    } finally {
      setIsOpening(false);
    }
  };

  const handleRent = async (legend: LegendPlayer) => {
    if (!user) return;
    const expiresAt = new Date(Date.now() + RENT_DURATION_MS);
    try {
      const rentedPlayer = await rentLegend(user.id, legend, expiresAt);
      setRented(prev => {
        const next = [...prev, { ...legend, playerId: rentedPlayer.id, expiresAt }];
        return next.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
      });
      setOwnedLegendIds((prev) =>
        prev.includes(legend.id) ? prev : [...prev, legend.id].sort((a, b) => a - b),
      );
      toast.success(`${legend.name} ${RENT_DURATION_DAYS} günlüğüne kadrona katıldı`);
      setCurrent(null);
    } catch (err) {
      console.warn(err);
      const message = err instanceof Error ? err.message : 'İşlem başarısız';
      toast.error(message);
    }
  };

  const handleRelease = () => {
    toast.message('Kart serbest bırakıldı');
    setCurrent(null);
  };

  return (
    <div className="relative h-screen w-full overflow-hidden bg-slate-950 text-white selection:bg-purple-500/30">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black" />
      <div className="absolute inset-0 bg-[url('/assets/menu/bg.png')] opacity-10 bg-cover bg-center mix-blend-overlay" />
      <div className="legend-pack-gradient pointer-events-none" />
      <div className="legend-pack-orb legend-pack-orb--left pointer-events-none" />
      <div className="legend-pack-orb legend-pack-orb--right pointer-events-none" />

      {/* Main Container */}
      <div className="relative z-10 flex h-full flex-col p-4 md:p-6 gap-4 md:gap-6 max-w-7xl mx-auto">

        {/* Header */}
        <header className="flex items-center justify-between shrink-0 h-16 rounded-2xl bg-white/5 border border-white/10 px-6 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <BackButton className="static translate-y-0" />
            <div className="flex flex-col">
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                <span className="text-purple-400">NOSTALJİ</span> PAKETİ
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {vipNostalgiaFreeAvailable && (
              <div className="hidden md:flex px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold tracking-wider uppercase">
                VIP Ücretsiz Hak Mevcut
              </div>
            )}
            <div className="flex flex-col items-end">
              <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Bakiye</span>
              <span className="text-xl font-bold text-cyan-300 flex items-center gap-1">
                {balance} <span className="text-xs text-cyan-500/70">💎</span>
              </span>
            </div>
          </div>
        </header>

        {/* Content Grid - Scroll Free */}
        <main className="flex-1 grid grid-cols-12 gap-2 sm:gap-4 md:gap-6 min-h-0">

          {/* LEFT: Collection Stats (3 cols) */}
          <aside className="col-span-3 flex flex-col gap-2 sm:gap-4 min-h-0 overflow-y-auto custom-scrollbar">
            {/* Info Card */}
            <div className="shrink-0 rounded-2xl sm:rounded-3xl bg-slate-900/60 border border-white/10 p-3 sm:p-4 md:p-6 backdrop-blur-sm flex flex-col gap-3 sm:gap-4 md:gap-6 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-bl-full -mr-8 -mt-8 blur-2xl group-hover:bg-purple-500/20 transition-colors" />

              <div>
                <h3 className="text-lg font-bold text-white mb-1">Koleksiyon</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  80'ler ve 90'ların efsane oyuncularını topla. Efsaneler satılamaz.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="bg-slate-950/50 rounded-xl p-4 border border-white/5">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block mb-1">Toplanan</span>
                  <div className="flex items-end gap-2">
                    <span className="text-3xl font-black text-white">{ownedCount}</span>
                    <span className="text-sm text-slate-500 font-medium mb-1.5">/ {TOTAL_LEGENDS}</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full mt-3 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-cyan-500"
                      style={{ width: `${(ownedCount / TOTAL_LEGENDS) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="bg-slate-950/50 rounded-xl p-4 border border-white/5">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block mb-1">Kira Süresi</span>
                  <div className="text-2xl font-bold text-white">{RENT_DURATION_DAYS} GÜN</div>
                  <p className="text-[10px] text-slate-500 mt-1">Süre bitiminde oyuncu ayrılır.</p>
                </div>
              </div>

              <div className="mt-auto">
                <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                  <p className="text-[11px] text-indigo-300 text-center">
                    Mevcut kartları "Kiralananlar" listesinden takip edebilirsin.
                  </p>
                </div>
              </div>
            </div>
          </aside>

          {/* CENTER: Pack Opening (6 cols) */}
          <section className="col-span-6 flex flex-col relative">
            <div className="flex-1 rounded-3xl bg-gradient-to-b from-slate-900/80 to-slate-950/90 border border-white/10 p-1 backdrop-blur-md shadow-2xl relative overflow-hidden flex flex-col items-center justify-center max-h-[70vh] lg:max-h-[calc(100vh-12rem)]">

              {/* Center Glow */}
              <div className="absolute inset-0 bg-radial-gradient from-purple-500/10 via-transparent to-transparent opacity-50" />

              {/* Pack Content */}
              <div className="relative z-10 w-full h-full flex flex-col items-center justify-center p-4 pb-4 text-center">

                {isLoadingTeam ? (
                  <div className="flex flex-col items-center gap-4 animate-pulse">
                    <div className="w-16 h-16 rounded-full border-4 border-white/10 border-t-purple-500 animate-spin" />
                    <p className="text-sm text-slate-400 font-medium tracking-wider uppercase">Loading Data...</p>
                  </div>
                ) : isOpening ? (
                  // ANIMATION STATE
                  <div className="flex flex-col items-center justify-center gap-4 relative">
                    <div className="relative w-32 h-32 md:w-48 md:h-48 flex items-center justify-center">
                      {/* Spinning / Glowing effects */}
                      <div className="absolute inset-0 bg-purple-500/30 rounded-full blur-[100px] animate-pulse" />
                      <div className="absolute inset-0 border-4 border-purple-500/30 rounded-full animate-[spin_3s_linear_infinite]" />
                      <div className="absolute inset-4 border-4 border-cyan-500/30 rounded-full animate-[spin_2s_linear_infinite_reverse]" />

                      {/* Central Star shaking/scaling */}
                      <div className="relative z-10 text-6xl animate-[bounce_0.5s_infinite]">
                        ✨
                      </div>
                    </div>
                    <p className="text-purple-300 font-bold tracking-widest animate-pulse uppercase">Efsane Çağırılıyor...</p>
                  </div>
                ) : current ? (
                  // CARD REVEALED STATE
                  <div className="flex flex-col items-center gap-6 w-full max-w-sm animate-in fade-in zoom-in duration-500">
                    <div className="relative group cursor-pointer" onClick={() => setDialogOpen(true)}>
                      <div className="absolute inset-0 bg-purple-500/20 blur-3xl group-hover:bg-purple-500/30 transition-all duration-500" />
                      <div className="relative transform transition-transform group-hover:scale-105 duration-300">
                        {/* Using placeholder card representation */}
                        <div className="w-48 h-64 rounded-xl bg-slate-900 border-2 border-amber-500/50 shadow-[0_0_50px_rgba(245,158,11,0.2)] flex items-center justify-center flex-col gap-2 overflow-hidden">
                          <img src={current.image} alt={current.name} className="absolute inset-0 w-full h-full object-cover opacity-60" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                          <div className="absolute bottom-4 left-0 right-0 text-center">
                            <div className="text-amber-400 font-black text-xl uppercase drop-shadow-md">{current.rating}</div>
                            <div className="text-white font-bold text-sm truncate px-2">{current.name}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 w-full">
                      <p className="text-amber-200 text-sm font-medium">Yeni bir efsane yakaladın!</p>
                      <Button
                        size="lg"
                        className="w-full bg-amber-500 hover:bg-amber-600 text-black font-bold shadow-lg shadow-amber-900/20"
                        onClick={() => setDialogOpen(true)}
                      >
                        KARTI İNCELE
                      </Button>
                    </div>
                  </div>
                ) : (
                  // IDLE STATE
                  <div className="flex flex-col items-center gap-4 w-full max-w-md">
                    <div
                      className={`relative w-32 h-32 md:w-48 md:h-48 flex items-center justify-center group cursor-pointer ${(!vipNostalgiaFreeAvailable && balance < PACK_COST) || allCollected ? 'opacity-50 grayscale cursor-not-allowed' : ''}`}
                      onClick={(!vipNostalgiaFreeAvailable && balance < PACK_COST) || allCollected ? undefined : handlePackClick}
                    >
                      <div className="absolute inset-0 bg-purple-600/20 rounded-full blur-[80px] animate-pulse group-hover:bg-purple-600/40 transition-colors duration-500" />
                      {/* Pack Image / Icon */}
                      <div className="relative z-10 w-full h-full transform group-hover:scale-110 transition-transform duration-300 ease-out">
                        <svg className="w-full h-full text-slate-800 drop-shadow-2xl opacity-80" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M100 20L180 60V140L100 180L20 140V60L100 20Z" fill="currentColor" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
                          <path d="M100 20L100 180M20 60L180 60M20 140L180 140" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-6xl filter drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]">✨</span>
                        </div>
                      </div>

                      {/* Click Hint */}
                      <div className="absolute -bottom-4 bg-white/10 backdrop-blur-md border border-white/20 px-4 py-1 rounded-full text-xs font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0">
                        TIKLA VE AÇ
                      </div>


                    </div>

                    <div className="space-y-4 w-full">
                      {allCollected ? (
                        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                          <p className="font-bold">Koleksiyon Tamamlandı!</p>
                          <p className="text-xs opacity-70 mt-1">Tüm efsanelere sahipsin.</p>
                        </div>
                      ) : (
                        <Button
                          size="lg"
                          className={`w-full h-12 text-lg font-bold tracking-wide shadow-xl transition-all duration-300 ${vipNostalgiaFreeAvailable
                            ? "bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-emerald-900/20"
                            : "bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-purple-900/20"
                            }`}
                          onClick={handlePackClick}
                          disabled={!vipNostalgiaFreeAvailable && balance < PACK_COST}
                        >
                          {vipNostalgiaFreeAvailable ? 'ÜCRETSİZ AÇ' : `PAKET AÇ (${PACK_COST} 💎)`}
                        </Button>
                      )}

                      {!vipNostalgiaFreeAvailable && !allCollected && (
                        <p className="text-xs text-slate-500">
                          Mevcut Bakiye: <span className={balance < PACK_COST ? "text-red-400" : "text-slate-300"}>{balance}</span> / {PACK_COST}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* RIGHT: Active Rentals (3 cols) */}
          <aside className="col-span-3 flex flex-col gap-2 sm:gap-4 min-h-0 overflow-hidden">
            <div className="flex items-center justify-between px-2">
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Kiralananlar</h3>
              <span className="bg-slate-800 text-slate-400 text-[10px] px-2 py-0.5 rounded-full font-bold">{rented.length}</span>
            </div>

            <div className="flex-1 rounded-3xl bg-slate-900/40 border border-white/5 backdrop-blur-sm overflow-hidden flex flex-col">
              {rented.length > 0 ? (
                <div className="overflow-y-auto p-2 space-y-2 pr-1 custom-scrollbar">
                  {rented.map((p) => (
                    <div key={p.id} className="group flex items-center gap-3 p-2.5 rounded-xl bg-slate-800/40 hover:bg-slate-800/80 border border-white/5 transition-colors">
                      <div className="w-10 h-10 rounded-lg bg-slate-700 overflow-hidden shrink-0 relative">
                        <img src={p.image} className="w-full h-full object-cover" alt={p.name} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-white truncate">{p.name}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span className="text-[10px] text-slate-400">
                            {Math.ceil((p.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))} gün kaldı
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center opacity-60">
                  <div className="w-12 h-12 rounded-full bg-slate-800 mb-3 flex items-center justify-center">
                    <span className="text-xl">📋</span>
                  </div>
                  <p className="text-sm text-slate-400">Henüz kiralanan efsane yok.</p>
                </div>
              )}
            </div>
          </aside>
        </main>
      </div>

      <Dialog open={Boolean(current) && isDialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-none bg-transparent shadow-none p-0 max-w-sm w-full flex items-center justify-center overflow-visible">
          {current ? (
            <div className="relative w-full flex flex-col items-center gap-6">
              {/* Glow Effect */}
              <div className="absolute inset-0 bg-purple-500/20 blur-[60px] rounded-full pointer-events-none" />

              <div className="relative z-10 text-center animate-in slide-in-from-bottom-4 fade-in duration-700">
                <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-500 drop-shadow-sm tracking-wide uppercase">
                  YENİ EFSANE!
                </h2>
              </div>

              <div className="relative z-10 transform transition-all duration-500 animate-in zoom-in-95 fade-in-0 scale-70 md:scale-90 pb-20">
                <LegendCard player={current} onRent={handleRent} onRelease={handleRelease} />
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="bg-slate-900 border border-purple-500/30 text-white max-w-md w-full rounded-2xl shadow-[0_0_50px_rgba(168,85,247,0.2)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-2xl font-bold text-center text-purple-400">
              NOSTALJİ PAKETİ AÇ
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center text-slate-300 text-lg py-4">
              Bu işlem için hesabınızdan <span className="font-bold text-amber-400">{PACK_COST} Elmas</span> düşülecektir.
              <br /><br />
              Efsane oyuncuyu açmak istediğinize emin misiniz?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-4 justify-center sm:justify-center">
            <AlertDialogCancel className="bg-slate-800 text-white border-slate-700 hover:bg-slate-700 hover:text-white px-8">
              VAZGEÇ
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold px-8 shadow-lg shadow-purple-900/30 border-none"
              onClick={() => {
                handleOpen();
                setShowConfirm(false);
              }}
            >
              EVET, AÇ!
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div >
  );
};

export default LegendPackPage;

function extractLegendIds(players: Player[]): number[] {
  const ids = new Set<number>();
  players.forEach((player) => {
    const legendId = getLegendIdFromPlayer(player);
    if (typeof legendId === 'number') {
      ids.add(legendId);
    }
  });
  return Array.from(ids).sort((a, b) => a - b);
}



