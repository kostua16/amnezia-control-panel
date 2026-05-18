import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ─── Types ──────────────────────────────────────────────

export interface VpnServiceResult {
  success: boolean;
  message: string;
  config?: Record<string, unknown>;
}

export interface AwgUserConfig {
  publicKey?: string;
  privateKey?: string;
  address?: string;
  allowedIPs?: string;
  [key: string]: unknown;
}

export interface ThreeXuiUserConfig {
  uuid?: string;
  flow?: string;
  [key: string]: unknown;
}

// ─── Helpers ────────────────────────────────────────────

/**
 * Escape a username for safe use in shell arguments.
 * Uses execFile's array-based argument passing, so this is a defense-in-depth
 * measure that rejects obviously dangerous input.
 */
function sanitizeUsername(username: string): void {
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    throw new Error(
      `Username contains invalid characters: ${username}. Only alphanumeric, underscore, dot, and hyphen are allowed.`,
    );
  }
}

/**
 * Execute a shell command and return a structured result.
 * Never throws — always returns a VpnServiceResult.
 */
async function runCommand(
  command: string,
  args: string[],
  serviceLabel: string,
): Promise<VpnServiceResult> {
  try {
    console.log(
      `[vpn-services] Executing ${serviceLabel}: ${command} ${args.join(' ')}`,
    );

    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 10_000,
      encoding: 'utf-8',
    });

    console.log(`[vpn-services] ${serviceLabel} stdout: ${stdout?.trim()}`);
    if (stderr?.trim()) {
      console.warn(`[vpn-services] ${serviceLabel} stderr: ${stderr.trim()}`);
    }

    return { success: true, message: stdout?.trim() ?? 'OK' };
  } catch (err) {
    const errMsg =
      err && typeof err === 'object' && 'message' in err
        ? String((err as Error).message)
        : String(err);

    console.error(`[vpn-services] ${serviceLabel} failed: ${errMsg}`);
    return { success: false, message: errMsg };
  }
}

// ─── AWG (Amnezia WireGuard) ────────────────────────────

/**
 * Create a new user in Amnezia AWG.
 *
 * Returns AWG-specific config (publicKey, privateKey, address, allowedIPs).
 *
 * NOTE: Currently a stub. The actual command depends on the server's Amnezia AWG
 * installation (e.g. `amneziawg`, `wg`, or a custom script). Replace the placeholder
 * command with the real one once the server environment is known.
 */
export async function createAwgUser(
  username: string,
  publicKey?: string,
): Promise<VpnServiceResult & { config?: AwgUserConfig }> {
  sanitizeUsername(username);

  const args = ['add-peer', '--name', username];
  if (publicKey) {
    args.push('--public-key', publicKey);
  }

  // STUB: Replace 'amneziawg' with the actual CLI path when available.
  const result: VpnServiceResult = await runCommand(
    'amneziawg',
    args,
    `AWG:createUser(${username})`,
  );

  if (result.success) {
    // When the real command is wired, parse stdout to extract actual keys/addresses.
    result.config = {
      publicKey: publicKey ?? 'STUB_PUBLIC_KEY',
      privateKey: 'STUB_PRIVATE_KEY',
      address: 'STUB_ADDRESS',
      allowedIPs: '0.0.0.0/0',
    };
  }

  return result;
}

/**
 * Remove a user from Amnezia AWG.
 *
 * STUB: Replace command with the real one.
 */
export async function deleteAwgUser(
  username: string,
): Promise<VpnServiceResult> {
  sanitizeUsername(username);
  return runCommand(
    'amneziawg',
    ['remove-peer', '--name', username],
    `AWG:deleteUser(${username})`,
  );
}

/**
 * Block a user in Amnezia AWG (disable traffic).
 *
 * STUB: Replace command with the real one.
 */
export async function blockAwgUser(
  username: string,
): Promise<VpnServiceResult> {
  sanitizeUsername(username);
  return runCommand(
    'amneziawg',
    ['block-peer', '--name', username],
    `AWG:blockUser(${username})`,
  );
}

/**
 * Unblock a user in Amnezia AWG (restore traffic).
 *
 * STUB: Replace command with the real one.
 */
export async function unblockAwgUser(
  username: string,
): Promise<VpnServiceResult> {
  sanitizeUsername(username);
  return runCommand(
    'amneziawg',
    ['unblock-peer', '--name', username],
    `AWG:unblockUser(${username})`,
  );
}

// ─── 3x-ui (Xray Panel) ────────────────────────────────

/**
 * Create a new user in 3x-ui (Xray panel).
 *
 * Returns 3x-ui-specific config (uuid, flow, etc.).
 *
 * NOTE: Currently a stub. The actual command depends on the 3x-ui API or CLI
 * interface available on the server. Replace the placeholder command with the
 * real one once the server environment is known.
 */
export async function createThreeXuiUser(
  username: string,
): Promise<VpnServiceResult & { config?: ThreeXuiUserConfig }> {
  sanitizeUsername(username);

  // STUB: Replace 'xui' with the actual CLI path when available.
  // 3x-ui typically has a web API; a CLI wrapper script may be needed.
  const result: VpnServiceResult = await runCommand(
    'xui',
    ['add-inbound', '--username', username],
    `3x-ui:createUser(${username})`,
  );

  if (result.success) {
    // When the real command is wired, parse stdout to extract actual config.
    result.config = {
      uuid: 'STUB_UUID',
      flow: 'xtls-rprx-vision',
    };
  }

  return result;
}

/**
 * Remove a user from 3x-ui.
 *
 * STUB: Replace command with the real one.
 */
export async function deleteThreeXuiUser(
  username: string,
): Promise<VpnServiceResult> {
  sanitizeUsername(username);
  return runCommand(
    'xui',
    ['remove-inbound', '--username', username],
    `3x-ui:deleteUser(${username})`,
  );
}

/**
 * Block a user in 3x-ui (disable).
 *
 * STUB: Replace command with the real one.
 */
export async function blockThreeXuiUser(
  username: string,
): Promise<VpnServiceResult> {
  sanitizeUsername(username);
  return runCommand(
    'xui',
    ['block-inbound', '--username', username],
    `3x-ui:blockUser(${username})`,
  );
}

/**
 * Unblock a user in 3x-ui (enable).
 *
 * STUB: Replace command with the real one.
 */
export async function unblockThreeXuiUser(
  username: string,
): Promise<VpnServiceResult> {
  sanitizeUsername(username);
  return runCommand(
    'xui',
    ['unblock-inbound', '--username', username],
    `3x-ui:unblockUser(${username})`,
  );
}
