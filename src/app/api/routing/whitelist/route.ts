import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const whitelistTypeSchema = z.enum(['domain', 'ip', 'cidr']);

const createWhitelistSchema = z.object({
  type: whitelistTypeSchema,
  value: z.string().min(1, 'Value is required').max(500),
  description: z.string().max(200).optional(),
  serverId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().default(true),
});

// In-memory store for whitelist entries (replace with DB model in production)
const whitelistEntries: Array<{
  id: number;
  type: 'domain' | 'ip' | 'cidr';
  value: string;
  description?: string;
  serverId: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}> = [];

let nextId = 1;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const serverIdParam = searchParams.get('serverId');
    const serverId = serverIdParam ? Number(serverIdParam) : undefined;

    let entries = [...whitelistEntries];

    if (serverId !== undefined && !Number.isNaN(serverId)) {
      entries = entries.filter(
        (e) => e.serverId === serverId || e.serverId === null,
      );
    }

    return NextResponse.json({
      success: true,
      data: entries,
    });
  } catch (err) {
    console.error('[api/routing/whitelist] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch whitelist entries' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createWhitelistSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    // Basic validation based on type
    const { type, value } = parsed.data;
    if (type === 'ip') {
      // Simple IPv4/IPv6 check
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
      const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
      if (!ipv4Regex.test(value) && !ipv6Regex.test(value)) {
        return NextResponse.json(
          { success: false, error: 'Invalid IP address format' },
          { status: 422 },
        );
      }
    } else if (type === 'cidr') {
      const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,3}$/;
      if (!cidrRegex.test(value)) {
        return NextResponse.json(
          { success: false, error: 'Invalid CIDR format (expected e.g. 10.0.0.0/24)' },
          { status: 422 },
        );
      }
    } else if (type === 'domain') {
      const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\*?$/;
      if (!domainRegex.test(value)) {
        return NextResponse.json(
          { success: false, error: 'Invalid domain format' },
          { status: 422 },
        );
      }
    }

    const entry = {
      id: nextId++,
      ...parsed.data,
      serverId: parsed.data.serverId ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    whitelistEntries.push(entry);

    return NextResponse.json(
      { success: true, data: entry },
      { status: 201 },
    );
  } catch (err) {
    console.error('[api/routing/whitelist] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to create whitelist entry' },
      { status: 500 },
    );
  }
}
