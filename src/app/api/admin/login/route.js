import { NextResponse } from 'next/server';
import {
  ADMIN_COOKIE,
  COOKIE_OPTIONS,
  isAdminConfigured,
  verifyPassword,
  issueToken,
} from '@/lib/adminAuth';

export const runtime = 'nodejs';

export async function POST(request) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: 'admin_not_configured' }, { status: 503 });
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
