import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // The middleware verified the token and attached the decoded claims as
  // request headers, so identity is read from there instead of re-decoding the
  // JWT on every authenticated request.
  const userId = request.headers.get('x-user-id');
  const username = request.headers.get('x-user-name');

  if (!userId || !username) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  return NextResponse.json({ user: { id: userId, username } });
}
