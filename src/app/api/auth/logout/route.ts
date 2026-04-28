import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ success: true });

  response.cookies.set('auth-token', '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    secure: process.env.NODE_ENV === 'production',
  });

  return response;
}
