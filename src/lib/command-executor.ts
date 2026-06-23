/**
 * Shared command executor.
 *
 * Wraps Node's `execFile` / `execFileSync` with a consistent timeout, error
 * standardization, platform detection, and dev-mode command+duration logging.
 * Uses array-form args everywhere (never a shell string) so callers cannot
 * introduce shell-injection bugs through this layer.
 */

import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BUFFER = 1024 * 1024;
const IS_DEV = process.env.NODE_ENV !== 'production';

export interface ExecOptions {
  /** Kill the process after this many milliseconds (default 10000). */
  timeoutMs?: number;
  /** Output encoding (default 'utf-8'). */
  encoding?: BufferEncoding;
  /** Max stdout/stderr buffer size in bytes (default 1 MiB). */
  maxBuffer?: number;
  /** Working directory to run the command in. */
  cwd?: string;
  /** Environment overrides merged onto `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Standardized command failure. Always carries the command name and args so
 * logs and error responses identify which invocation failed without callers
 * having to thread context manually.
 */
export class CommandError extends Error {
  readonly command: string;
  readonly args: readonly string[];
  /** Exit code when known, else the errno string (e.g. 'ENOENT'). */
  readonly code: string | number | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(params: {
    command: string;
    args: readonly string[];
    code: string | number | null;
    message: string;
    stdout?: string;
    stderr?: string;
  }) {
    super(
      `Command '${params.command}' failed: ${params.message}` +
        (params.code !== null ? ` (code ${params.code})` : ''),
    );
    this.name = 'CommandError';
    this.command = params.command;
    this.args = params.args;
    this.code = params.code;
    this.stdout = params.stdout ?? '';
    this.stderr = params.stderr ?? '';
  }
}

/** True when running under Windows. Centralized so call sites avoid raw checks. */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

function toCommandError(
  err: unknown,
  command: string,
  args: readonly string[],
): CommandError {
  if (!(err instanceof Error)) {
    return new CommandError({
      command,
      args,
      code: null,
      message: String(err),
    });
  }

  const nodeErr = err as NodeJS.ErrnoException & {
    code?: string | number;
    stdout?: string;
    stderr?: string;
  };
  const message = err.message || err.name;
  return new CommandError({
    command,
    args,
    code: nodeErr.code ?? null,
    message,
    stdout: typeof nodeErr.stdout === 'string' ? nodeErr.stdout : '',
    stderr: typeof nodeErr.stderr === 'string' ? nodeErr.stderr : '',
  });
}

function buildExecOptions(opts: ExecOptions | undefined) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    encoding = 'utf-8',
    maxBuffer = DEFAULT_MAX_BUFFER,
    cwd,
    env,
  } = opts ?? {};
  return { timeout: timeoutMs, encoding, maxBuffer, cwd, env };
}

/**
 * Run a command asynchronously. Resolves with stdout/stderr, or rejects with
 * {@link CommandError} on non-zero exit, timeout, or spawn failure.
 */
export async function execCommand(
  command: string,
  args: readonly string[] = [],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const startedAt = IS_DEV ? Date.now() : 0;
  if (IS_DEV) {
    console.debug(`[exec] ${command} ${args.join(' ')}`);
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      command,
      [...args],
      buildExecOptions(options),
    );
    if (IS_DEV) {
      console.debug(`[exec] ${command} ok (${Date.now() - startedAt}ms)`);
    }
    return { stdout: stdout ?? '', stderr: stderr ?? '' };
  } catch (err) {
    throw toCommandError(err, command, args);
  }
}

/**
 * Run a command synchronously. Returns stdout (stderr is not available from the
 * sync API), or throws {@link CommandError} on failure.
 */
export function execCommandSync(
  command: string,
  args: readonly string[] = [],
  options: ExecOptions = {},
): ExecResult {
  const startedAt = IS_DEV ? Date.now() : 0;
  if (IS_DEV) {
    console.debug(`[exec] ${command} ${args.join(' ')}`);
  }

  try {
    const stdout = execFileSync(command, [...args], buildExecOptions(options));
    if (IS_DEV) {
      console.debug(`[exec] ${command} ok (${Date.now() - startedAt}ms)`);
    }
    return { stdout: (stdout as string) ?? '', stderr: '' };
  } catch (err) {
    throw toCommandError(err, command, args);
  }
}
