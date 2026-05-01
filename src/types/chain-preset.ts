export interface ChainPreset {
  id: number;
  name: string;
  description: string;
  topology: 'linear' | 'split' | 'mesh';
  nodeCount: number;
  chainTemplateId: string;
  routingBundleId: string | null;
  protocolOverrides: Record<string, unknown> | null;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChainPresetCreate {
  name: string;
  description?: string;
  topology?: 'linear' | 'split' | 'mesh';
  nodeCount?: number;
  chainTemplateId?: string;
  routingBundleId?: string;
  protocolOverrides?: Record<string, unknown>;
  isBuiltIn?: boolean;
}
