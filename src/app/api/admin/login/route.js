import { NextResponse } from 'next/server';
import {
  ADMIN_COOKIE,
  COOKIE_OPTIONS,
  isAdminConfigured,
  verifyPassword,
  issueToken,
} from '@/lib/adminAuth';
import { checkRateLimit, clientIp, isSameOrigin } from '@/lib/rateLimit';

export const runtime = 'nodejs';

// Brute-force speed bump. Every attempt counts (not just failures), so a
// correct guess can't be used to reset the window.
const LOGIN_LIMIT = { windowMs: 15 * 60 * 1000, max: 5 };

export async function POST(request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: 'forbidden_origin' }, { status: 403 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: 'admin_not_configured' }, { status: 503 });
  }

  const limit = checkRateLimit(`admin-login:${clientIp(request)}`, LOGIN_LIMIT);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return NextResponse.json(
      {
        ok: false,
        error: 'rate_limited',
        message: `Too many sign-in attempts. Please wait about ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`,
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  if (!verifyPassword(body?.password)) {
    return NextResponse.json({ ok: false, error: 'invalid_password' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, issueToken(), COOKIE_OPTIONS);
  return res;
}

// Logout
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
