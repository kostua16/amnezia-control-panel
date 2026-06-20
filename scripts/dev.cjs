const { spawn } = require('child_process');
const path = require('path');

const serverScript = path.join(__dirname, '..', 'server.mjs');
const userArgs = process.argv.slice(2);
const npmPort = process.env.npm_config_port;

function isPositiveIntegerText(value) {
  return /^\d+$/.test(value) && Number(value) > 0;
}

function resolvePortFromNpmShorthand(args) {
  if (npmPort === undefined) return { port: undefined, remainingArgs: args };

  // npm run dev --port=3334
  if (isPositiveIntegerText(String(npmPort))) {
    return { port: String(npmPort), remainingArgs: args };
  }

  // npm run dev --port 3334 (npm sets npm_config_port=true and passes "3334" as argv)
  if (
    String(npmPort) === 'true' &&
    args.length > 0 &&
    isPositiveIntegerText(args[0])
  ) {
    return { port: args[0], remainingArgs: args.slice(1) };
  }

  return { port: undefined, remainingArgs: args };
}

function extractPortFromArgs(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-p' || args[i] === '--port') {
      if (i + 1 < args.length && isPositiveIntegerText(args[i + 1])) {
        return {
          port: args[i + 1],
          remainingArgs: [...args.slice(0, i), ...args.slice(i + 2)],
        };
      }
    }
    const eqMatch = args[i].match(/^-(?:p|port)=(\d+)$/);
    if (eqMatch) {
      return {
        port: eqMatch[1],
        remainingArgs: [...args.slice(0, i), ...args.slice(i + 1)],
      };
    }
  }
  return { port: undefined, remainingArgs: args };
}

const hasPortEnv =
  process.env.PORT !== undefined && String(process.env.PORT).trim().length > 0;
const resolvedNpm = resolvePortFromNpmShorthand(userArgs);
const extractedCli = extractPortFromArgs(resolvedNpm.remainingArgs);
const finalArgs = extractedCli.remainingArgs;
const hasCLIPort = extractedCli.port !== undefined;
const hasNpmPort = resolvedNpm.port !== undefined;

// Set NODE_ENV=development and resolve port
process.env.NODE_ENV = 'development';

let port;
if (!hasCLIPort && !hasPortEnv && hasNpmPort) {
  port = resolvedNpm.port;
} else if (!hasCLIPort && !hasPortEnv) {
  port = '3333';
} else if (hasCLIPort) {
  port = extractedCli.port;
}

if (port) {
  process.env.PORT = port;
}

/**
 * Next.js dev (especially Turbopack) can grow past the default V8 heap (~4 GiB on many setups).
 * Allow a larger ceiling unless the operator already set --max-old-space-size in NODE_OPTIONS.
 */
function envForDevChild() {
  const env = { ...process.env };
  const opts = env.NODE_OPTIONS ?? '';
  if (!/--max-old-space-size=\d+/.test(opts)) {
    const extra = '--max-old-space-size=8192';
    env.NODE_OPTIONS = opts.trim() ? `${opts.trim()} ${extra}` : extra;
  }
  return env;
}

// Pass remaining args as environment or ignore (custom server doesn't support all next CLI flags)
const child = spawn(
  process.execPath,
  [serverScript, ...finalArgs],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: envForDevChild(),
  },
);

child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code === null ? 1 : code);
});
