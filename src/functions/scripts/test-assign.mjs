// Emulator integration test for assigning a new user/team
// to a random bot slot in the next league.
//
// Usage:
//   firebase emulators:exec --only firestore "node src/functions/scripts/test-assign.mjs"
//
// Env:
//   PROJECT_ID=demo-osm-react (default)
//
import admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';

// Import the compiled function logic (uses firebase-admin under emulator)
import { assignIntoRandomBotSlot } from '../lib/assign.js';

const PROJECT_ID = process.env.PROJECT_ID || 'demo-osm-react';

async function seedLeagueWithBots(db, { leagueId, capacity = 6 }) {
  const created = await db.collection('leagues').doc(leagueId).set({
    name: `Test Lig`,
    season: 1,
    capacity,
    timezone: 'Europe/Istanbul',
    state: 'scheduled',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    rounds: 10,
    monthKey: 'TEST',
  });

  // Create bot pool if missing
  const botsCol = db.collection('bots');
  const haveBots = await botsCol.count().get().then((c) => c.data().count);
  const need = Math.max(0, capacity - haveBots);
  if (need > 0) {
    const batch = db.batch();
    for (let i = 0; i < need; i++) {
      const ref = botsCol.doc();
      batch.set(ref, { name: `Bot ${i + 1}`, rating: 50 + (i % 30), createdAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    await batch.commit();
  }

  const botSnap = await botsCol.limit(capacity).get();
  const botIds = botSnap.docs.map((d) => d.id);

  // Create slots with those bots
  const slotBatch = db.batch();
  for (let i = 0; i < capacity; i++) {
    const slotIndex = i + 1;
    const slotRef = db.collection('leagues').doc(leagueId).collection('slots').doc(String(slotIndex));
    slotBatch.set(slotRef, {
      slotIndex,
      type: 'bot',
      teamId: null,
      botId: botIds[i % botIds.length],
      lockedAt: null,
    });
  }
  await slotBatch.commit();

  // Minimal fixtures to exercise update logic
  const fxRef = db.collection('leagues').doc(leagueId).collection('fixtures');
  const when = new Date(Date.now() + 60_000);
  const makeFx = (homeSlot, awaySlot) => ({
    round: 1,
    date: admin.firestore.Timestamp.fromDate(when),
    homeSlot,
    awaySlot,
    status: 'scheduled',
    score: null,
    homeTeamId: null,
    awayTeamId: null,
    participants: [],
  });
  await fxRef.add(makeFx(1, 2));
  await fxRef.add(makeFx(3, 4));
}

async function run() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  const db = admin.firestore();

  // Fresh ids per run
  const teamId = `T-${randomUUID().slice(0, 8)}`;
  const leagueId = `L-${randomUUID().slice(0, 8)}`;
  const teamName = 'Yeni Takım';

  // Seed league with bot slots and a couple fixtures
  await seedLeagueWithBots(db, { leagueId, capacity: 6 });

  // Seed team document
  await db.collection('teams').doc(teamId).set({
    id: teamId,
    name: teamName,
    ownerUid: `U-${teamId}`,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Execute assignment logic (chooses random free bot slot in earliest league)
  // Our test has only one league => it should pick from that.
  const chosen = await assignIntoRandomBotSlot(teamId, teamName);

  // Validate effects
  const teamSnap = await db.collection('teams').doc(teamId).get();
  const team = teamSnap.data();
  const slotSnap = await db.collection('leagues').doc(chosen.leagueId).collection('slots').doc(String(chosen.slotIndex)).get();
  const slot = slotSnap.data();

  const fxSnap = await db.collection('leagues').doc(chosen.leagueId).collection('fixtures').get();
  const fx = fxSnap.docs.map((d) => d.data());

  const fixturePatched = fx.some((f) => (f.homeSlot === chosen.slotIndex && f.homeTeamId === teamId) || (f.awaySlot === chosen.slotIndex && f.awayTeamId === teamId));

  const result = {
    ok: true,
    chosen,
    teamLeagueId: team?.leagueId || null,
    slot,
    fixturePatched,
  };

  // Basic assertions -> throw if broken
  if (result.teamLeagueId !== chosen.leagueId) throw new Error('Team leagueId was not set correctly');
  if (!slot || slot.type !== 'human' || slot.teamId !== teamId) throw new Error('Slot was not converted to human with correct teamId');
  if (!fixturePatched) throw new Error('Fixtures were not patched for the assigned slot');

  console.log(JSON.stringify(result, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });

