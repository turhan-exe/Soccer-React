import type { TranslationDictionary } from '@/i18n/types';

export const trFriends: TranslationDictionary = {
  friends: {
    title: 'Sosyal Merkez',
    tabs: {
      friends: 'Arkadaslar',
      requests: 'Istekler',
      add: 'Ekle',
      searchMobile: 'Ara',
    },
    empty: {
      friendsTitle: 'Henuz arkadasin yok',
      friendsDescription: 'Diger menajerleri ekleyerek rekabete basla!',
      requestsTitle: 'Gelen istek yok',
      requestsDescription: 'Yeni arkadaslik istekleri burada gorunecek.',
      searchDescription: 'Menajer veya takim adi ara.',
    },
    placeholders: {
      search: 'Takim Adi veya Menajer Adi...',
    },
    actions: {
      chat: 'Chat Ac',
      friendly: 'Dostluk Maci',
      viewTeam: 'Takimi Gor',
      remove: 'Arkadasi Sil',
      you: 'Sen',
      accept: 'Kabul Et',
      reject: 'Reddet',
      sendRequest: 'Istek Gonder',
      alreadyFriends: 'Arkadassiniz',
      requestSent: 'Istek Gonderildi',
      requestReceived: 'Istek Geldi',
    },
    confirmations: {
      rejectRequest: 'Bu istegi reddetmek istedigine emin misin?',
      removeFriend: '{name} adli arkadasi silmek istedigine emin misin?',
    },
    toasts: {
      loadFailed: 'Veriler yuklenirken hata olustu.',
      userNotFound: 'Kullanici bulunamadi.',
      searchFailed: 'Arama hatasi: {message}',
      requestSent: 'Arkadaslik istegi gonderildi!',
      requestAccepted: 'Arkadaslik istegi kabul edildi!',
      requestRejected: 'Istek reddedildi.',
      requestRejectFailed: 'Istek reddedilemedi.',
      removeSuccess: 'Arkadas silindi.',
      removeFailed: 'Silme islemi basarisiz.',
      requestFailed: 'Istek gonderilirken hata olustu.',
      acceptFailed: 'Istek kabul edilirken hata olustu.',
    },
  },
};
