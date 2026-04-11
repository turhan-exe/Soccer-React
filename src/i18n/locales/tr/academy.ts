import type { TranslationDictionary } from '@/i18n/types';

export const trAcademy: TranslationDictionary = {
  academy: {
    title: 'Altyapi',
    loginRequired: 'Giris yapmalisin',
    generatePlayer: 'Oyuncu Uret',
    youngPlayer: 'Genc Oyuncu',
    talented: 'Yetenekli',
    averageAge: 'Ort. Yas',
    youngPlayers: 'Genc Oyuncular',
    candidateMissing: 'Aday bulunamadi.',
    joinedTeam: '{name} A takimina katildi!',
    negotiationFailed: 'Pazarlik tamamlanamadi',
    errors: {
      permissionDenied: 'Altyapi adaylarina erisim izni yok.',
      indexRequired: 'Altyapi adaylari sorgusu icin Firestore index gerekli.',
      candidatesLoadFailed: 'Altyapi adaylari yuklenemedi.',
      cooldownLoadFailed: 'Altyapi bekleme suresi senkronize edilemedi.',
    },
    generation: {
      title: 'Oyuncu Uretimi',
      next: 'Sonraki uretim: {time}',
      speedUp: 'Hizlandir ({cost} Elmas)',
    },
    candidate: {
      promote: 'Takima Al',
      release: 'Serbest Birak',
      potential: 'Maks. Potansiyel: {value}',
      poolTitle: 'Oyuncu Havuzu',
      poolTrigger: 'Altyapi oyuncusu olmadiginda gosterilen mesaji ac',
      poolEmpty: 'Henuz altyapi oyuncusu yok. Yeni aday uret.',
      listTitle: 'Altyapi Adaylari',
      listTrigger: 'Aday olmadiginda gosterilen mesaji ac',
      listEmpty: 'Henuz aday yok.',
      height: 'Boy: {value} cm',
      weight: 'Kilo: {value} kg',
    },
  },
};
