import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { BackButton } from '@/components/ui/back-button';
import CheckoutModal from './CheckoutModal';
import PacksGrid from './PacksGrid';
import { DIAMOND_PACKS, type DiamondPack } from './packs';
import {
  getPlayBillingUnavailableMessage,
  isNativeAndroidPlayBillingSupported,
  loadPlayBillingProducts,
  type PlayBillingProduct,
} from '@/services/playBilling';
import { syncPendingAndroidDiamondPurchases } from '@/services/diamonds';

const DiamondsPage = () => {
  const { user } = useAuth();
  const { balance } = useDiamonds();
  const [selected, setSelected] = useState<DiamondPack | null>(null);
  const [productsById, setProductsById] = useState<Record<string, PlayBillingProduct>>({});
  const [isStoreLoading, setIsStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function prepareStore() {
      if (!user) {
        setProductsById({});
        setStoreError(null);
        setIsStoreLoading(false);
        return;
      }

      if (!isNativeAndroidPlayBillingSupported()) {
        setProductsById({});
        setStoreError(getPlayBillingUnavailableMessage());
        setIsStoreLoading(false);
        return;
      }

      setIsStoreLoading(true);
      setStoreError(null);

      try {
        const products = await loadPlayBillingProducts(
          DIAMOND_PACKS.map((pack) => pack.productId),
        );

        if (isCancelled) {
          return;
        }

        setProductsById(products);

        if (Object.keys(products).length === 0) {
          setStoreError('Play Store urunleri bulunamadi. Uygulama ici urunleri kontrol et.');
        }
      } catch (error) {
        console.warn('[DiamondsPage] prepare store failed', error);
        if (!isCancelled) {
          setStoreError(
            error instanceof Error
              ? error.message
              : 'Play Store baglantisi kurulurken hata olustu.',
          );
        }
      } finally {
        if (!isCancelled) {
          setIsStoreLoading(false);
        }
      }

      try {
        const syncResult = await syncPendingAndroidDiamondPurchases();
        if (isCancelled) {
          return;
        }

        if (syncResult.processed > 0) {
          toast.success(`${syncResult.processed} bekleyen satin alma hesaba islendi.`);
        }
        if (syncResult.pending > 0) {
          toast(
            `${syncResult.pending} satin alma hala beklemede. Google Play onayindan sonra otomatik islenecek.`,
          );
        }
      } catch (error) {
        console.warn('[DiamondsPage] pending purchase sync failed', error);
        if (!isCancelled) {
          toast.warning(
            'Bekleyen Google Play satin almalari su an senkronize edilemedi. Magazayi tekrar acarak yeniden deneyebilirsin.',
          );
        }
      }
    }

    void prepareStore();

    return () => {
      isCancelled = true;
    };
  }, [user]);

  const selectedProduct = useMemo(
    () => (selected ? productsById[selected.productId] ?? null : null),
    [productsById, selected],
  );

  if (!user) {
    return <div className="p-4 text-center">Giris yapmalisin</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <BackButton fallbackPath="/" />
          <div>
            <h1 className="text-2xl font-bold">Elmas Magazasi</h1>
            <p className="text-muted-foreground">Google Play ile guvenli sekilde elmas satin al.</p>
          </div>
        </div>
        <div className="text-sm text-muted-foreground">Bakiyen: {balance} elmas</div>
      </div>

      {storeError && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {storeError}
        </div>
      )}

      <PacksGrid
        packs={DIAMOND_PACKS}
        onSelect={setSelected}
        productsById={productsById}
        isStoreLoading={isStoreLoading}
        storeError={storeError}
      />

      <CheckoutModal
        pack={selected}
        storeProduct={selectedProduct}
        storeError={storeError}
        isStoreLoading={isStoreLoading}
        onClose={() => setSelected(null)}
      />
    </div>
  );
};

export default DiamondsPage;
