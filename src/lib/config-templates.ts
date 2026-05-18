import { prisma } from '@/lib/prisma';
import type { ServiceType } from '@/generated/prisma/enums';
import type {
  ConfigTemplate,
  ConfigTemplateCreate,
  ConfigTemplateUpdate,
} from '@/types/config';

// ─── CRUD Operations ────────────────────────────────────

export async function getTemplates(
  serviceType?: ServiceType,
  category?: string,
): Promise<ConfigTemplate[]> {
  const where: Record<string, unknown> = {};
  if (serviceType) where.serviceType = serviceType;
  if (category) where.category = category;
  const templates = await prisma.configTemplate.findMany({
    where,
    orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }],
  });

  return templates.map(mapTemplate);
}

export async function getTemplate(id: number): Promise<ConfigTemplate | null> {
  const template = await prisma.configTemplate.findUnique({ where: { id } });
  return template ? mapTemplate(template) : null;
}

export async function createTemplate(
  data: ConfigTemplateCreate,
): Promise<ConfigTemplate> {
  const template = await prisma.configTemplate.create({
    data: {
      name: data.name,
      serviceType: data.serviceType ?? null,
      protocol: data.protocol,
      content: data.content as never,
      description: data.description ?? '',
      isBuiltIn: false,
    },
  });

  return mapTemplate(template);
}

export async function updateTemplate(
  id: number,
  data: ConfigTemplateUpdate,
): Promise<ConfigTemplate> {
  const template = await prisma.configTemplate.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.serviceType !== undefined && { serviceType: data.serviceType }),
      ...(data.protocol !== undefined && { protocol: data.protocol }),
      ...(data.content !== undefined && { content: data.content as never }),
      ...(data.description !== undefined && { description: data.description }),
    },
  });

  return mapTemplate(template);
}

export async function deleteTemplate(id: number): Promise<void> {
  const template = await prisma.configTemplate.findUniqueOrThrow({
    where: { id },
  });

  if (template.isBuiltIn) {
    throw new Error('Cannot delete built-in templates');
  }

  await prisma.configTemplate.delete({ where: { id } });
}

// ─── Mapping ────────────────────────────────────────────

function mapTemplate(
  t: Awaited<ReturnType<typeof prisma.configTemplate.findUnique>>,
): ConfigTemplate {
  if (!t) throw new Error('Template not found');
  return {
    id: t.id,
    name: t.name,
    serviceType: t.serviceType as ServiceType | null,
    protocol: t.protocol,
    content: t.content as Record<string, unknown>,
    description: t.description,
    category: t.category,
    isBuiltIn: t.isBuiltIn,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
