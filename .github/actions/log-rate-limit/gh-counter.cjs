/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const {
  accessSync,
  appendFileSync,
  chmodSync,
  constants,
  copyFileSync,
  mkdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const { delimiter, dirname, join, resolve } = require('node:path');

// Restrict debug injection to known built-ins. Unknown names can run extensions
// or shell aliases with a different stderr format.
// agent-task is registered by the CLI itself starting with v2.80.0.
const TRACED_COMMANDS = new Set([
  'agent-task',
  'api',
  'attestation',
  'auth',
  'cache',
  'codespace',
  'gist',
  'gpg-key',
  'issue',
  'label',
  'org',
  'pr',
  'project',
  'release',
  'repo',
  'ruleset',
  'run',
  'search',
  'secret',
  'ssh-key',
  'status',
  'variable',
  'workflow',
]);

function restCounterEnabled(input) {
  return input?.trim().toLowerCase() === 'true';
}

function isExecutableFile(path) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function findGhOnPath(path, skip) {
  for (const entry of path?.split(delimiter) ?? []) {
    const candidate = resolve(entry, 'gh');
    if (
      isExecutableFile(candidate) &&
      (!skip || realpathSync(candidate) !== skip)
    )
      return candidate;
  }
  return undefined;
}

function installGhCounter(dir, enabled, env = process.env) {
  if (!enabled) return 'disabled';
  if (process.platform !== 'linux') return 'failed:unsupported-platform';
  if (!dir) return 'failed:no-counter-directory';
  if (!env.GITHUB_PATH) return 'failed:no-github-path';

  let failure = 'io';
  try {
    dir = realpathSync(dir);
    if (/[\r\n]/.test(dir)) return 'failed:io';
    const bin = join(dir, 'gh-bin');
    const launcher = join(bin, 'gh');
    const realGh = findGhOnPath(env.PATH, launcher);
    if (!realGh) return 'failed:no-gh';

    failure = 'unwritable-dir';
    mkdirSync(bin, { recursive: true });
    const observer = join(bin, 'gh-counter.cjs');
    copyFileSync(__filename, observer);
    const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
    writeFileSync(
      launcher,
      `#!/bin/bash
real_gh=${quote(realGh)}
observer=${quote(observer)}
node_bin=${quote(process.execPath)}
if [[ -t 2 || ! -x "$node_bin" || ! -r "$observer" || ! -s "$observer" ]]; then
  exec "$real_gh" "$@"
fi
# Keep application preloads out of the observer and restore them for gh.
unset REST_COUNTER_ORIGINAL_NODE_OPTIONS
if [[ -v NODE_OPTIONS ]]; then
  export REST_COUNTER_ORIGINAL_NODE_OPTIONS="$NODE_OPTIONS"
fi
unset NODE_OPTIONS
exec "$node_bin" "$observer" "$real_gh" "$@"
`,
      { mode: 0o700 },
    );
    chmodSync(launcher, 0o700);
    failure = 'io';
    appendFileSync(env.GITHUB_PATH, `${bin}\n`);
    return 'installed';
  } catch {
    // PATH is only updated after the launcher and observer are ready.
    return `failed:${failure}`;
  }
}

function requestRoute(line, target, classify) {
  const address = /^\* Request to (\S+)\s*$/.exec(line)?.[1];
  if (!address) return null;
  try {
    const url = new URL(address);
    return classify({ origin: url.origin, path: url.pathname }, target);
  } catch {
    return null;
  }
}

function prepareObserver(dir, env, writeStderr) {
  const { apiTarget, classify, sameDirectory } = require('../rest-routes.cjs');
  if (!sameDirectory(env.REST_COUNTER_DIR, dir)) return null;
  const target = apiTarget(env.GITHUB_API_URL);
  const file = join(dir, `gh-requests-${randomUUID()}.log`);
  appendFileSync(file, 'attached\n', { mode: 0o600, flag: 'wx' });

  let inFlight = 0;
  return (rawLine) => {
    const line = rawLine.replace(/\x1b\[[0-9;]*m/g, '');
    if (line.startsWith('* Request to ')) {
      const route = requestRoute(line, target, classify);
      if (route) {
        try {
          appendFileSync(file, `${route}\n`, { flag: 'a' });
        } catch {
          // Keep filtering the injected trace if record storage fails.
        }
      }
      return;
    }
    if (line.startsWith('* Request at ')) {
      inFlight += 1;
      return;
    }
    if (line.startsWith('* Request took ')) {
      inFlight = Math.max(0, inFlight - 1);
      return;
    }
    // httppretty prints transport diagnostics, including proxy addresses, as
    // starred lines. Timing markers may be missing or interleaved.
    if (
      /^[<>] /.test(line) ||
      (line.startsWith('* ') &&
        (inFlight ||
          line.includes('://') ||
          /proxy/i.test(line) ||
          /^\* +(?:Request(?:ing)?|Response|HTTP|Connected|TLS|dial|ALPN|Skipping TLS|(?:Client|Server) certificate|cannot filter request|subject|start date|expire date|issuer)\b/i.test(
            line,
          ))) ||
      /^\[(?:\S*[/\\])?git(?:[.]exe)?(?: |\])/.test(line)
    )
      return;
    writeStderr(Buffer.from(rawLine, 'latin1'));
  };
}

function runGh(realGh, args) {
  const env = { ...process.env };
  if (Object.hasOwn(env, 'REST_COUNTER_ORIGINAL_NODE_OPTIONS')) {
    env.NODE_OPTIONS = env.REST_COUNTER_ORIGINAL_NODE_OPTIONS;
    delete env.REST_COUNTER_ORIGINAL_NODE_OPTIONS;
  }

  let observe;
  // Honor caller diagnostics and bypass aliases/extensions whose debug
  // output is outside the CLI's headline format.
  if (
    env.GH_DEBUG === undefined &&
    !env.DEBUG &&
    TRACED_COMMANDS.has(args[0]) &&
    !args.some((arg) => /^--verbose(?:=|$)/.test(arg))
  ) {
    try {
      observe = prepareObserver(dirname(__dirname), env, (bytes) =>
        process.stderr.write(bytes),
      );
    } catch {
      // Launch gh normally if the observer cannot initialize.
    }
  }

  const child = spawn(realGh, args, {
    env: observe ? { ...env, GH_DEBUG: '1' } : env,
    stdio: ['inherit', 'inherit', observe ? 'pipe' : 'inherit'],
  });
  if (observe) {
    // A closed consumer of stderr must not terminate the observer or gh.
    process.stderr.on('error', () => {});
    let pending = '';
    child.stderr.setEncoding('latin1');
    child.stderr.on('data', (chunk) => {
      pending += chunk;
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        observe(pending.slice(0, end + 1));
        pending = pending.slice(end + 1);
      }
    });
    child.stderr.on('end', () => {
      if (pending) observe(pending);
    });
  }
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const forward = Object.fromEntries(
    signals.map((signal) => [signal, () => child.kill(signal)]),
  );
  for (const signal of signals) process.on(signal, forward[signal]);
  child.on('error', (error) => {
    process.stderr.write(`gh: ${error.message}\n`);
    process.exitCode = error.code === 'ENOENT' ? 127 : 126;
  });
  child.on('close', (code, signal) => {
    for (const name of signals) process.off(name, forward[name]);
    if (signal) process.kill(process.pid, signal);
    else if (code !== null) process.exitCode = code;
  });
}

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--install') {
    const outcome = installGhCounter(
      process.env.REST_COUNTER_DIR,
      restCounterEnabled(args[0]),
    );
    if (outcome.startsWith('failed:')) {
      console.log(outcome.slice('failed:'.length));
      process.exitCode = 1;
    }
  } else {
    runGh(command, args);
  }
}

module.exports = {
  findGhOnPath,
  installGhCounter,
  isExecutableFile,
  restCounterEnabled,
};
