import type { StructuredPushError } from '@/types/config-push';

type ErrorCategory = StructuredPushError['type'];

interface ErrorPattern {
  /** Case-insensitive substring patterns to match */
  patterns: string[];
  /** The error type to assign */
  type: ErrorCategory;
  /** Human-readable error message template */
  message: (panelName: string, raw: string) => string;
  /** Recommended action for the admin */
  recommendation: string;
  /** Specific fix command or step, if available */
  knownFix: string | null;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    patterns: ['timeout', 'etimedout', 'abort_err', 'econnrefused'],
    type: 'connection_timeout',
    message: (panelName) => `Connection to ${panelName} timed out`,
    recommendation: 'Check Tailscale status on the remote panel',
    knownFix: 'Verify panel is reachable: `ping <panelUrl>`',
  },
  {
    patterns: [
      '401',
      '403',
      'unauthorized',
      'invalid api key',
      'invalid signature',
    ],
    type: 'auth_failure',
    message: (panelName) => `Authentication failed for ${panelName}`,
    recommendation: 'Verify API key is correct in panel settings',
    knownFix: 'Re-enter API key on the panel edit page',
  },
  {
    patterns: ['invalid', 'malformed', 'validation failed'],
    type: 'invalid_config',
    message: (panelName) => `Configuration validation failed for ${panelName}`,
    recommendation: 'Check chain configuration for invalid values',
    knownFix: 'Review the config diff before pushing',
  },
  {
    patterns: ['docker', 'container not found', 'container is not running'],
    type: 'docker_error',
    message: (panelName) => `Docker container issue on ${panelName}`,
    recommendation: 'Check Docker container status on the remote server',
    knownFix:
      '`docker ps` to verify container is running, `docker restart <container>`',
  },
  {
    patterns: [
      'service not found',
      'command not found',
      'amneziawg: not found',
      'wg: not found',
    ],
    type: 'service_error',
    message: (panelName) => `VPN service not available on ${panelName}`,
    recommendation: 'Verify VPN service is installed on the remote server',
    knownFix: 'Install or restart the service on the remote panel',
  },
];

/**
 * Enrich a raw error string into a StructuredPushError with actionable
 * recommendations and known fixes.
 *
 * Pattern-matches against known failure modes (timeout, auth, config,
 * docker, service). Falls back to 'unknown' type if no pattern matches.
 *
 * This function never throws -- it always returns a StructuredPushError.
 */
export function enrichError(
  rawError: string,
  panelName: string,
): StructuredPushError {
  const lower = rawError.toLowerCase();

  for (const pattern of ERROR_PATTERNS) {
    for (const p of pattern.patterns) {
      if (lower.includes(p.toLowerCase())) {
        return {
          type: pattern.type,
          message: pattern.message(panelName, rawError),
          recommendation: pattern.recommendation,
          knownFix: pattern.knownFix,
          rawError,
        };
      }
    }
  }

  // Default: unknown error type
  return {
    type: 'unknown',
    message: `Unknown error on ${panelName}: ${rawError}`,
    recommendation: 'Check panel logs for details',
    knownFix: null,
    rawError,
  };
}
