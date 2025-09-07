import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getFirestore } from 'firebase-admin/firestore';
import { betweenTR_19_to_2359, dayKeyTR, ts } from '../utils/schedule.js';
import { requireAppCheck, requireAuth } from '../mw/auth.js';
import { startMatchInternal } from './startMatch.js';
import { log } from '../logger.js';


const db = getFirestore();
const REGION = 'europe-west1';

async function collectFixturesBetween(start: Date, end: Date) {
  try {
    const snap = await db
      .collectionGroup('fixtures')
      .where('date', '>=', ts(start))
      .where('date', '<=', ts(end))
      .get();
    return snap.docs;
  } catch (e) {
    // Index yoksa lig bazında geri düş
    const leagues = await db.collection('leagues').get();
    const all: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    for (const lg of leagues.docs) {
      const s = await lg.ref
        .collection('fixtures')
        .where('date', '>=', ts(start))
        .where('date', '<=', ts(end))
        .get();
      all.push(...s.docs);
    }
    return all;
  }
}

/**
 * Admin/operator callable: Start all fixtures scheduled for a given TR day.
 * If no dayKey provided, uses today in TR.
 * Note: startMatchInternal will ensure matchPlans snapshot if missing.
 */
export const playAllForDayFn = functions
  .region(REGION)
  .https.onCall(async (request) => {
    const cfg = (functions.config() as any) || {};
    // Default: App Check opsiyonel (test akışı kolay çalışsın). Kapatmak için env/config'ı 0 yapın.
    const APP_CHECK_OPTIONAL = (process.env.APP_CHECK_OPTIONAL ?? cfg?.app?.check_optional ?? '1') !== '0';
    const ALLOW_ANY_OPERATOR = (process.env.ALLOW_ANY_OPERATOR ?? cfg?.auth?.allow_operator_any ?? '0') === '1';
    try {
      const force = !!((request.data as any)?.force);
      if (!APP_CHECK_OPTIONAL) {
        requireAppCheck(request as any);
      }
      if (!force) {
        requireAuth(request as any);
      }

      // Optional: restrict to users with a custom claim (admin/operator)
      const claims = (request.auth as any)?.token || {};
      const isOperator = !!(claims.admin || claims.operator);
      const allowed = isOperator || ALLOW_ANY_OPERATOR || force;
      if (!allowed) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Operator permission required'
        );
      }

      const dayKey = (request.data as any)?.dayKey as string | undefined;
      const targetDay = dayKey || dayKeyTR();
      const { start, end } = betweenTR_19_to_2359(targetDay);

      const allDocs = await collectFixturesBetween(start, end);
      const docs = allDocs.filter((d) => (d.data() as any)?.status === 'scheduled');
      log.info('playAllForDay_start', { dayKey: targetDay, count: docs.length, allowAnyOperator: ALLOW_ANY_OPERATOR, appCheckOptional: APP_CHECK_OPTIONAL });

      let started = 0;
      for (const d of docs) {
        const leagueId = d.ref.parent.parent?.id;
        if (!leagueId) continue;
        try {
          await startMatchInternal(d.id, leagueId);
          started++;
        } catch (e) {
          log.error('playAllForDay_err_one', {
            matchId: d.id,
            leagueId,
            err: (e as any)?.message || String(e),
          });
        }
      }

      log.info('playAllForDay_done', { dayKey: targetDay, started, total: docs.length });
      return { ok: true, dayKey: targetDay, total: docs.length, started };
    } catch (e: any) {
      // Dışarıya okunabilir hata mesajı dön
      const code = e?.code && typeof e.code === 'string' ? e.code : 'internal';
      const msg = e?.message || 'internal error';
      throw new functions.https.HttpsError(code as any, msg);
    }
  });

// HTTP sürüm (CORS açık) — lokal geliştirme ve test kolaylığı için
export const playAllForDayHttp = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    // CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    try {
      const cfg = (functions.config() as any) || {};
      const APP_CHECK_OPTIONAL = (process.env.APP_CHECK_OPTIONAL ?? cfg?.app?.check_optional ?? '1') !== '0';
      const ALLOW_ANY_OPERATOR = (process.env.ALLOW_ANY_OPERATOR ?? cfg?.auth?.allow_operator_any ?? '0') === '1';

      // İstek gövdesini güvenle parse et (string veya objeyi destekle)
      let body: any = {};
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      } catch {
        body = {};
      }

      // HTTP endpoint için yalnızca opsiyonel Bearer secret kontrolü
      const token = (req.headers.authorization || '').toString().startsWith('Bearer ')
        ? (req.headers.authorization as string).slice(7)
        : '';
      const secret = cfg?.orchestrate?.secret || cfg?.scheduler?.secret || '';
      const force = !!body.force;
      if (!ALLOW_ANY_OPERATOR && !force && secret && token !== secret) {
        res.status(401).json({ ok: false, error: 'unauthorized' });
        return;
      }

      const dayKey = (body.dayKey as string | undefined) || dayKeyTR();
      const { start, end } = betweenTR_19_to_2359(dayKey);
      const allDocs = await collectFixturesBetween(start, end);
      const docs = allDocs.filter((d) => (d.data() as any)?.status === 'scheduled');
      log.info('playAllForDay_http_start', { dayKey, count: docs.length, appCheckOptional: APP_CHECK_OPTIONAL, allowAnyOperator: ALLOW_ANY_OPERATOR });
      let started = 0;
      for (const d of docs) {
        const leagueId = d.ref.parent.parent?.id;
        if (!leagueId) continue;
        try {
          await startMatchInternal(d.id, leagueId);
          started++;
        } catch (e) {
          log.error('playAllForDay_http_err_one', { matchId: d.id, leagueId, err: (e as any)?.message || String(e) });
        }
      }
      log.info('playAllForDay_http_done', { dayKey, started, total: docs.length });
      res.json({ ok: true, dayKey, total: docs.length, started });
    } catch (e: any) {
      const code = e?.code || 'internal';
      const msg = e?.message || 'internal error';
      res.status(500).json({ ok: false, code, error: msg });
    }
  });
