import type { ServiceType } from '@/generated/prisma/enums';
import {
  createAwgUser,
  deleteAwgUser,
  blockAwgUser,
  unblockAwgUser,
  createThreeXuiUser,
  deleteThreeXuiUser,
  blockThreeXuiUser,
  unblockThreeXuiUser,
} from '@/lib/vpn-services';
import type {
  VpnServiceResult,
  AwgUserConfig,
  ThreeXuiUserConfig,
} from '@/lib/vpn-services';

/**
 * Polymorphic interface for VPN service lifecycle operations.
 *
 * Each method wraps a single service-type-specific function from vpn-services.ts.
 * Implementations are thin delegates — adding a third VPN system requires only a
 * new class implementing this interface plus a registry entry in getAdapter().
 */
export interface VpnServiceAdapter {
  create(
    username: string,
    publicKey?: string,
  ): Promise<VpnServiceResult & { config?: Record<string, unknown> }>;
  delete(username: string): Promise<VpnServiceResult>;
  block(username: string): Promise<VpnServiceResult>;
  unblock(username: string): Promise<VpnServiceResult>;
}

class AwgAdapter implements VpnServiceAdapter {
  async create(username: string, publicKey?: string) {
    return createAwgUser(username, publicKey) as Promise<
      VpnServiceResult & { config?: AwgUserConfig }
    >;
  }
  async delete(username: string) {
    return deleteAwgUser(username);
  }
  async block(username: string) {
    return blockAwgUser(username);
  }
  async unblock(username: string) {
    return unblockAwgUser(username);
  }
}

class ThreeXuiAdapter implements VpnServiceAdapter {
  async create(username: string) {
    return createThreeXuiUser(username) as Promise<
      VpnServiceResult & { config?: ThreeXuiUserConfig }
    >;
  }
  async delete(username: string) {
    return deleteThreeXuiUser(username);
  }
  async block(username: string) {
    return blockThreeXuiUser(username);
  }
  async unblock(username: string) {
    return unblockThreeXuiUser(username);
  }
}

const ADAPTERS: Readonly<Record<string, VpnServiceAdapter>> = {
  AWG: new AwgAdapter(),
  THREE_XUI: new ThreeXuiAdapter(),
};

/**
 * Return the adapter for a known service type.
 *
 * @throws Error for unknown service types
 */
export function getAdapter(serviceType: ServiceType): VpnServiceAdapter {
  const adapter = ADAPTERS[serviceType];
  if (!adapter) {
    throw new Error(`Unknown VPN service type: ${serviceType}`);
  }
  return adapter;
}

export { AwgAdapter, ThreeXuiAdapter };
