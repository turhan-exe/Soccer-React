import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const services = [
  {
    name: "match-control-api",
    cwd: path.join(rootDir, "services", "match-control-api"),
    cmd: "npm",
    args: ["start"],
  },
  {
    name: "node-agent",
    cwd: path.join(rootDir, "services", "node-agent"),
    cmd: "npm",
    args: ["start"],
  },
  {
    name: "frontend",
    cwd: rootDir,
    cmd: "npm",
    args: ["run", "dev"],
  },
];

const children = [];
let shuttingDown = false;

function colorize(tag, colorCode) {
  return `\u001b[${colorCode}m${tag}\u001b[0m`;
}

function logPrefixed(name, colorCode, data) {
  const text = data.toString().trimEnd();
  if (!text) return;
  const prefix = colorize(`[${name}]`, colorCode);
  for (const line of text.split(/\r?\n/)) {
    console.log(`${prefix} ${line}`);
  }
}

function stopAll(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => process.exit(exitCode), 300);
}

services.forEach((service, index) => {
  const color = 32 + (index % 6);
  const child = spawn(service.cmd, service.args, {
    cwd: service.cwd,
    shell: true,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  children.push(child);
  child.stdout.on("data", (data) => logPrefixed(service.name, color, data));
  child.stderr.on("data", (data) => logPrefixed(service.name, 31, data));

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;

    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[${service.name}] exited with ${reason}`);
    stopAll(code && code !== 0 ? code : 1);
  });
});

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
