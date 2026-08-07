import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  readBody,
  BodySizeLimitError,
  bodySizeLimitResponse,
} from '@/lib/parse-body';
import { prisma } from '@/lib/prisma';
import { seedAdmin } from '@/lib/seed';
import { verifyValue } from '@/lib/password';
import { createSessionToken, SESSION_MAX_AGE } from '@/lib/auth-jwt';
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  getClientIp,
} from '@/lib/login-rate-limit';

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: NextRequest) {
  try {
    await seedAdmin();

    const body = JSON.parse(await readBody(request));
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

    const clientIp = getClientIp(request);
    const rateCheck = checkLoginRateLimit(clientIp);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(rateCheck.retryAfterMs / 1000)),
          },
        },
      );
    }

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

    clearLoginAttempts(clientIp);

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
    if (error instanceof BodySizeLimitError) {
      return bodySizeLimitResponse(error);
    }
    console.error('[auth/login] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
