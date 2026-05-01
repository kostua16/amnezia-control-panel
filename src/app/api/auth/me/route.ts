import { NextRequest, NextResponse } from 'next/server';
import { decodeJwt } from 'jose';

export async function GET(request: NextRequest) {
  const token = request.cookies.get('auth-token')?.value;

  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    // Middleware already verified the JWT; decode to extract user info
    const payload = decodeJwt(token);
    return NextResponse.json({
      user: {
        id: payload.userId as string,
        username: payload.username as string,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
}
