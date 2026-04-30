import { NextResponse } from 'next/server';

// ─── GET /api/panels/push/status ─────────────────────

/**
 * Polling fallback for push progress.
 * Returns empty events array since push progress is ephemeral
 * and delivered via WebSocket as the primary channel.
 * The existing polling code in push-wizard.tsx already handles
 * { events: [] } gracefully (iterates and updates nothing).
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    data: { events: [] },
  });
}
