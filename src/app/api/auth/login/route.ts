import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { seedAdmin } from '@/lib/seed';
import { verifyValue } from '@/lib/password';
import { createSessionToken, SESSION_MAX_AGE } from '@/lib/auth-jwt';

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: NextRequest) {
  try {
    await seedAdmin();

    const body = await request.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation error',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 422 },
      );
    }

    const { username, password } = parsed.data;

    const admin = await prisma.admin.findUnique({
      where: { username },
    });

    if (!admin) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 },
      );
    }

    const isValid = await verifyValue(password, admin.password);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 },
      );
    }

    const token = await createSessionToken({
      userId: admin.id,
      username: admin.username,
    });

    const response = NextResponse.json({
      user: {
        id: admin.id,
        username: admin.username,
      },
    });

    response.cookies.set('auth-token', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    });

    return response;
  } catch (error) {
    console.error('[auth/login] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
