import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { generateDoubleRoundRobinSlots } from './utils/roundrobin.js';
import { nextMonthOrThisMonthFirstAt19, monthKeyTR, dateForRound } from './utils/time.js';

const db = getFirestore();

export const resetSeasonMonthly = functions
  .region('europe-west1')
  .pubsub.schedule('5 0 1 * *')
  .timeZone('Europe/Istanbul')
  .onRun(async () => {
    const leaguesSnap = await db.collection('leagues').get();
    const startDate = nextMonthOrThisMonthFirstAt19();
    const mKey = monthKeyTR(startDate);
    for (const lg of leaguesSnap.docs) {
      const leagueRef = lg.ref;
      const league = lg.data() as any;
      const capacity = league.capacity ?? 15;
      const rounds = Math.max(28, league.rounds ?? 28);
      const template = generateDoubleRoundRobinSlots(capacity);

      // Mark completed previous season and schedule new one
      await leagueRef.set({
        state: 'scheduled',
        startDate: Timestamp.fromDate(startDate),
        rounds,
        monthKey: mKey,
        lockedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      // Ensure slots: keep human, fill missing with bots
      const slotsSnap = await leagueRef.collection('slots').get();
      // naive bot refill: any with type bot but missing botId => assign random placeholder
      for (const sDoc of slotsSnap.docs) {
        const s = sDoc.data() as any;
        if (s.type === 'bot' && !s.teamId && !s.botId) {
          await sDoc.ref.set({ botId: `bot-${sDoc.id}` }, { merge: true });
        }
      }

      // Reset standings using current names
      const standingsBatch = db.batch();
      const standingsSnap = await leagueRef.collection('standings').get();
      const nameBySlot = new Map<number, string>();
      for (const s of slotsSnap.docs) {
        const sd = s.data() as any;
        const slotIndex = sd.slotIndex;
        const name = sd.teamId ? (sd.teamId as string) : `Bot ${sd.botId || slotIndex}`;
        nameBySlot.set(slotIndex, name);
      }
      // Clear standings and write new
      for (const st of standingsSnap.docs) standingsBatch.delete(st.ref);
      for (const [slotIndex, name] of nameBySlot) {
        const ref = leagueRef.collection('standings').doc(String(slotIndex));
        standingsBatch.set(ref, {
          slotIndex,
          teamId: slotsSnap.docs.find((d) => (d.data() as any).slotIndex === slotIndex)?.data()?.teamId || null,
          name,
          P: 0,
          W: 0,
          D: 0,
          L: 0,
          GF: 0,
          GA: 0,
          GD: 0,
          Pts: 0,
        });
      }
      await standingsBatch.commit();

      // Regenerate fixtures
      const existingFix = await leagueRef.collection('fixtures').get();
      let batch = db.batch();
      let ops = 0;
      for (const d of existingFix.docs) {
        batch.delete(d.ref); ops++; if (ops >= 450) { await batch.commit(); batch = db.batch(); ops = 0; }
      }
      if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0; }

      // Build slot map for teamIds
      const slotMap = new Map<number, string | null>();
      for (const s of slotsSnap.docs) {
        const sd = s.data() as any;
        slotMap.set(sd.slotIndex, sd.teamId || null);
      }

      for (const f of template) {
        const fRef = leagueRef.collection('fixtures').doc();
        const date = dateForRound(startDate, f.round);
        const homeTeamId = slotMap.get(f.homeSlot) || null;
        const awayTeamId = slotMap.get(f.awaySlot) || null;
        batch.set(fRef, {
          round: f.round,
          date: Timestamp.fromDate(date),
          homeSlot: f.homeSlot,
          awaySlot: f.awaySlot,
          status: 'scheduled',
          score: null,
          homeTeamId,
          awayTeamId,
          participants: [homeTeamId, awayTeamId].filter(Boolean),
        });
        ops++; if (ops >= 450) { await batch.commit(); batch = db.batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
    }
    return null;
  });

