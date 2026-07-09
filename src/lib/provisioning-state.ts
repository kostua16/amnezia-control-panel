import { Prisma } from '@/generated/prisma/client';

type ProvisioningProtocol = {
  isActive: boolean;
  config: Prisma.JsonValue;
};

export function hasProvisioningConfig(config: Prisma.JsonValue): boolean {
  return (
    !!config &&
    typeof config === 'object' &&
    !Array.isArray(config) &&
    Object.keys(config).length > 0
  );
}

export function isPendingProvisioning(protocol: ProvisioningProtocol): boolean {
  return !protocol.isActive && !hasProvisioningConfig(protocol.config);
}

export function hasPartialProvisioning(
  protocols: ProvisioningProtocol[],
): boolean {
  return protocols.some(isPendingProvisioning);
}

export function shouldReactivateAfterProvisioningRetry(
  protocols: ProvisioningProtocol[],
  provisioningFixed: number,
): boolean {
  const pendingProvisioningCount = protocols.filter(
    isPendingProvisioning,
  ).length;
  return (
    pendingProvisioningCount > 0 &&
    pendingProvisioningCount === protocols.length &&
    provisioningFixed === pendingProvisioningCount
  );
}
