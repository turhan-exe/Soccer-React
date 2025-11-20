/**
 * Takım dokümanına Unity için badge ve kit dokularını yazar.
 *
 * Kullanım:
 *   GOOGLE_APPLICATION_CREDENTIALS="/path/service-account.json" \
 *   TEAM_ID="uidVeyaDocId" \
 *   BADGE_URL="https://cdn.example.com/badges/roblox.png" \
 *   HOME_TEXTURE_URL="https://cdn.example.com/kits/roblox-home.png" \
 *   AWAY_TEXTURE_URL="https://cdn.example.com/kits/roblox-away.png" \
 *   HOME_NORMAL_URL="https://cdn.example.com/kits/roblox-home-norm.png" \
 *   AWAY_NORMAL_URL="https://cdn.example.com/kits/roblox-away-norm.png" \
 *   node scripts/patch-team-assets.mjs
 *
 * Notlar:
 * - Service account JSON için GOOGLE_APPLICATION_CREDENTIALS yeterli. İsterseniz
 *   gcloud auth application-default login de kullanabilirsiniz.
 * - Sadece belirtilen alanları merge eder; diğer alanlarınızı silmez.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const {
  TEAM_ID,
  BADGE_URL,
  BADGE_ALT,
  BADGE_WIDTH,
  BADGE_HEIGHT,
  BADGE_TYPE,
  HOME_TEXTURE_URL,
  HOME_NORMAL_URL,
  HOME_WIDTH,
  HOME_HEIGHT,
  AWAY_TEXTURE_URL,
  AWAY_NORMAL_URL,
  AWAY_WIDTH,
  AWAY_HEIGHT,
  THIRD_TEXTURE_URL,
  THIRD_NORMAL_URL,
  THIRD_WIDTH,
  THIRD_HEIGHT,
  THIRD_TYPE,
  HOME_TYPE,
  AWAY_TYPE,
} = process.env;

if (!TEAM_ID) {
  console.error('TEAM_ID zorunlu. Örn: TEAM_ID="uidVeyaDocId"');
  process.exit(1);
}

if (!BADGE_URL) {
  console.error('BADGE_URL zorunlu. Örn: BADGE_URL="https://cdn.example.com/badges/roblox.png"');
  process.exit(1);
}

if (!HOME_TEXTURE_URL || !AWAY_TEXTURE_URL) {
  console.error('HOME_TEXTURE_URL ve AWAY_TEXTURE_URL zorunlu. Lütfen ikisini de verin.');
  process.exit(1);
}

const toNumber = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const badge = {
  url: BADGE_URL,
  alt: BADGE_ALT || undefined,
  contentType: BADGE_TYPE || 'image/png',
  width: toNumber(BADGE_WIDTH) ?? 256,
  height: toNumber(BADGE_HEIGHT) ?? 256,
};

const kit = {
  home: {
    textureUrl: HOME_TEXTURE_URL,
    normalMapUrl: HOME_NORMAL_URL || undefined,
    contentType: HOME_TYPE || 'image/png',
    width: toNumber(HOME_WIDTH) ?? 1024,
    height: toNumber(HOME_HEIGHT) ?? 1024,
  },
  away: {
    textureUrl: AWAY_TEXTURE_URL,
    normalMapUrl: AWAY_NORMAL_URL || undefined,
    contentType: AWAY_TYPE || 'image/png',
    width: toNumber(AWAY_WIDTH) ?? 1024,
    height: toNumber(AWAY_HEIGHT) ?? 1024,
  },
};

if (THIRD_TEXTURE_URL) {
  kit.third = {
    textureUrl: THIRD_TEXTURE_URL,
    normalMapUrl: THIRD_NORMAL_URL || undefined,
    contentType: THIRD_TYPE || 'image/png',
    width: toNumber(THIRD_WIDTH) ?? 1024,
    height: toNumber(THIRD_HEIGHT) ?? 1024,
  };
}

console.log('[patch-team-assets] Başlangıç', {
  teamId: TEAM_ID,
  badgeUrl: badge.url,
  homeTexture: kit.home.textureUrl,
  awayTexture: kit.away.textureUrl,
  thirdTexture: kit.third?.textureUrl,
});

initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const ref = db.collection('teams').doc(TEAM_ID);

const main = async () => {
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`Takım dokümanı bulunamadı: teams/${TEAM_ID}`);
    process.exit(1);
  }

  await ref.set({ badge, kit }, { merge: true });
  console.log('[patch-team-assets] Güncellendi:', `teams/${TEAM_ID}`);
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[patch-team-assets] Hata', err);
    process.exit(1);
  });
