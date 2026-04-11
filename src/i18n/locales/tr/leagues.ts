import type { TranslationDictionary } from '@/i18n/types';

export const trLeagues: TranslationDictionary = {
  leagues: {
    listPage: {
      title: 'Ligler',
      description: 'Lig aciklamasi.',
      listTitle: 'Lig Listesi',
      columns: {
        detail: 'Lig Detayi',
        season: 'Sezon',
        occupancy: 'Doluluk',
        status: 'Durum',
      },
      loading: 'Ligler yukleniyor...',
      empty: 'Henuz lig bulunamadi.',
      currentLeague: 'Mevcut Ligin',
    },
    detailPage: {
      title: 'Lig Detayi',
      description: 'Puan durumu ve istatistikler.',
      standingsTitle: 'Puan Durumu',
      columns: {
        rank: 'S',
        team: 'Takim',
        played: 'O',
        won: 'G',
        draw: 'B',
        lost: 'M',
        goalsFor: 'AG',
        goalsAgainst: 'YG',
        goalDiff: 'AV',
        points: 'P',
      },
      botPrefix: 'Bot',
    },
    states: {
      active: 'Aktif',
      forming: 'Olusuyor',
      scheduled: 'Planlandi',
      completed: 'Tamamlandi',
    },
  },
};
