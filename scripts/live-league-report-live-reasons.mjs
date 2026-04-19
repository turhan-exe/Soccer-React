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

function parseDate(raw) {
  const day = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("--date must be YYYY-MM-DD");
  }
  return day;
}

function parseHours(raw) {
  return String(raw || "")
    .split(",")
    .map((part) => Number(String(part).trim()))
    .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);
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
    hours: [],
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--project-id") out.projectId = args[++i] || out.projectId;
    else if (arg === "--date") out.date = parseDate(args[++i]);
    else if (arg === "--hours") out.hours = parseHours(args[++i]);
  }

  if (!out.projectId) throw new Error("--project-id is required");
  if (!out.date) throw new Error("--date is required");
  if (!out.hours.length) throw new Error("--hours is required");
  return out;
}

function kickoffDateAtHour(day, hour) {
  const hh = String(hour).padStart(2, "0");
  return new Date(`${day}T${hh}:00:00+03:00`);
}

async function loadFixturesByKickoffTimestamp(db, targetTs) {
  try {
    const snap = await db.collectionGroup("fixtures").where("date", "==", targetTs).get();
    return snap.docs;
  } catch {
    const leagues = await db.collection("leagues").get();
    const docs = [];
    for (const league of leagues.docs) {
      const fixtures = await league.ref.collection("fixtures").where("date", "==", targetTs).get();
      docs.push(...fixtures.docs);
    }
    return docs;
  }
}

async function run() {
  const args = parseArgs();
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: args.projectId,
  });

  const db = admin.firestore();
  const report = [];

  for (const hour of args.hours) {
    const ts = admin.firestore.Timestamp.fromDate(kickoffDateAtHour(args.date, hour));
    const docs = await loadFixturesByKickoffTimestamp(db, ts);
    const reasons = new Map();
    const states = new Map();
    let withLive = 0;

    for (const doc of docs) {
      const fixture = doc.data() || {};
      const live = fixture.live || null;
      if (!live) continue;
      withLive += 1;
      const reason = String(live.reason || "none");
      const state = String(live.state || "none");
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
      states.set(state, (states.get(state) || 0) + 1);
    }

    report.push({
      hour,
      total: docs.length,
      withLive,
      reasons: Object.fromEntries([...reasons.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
      states: Object.fromEntries([...states.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    });
  }

  console.log(JSON.stringify({ projectId: args.projectId, date: args.date, hours: args.hours, report }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
