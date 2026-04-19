import type { TranslationDictionary } from '@/i18n/types';

export const trFixtures: TranslationDictionary = {
  fixtures: {
    page: {
      title: 'Fikstur',
      description: 'Sezonluk mac programi, canli durumlar ve sonuclar.',
      scheduleTitle: 'Fikstur Programi',
      scheduleDescription:
        'Canli durumdaki maclar icin Android uygulamadan dogrudan maca baglanabilirsin.',
      back: 'Geri',
      loading: 'Yukleniyor...',
      empty: 'Henuz fikstur olusturulmamis.',
    },
    labels: {
      competitionName: 'Super Lig',
      currentlyPlaying: 'Mac oynaniyor',
      watch: 'Izle',
      preparingCta: 'Hazirlaniyor',
      live: 'CANLI',
      preparing: 'HAZIRLANIYOR',
      queued: 'SIRADA',
      preparingDelayed: 'GECIKMELI HAZIRLANIYOR',
      finished: 'BITTI',
      error: 'HATA',
      queueHint: 'Mac kapasite sirasinda. Hazir olunca Izle acilacak.',
      preparingDelayedHint: 'Mac sunucusu hazirlaniyor. Birazdan Izle acilacak.',
    },
    errors: {
      loginRequired: 'Canli maca baglanmak icin giris yapmalisin.',
      matchControlUnavailable: 'Match Control API ayarli degil.',
      noLiveConnection: 'Bu mac icin canli baglanti bulunamadi.',
      noLongerJoinable: 'Bu mac artik canli baglantiya acik degil.',
      androidOnly: 'Canli lig maci su anda yalnizca Android uygulamada acilabiliyor.',
      unauthorized: 'Canli maca baglanti yetkin yok veya mac kapanmis.',
      joinFailed: 'Canli maca baglanilamadi.',
    },
    toasts: {
      joinStarted: 'Canli mac baglantisi baslatildi.',
    },
  },
};
