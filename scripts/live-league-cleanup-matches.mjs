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

const DEFAULT_HOURS = [12, 15, 16, 17, 18, 19];

function parseDate(raw) {
  const day = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("--date must be YYYY-MM-DD");
  }
  return day;
}

function parseHours(raw) {
  if (!raw) return DEFAULT_HOURS;
  const values = String(raw)
    .split(",")
    .map((part) => Number(String(part).trim()))
    .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);
  return values.length ? values : DEFAULT_HOURS;
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
    baseUrl: process.env.MATCH_CONTROL_BASE_URL || "",
    callbackToken: process.env.MATCH_CONTROL_CALLBACK_TOKEN || "",
    dryRun: true,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--project-id") out.projectId = args[++i] || out.projectId;
    else if (arg === "--date") out.date = parseDate(args[++i]);
    else if (arg === "--hours") out.hours = parseHours(args[++i]);
    else if (arg === "--base-url") out.baseUrl = args[++i] || out.baseUrl;
    else if (arg === "--callback-token") out.callbackToken = args[++i] || out.callbackToken;
    else if (arg === "--write") out.dryRun = false;
    else if (arg === "--dry-run") out.dryRun = true;
  }

  if (!out.projectId) throw new Error("--project-id is required");
  if (!out.date) throw new Error("--date is required");
  if (!out.baseUrl) throw new Error("--base-url is required");
  if (!out.callbackToken) throw new Error("--callback-token is required");
  return out;
}

function kickoffDateAtHour(day, hour) {
  const hh = String(hour).padStart(2, "0");
  return new Date(`${day}T${hh}:00:00+03:00`);
}

async function postLifecycle(baseUrl, callbackToken, matchId, payload) {
  const url = `${baseUrl.replace(/\/$/, "")}/v1/internal/matches/${encodeURIComponent(matchId)}/lifecycle`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${callbackToken}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, body: text };
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

    let fixtures = docs.length;
    let withLiveMatchId = 0;
    let tried = 0;
    let ok = 0;
    let notFound = 0;
    let failed = 0;

    for (const doc of docs) {
      const fixture = doc.data() || {};
      const matchId = String(fixture?.live?.matchId || "").trim();
      if (!matchId) continue;

      withLiveMatchId += 1;
      tried += 1;

      if (args.dryRun) {
        continue;
      }

      try {
        const response = await postLifecycle(args.baseUrl, args.callbackToken, matchId, {
          state: "failed",
          reason: `cleanup_${args.date}_h${hour}`,
        });
        if (response.ok) ok += 1;
        else if (response.status === 404) notFound += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }

    report.push({
      hour,
      fixtures,
      withLiveMatchId,
      tried,
      ok,
      notFound,
      failed,
    });
  }

  console.log(JSON.stringify({
    dryRun: args.dryRun,
    projectId: args.projectId,
    date: args.date,
    hours: args.hours,
    baseUrl: args.baseUrl,
    report,
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
