import crypto from 'node:crypto';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    nodeAgents: 1,
    prefix: 'NODE_AGENT',
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--node-agents') out.nodeAgents = Math.max(1, Number(args[++i] || '1'));
    else if (arg === '--prefix') out.prefix = (args[++i] || 'NODE_AGENT').trim() || 'NODE_AGENT';
  }

  return out;
}

function secret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function main() {
  const args = parseArgs();
  const lines = [
    '# Copy these values into your secure password manager first.',
    '# Then place them into the exact env files listed in docs/live-league-release-checklist.md.',
    `MATCH_CONTROL_SECRET=${secret(32)}`,
    `MATCH_CONTROL_CALLBACK_TOKEN=${secret(32)}`,
    `SESSION_SIGNING_KEY=${secret(48)}`,
    `FIREBASE_LIFECYCLE_TOKEN=${secret(32)}`,
    `LEAGUE_LIFECYCLE_SECRET=${secret(32)}`,
    `BATCH_SECRET=${secret(32)}`,
  ];

  for (let index = 1; index <= args.nodeAgents; index += 1) {
    lines.push(`${args.prefix}_${String(index).padStart(2, '0')}_SECRET=${secret(32)}`);
  }

  console.log(lines.join('\n'));
}

main();
