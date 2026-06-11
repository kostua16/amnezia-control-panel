import { prisma } from '@/lib/prisma';

// ─── Built-in template definitions ─────────────────────

export interface TemplateRuleDef {
  name: string;
  matchType: 'country' | 'region' | 'special';
  countryCode?: string;
  region?: string;
  special?: 'domestic' | 'foreign';
  action: 'ALLOW' | 'BLOCK' | 'ROUTE';
  chainId?: number | null;
  priority: number;
}

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  category: 'geo' | 'ip' | 'domain' | 'bundle';
  rules: TemplateRuleDef[];
}

export const BUILTIN_GEO_TEMPLATES: TemplateDef[] = [
  {
    id: 'russia-direct',
    name: 'Russia Direct',
    description:
      'Route Russian traffic directly (bypass VPN). Block known Russian surveillance IPs.',
    category: 'geo',
    rules: [
      {
        name: 'Allow Russia domestic',
        matchType: 'country',
        countryCode: 'RU',
        action: 'ALLOW',
        priority: 10,
      },
      {
        name: 'Block RU surveillance',
        matchType: 'country',
        countryCode: 'RU',
        action: 'BLOCK',
        priority: 11,
      },
    ],
  },
  {
    id: 'eu-privacy',
    name: 'EU Privacy',
    description:
      'Route EU traffic through VPN for GDPR-aligned privacy. Direct all other traffic.',
    category: 'geo',
    rules: [
      {
        name: 'Route EU via VPN',
        matchType: 'region',
        region: 'Europe',
        action: 'ROUTE',
        priority: 10,
      },
      {
        name: 'Allow all other traffic',
        matchType: 'special',
        special: 'foreign',
        action: 'ALLOW',
        priority: 100,
      },
    ],
  },
  {
    id: 'full-tunnel',
    name: 'Full Tunnel',
    description:
      'Route all foreign traffic through VPN. Allow domestic traffic directly.',
    category: 'bundle',
    rules: [
      {
        name: 'Allow domestic traffic',
        matchType: 'special',
        special: 'domestic',
        action: 'ALLOW',
        priority: 0,
      },
      {
        name: 'Route foreign via VPN',
        matchType: 'special',
        special: 'foreign',
        action: 'ROUTE',
        priority: 100,
      },
    ],
  },
  {
    id: 'asia-pacific-vpn',
    name: 'Asia-Pacific VPN',
    description:
      'Route Asia-Pacific traffic through VPN for better connectivity. Direct everything else.',
    category: 'geo',
    rules: [
      {
        name: 'Route Asia-Pacific via VPN',
        matchType: 'region',
        region: 'Asia-Pacific',
        action: 'ROUTE',
        priority: 10,
      },
      {
        name: 'Allow all other traffic',
        matchType: 'special',
        special: 'foreign',
        action: 'ALLOW',
        priority: 100,
      },
    ],
  },
  {
    id: 'block-ads',
    name: 'Block Ad Networks',
    description:
      'Block traffic to known ad server countries. Allow everything else.',
    category: 'geo',
    rules: [
      {
        name: 'Block ad traffic',
        matchType: 'country',
        countryCode: 'US',
        action: 'BLOCK',
        priority: 5,
      },
      {
        name: 'Allow all traffic',
        matchType: 'special',
        special: 'foreign',
        action: 'ALLOW',
        priority: 100,
      },
    ],
  },
];

// ─── Seed built-in templates to DB ────────────────────

export async function seedTemplates(): Promise<{
  seeded: number;
  skipped: number;
}> {
  let seeded = 0;
  let skipped = 0;

  for (const tmpl of BUILTIN_GEO_TEMPLATES) {
    const existing = await prisma.routingRuleTemplate.findFirst({
      where: { name: tmpl.name, isBuiltIn: true },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.routingRuleTemplate.create({
      data: {
        name: tmpl.name,
        description: tmpl.description,
        category: tmpl.category,
        ruleCount: tmpl.rules.length,
        isBuiltIn: true,
        rules:
          tmpl.rules as unknown as import('@/generated/prisma/internal/prismaNamespace').InputJsonValue,
      },
    });
    seeded++;
  }

  return { seeded, skipped };
}

// ─── Apply template rules to geo routing ──────────────

export interface ApplyTemplateResult {
  created: number;
  skipped: number;
  errors: string[];
}

/**
 * Apply a template's rules as geo-routing rules.
 * Per D-09: template rules get source='template'.
 * Per D-10: if a rule with the same name+matchType+countryCode already exists, skip it.
 */
export async function applyTemplateRules(
  templateId: number,
): Promise<ApplyTemplateResult> {
  const template = await prisma.routingRuleTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    return { created: 0, skipped: 0, errors: ['Template not found'] };
  }

  const rules = template.rules as unknown as TemplateRuleDef[];
  const result: ApplyTemplateResult = { created: 0, skipped: 0, errors: [] };

  for (const ruleDef of rules) {
    try {
      const where: Record<string, unknown> = {
        name: ruleDef.name,
        matchType: ruleDef.matchType,
      };
      if (ruleDef.countryCode) where.countryCode = ruleDef.countryCode;
      if (ruleDef.region) where.region = ruleDef.region;
      if (ruleDef.special) where.special = ruleDef.special;

      const existing = await prisma.geoRoutingRule.findFirst({ where });
      if (existing) {
        result.skipped++;
        continue;
      }

      await prisma.geoRoutingRule.create({
        data: {
          name: ruleDef.name,
          matchType: ruleDef.matchType,
          countryCode: ruleDef.countryCode ?? null,
          region: ruleDef.region ?? null,
          special: ruleDef.special ?? null,
          action: ruleDef.action,
          chainId: ruleDef.chainId ?? null,
          priority: ruleDef.priority,
          isActive: true,
          source: 'template',
        },
      });
      result.created++;
    } catch (err) {
      result.errors.push(
        `Failed to create rule "${ruleDef.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}

// ─── Import from v2fly/geoip.dat ──────────────────────

export interface ImportResult {
  imported: number;
  collisions: number;
  skipped: string[];
  errors: string[];
}

/**
 * Parse a v2fly geoip.dat file and import country entries as geo-routing rules.
 *
 * Per D-09: imported rules get source='imported'. Custom rules (source='custom')
 * are never touched.
 * Per D-10: if an imported rule collides with an existing imported rule on the same
 * countryCode, overwrite it (with confirmation from the UI).
 * Per D-12: best-effort parse -- skip unsupported entries, surface errors.
 *
 */
export async function importFromGeoIPDat(
  overwriteCollisions: boolean = false,
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0,
    collisions: 0,
    skipped: [],
    errors: [],
  };

  try {
    const fs = await import('fs');
    const path = await import('path');
    const geoipPath = path.join(process.cwd(), 'data', 'geoip', 'geoip.dat');

    if (!fs.existsSync(geoipPath)) {
      result.errors.push('geoip.dat file not found');
      return result;
    }

    const buffer = fs.readFileSync(geoipPath);
    const countryCodes = extractCountryCodesFromDat(buffer);

    for (const countryCode of countryCodes) {
      try {
        const existing = await prisma.geoRoutingRule.findFirst({
          where: {
            matchType: 'country',
            countryCode: countryCode,
            source: 'imported',
          },
        });

        if (existing) {
          result.collisions++;
          if (overwriteCollisions) {
            await prisma.geoRoutingRule.update({
              where: { id: existing.id },
              data: {
                name: `Imported: ${countryCode}`,
                priority: existing.priority,
                updatedAt: new Date(),
              },
            });
            result.imported++;
          }
          continue;
        }

        const customExists = await prisma.geoRoutingRule.findFirst({
          where: {
            matchType: 'country',
            countryCode: countryCode,
            source: 'custom',
          },
        });

        if (customExists) {
          result.skipped.push(`${countryCode} (custom rule exists)`);
          continue;
        }

        await prisma.geoRoutingRule.create({
          data: {
            name: `Imported: ${countryCode}`,
            matchType: 'country',
            countryCode: countryCode,
            action: 'ALLOW',
            priority: 500,
            isActive: true,
            source: 'imported',
          },
        });
        result.imported++;
      } catch (err) {
        result.errors.push(
          `Failed to import ${countryCode}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    result.errors.push(
      `Import failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return result;
}

// ─── Import from sendmiche/rulite ──────────────────────

/**
 * Parse sendmiche/rulite files and import country entries as geo-routing rules.
 *
 * The current rulite repository ships a v2fly-compatible geoip.dat, while older
 * community list snapshots may be plain text files with country sections and CIDR
 * lines. This importer accepts both from data/geoip/rulite/ and imports only
 * two-letter country geoip codes; service/category lists are skipped.
 *
 * Per D-09: imported rules get source='imported'. Custom rules (source='custom')
 * are never touched.
 * Per D-10: if an imported rule collides with an existing imported rule on the same
 * countryCode, overwrite it when requested by the UI.
 * Per D-12: best-effort parse -- skip unsupported entries, surface errors.
 */
export async function importFromRulite(
  overwriteCollisions: boolean = false,
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0,
    collisions: 0,
    skipped: [],
    errors: [],
  };

  try {
    const fs = await import('fs');
    const path = await import('path');
    const rulitePath = path.join(process.cwd(), 'data', 'geoip', 'rulite');

    if (!fs.existsSync(rulitePath) || !fs.statSync(rulitePath).isDirectory()) {
      result.errors.push('rulite directory not found');
      return result;
    }

    const countryCodes = new Set<string>();
    const fileNames = fs.readdirSync(rulitePath);

    for (const fileName of fileNames) {
      const filePath = path.join(rulitePath, fileName);
      if (!fs.statSync(filePath).isFile()) continue;

      const extension = path.extname(fileName).toLowerCase();
      try {
        if (extension === '.dat') {
          for (const countryCode of extractCountryCodesFromDat(
            fs.readFileSync(filePath),
          )) {
            countryCodes.add(countryCode);
          }
          continue;
        }

        for (const countryCode of extractCountryCodesFromRuliteText(
          fs.readFileSync(filePath, 'utf-8'),
          path.basename(fileName, extension),
        )) {
          countryCodes.add(countryCode);
        }
      } catch (err) {
        result.errors.push(
          `Failed to parse rulite file "${fileName}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    for (const countryCode of Array.from(countryCodes).sort()) {
      try {
        const existing = await prisma.geoRoutingRule.findFirst({
          where: {
            matchType: 'country',
            countryCode: countryCode,
            source: 'imported',
          },
        });

        if (existing) {
          result.collisions++;
          if (overwriteCollisions) {
            await prisma.geoRoutingRule.update({
              where: { id: existing.id },
              data: {
                name: `Imported: ${countryCode}`,
                priority: existing.priority,
                updatedAt: new Date(),
              },
            });
            result.imported++;
          }
          continue;
        }

        const customExists = await prisma.geoRoutingRule.findFirst({
          where: {
            matchType: 'country',
            countryCode: countryCode,
            source: 'custom',
          },
        });

        if (customExists) {
          result.skipped.push(`${countryCode} (custom rule exists)`);
          continue;
        }

        await prisma.geoRoutingRule.create({
          data: {
            name: `Imported: ${countryCode}`,
            matchType: 'country',
            countryCode: countryCode,
            action: 'ALLOW',
            priority: 500,
            isActive: true,
            source: 'imported',
          },
        });
        result.imported++;
      } catch (err) {
        result.errors.push(
          `Failed to import ${countryCode}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    result.errors.push(
      `Import failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return result;
}

function extractCountryCodesFromRuliteText(
  text: string,
  fileStem: string,
): string[] {
  const codes = new Set<string>();
  const fileCode = normalizeCountryCode(fileStem);
  let currentSectionCode: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const sectionCode = extractRuliteSectionCode(line);
    if (sectionCode) {
      currentSectionCode = sectionCode;
      continue;
    }

    if (line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) {
      continue;
    }

    const code = normalizeCountryCode(line);
    if (code) {
      currentSectionCode = code;
      codes.add(code);
      continue;
    }

    if (isCidrLine(line)) {
      const countryCode = currentSectionCode ?? fileCode;
      if (countryCode) codes.add(countryCode);
    }
  }

  return Array.from(codes);
}

function extractRuliteSectionCode(line: string): string | null {
  const normalized = line
    .replace(/^[#;/\s\[]+/, '')
    .replace(/[\]\s:=-].*$/, '');
  const geoipPrefixMatch = line.match(/geoip:([a-z]{2})(?:\b|[^a-z-])/i);
  return normalizeCountryCode(geoipPrefixMatch?.[1] ?? normalized);
}

function normalizeCountryCode(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^[a-z]{2}$/i.test(trimmed) ? trimmed.toUpperCase() : null;
}

function isCidrLine(line: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}(?:\s|$)/.test(line);
}

// ─── Protobuf helpers for v2fly geoip.dat ─────────────

function extractCountryCodesFromDat(buffer: Buffer): string[] {
  const codes: string[] = [];

  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;
    offset += varintSize(buffer, offset);

    if (fieldNumber === 1 && wireType === 2) {
      const length = readVarint(buffer, offset);
      offset += varintSize(buffer, offset);
      const countryData = buffer.subarray(offset, offset + length);
      offset += length;

      const code = extractIsoCode(countryData);
      if (code && code.length === 2) codes.push(code.toUpperCase());
    } else if (wireType === 2) {
      const length = readVarint(buffer, offset);
      offset += varintSize(buffer, offset) + length;
    } else if (wireType === 0) {
      offset += varintSize(buffer, offset);
    } else {
      break;
    }
  }

  return codes;
}

function extractIsoCode(buffer: Buffer): string | null {
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;
    offset += varintSize(buffer, offset);

    if (fieldNumber === 1 && wireType === 2) {
      const length = readVarint(buffer, offset);
      offset += varintSize(buffer, offset);
      return buffer.subarray(offset, offset + length).toString('utf-8');
    } else if (wireType === 2) {
      const length = readVarint(buffer, offset);
      offset += varintSize(buffer, offset) + length;
    } else if (wireType === 0) {
      offset += varintSize(buffer, offset);
    } else {
      break;
    }
  }
  return null;
}

function readVarint(buffer: Buffer, offset: number): number {
  let result = 0;
  let shift = 0;
  while (offset < buffer.length) {
    const byte = buffer[offset];
    result |= (byte & 0x7f) << shift;
    offset++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift >= 70) break;
  }
  return result >>> 0;
}

function varintSize(buffer: Buffer, offset: number): number {
  let size = 0;
  while (offset + size < buffer.length) {
    size++;
    if ((buffer[offset + size - 1] & 0x80) === 0) break;
    if (size >= 10) break;
  }
  return Math.max(size, 1);
}
