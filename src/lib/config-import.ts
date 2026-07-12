import { prisma } from '@/lib/prisma';
import type { ConfigImportReport } from '@/types/config';

/** Maximum number of entries allowed in a single import payload. */
const MAX_IMPORT_ENTRIES = 500;

// ─── Import Functions ────────────────────────────────────

export async function importConfigs(
  data: unknown,
): Promise<ConfigImportReport> {
  const report: ConfigImportReport = {
    imported: 0,
    skipped: 0,
    updated: 0,
    errors: [],
  };

  // Validate the import data structure
  if (!data || typeof data !== 'object') {
    report.errors.push('Invalid import data: expected an object');
    return report;
  }

  const importPayload = data as Record<string, unknown>;

  // Check version
  if (!importPayload.version || typeof importPayload.version !== 'number') {
    report.errors.push('Invalid or missing version field');
    return report;
  }

  if (importPayload.version !== 1) {
    report.errors.push(`Unsupported version: ${importPayload.version}`);
    return report;
  }

  // Import configurations
  if (Array.isArray(importPayload.configurations)) {
    await importConfigurationList(importPayload.configurations, report);
  }

  // Import templates (only non-built-in)
  if (Array.isArray(importPayload.templates)) {
    await importTemplateList(importPayload.templates, report);
  }

  return report;
}

// ─── Import Configurations (batched) ─────────────────────

async function importConfigurationList(
  configs: unknown[],
  report: ConfigImportReport,
): Promise<void> {
  if (configs.length > MAX_IMPORT_ENTRIES) {
    report.errors.push(
      `Configuration list exceeds maximum of ${MAX_IMPORT_ENTRIES} entries (${configs.length} provided)`,
    );
    return;
  }

  // Pre-load all existing configurations into a lookup map (1 query)
  const existingRows = await prisma.configuration.findMany({
    select: { id: true, name: true, content: true },
  });
  const existingByName = new Map(existingRows.map((r) => [r.name, r]));

  const validated: Array<{
    name: string;
    type: string;
    content: Record<string, unknown>;
    isActive: boolean;
  }> = [];

  // Validate and classify entries in a single pass
  for (const item of configs) {
    if (!item || typeof item !== 'object') {
      report.errors.push('Invalid configuration entry: expected an object');
      continue;
    }

    const config = item as Record<string, unknown>;

    if (!config.name || typeof config.name !== 'string') {
      report.errors.push('Configuration entry missing required field: name');
      continue;
    }

    if (!config.content || typeof config.content !== 'object') {
      report.errors.push(
        `Configuration "${config.name}" missing required field: content`,
      );
      continue;
    }

    validated.push({
      name: config.name as string,
      type: (config.type as string) || 'imported',
      content: config.content as Record<string, unknown>,
      isActive: config.isActive !== false,
    });
  }

  // Classify into new vs changed vs unchanged
  const toCreate: typeof validated = [];
  const toUpdate: Array<{ id: number } & (typeof validated)[number]> = [];

  for (const entry of validated) {
    const existing = existingByName.get(entry.name);
    if (!existing) {
      toCreate.push(entry);
    } else {
      const contentChanged =
        JSON.stringify(existing.content) !== JSON.stringify(entry.content);
      if (contentChanged) {
        toUpdate.push({ id: existing.id, ...entry });
      } else {
        report.skipped++;
      }
    }
  }

  // Batch-create new entries (1 query)
  if (toCreate.length > 0) {
    await prisma.configuration.createMany({
      data: toCreate.map((e) => ({
        type: e.type,
        name: e.name,
        content: e.content as never,
        isActive: e.isActive,
      })),
    });
    report.imported += toCreate.length;
  }

  // Update only changed entries (N queries, typically small)
  for (const entry of toUpdate) {
    await prisma.configuration.update({
      where: { id: entry.id },
      data: {
        type: entry.type,
        content: entry.content as never,
        isActive: entry.isActive,
      },
    });
    report.updated++;
  }
}

// ─── Import Templates (batched) ──────────────────────────

async function importTemplateList(
  templates: unknown[],
  report: ConfigImportReport,
): Promise<void> {
  if (templates.length > MAX_IMPORT_ENTRIES) {
    report.errors.push(
      `Template list exceeds maximum of ${MAX_IMPORT_ENTRIES} entries (${templates.length} provided)`,
    );
    return;
  }

  // Pre-load all existing templates into a lookup map (1 query)
  const existingRows = await prisma.configTemplate.findMany({
    select: { id: true, name: true, content: true, isBuiltIn: true },
  });
  const existingByName = new Map(existingRows.map((r) => [r.name, r]));

  const validated: Array<{
    name: string;
    protocol: string;
    content: Record<string, unknown>;
    description: string;
    serviceType: 'AWG' | 'THREE_XUI' | null;
  }> = [];

  // Validate and collect entries in a single pass
  for (const item of templates) {
    if (!item || typeof item !== 'object') {
      report.errors.push('Invalid template entry: expected an object');
      continue;
    }

    const tmpl = item as Record<string, unknown>;

    if (!tmpl.name || typeof tmpl.name !== 'string') {
      report.errors.push('Template entry missing required field: name');
      continue;
    }

    if (!tmpl.protocol || typeof tmpl.protocol !== 'string') {
      report.errors.push(
        `Template "${tmpl.name}" missing required field: protocol`,
      );
      continue;
    }

    if (!tmpl.content || typeof tmpl.content !== 'object') {
      report.errors.push(
        `Template "${tmpl.name}" missing required field: content`,
      );
      continue;
    }

    validated.push({
      name: tmpl.name as string,
      protocol: tmpl.protocol as string,
      content: tmpl.content as Record<string, unknown>,
      description: (tmpl.description as string) || '',
      serviceType: tmpl.serviceType
        ? (tmpl.serviceType as string as 'AWG' | 'THREE_XUI')
        : null,
    });
  }

  // Classify into new vs changed vs unchanged
  const toCreate: typeof validated = [];
  const toUpdate: Array<{ id: number } & (typeof validated)[number]> = [];

  for (const entry of validated) {
    const existing = existingByName.get(entry.name);
    if (!existing) {
      toCreate.push(entry);
    } else if (existing.isBuiltIn) {
      report.skipped++;
    } else {
      const contentChanged =
        JSON.stringify(existing.content) !== JSON.stringify(entry.content);
      if (contentChanged) {
        toUpdate.push({ id: existing.id, ...entry });
      } else {
        report.skipped++;
      }
    }
  }

  // Batch-create new entries (1 query)
  if (toCreate.length > 0) {
    await prisma.configTemplate.createMany({
      data: toCreate.map((e) => ({
        name: e.name,
        protocol: e.protocol,
        content: e.content as never,
        description: e.description,
        serviceType: e.serviceType,
        isBuiltIn: false,
      })),
    });
    report.imported += toCreate.length;
  }

  // Update only changed entries (N queries, typically small)
  for (const entry of toUpdate) {
    await prisma.configTemplate.update({
      where: { id: entry.id },
      data: {
        protocol: entry.protocol,
        content: entry.content as never,
        description: entry.description,
        serviceType: entry.serviceType,
      },
    });
    report.updated++;
  }
}
