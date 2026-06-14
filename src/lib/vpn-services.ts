import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { promisify } from 'util';
import { prisma } from '@/lib/prisma';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 10_000;
const AWG_SERVICE_TYPE = 'AWG';
const THREE_XUI_SERVICE_TYPE = 'THREE_XUI';
const WIREGUARD_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const IPV4_PREFIX_PATTERN =
  /^(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.$/;
const ADDRESS_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}\/(?:3[0-2]|[12]?\d)$/;
const ALLOWED_IPS_PATTERN = /^[0-9a-fA-F:.,/\s]+$/;
const XUI_BASE_URL_PATTERN = /^https?:\/\/[^\s"'`<>]+$/;

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
  peerAllowedIPs?: string;
  interface?: string;
  [key: string]: unknown;
}

export interface ThreeXuiUserConfig {
  uuid?: string;
  flow?: string;
  inboundId?: number;
  protocol?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

interface CliResult {
  stdout: string;
  stderr: string;
}

interface UserProtocolConfig {
  config: unknown;
}

interface XuiApiResponse {
  success?: boolean;
  msg?: string;
  obj?: unknown;
}

// ─── Environment / validation helpers ───────────────────

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function envEnabled(name: string): boolean {
  return ['1', 'true', 'yes'].includes((process.env[name] ?? '').toLowerCase());
}

export function sanitizeUsername(username: string): void {
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error(
      `Username contains invalid characters: ${username}. Only alphanumeric, underscore, dot, and hyphen are allowed.`,
    );
  }
}

function validateNoNul(value: string, label: string): void {
  if (value.includes('\0')) {
    throw new Error(`${label} contains a NUL byte`);
  }
}

function validateWireGuardKey(value: string, label: string): void {
  if (!WIREGUARD_KEY_PATTERN.test(value)) {
    throw new Error(`${label} is not a valid WireGuard public/private key`);
  }
}

function validateAllowedIps(value: string, label: string): void {
  if (!ALLOWED_IPS_PATTERN.test(value)) {
    throw new Error(`${label} contains invalid characters`);
  }
}

function validateAddress(value: string): void {
  if (!ADDRESS_PATTERN.test(value)) {
    throw new Error(`AWG address is not a valid CIDR address: ${value}`);
  }

  const [ip] = value.split('/');
  const octets = ip.split('.').map(Number);
  if (
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    throw new Error(`AWG address contains an invalid IPv4 octet: ${value}`);
  }
}

function awgBinary(): string {
  return env('AWG_CLI_PATH', env('AMNEZIAWG_CLI_PATH', 'awg'));
}

function awgInterface(): string {
  return env('AWG_INTERFACE', 'awg0');
}

function awgClientAddressPrefix(): string {
  const prefix = env('AWG_CLIENT_IPV4_PREFIX', '10.8.0.');
  if (!IPV4_PREFIX_PATTERN.test(prefix)) {
    throw new Error(
      `AWG_CLIENT_IPV4_PREFIX must look like "10.8.0.", got: ${prefix}`,
    );
  }
  return prefix;
}

function awgClientRoutes(): string {
  const routes = env('AWG_CLIENT_ALLOWED_IPS', '0.0.0.0/0, ::/0');
  validateAllowedIps(routes, 'AWG_CLIENT_ALLOWED_IPS');
  return routes;
}

function awgPeerAllowedIps(address: string): string {
  const ip = address.split('/')[0];
  return `${ip}/32`;
}

function xuiBaseUrl(): string {
  const baseUrl = env('XUI_BASE_URL', 'http://127.0.0.1:2053').replace(
    /\/$/,
    '',
  );
  if (!XUI_BASE_URL_PATTERN.test(baseUrl)) {
    throw new Error(`XUI_BASE_URL is not a safe http(s) URL: ${baseUrl}`);
  }
  return baseUrl;
}

function xuiInboundId(): number {
  return envNumber('XUI_INBOUND_ID', 1);
}

function withOptionalSudo(args: string[]): { command: string; args: string[] } {
  const binary = awgBinary();
  if (!envEnabled('AWG_USE_SUDO')) {
    return { command: binary, args };
  }
  return { command: 'sudo', args: [binary, ...args] };
}

function getErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as Error).message);
  }
  return String(err);
}

function redactArgs(args: string[]): string[] {
  return args.map((arg, index) => {
    const previous = args[index - 1]?.toLowerCase();
    if (
      previous === '-d' ||
      previous === '--data' ||
      previous === '--data-raw' ||
      previous === 'cookie:'
    ) {
      return '<redacted>';
    }
    if (/^(cookie|authorization):/i.test(arg)) return '<redacted-header>';
    if (arg.includes('password=') || arg.includes('Cookie:'))
      return '<redacted>';
    return arg;
  });
}

// ─── CLI helpers ─────────────────────────────────────────

async function runCli(
  command: string,
  args: string[],
  serviceLabel: string,
  timeout = DEFAULT_TIMEOUT_MS,
): Promise<CliResult> {
  validateNoNul(command, 'Command');
  for (const [index, arg] of args.entries()) {
    validateNoNul(arg, `Argument ${index}`);
  }

  try {
    console.log(
      `[vpn-services] Executing ${serviceLabel}: ${command} ${redactArgs(args).join(' ')}`,
    );

    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });

    const trimmedStdout = stdout?.trim() ?? '';
    const trimmedStderr = stderr?.trim() ?? '';
    if (trimmedStdout) {
      console.log(`[vpn-services] ${serviceLabel} stdout: ${trimmedStdout}`);
    }
    if (trimmedStderr) {
      console.warn(`[vpn-services] ${serviceLabel} stderr: ${trimmedStderr}`);
    }

    return { stdout: stdout ?? '', stderr: stderr ?? '' };
  } catch (err) {
    const message = getErrorMessage(err);
    console.error(`[vpn-services] ${serviceLabel} failed: ${message}`);
    throw new Error(`${serviceLabel} failed: ${message}`);
  }
}

function runCliWithInput(
  command: string,
  args: string[],
  input: string,
  serviceLabel: string,
  timeout = DEFAULT_TIMEOUT_MS,
): Promise<CliResult> {
  validateNoNul(command, 'Command');
  validateNoNul(input, 'Input');
  for (const [index, arg] of args.entries()) {
    validateNoNul(arg, `Argument ${index}`);
  }

  return new Promise((resolve, reject) => {
    console.log(
      `[vpn-services] Executing ${serviceLabel}: ${command} ${redactArgs(args).join(' ')}`,
    );

    const child = execFile(
      command,
      args,
      { timeout, encoding: 'utf-8', maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        const normalizedStdout = String(stdout ?? '');
        const normalizedStderr = String(stderr ?? '');

        if (err) {
          const message = getErrorMessage(err);
          console.error(`[vpn-services] ${serviceLabel} failed: ${message}`);
          reject(new Error(`${serviceLabel} failed: ${message}`));
          return;
        }

        if (normalizedStdout.trim()) {
          console.log(
            `[vpn-services] ${serviceLabel} stdout: ${normalizedStdout.trim()}`,
          );
        }
        if (normalizedStderr.trim()) {
          console.warn(
            `[vpn-services] ${serviceLabel} stderr: ${normalizedStderr.trim()}`,
          );
        }

        resolve({ stdout: normalizedStdout, stderr: normalizedStderr });
      },
    );

    child.stdin?.end(input);
  });
}

function ok(
  message: string,
  config?: Record<string, unknown>,
): VpnServiceResult {
  return config
    ? { success: true, message, config }
    : { success: true, message };
}

function fail(message: string): VpnServiceResult {
  return { success: false, message };
}

// ─── DB config helpers ───────────────────────────────────

async function findProtocolConfig(
  username: string,
  serviceType: typeof AWG_SERVICE_TYPE | typeof THREE_XUI_SERVICE_TYPE,
): Promise<Record<string, unknown> | null> {
  const protocol: UserProtocolConfig | null =
    await prisma.userProtocol.findFirst({
      where: {
        serviceType,
        isActive: true,
        user: { username },
      },
      select: { config: true },
    });

  if (!protocol || !protocol.config || typeof protocol.config !== 'object') {
    return null;
  }

  return protocol.config as Record<string, unknown>;
}

function getStringConfig(
  config: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = config?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// ─── AWG (Amnezia WireGuard) ────────────────────────────

async function generateAwgKeyPair(): Promise<{
  privateKey: string;
  publicKey: string;
}> {
  const privateKey = (
    await runCli(awgBinary(), ['genkey'], 'AWG:genkey')
  ).stdout.trim();
  validateWireGuardKey(privateKey, 'Generated AWG private key');

  const publicKey = (
    await runCliWithInput(
      awgBinary(),
      ['pubkey'],
      `${privateKey}\n`,
      'AWG:pubkey',
    )
  ).stdout.trim();
  validateWireGuardKey(publicKey, 'Generated AWG public key');

  return { privateKey, publicKey };
}

async function allocateAwgAddress(): Promise<string> {
  const prefix = awgClientAddressPrefix();
  const used = new Set<string>();

  const protocols = await prisma.userProtocol.findMany({
    where: { serviceType: AWG_SERVICE_TYPE, isActive: true },
    select: { config: true },
  });

  for (const protocol of protocols) {
    if (protocol.config && typeof protocol.config === 'object') {
      const address = (protocol.config as Record<string, unknown>).address;
      if (typeof address === 'string') {
        used.add(address.split('/')[0] ?? address);
      }
    }
  }

  for (let host = 2; host < 255; host++) {
    const candidate = `${prefix}${host}`;
    if (!used.has(candidate)) {
      return `${candidate}/32`;
    }
  }

  throw new Error(
    `No free AWG client addresses left in ${prefix}0/24; set AWG_CLIENT_IPV4_PREFIX to another subnet`,
  );
}

async function addAwgPeer(
  username: string,
  publicKey: string,
  peerAllowedIPs: string,
): Promise<void> {
  validateWireGuardKey(publicKey, 'AWG peer public key');
  validateAllowedIps(peerAllowedIPs, 'AWG peer allowed IPs');

  const { command, args } = withOptionalSudo([
    'set',
    awgInterface(),
    'peer',
    publicKey,
    'allowed-ips',
    peerAllowedIPs,
  ]);

  await runCli(command, args, `AWG:addPeer(${username})`);
}

async function removeAwgPeer(
  username: string,
  publicKey: string,
): Promise<void> {
  validateWireGuardKey(publicKey, 'AWG peer public key');

  const { command, args } = withOptionalSudo([
    'set',
    awgInterface(),
    'peer',
    publicKey,
    'remove',
  ]);

  await runCli(command, args, `AWG:removePeer(${username})`);
}

async function getAwgConfig(username: string): Promise<AwgUserConfig> {
  const config = await findProtocolConfig(username, AWG_SERVICE_TYPE);
  const publicKey = getStringConfig(config, 'publicKey');
  const address = getStringConfig(config, 'address');
  const peerAllowedIPs =
    getStringConfig(config, 'peerAllowedIPs') ??
    (address ? awgPeerAllowedIps(address) : null);

  if (!publicKey) {
    throw new Error(
      `AWG config for ${username} is missing publicKey; recreate the user's AWG service first`,
    );
  }
  if (!address) {
    throw new Error(
      `AWG config for ${username} is missing address; recreate the user's AWG service first`,
    );
  }
  if (!peerAllowedIPs) {
    throw new Error(
      `AWG config for ${username} is missing peerAllowedIPs; recreate the user's AWG service first`,
    );
  }

  validateWireGuardKey(publicKey, 'Stored AWG public key');
  validateAddress(address);
  validateAllowedIps(peerAllowedIPs, 'Stored AWG peer allowed IPs');

  return { publicKey, address, peerAllowedIPs };
}

/**
 * Create a new AmneziaWG peer via the WireGuard-compatible `awg` CLI.
 *
 * Env knobs:
 * - `AWG_CLI_PATH` / `AMNEZIAWG_CLI_PATH` (default: `awg`)
 * - `AWG_INTERFACE` (default: `awg0`)
 * - `AWG_USE_SUDO=1` to run `sudo awg ...`
 * - `AWG_CLIENT_IPV4_PREFIX` (default: `10.8.0.`)
 * - `AWG_CLIENT_ALLOWED_IPS` (default client routes: `0.0.0.0/0, ::/0`)
 */
export async function createAwgUser(
  username: string,
  publicKey?: string,
): Promise<VpnServiceResult & { config?: AwgUserConfig }> {
  try {
    sanitizeUsername(username);

    const generated = publicKey ? null : await generateAwgKeyPair();
    const peerPublicKey = publicKey ?? generated!.publicKey;
    validateWireGuardKey(peerPublicKey, 'AWG peer public key');

    const address = await allocateAwgAddress();
    validateAddress(address);

    const peerAllowedIPs = awgPeerAllowedIps(address);
    await addAwgPeer(username, peerPublicKey, peerAllowedIPs);

    const config: AwgUserConfig = {
      publicKey: peerPublicKey,
      address,
      allowedIPs: awgClientRoutes(),
      peerAllowedIPs,
      interface: awgInterface(),
    };

    if (generated) {
      config.privateKey = generated.privateKey;
    }

    return ok(`Created AWG peer ${username} on ${awgInterface()}`, config) as
      | VpnServiceResult
      | (VpnServiceResult & { config?: AwgUserConfig });
  } catch (err) {
    return fail(getErrorMessage(err));
  }
}

export async function deleteAwgUser(
  username: string,
): Promise<VpnServiceResult> {
  try {
    sanitizeUsername(username);
    const config = await getAwgConfig(username);
    await removeAwgPeer(username, config.publicKey!);
    return ok(`Deleted AWG peer ${username} from ${awgInterface()}`);
  } catch (err) {
    return fail(getErrorMessage(err));
  }
}

/**
 * Block a user in AmneziaWG.
 * WireGuard/AmneziaWG has no native disabled flag, so blocking removes the
 * peer from the live interface while preserving the stored DB config for
 * later unblock/re-add.
 */
export async function blockAwgUser(
  username: string,
): Promise<VpnServiceResult> {
  try {
    sanitizeUsername(username);
    const config = await getAwgConfig(username);
    await removeAwgPeer(username, config.publicKey!);
    return ok(
      `Blocked AWG peer ${username} by removing it from ${awgInterface()}`,
    );
  } catch (err) {
    return fail(getErrorMessage(err));
  }
}

export async function unblockAwgUser(
  username: string,
): Promise<VpnServiceResult> {
  try {
    sanitizeUsername(username);
    const config = await getAwgConfig(username);
    await addAwgPeer(username, config.publicKey!, config.peerAllowedIPs!);
    return ok(`Unblocked AWG peer ${username} on ${awgInterface()}`);
  } catch (err) {
    return fail(getErrorMessage(err));
  }
}

// ─── 3x-ui (Xray Panel) ────────────────────────────────

function xuiCookieFromHeaders(rawHeaders: string): string | null {
  const cookies = rawHeaders
    .split(/\r?\n/)
    .filter((line) => /^set-cookie:/i.test(line))
    .map((line) => line.replace(/^set-cookie:\s*/i, '').split(';')[0])
    .filter(Boolean);

  return cookies.length > 0 ? cookies.join('; ') : null;
}

async function xuiCookie(): Promise<string> {
  const configuredCookie = process.env.XUI_COOKIE;
  if (configuredCookie?.trim()) {
    return configuredCookie.trim();
  }

  const username = process.env.XUI_USERNAME;
  const password = process.env.XUI_PASSWORD;
  if (!username || !password) {
    throw new Error(
      '3x-ui client management requires XUI_COOKIE or XUI_USERNAME/XUI_PASSWORD',
    );
  }

  const result = await runCli(
    'curl',
    [
      '-sS',
      '-i',
      '--max-time',
      String(envNumber('XUI_TIMEOUT_SECONDS', 10)),
      '-X',
      'POST',
      '-d',
      `username=${encodeURIComponent(username)}`,
      '-d',
      `password=${encodeURIComponent(password)}`,
      `${xuiBaseUrl()}/login`,
    ],
    '3x-ui:login',
  );

  const cookie = xuiCookieFromHeaders(result.stdout);
  if (!cookie) {
    throw new Error('3x-ui login did not return a session cookie');
  }
  return cookie;
}

function parseXuiResponse(raw: string, action: string): XuiApiResponse {
  try {
    const parsed = JSON.parse(raw) as XuiApiResponse;
    if (parsed.success === false) {
      throw new Error(parsed.msg || `${action} returned success=false`);
    }
    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(
        `${action} returned non-JSON output: ${raw.slice(0, 200)}`,
      );
    }
    throw err;
  }
}

async function xuiApi(
  action: string,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<XuiApiResponse> {
  const cookie = await xuiCookie();
  const args = [
    '-sS',
    '--max-time',
    String(envNumber('XUI_TIMEOUT_SECONDS', 10)),
    '-X',
    method,
    '-H',
    'Content-Type: application/json',
    '-H',
    `Cookie: ${cookie}`,
  ];

  if (body) {
    args.push('-d', JSON.stringify(body));
  }

  args.push(`${xuiBaseUrl()}${path}`);

  const result = await runCli('curl', args, `3x-ui:${action}`);
  return parseXuiResponse(result.stdout.trim(), action);
}

function buildXuiClient(
  username: string,
  uuid: string,
  enabled: boolean,
  subId = randomUUID().replace(/-/g, '').slice(0, 16),
): Record<string, unknown> {
  return {
    id: uuid,
    email: username,
    enable: enabled,
    flow: env('XUI_VLESS_FLOW', 'xtls-rprx-vision'),
    limitIp: envNumber('XUI_LIMIT_IP', 0),
    totalGB: envNumber('XUI_TOTAL_GB', 0),
    expiryTime: envNumber('XUI_EXPIRY_TIME', 0),
    tgId: '',
    subId,
    reset: 0,
  };
}

async function updateXuiClientEnabled(
  username: string,
  enabled: boolean,
): Promise<{ uuid: string; response: XuiApiResponse }> {
  const config = await findProtocolConfig(username, THREE_XUI_SERVICE_TYPE);
  const uuid = getStringConfig(config, 'uuid');
  if (!uuid) {
    throw new Error(
      `3x-ui config for ${username} is missing uuid; recreate the user's 3x-ui service first`,
    );
  }

  const inboundId = Number(config?.inboundId ?? xuiInboundId());
  const subId = getStringConfig(config, 'subId') ?? undefined;
  const client = buildXuiClient(username, uuid, enabled, subId);
  const response = await xuiApi(
    enabled ? `unblockClient(${username})` : `blockClient(${username})`,
    'POST',
    `/panel/api/inbounds/updateClient/${encodeURIComponent(uuid)}`,
    {
      id: inboundId,
      settings: JSON.stringify({ clients: [client] }),
    },
  );

  return { uuid, response };
}

/**
 * Create a new 3x-ui client via the official panel REST API using `curl`
 * through execFile. 3x-ui's `x-ui` binary controls the daemon, but upstream
 * does not expose client CRUD as CLI subcommands, so client lifecycle has to
 * use `/panel/api/inbounds/*`.
 */
export async function createThreeXuiUser(
  username: string,
): Promise<VpnServiceResult & { config?: ThreeXuiUserConfig }> {
  try {
    sanitizeUsername(username);

    const uuid = randomUUID();
    const inboundId = xuiInboundId();
    const subId = randomUUID().replace(/-/g, '').slice(0, 16);
    const client = buildXuiClient(username, uuid, true, subId);

    await xuiApi(
      `createClient(${username})`,
      'POST',
      '/panel/api/inbounds/addClient',
      {
        id: inboundId,
        settings: JSON.stringify({ clients: [client] }),
      },
    );

    const config: ThreeXuiUserConfig = {
      uuid,
      flow: String(client.flow),
      inboundId,
      protocol: env('XUI_PROTOCOL', 'vless'),
      enabled: true,
      subId,
    };

    return ok(
      `Created 3x-ui client ${username} on inbound ${inboundId}`,
      config,
    ) as
      | VpnServiceResult
      | (VpnServiceResult & { config?: ThreeXuiUserConfig });
  } catch (err) {
    return fail(getErrorMessage(err));
  }
}

export async function deleteThreeXuiUser(
  username: string,
): Promise<VpnServiceResult> {
  try {
    sanitizeUsername(username);
    const config = await findProtocolConfig(username, THREE_XUI_SERVICE_TYPE);
    const uuid = getStringConfig(config, 'uuid');
    if (!uuid) {
      throw new Error(
        `3x-ui config for ${username} is missing uuid; cannot delete remote client`,
      );
    }

    const inboundId = Number(config?.inboundId ?? xuiInboundId());
    await xuiApi(
      `deleteClient(${username})`,
      'POST',
      `/panel/api/inbounds/${inboundId}/delClient/${encodeURIComponent(uuid)}`,
    );

    return ok(`Deleted 3x-ui client ${username} from inbound ${inboundId}`);
  } catch (err) {
    return fail(getErrorMessage(err));
  }
}

export async function blockThreeXuiUser(
  username: string,
): Promise<VpnServiceResult> {
  try {
    sanitizeUsername(username);
    await updateXuiClientEnabled(username, false);
    return ok(`Blocked 3x-ui client ${username}`);
  } catch (err) {
    return fail(getErrorMessage(err));
  }
}

export async function unblockThreeXuiUser(
  username: string,
): Promise<VpnServiceResult> {
  try {
    sanitizeUsername(username);
    await updateXuiClientEnabled(username, true);
    return ok(`Unblocked 3x-ui client ${username}`);
  } catch (err) {
    return fail(getErrorMessage(err));
  }
}
