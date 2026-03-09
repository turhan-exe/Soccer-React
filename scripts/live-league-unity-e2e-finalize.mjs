import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import admin from "firebase-admin";

function parseDate(raw) {
  const day = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("--date must be YYYY-MM-DD");
  }
  return day;
}

function parseHour(raw) {
  const value = Number(String(raw || "").trim());
  if (!Number.isInteger(value) || value < 0 || value > 23) {
    throw new Error("--kickoff-hour-tr must be 0..23");
  }
  return value;
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
    kickoffHourTr: 19,
    prepareUrl: "",
    kickoffUrl: "",
    adminSecret: process.env.ADMIN_SECRET || "",
    serviceAccount: process.env.GOOGLE_APPLICATION_CREDENTIALS || "",
    timeoutMinutes: 20,
    intervalSeconds: 20,
    outputFile: "",
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--project-id") out.projectId = args[++i] || out.projectId;
    else if (arg === "--date") out.date = parseDate(args[++i]);
    else if (arg === "--kickoff-hour-tr") out.kickoffHourTr = parseHour(args[++i]);
    else if (arg === "--prepare-url") out.prepareUrl = args[++i] || out.prepareUrl;
    else if (arg === "--kickoff-url") out.kickoffUrl = args[++i] || out.kickoffUrl;
    else if (arg === "--admin-secret") out.adminSecret = args[++i] || out.adminSecret;
    else if (arg === "--service-account") out.serviceAccount = args[++i] || out.serviceAccount;
    else if (arg === "--timeout-minutes") out.timeoutMinutes = Number(args[++i] || "20");
    else if (arg === "--interval-seconds") out.intervalSeconds = Number(args[++i] || "20");
    else if (arg === "--out") out.outputFile = args[++i] || out.outputFile;
  }

  if (!out.projectId) throw new Error("--project-id is required");
  if (!out.date) throw new Error("--date is required");
  if (!out.prepareUrl) throw new Error("--prepare-url is required");
  if (!out.kickoffUrl) throw new Error("--kickoff-url is required");
  if (!out.adminSecret) throw new Error("--admin-secret is required");
  if (!Number.isFinite(out.timeoutMinutes) || out.timeoutMinutes <= 0) {
    throw new Error("--timeout-minutes must be > 0");
  }
  if (!Number.isFinite(out.intervalSeconds) || out.intervalSeconds <= 0) {
    throw new Error("--interval-seconds must be > 0");
  }

  return out;
}

function kickoffDateAtHour(day, hour) {
  const hh = String(hour).padStart(2, "0");
  return new Date(`${day}T${hh}:00:00+03:00`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(url, adminSecret, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-secret": adminSecret,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text || "{}");
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${text}`);
    error.response = parsed;
    throw error;
  }
  return parsed;
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

function summarizeFixtures(fixtures) {
  const summary = {
    total: fixtures.length,
    scheduled: 0,
    running: 0,
    played: 0,
    failed: 0,
    withLiveMatchId: 0,
    liveStates: {},
  };

  for (const fixture of fixtures) {
    const status = String(fixture.status || "unknown").toLowerCase();
    const liveState = String(fixture.live?.state || "none").toLowerCase();
    summary[status] = (summary[status] || 0) + 1;
    summary.liveStates[liveState] = (summary.liveStates[liveState] || 0) + 1;
    if (fixture.live?.matchId) summary.withLiveMatchId += 1;
  }

  return summary;
}

function initAdmin(projectId, serviceAccountPath) {
  if (admin.apps.length) return;
  if (serviceAccountPath) {
    const raw = fs.readFileSync(path.resolve(serviceAccountPath), "utf8");
    const json = JSON.parse(raw);
    admin.initializeApp({
      credential: admin.credential.cert(json),
      projectId,
    });
    return;
  }
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId,
  });
}

async function run() {
  const args = parseArgs();
  initAdmin(args.projectId, args.serviceAccount);
  const db = admin.firestore();

  const kickoffAt = kickoffDateAtHour(args.date, args.kickoffHourTr);
  const kickoffTs = admin.firestore.Timestamp.fromDate(kickoffAt);

  const prepareResponse = await postJson(args.prepareUrl, args.adminSecret, {
    date: args.date,
    kickoffHour: args.kickoffHourTr,
  });

  const kickoffResponse = await postJson(args.kickoffUrl, args.adminSecret, {
    date: args.date,
    kickoffHour: args.kickoffHourTr,
  });

  const startedAt = Date.now();
  const timeoutMs = Math.round(args.timeoutMinutes * 60 * 1000);
  const intervalMs = Math.round(args.intervalSeconds * 1000);
  const timeline = [];

  let done = false;
  let lastSummary = null;

  while (Date.now() - startedAt <= timeoutMs) {
    const docs = await loadFixturesByKickoffTimestamp(db, kickoffTs);
    const fixtures = docs.map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        status: data.status || "unknown",
        live: data.live || null,
      };
    });
    const summary = summarizeFixtures(fixtures);
    lastSummary = summary;
    timeline.push({
      at: new Date().toISOString(),
      summary,
    });

    if (summary.total > 0 && summary.played === summary.total) {
      done = true;
      break;
    }

    await sleep(intervalMs);
  }

  const output = {
    date: args.date,
    kickoffHourTR: args.kickoffHourTr,
    kickoffAt: kickoffAt.toISOString(),
    timeoutMinutes: args.timeoutMinutes,
    intervalSeconds: args.intervalSeconds,
    prepareResponse,
    kickoffResponse,
    success: done,
    finalSummary: lastSummary,
    timeline,
  };

  if (args.outputFile) {
    fs.writeFileSync(path.resolve(args.outputFile), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(output, null, 2));
  if (!done) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
