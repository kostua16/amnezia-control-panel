export type DeploymentMode = 'bundled' | 'external';

/**
 * bundled  — fat stack image: VPN tools run inside the same container (s6).
 * external — host/systemd or remote executors (default).
 */
export function getDeploymentMode(): DeploymentMode {
  const mode = (process.env.ACP_DEPLOYMENT_MODE ?? 'external').toLowerCase();
  return mode === 'bundled' ? 'bundled' : 'external';
}

export function isBundledDeployment(): boolean {
  return getDeploymentMode() === 'bundled';
}
