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

// ─── Import Configurations ───────────────────────────────

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

  for (const item of configs) {
    if (!item || typeof item !== 'object') {
      report.errors.push('Invalid configuration entry: expected an object');
      continue;
    }

    const config = item as Record<string, unknown>;

    // Validate required fields
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

    try {
      const name = config.name as string;
      const type = (config.type as string) || 'imported';
      const content = config.content as Record<string, unknown>;
      const isActive = config.isActive !== false;

      // Check for existing configuration with same name
      const existing = await prisma.configuration.findUnique({
        where: { name },
      });

      if (existing) {
        // Compare content to see if it changed
        const existingContent = existing.content as Record<string, unknown>;
        const contentChanged =
          JSON.stringify(existingContent) !== JSON.stringify(content);

        if (contentChanged) {
          await prisma.configuration.update({
            where: { id: existing.id },
            data: {
              type,
              content: content as never,
              isActive,
            },
          });
          report.updated++;
        } else {
          report.skipped++;
        }
      } else {
        await prisma.configuration.create({
          data: {
            type,
            name,
            content: content as never,
            isActive,
          },
        });
        report.imported++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.errors.push(
        `Failed to import configuration "${config.name}": ${message}`,
      );
    }
  }
}

// ─── Import Templates ────────────────────────────────────

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

  for (const item of templates) {
    if (!item || typeof item !== 'object') {
      report.errors.push('Invalid template entry: expected an object');
      continue;
    }

    const tmpl = item as Record<string, unknown>;

    // Validate required fields
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

    try {
      const name = tmpl.name as string;
      const protocol = tmpl.protocol as string;
      const content = tmpl.content as Record<string, unknown>;
      const description = (tmpl.description as string) || '';
      const serviceType = tmpl.serviceType as string | undefined;

      // Check for existing template with same name
      const existing = await prisma.configTemplate.findFirst({
        where: { name },
      });

      if (existing) {
        if (existing.isBuiltIn) {
          // Never overwrite built-in templates
          report.skipped++;
        } else {
          const existingContent = existing.content as Record<string, unknown>;
          const contentChanged =
            JSON.stringify(existingContent) !== JSON.stringify(content);

          if (contentChanged) {
            await prisma.configTemplate.update({
              where: { id: existing.id },
              data: {
                protocol,
                content: content as never,
                description,
                ...(serviceType && {
                  serviceType: serviceType as 'AWG' | 'THREE_XUI',
                }),
              },
            });
            report.updated++;
          } else {
            report.skipped++;
          }
        }
      } else {
        await prisma.configTemplate.create({
          data: {
            name,
            protocol,
            content: content as never,
            description,
            serviceType: serviceType
              ? (serviceType as 'AWG' | 'THREE_XUI')
              : null,
            isBuiltIn: false,
          },
        });
        report.imported++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.errors.push(
        `Failed to import template "${tmpl.name}": ${message}`,
      );
    }
  }
}
