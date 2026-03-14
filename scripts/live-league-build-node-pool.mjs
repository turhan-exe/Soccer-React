function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    idPrefix: 'node',
    token: '',
    port: 9090,
    ips: '',
    protocol: 'http',
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--id-prefix') out.idPrefix = args[++i] || out.idPrefix;
    else if (arg === '--token') out.token = args[++i] || '';
    else if (arg === '--port') out.port = Number(args[++i] || '9090');
    else if (arg === '--ips') out.ips = args[++i] || '';
    else if (arg === '--protocol') out.protocol = args[++i] || out.protocol;
  }

  if (!out.token.trim()) {
    throw new Error('--token is required');
  }

  const ips = out.ips
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!ips.length) {
    throw new Error('--ips is required (comma-separated private IP list)');
  }

  if (!Number.isFinite(out.port) || out.port <= 0) {
    throw new Error('--port must be a positive number');
  }

  return { ...out, ips };
}

function run() {
  const args = parseArgs();
  const nodes = args.ips.map((ip, index) => ({
    id: `${args.idPrefix}-${String(index + 1).padStart(2, '0')}`,
    url: `${args.protocol}://${ip}:${args.port}`,
    token: args.token,
  }));
  process.stdout.write(`${JSON.stringify(nodes)}\n`);
}

run();
