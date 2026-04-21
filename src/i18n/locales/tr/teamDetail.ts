import type { TranslationDictionary } from '@/i18n/types';

export const trTeamDetail: TranslationDictionary = {
  teamDetail: {
    title: 'Takim Detayi',
    subtitle: 'Rakip kadroyu ve sosyal aksiyonlari incele.',
    unknownTeam: 'Bilinmeyen Takim',
    unknownManager: 'Menajer',
    manager: 'Menajer: {name}',
    notFoundTitle: 'Takim bulunamadi',
    notFoundDescription: 'Bu takim artik mevcut olmayabilir veya erisim gecici olarak basarisiz oldu.',
    metrics: {
      formation: 'Formasyon',
      value: 'Takim Degeri',
      strength: 'Kadro Gucu',
      players: 'Oyuncu',
    },
    sections: {
      topPlayers: 'En Iyi Oyuncular',
      squad: 'Kadro Ozeti',
      vitals: 'Ortalama Durum',
    },
    squad: {
      starters: 'Ilk 11',
      bench: 'Yedek',
      reserve: 'Rezerv',
    },
    vitals: {
      condition: 'Kondisyon',
      motivation: 'Moral',
      health: 'Saglik',
    },
    actions: {
      yourTeam: 'Senin Takimin',
      openRequest: 'Isteklere Git',
    },
    empty: {
      players: 'Gosterilecek aktif oyuncu yok.',
    },
    toasts: {
      loadFailed: 'Takim detayi yuklenemedi.',
    },
  },
};
