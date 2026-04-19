import fs from "node:fs";
import process from "node:process";
import admin from "firebase-admin";

function loadEnvFileIfPresent(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }
    process.env[key] = value;
  }
}

loadEnvFileIfPresent(".env");
loadEnvFileIfPresent(".env.local");

const TZ = "Europe/Istanbul";
const DEFAULT_HOURS = [12, 15, 16, 17, 18, 19];
const MAX_BATCH = 400;

function parseHours(raw) {
  const values = String(raw || "")
    .split(",")
    .map((v) => Number(String(v).trim()))
    .filter((v) => Number.isInteger(v) && v >= 0 && v <= 23);
  return values.length ? values : DEFAULT_HOURS;
}

function parseDate(raw) {
  const day = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("--date must be YYYY-MM-DD");
  }
  return day;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    projectId:
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      "",
    date: "",
    hours: DEFAULT_HOURS,
    dryRun: true,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--project-id") out.projectId = args[++i] || out.projectId;
    else if (arg === "--date") out.date = parseDate(args[++i]);
    else if (arg === "--hours") out.hours = parseHours(args[++i]);
    else if (arg === "--write") out.dryRun = false;
    else if (arg === "--dry-run") out.dryRun = true;
  }

  if (!out.projectId) throw new Error("--project-id is required");
  if (!out.date) throw new Error("--date is required");
  return out;
}

function kickoffDateAtHour(day, hour) {
  const hh = String(hour).padStart(2, "0");
  return new Date(`${day}T${hh}:00:00+03:00`);
}

async function commitInChunks(mutations, dryRun) {
  if (!mutations.length || dryRun) return;
  const db = admin.firestore();
  for (let i = 0; i < mutations.length; i += MAX_BATCH) {
    const chunk = mutations.slice(i, i + MAX_BATCH);
    const batch = db.batch();
    for (const item of chunk) {
      batch.set(item.ref, item.data, { merge: true });
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
  const mutations = [];
  const byHour = {};
  let totalMatched = 0;
  let totalReset = 0;
  let totalSkippedPlayed = 0;

  for (const hour of args.hours) {
    const kickoffAt = kickoffDateAtHour(args.date, hour);
    const ts = admin.firestore.Timestamp.fromDate(kickoffAt);

    let docs = [];
    try {
      const snap = await db.collectionGroup("fixtures").where("date", "==", ts).get();
      docs = snap.docs;
    } catch {
      const leagues = await db.collection("leagues").get();
      for (const league of leagues.docs) {
        const fixtures = await league.ref.collection("fixtures").where("date", "==", ts).get();
        docs.push(...fixtures.docs);
      }
    }

    let resetCount = 0;
    let skipPlayed = 0;
    totalMatched += docs.length;

    for (const doc of docs) {
      const data = doc.data() || {};
      const status = String(data.status || "").toLowerCase();
      if (status === "played") {
        skipPlayed += 1;
        totalSkippedPlayed += 1;
        continue;
      }

      resetCount += 1;
      totalReset += 1;
      mutations.push({
        ref: doc.ref,
        data: {
          status: "scheduled",
          score: null,
          live: admin.firestore.FieldValue.delete(),
          videoMissing: false,
          videoError: admin.firestore.FieldValue.delete(),
          video: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      });
    }

    byHour[hour] = {
      matched: docs.length,
      reset: resetCount,
      skippedPlayed: skipPlayed,
    };
  }

  await commitInChunks(mutations, args.dryRun);

  console.log(
    JSON.stringify(
      {
        dryRun: args.dryRun,
        projectId: args.projectId,
        date: args.date,
        timezone: TZ,
        hours: args.hours,
        totalMatched,
        totalReset,
        totalSkippedPlayed,
        byHour,
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
