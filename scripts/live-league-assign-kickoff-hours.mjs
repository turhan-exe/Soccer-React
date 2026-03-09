import "dotenv/config";
import process from "node:process";
import admin from "firebase-admin";

const TZ = "Europe/Istanbul";
const DEFAULT_HOURS = [12, 15, 16, 17, 18, 19];
const DEFAULT_DISTRIBUTION = [3, 4, 4, 4, 5, 5];
const MAX_BATCH = 400;

function parseList(raw, parser) {
  return String(raw || "")
    .split(",")
    .map((value) => parser(String(value).trim()))
    .filter((value) => value != null);
}

function parseHour(value) {
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return null;
  }
  return hour;
}

function parseCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    return null;
  }
  return count;
}

function parseDateArg(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`Invalid date format: ${text} (expected YYYY-MM-DD)`);
  }
  return text;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    projectId:
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      "",
    hours: DEFAULT_HOURS,
    distribution: DEFAULT_DISTRIBUTION,
    applyFixtures: false,
    dryRun: true,
    dateFrom: null,
    dateTo: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--project-id") out.projectId = args[++i] || out.projectId;
    else if (arg === "--hours") out.hours = parseList(args[++i], parseHour);
    else if (arg === "--distribution") out.distribution = parseList(args[++i], parseCount);
    else if (arg === "--apply-fixtures") out.applyFixtures = true;
    else if (arg === "--date-from") out.dateFrom = parseDateArg(args[++i]);
    else if (arg === "--date-to") out.dateTo = parseDateArg(args[++i]);
    else if (arg === "--write") out.dryRun = false;
    else if (arg === "--dry-run") out.dryRun = true;
  }

  if (!out.projectId) {
    throw new Error("--project-id is required (or FIREBASE_PROJECT_ID env)");
  }
  if (!out.hours.length) {
    throw new Error("--hours is empty");
  }
  if (out.distribution.length !== out.hours.length) {
    throw new Error("--distribution length must match --hours length");
  }

  return out;
}

function createLeagueHourAssignments(leagues, hours, distribution) {
  const slots = [];
  for (let i = 0; i < hours.length; i += 1) {
    const hour = hours[i];
    const count = distribution[i] || 0;
    for (let j = 0; j < count; j += 1) {
      slots.push(hour);
    }
  }
  if (!slots.length) {
    throw new Error("resolved kickoff slots are empty");
  }

  const assignments = [];
  for (let i = 0; i < leagues.length; i += 1) {
    const hour = slots[i] ?? slots[i % slots.length];
    assignments.push({
      leagueRef: leagues[i].ref,
      leagueId: leagues[i].id,
      hour,
    });
  }
  return assignments;
}

function trDayKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function trDateAtHour(dayKey, hour) {
  const hh = String(hour).padStart(2, "0");
  return new Date(`${dayKey}T${hh}:00:00+03:00`);
}

function isInsideWindow(dayKey, dateFrom, dateTo) {
  if (dateFrom && dayKey < dateFrom) return false;
  if (dateTo && dayKey > dateTo) return false;
  return true;
}

async function commitInChunks(mutations, dryRun) {
  if (!mutations.length) return;
  const db = admin.firestore();

  if (dryRun) {
    return;
  }

  for (let i = 0; i < mutations.length; i += MAX_BATCH) {
    const chunk = mutations.slice(i, i + MAX_BATCH);
    const batch = db.batch();
    for (const mutation of chunk) {
      batch.set(mutation.ref, mutation.data, { merge: true });
    }
    await batch.commit();
  }
}

async function run() {
  const args = parseArgs();

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: args.projectId,
  });

  const db = admin.firestore();
  const leaguesSnap = await db
    .collection("leagues")
    .where("state", "in", ["scheduled", "active"])
    .get();

  const leagues = leaguesSnap.docs
    .map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() || {} }))
    .sort((a, b) => {
      const seasonA = Number(a.data?.season || 0);
      const seasonB = Number(b.data?.season || 0);
      if (seasonA !== seasonB) return seasonA - seasonB;
      return String(a.id).localeCompare(String(b.id));
    });

  if (!leagues.length) {
    throw new Error("no leagues found");
  }

  const assignments = createLeagueHourAssignments(
    leagues,
    args.hours,
    args.distribution,
  );

  const leagueMutations = assignments.map((item) => ({
    ref: item.leagueRef,
    data: { kickoffHourTR: item.hour },
  }));

  let fixtureMutationCount = 0;
  const fixtureMutations = [];

  if (args.applyFixtures) {
    for (const assignment of assignments) {
      const fixturesSnap = await assignment.leagueRef
        .collection("fixtures")
        .where("status", "==", "scheduled")
        .get();

      for (const fixtureDoc of fixturesSnap.docs) {
        const fixture = fixtureDoc.data() || {};
        const rawDate = fixture.date;
        if (!rawDate || typeof rawDate.toDate !== "function") {
          continue;
        }
        const currentDate = rawDate.toDate();
        const dayKey = trDayKey(currentDate);
        if (!isInsideWindow(dayKey, args.dateFrom, args.dateTo)) {
          continue;
        }
        const nextDate = trDateAtHour(dayKey, assignment.hour);
        if (nextDate.getTime() === currentDate.getTime()) {
          continue;
        }
        fixtureMutations.push({
          ref: fixtureDoc.ref,
          data: {
            date: admin.firestore.Timestamp.fromDate(nextDate),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        });
        fixtureMutationCount += 1;
      }
    }
  }

  await commitInChunks(leagueMutations, args.dryRun);
  await commitInChunks(fixtureMutations, args.dryRun);

  const grouped = assignments.reduce((acc, item) => {
    acc[item.hour] = (acc[item.hour] || 0) + 1;
    return acc;
  }, {});

  const report = {
    dryRun: args.dryRun,
    applyFixtures: args.applyFixtures,
    projectId: args.projectId,
    hours: args.hours,
    distribution: args.distribution,
    leagueCount: assignments.length,
    leagueAssignmentsByHour: grouped,
    fixtureMutations: fixtureMutationCount,
    dateFrom: args.dateFrom,
    dateTo: args.dateTo,
  };

  console.log(JSON.stringify(report, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
