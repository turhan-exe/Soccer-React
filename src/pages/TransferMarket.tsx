import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { BackButton } from '@/components/ui/back-button';
import { Loader2, PlusCircle, ShoppingCart, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Player, TransferListing } from '@/types';
import { getTeam } from '@/services/team';
import {
  createTransferListing,
  listenAvailableTransferListings,
  listenUserTransferListings,
  purchaseTransferListing,
  type MarketSortOption,
} from '@/services/transferMarket';

const POSITIONS: Player['position'][] = [
  'GK',
  'CB',
  'LB',
  'RB',
  'CM',
  'LM',
  'RM',
  'CAM',
  'LW',
  'RW',
  'ST',
];

type SortOption = 'overall-desc' | 'overall-asc' | 'price-asc' | 'price-desc';

type FilterState = {
  position: 'all' | Player['position'];
  maxPrice: string;
  sortBy: SortOption;
};

type FirestoreErrorLike = Error & { code?: string };

const mapSortToService = (sort: SortOption): MarketSortOption => {
  switch (sort) {
    case 'overall-asc':
      return 'overall_asc';
    case 'price-asc':
      return 'price_asc';
    case 'price-desc':
      return 'price_desc';
    case 'overall-desc':
    default:
      return 'overall_desc';
  }
};

const formatPrice = (value: number) =>
  `${value.toLocaleString('tr-TR')} ₺`;

const formatOverall = (value: number) => value.toFixed(3);

const isFirestoreIndexError = (error: FirestoreErrorLike) =>
  error.code === 'failed-precondition' || error.message.includes('The query requires an index');

const resolveMarketplaceErrorMessage = (error: unknown) => {
  const err =
    error instanceof Error
      ? (error as FirestoreErrorLike)
      : new Error(typeof error === 'string' ? error : String(error));

  if (isFirestoreIndexError(err)) {
    return 'Pazar sorgusu için Firestore indeksine ihtiyaç var. Lütfen Firebase projenizde composite indexi oluşturun.';
  }

  if (err.message.includes('permission')) {
    return 'Pazar okunamıyor. Kuralları güncelliyor musunuz?';
  }

  return err.message || 'Beklenmedik bir hata oluştu.';
};

export default function TransferMarket() {
  const { user } = useAuth();
  const [teamPlayers, setTeamPlayers] = useState<Player[]>([]);
  const [teamName, setTeamName] = useState<string>('');
  const [isLoadingTeam, setIsLoadingTeam] = useState(false);
  const [listings, setListings] = useState<TransferListing[]>([]);
  const [myListings, setMyListings] = useState<TransferListing[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [isListing, setIsListing] = useState(false);
  const [purchasingId, setPurchasingId] = useState<string>('');
  const [isListingsLoading, setIsListingsLoading] = useState(true);
  const [isMyListingsLoading, setIsMyListingsLoading] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    position: 'all',
    maxPrice: '',
    sortBy: 'overall-desc',
  });
  const previousListingCount = useRef<number>(0);

  const loadTeam = useCallback(async () => {
    if (!user) return;
    setIsLoadingTeam(true);
    try {
      const team = await getTeam(user.id);
      setTeamPlayers(team?.players ?? []);
      setTeamName(team?.name ?? user.teamName ?? 'Takımım');
    } catch (error) {
      console.error('[TransferMarket] takımı yükleme hatası', error);
      toast.error('Takım bilgileri alınamadı.', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsLoadingTeam(false);
    }
  }, [user]);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  useEffect(() => {
    if (!user) {
      setListings([]);
      setIsListingsLoading(false);
      return;
    }

    let isMounted = true;
    setIsListingsLoading(true);

    const rawMaxPrice = Number(filters.maxPrice);
    const maxPrice = Number.isFinite(rawMaxPrice) && rawMaxPrice > 0 ? rawMaxPrice : undefined;

    const unsubscribe = listenAvailableTransferListings(
      {
        pos: filters.position === 'all' ? undefined : filters.position,
        maxPrice,
        sort: mapSortToService(filters.sortBy),
      },
      list => {
        if (!isMounted) return;
        setListings(list);
        setIsListingsLoading(false);
      },
      error => {
        if (!isMounted) return;
        console.error('[TransferMarket] marketplace listen error', error);
        const message = resolveMarketplaceErrorMessage(error);
        toast.error(message);
        setListings([]);
        setIsListingsLoading(false);
      },
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [filters.maxPrice, filters.position, filters.sortBy, user]);

  useEffect(() => {
    if (!user?.id) {
      setMyListings([]);
      setIsMyListingsLoading(false);
      return;
    }

    let isMounted = true;
    setIsMyListingsLoading(true);

    const unsubscribe = listenUserTransferListings(
      user.id,
      list => {
        if (!isMounted) return;
        setMyListings(list);
        setIsMyListingsLoading(false);
      },
      error => {
        if (!isMounted) return;
        console.error('[TransferMarket] my listings listen error', error);
        const message = resolveMarketplaceErrorMessage(error);
        toast.error(message);
        setMyListings([]);
        setIsMyListingsLoading(false);
      },
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    if (previousListingCount.current > myListings.length) {
      loadTeam();
    }
    previousListingCount.current = myListings.length;
  }, [loadTeam, myListings.length, user]);

  const availablePlayers = useMemo(() => {
    const listedIds = new Set(myListings.map(listing => listing.playerId));
    return teamPlayers.filter(player => !listedIds.has(player.id));
  }, [myListings, teamPlayers]);

  const handleCreateListing = async () => {
    if (!user) {
      toast.error('Giriş yapmalısın.');
      return;
    }
    const player = availablePlayers.find(p => p.id === selectedPlayerId);
    if (!player) {
      toast.error('Pazara koymak için bir oyuncu seç.');
      return;
    }
    const priceValue = Number(price);
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      toast.error('Geçerli bir fiyat gir.');
      return;
    }

    setIsListing(true);
    try {
      await createTransferListing({
        player,
        price: priceValue,
      });
      toast.success(`${player.name} transfer pazarına eklendi.`);
      setSelectedPlayerId('');
      setPrice('');
      await loadTeam();
    } catch (error) {
      toast.error('İlan oluşturulamadı.', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsListing(false);
    }
  };

  const handlePurchase = async (listing: TransferListing) => {
    if (!user) {
      toast.error('Giriş yapmalısın.');
      return;
    }
    const sellerUid = listing.sellerUid ?? listing.sellerId;
    if (sellerUid === user.id) {
      toast.error('Kendi oyuncunu satın alamazsın.');
      return;
    }

    setPurchasingId(listing.id);
    try {
      await purchaseTransferListing({
        listingId: listing.id,
        buyerTeamName: teamName || user.teamName || 'Takımım',
      });
      toast.success(`${listing.player.name} takımıza katıldı!`);
      await loadTeam();
    } catch (error) {
      toast.error('Satın alma başarısız.', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPurchasingId('');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-slate-50 to-blue-50 dark:from-emerald-950 dark:via-slate-950 dark:to-blue-950">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <BackButton />
            <h1 className="text-3xl font-bold">Transfer Pazarı</h1>
            <p className="text-muted-foreground max-w-2xl">
              Oyuncularını pazara çıkar, eksik bölgeler için yeni yıldızlar keşfet.
              Mevkilere, ortalama güce ve fiyata göre filtreleyerek hedeflediğin transferi kolayca bul.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-lg border bg-white/60 p-4 dark:bg-slate-900/60">
            <Shield className="h-10 w-10 text-emerald-600" />
            <div>
              <p className="text-sm text-muted-foreground">Takım Adı</p>
              <p className="font-semibold">{teamName || user?.teamName || 'Takımım'}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
          <Card>
            <CardHeader className="flex flex-col gap-2 border-b bg-white/70 dark:bg-slate-900/60">
              <CardTitle className="flex items-center gap-2 text-xl">
                <ShoppingCart className="h-5 w-5" />
                Pazardaki Oyuncular
              </CardTitle>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium uppercase text-muted-foreground mb-1">
                    Mevki
                  </label>
                  <Select
                    value={filters.position}
                    onValueChange={value =>
                      setFilters(prev => ({ ...prev, position: value as FilterState['position'] }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Mevki seç" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tümü</SelectItem>
                      {POSITIONS.map(position => (
                        <SelectItem key={position} value={position}>
                          {position}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-medium uppercase text-muted-foreground mb-1">
                    Maksimum Fiyat
                  </label>
                  <Input
                    inputMode="numeric"
                    type="number"
                    min={0}
                    placeholder="Örn. 500000"
                    value={filters.maxPrice}
                    onChange={event =>
                      setFilters(prev => ({ ...prev, maxPrice: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium uppercase text-muted-foreground mb-1">
                    Sıralama
                  </label>
                  <Select
                    value={filters.sortBy}
                    onValueChange={value =>
                      setFilters(prev => ({ ...prev, sortBy: value as SortOption }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sırala" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="overall-desc">Güç (Yüksek &rarr; Düşük)</SelectItem>
                      <SelectItem value="overall-asc">Güç (Düşük &rarr; Yüksek)</SelectItem>
                      <SelectItem value="price-asc">Fiyat (Düşük &rarr; Yüksek)</SelectItem>
                      <SelectItem value="price-desc">Fiyat (Yüksek &rarr; Düşük)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Oyuncu</TableHead>
                      <TableHead>Mevki</TableHead>
                      <TableHead>Güç Ortalaması</TableHead>
                      <TableHead>Satıcı</TableHead>
                      <TableHead>Fiyat</TableHead>
                      <TableHead className="text-right">İşlem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isListingsLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                          <div className="flex items-center justify-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            İlanlar yükleniyor...
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : listings.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                          Filtrenize uyan aktif ilan bulunamadı.
                        </TableCell>
                      </TableRow>
                    ) : (
                      listings.map(listing => {
                        const player = listing.player;
                        const name = player?.name ?? listing.playerName ?? 'Bilinmeyen Oyuncu';
                        const position = player?.position ?? listing.pos ?? 'N/A';
                        const overallValue =
                          player?.overall ?? listing.overall ?? 0;
                        const potentialValue =
                          player?.potential ?? overallValue;
                        const ageDisplay = player?.age ?? '—';
                        const sellerUid = listing.sellerUid ?? listing.sellerId;

                        return (
                          <TableRow key={listing.id}>
                            <TableCell>
                              <div className="font-semibold">{name}</div>
                              <div className="text-xs text-muted-foreground">
                                Yaş {ageDisplay} · Potansiyel {formatOverall(potentialValue)}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{position}</Badge>
                            </TableCell>
                            <TableCell>{formatOverall(overallValue)}</TableCell>
                            <TableCell>{listing.sellerTeamName}</TableCell>
                            <TableCell className="font-medium text-emerald-600">
                              {formatPrice(listing.price)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                onClick={() => handlePurchase(listing)}
                                disabled={sellerUid === user?.id || purchasingId === listing.id}
                              >
                                {purchasingId === listing.id ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    İşlem Yapılıyor
                                  </>
                                ) : (
                                  'Satın Al'
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <PlusCircle className="h-5 w-5" />
                  Oyuncu İlanı Oluştur
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-xs font-medium uppercase text-muted-foreground mb-1">
                    Oyuncu Seç
                  </label>
                  <Select
                    value={selectedPlayerId}
                    onValueChange={value => setSelectedPlayerId(value)}
                    disabled={availablePlayers.length === 0 || isListing || isLoadingTeam}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          isLoadingTeam
                            ? 'Takım yükleniyor...'
                            : availablePlayers.length === 0
                              ? 'Pazara koyabileceğin oyuncu kalmadı'
                              : 'Oyuncu seç'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {availablePlayers.map(player => (
                        <SelectItem key={player.id} value={player.id}>
                          {player.name} · {player.position} · Overall {formatOverall(player.overall)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-medium uppercase text-muted-foreground mb-1">
                    Satış Fiyatı (₺)
                  </label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step="10000"
                    placeholder="Örn. 250000"
                    value={price}
                    onChange={event => setPrice(event.target.value)}
                    disabled={isListing}
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={handleCreateListing}
                  disabled={!selectedPlayerId || !price || isListing}
                >
                  {isListing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      İlan Oluşturuluyor
                    </>
                  ) : (
                    'Pazara Ekle'
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">
                  İlan verdiğin oyuncular satılana kadar kadronda görünmeye devam eder. Satış gerçekleştiğinde oyuncu yeni
                  takımına otomatik olarak transfer edilir.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Aktif İlanların</CardTitle>
              </CardHeader>
              <CardContent>
                {isMyListingsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    İlanların yükleniyor...
                  </div>
                ) : myListings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Şu anda pazarda aktif ilanların bulunmuyor.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {myListings.map(listing => (
                      <li
                        key={listing.id}
                        className="flex items-center justify-between rounded-lg border bg-white/70 px-3 py-2 text-sm dark:bg-slate-900/60"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{listing.player.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {listing.player.position} · Overall {formatOverall(listing.player.overall)}
                          </span>
                        </div>
                        <span className="font-semibold text-emerald-600">{formatPrice(listing.price)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
// Used path for listings: transferListings
// Added callables: marketCreateListing, marketCancelListing
// Updated marketplace UI/services.
// Rules block added.
// Indexes added.
