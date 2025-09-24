import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { dayRangeTR, dayKeyTR, ts } from '../utils/schedule.js';
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

async function findFirstScheduledOnOrAfter(start: Date): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  // Try collectionGroup with range+order, then fall back to per-league scan
  try {
    const snap = await db
      .collectionGroup('fixtures')
      .where('date', '>=', ts(start))
      .orderBy('date', 'asc')
      .limit(1)
      .get();
    if (!snap.empty) return snap.docs[0];
  } catch {}

  const leagues = await db.collection('leagues').get();
  let best: { doc: FirebaseFirestore.QueryDocumentSnapshot; at: Date } | null = null;
  for (const lg of leagues.docs) {
    try {
      const s = await lg.ref
        .collection('fixtures')
        .where('date', '>=', ts(start))
        .orderBy('date', 'asc')
        .limit(1)
        .get();
      if (!s.empty) {
        const d = (s.docs[0].data() as any)?.date?.toDate?.() as Date | undefined;
        if (d && (!best || d < best.at)) best = { doc: s.docs[0], at: d };
      }
    } catch {}
  }
  return best?.doc || null;
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
      const instant: boolean = !!(request.data as any)?.instant;
      const targetDay = dayKey || dayKeyTR();
      // Manual trigger: include the full day range in TR timezone
      let { start, end } = dayRangeTR(targetDay);
      let allDocs = await collectFixturesBetween(start, end);
      let docs = allDocs.filter((d) => (d.data() as any)?.status === 'scheduled');
      // Fallback: if none found for requested day, pick the nearest scheduled day >= target
      if (docs.length === 0) {
        const first = await findFirstScheduledOnOrAfter(start);
        if (first) {
          const firstDate = (first.data() as any)?.date?.toDate?.() as Date | undefined;
          if (firstDate) {
            const newDay = dayKeyTR(firstDate);
            const r = dayRangeTR(newDay);
            start = r.start; end = r.end;
            allDocs = await collectFixturesBetween(start, end);
            docs = allDocs.filter((d) => (d.data() as any)?.status === 'scheduled');
          }
        }
      }
      log.info('playAllForDay_start', { dayKey: targetDay, count: docs.length, allowAnyOperator: ALLOW_ANY_OPERATOR, appCheckOptional: APP_CHECK_OPTIONAL });

      let started = 0;
      if (instant) {
        // Hızlı mod: maçı anında bitir ve puan durumunu güncelle
        for (const d of docs) {
          const leagueId = d.ref.parent.parent?.id;
          if (!leagueId) continue;
          try {
            const fxRef = db.doc(`leagues/${leagueId}/fixtures/${d.id}`);
            await db.runTransaction(async (tx) => {
              const snap = await tx.get(fxRef);
              if (!snap.exists) return;
              const cur = snap.data() as any;
              if (cur.status === 'played') return; // idempotent
              const homeId = cur.homeTeamId;
              const awayId = cur.awayTeamId;
              const h = Math.floor(Math.random() * 5);
              const a = Math.floor(Math.random() * 5);
              tx.update(fxRef, {
                status: 'played',
                score: { home: h, away: a },
                endedAt: FieldValue.serverTimestamp(),
              });
              const leagueRef = fxRef.parent.parent!;
              const homeRef = leagueRef.collection('standings').doc(homeId);
              const awayRef = leagueRef.collection('standings').doc(awayId);
              const [homeSnap, awaySnap] = await Promise.all([tx.get(homeRef), tx.get(awayRef)]);
              const hs = homeSnap.exists
                ? (homeSnap.data() as any)
                : { teamId: homeId, name: '', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
              const as = awaySnap.exists
                ? (awaySnap.data() as any)
                : { teamId: awayId, name: '', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
              hs.P++; as.P++;
              hs.GF += h; hs.GA += a; hs.GD = hs.GF - hs.GA;
              as.GF += a; as.GA += h; as.GD = as.GF - as.GA;
              if (h > a) { hs.W++; as.L++; hs.Pts += 3; }
              else if (h < a) { as.W++; hs.L++; as.Pts += 3; }
              else { hs.D++; as.D++; hs.Pts++; as.Pts++; }
              tx.set(homeRef, hs, { merge: true });
              tx.set(awayRef, as, { merge: true });
            });
            started++;
          } catch (e) {
            log.error('playAllForDay_instant_err_one', { matchId: d.id, leagueId, err: (e as any)?.message || String(e) });
          }
        }
      } else {
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
      }

      const finalDayKey = docs.length > 0 ? dayKeyTR(((docs[0].data() as any)?.date?.toDate?.() as Date) || new Date(start)) : targetDay;
      log.info('playAllForDay_done', { dayKey: finalDayKey, started, total: docs.length });
      return { ok: true, dayKey: finalDayKey, total: docs.length, started };
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
      const instant: boolean = !!body.instant;
      // Manual HTTP trigger: include the full day range in TR timezone
      let { start, end } = dayRangeTR(dayKey);
      let allDocs = await collectFixturesBetween(start, end);
      let docs = allDocs.filter((d) => (d.data() as any)?.status === 'scheduled');
      if (docs.length === 0) {
        const first = await findFirstScheduledOnOrAfter(start);
        if (first) {
          const firstDate = (first.data() as any)?.date?.toDate?.() as Date | undefined;
          if (firstDate) {
            const newDay = dayKeyTR(firstDate);
            const r = dayRangeTR(newDay);
            start = r.start; end = r.end;
            allDocs = await collectFixturesBetween(start, end);
            docs = allDocs.filter((d) => (d.data() as any)?.status === 'scheduled');
          }
        }
      }
      log.info('playAllForDay_http_start', { dayKey, count: docs.length, appCheckOptional: APP_CHECK_OPTIONAL, allowAnyOperator: ALLOW_ANY_OPERATOR });
      let started = 0;
      if (instant) {
        for (const d of docs) {
          const leagueId = d.ref.parent.parent?.id;
          if (!leagueId) continue;
          try {
            const fxRef = db.doc(`leagues/${leagueId}/fixtures/${d.id}`);
            await db.runTransaction(async (tx) => {
              const snap = await tx.get(fxRef);
              if (!snap.exists) return;
              const cur = snap.data() as any;
              if (cur.status === 'played') return;
              const homeId = cur.homeTeamId;
              const awayId = cur.awayTeamId;
              const h = Math.floor(Math.random() * 5);
              const a = Math.floor(Math.random() * 5);
              tx.update(fxRef, {
                status: 'played',
                score: { home: h, away: a },
                endedAt: FieldValue.serverTimestamp(),
              });
              const leagueRef = fxRef.parent.parent!;
              const homeRef = leagueRef.collection('standings').doc(homeId);
              const awayRef = leagueRef.collection('standings').doc(awayId);
              const [homeSnap, awaySnap] = await Promise.all([tx.get(homeRef), tx.get(awayRef)]);
              const hs = homeSnap.exists
                ? (homeSnap.data() as any)
                : { teamId: homeId, name: '', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
              const as = awaySnap.exists
                ? (awaySnap.data() as any)
                : { teamId: awayId, name: '', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
              hs.P++; as.P++;
              hs.GF += h; hs.GA += a; hs.GD = hs.GF - hs.GA;
              as.GF += a; as.GA += h; as.GD = as.GF - as.GA;
              if (h > a) { hs.W++; as.L++; hs.Pts += 3; }
              else if (h < a) { as.W++; hs.L++; as.Pts += 3; }
              else { hs.D++; as.D++; hs.Pts++; as.Pts++; }
              tx.set(homeRef, hs, { merge: true });
              tx.set(awayRef, as, { merge: true });
            });
            started++;
          } catch (e) {
            log.error('playAllForDay_http_instant_err_one', { matchId: d.id, leagueId, err: (e as any)?.message || String(e) });
          }
        }
      } else {
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
      }
      const finalDayKey = docs.length > 0 ? dayKeyTR(((docs[0].data() as any)?.date?.toDate?.() as Date) || new Date(start)) : dayKey;
      log.info('playAllForDay_http_done', { dayKey: finalDayKey, started, total: docs.length });
      res.json({ ok: true, dayKey: finalDayKey, total: docs.length, started });
    } catch (e: any) {
      const code = e?.code || 'internal';
      const msg = e?.message || 'internal error';
      res.status(500).json({ ok: false, code, error: msg });
    }
  });
