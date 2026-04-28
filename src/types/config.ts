import type { ServiceType } from '@/generated/prisma/enums';

// ─── Config Template ────────────────────────────────────

export interface ConfigTemplate {
  id: number;
  name: string;
  serviceType: ServiceType | null;
  protocol: string;
  content: Record<string, unknown>;
  description: string;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigTemplateCreate {
  name: string;
  serviceType?: ServiceType;
  protocol: string;
  content: Record<string, unknown>;
  description?: string;
}

export interface ConfigTemplateUpdate {
  name?: string;
  serviceType?: ServiceType;
  protocol?: string;
  content?: Record<string, unknown>;
  description?: string;
}

// ─── Protocol Template ──────────────────────────────────

export interface ProtocolTemplate {
  name: string;
  protocol: string;
  serviceType: ServiceType;
  defaultConfig: Record<string, unknown>;
  description: string;
}

// ─── Export / Import ────────────────────────────────────

export interface ConfigExport {
  version: number;
  exportedAt: string;
  configurations: Array<{
    type: string;
    name: string;
    content: Record<string, unknown>;
    isActive: boolean;
    serviceType?: string;
    protocol?: string;
  }>;
  templates: Array<{
    name: string;
    serviceType: string;
    protocol: string;
    content: Record<string, unknown>;
    description: string;
  }>;
}

export interface ConfigImportReport {
  imported: number;
  skipped: number;
  updated: number;
  errors: string[];
}

// ─── Config Preset ──────────────────────────────────────

export interface ConfigPreset {
  name: string;
  label: string;
  description: string;
  serviceType: ServiceType;
  protocol: string;
  settings: Record<string, unknown>;
  tags: string[];
}

// ─── Config Generation ──────────────────────────────────

export interface GenerateConfigOptions {
  userId?: number;
  serverId?: number;
  overrides?: Record<string, unknown>;
}
