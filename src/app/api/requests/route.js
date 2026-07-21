import { NextResponse } from 'next/server';
import { deliverSubmission } from '@/lib/submissions';

export const runtime = 'nodejs';

const MAX_LEN = 5000;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  // Honeypot: bots fill hidden fields. Silently accept, don't deliver.
  if (body.company) {
    return NextResponse.json({ ok: true });
  }

  const submission = {
    requestType: clip(body.requestType) || 'Custom Request',
    name: clip(body.name),
    email: clip(body.email),
    phone: clip(body.phone),
    nmls: clip(body.nmls),
    asset: clip(body.asset),
    details: clip(body.details),
  };

  if (!submission.name || !submission.email) {
    return NextResponse.json({ ok: false, error: 'missing_required' }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(submission.email)) {
    return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 });
  }

  const result = await deliverSubmission(submission);
  if (!result.delivered) {
    return NextResponse.json({ ok: false, error: 'delivery_failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

function clip(v) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, MAX_LEN);
}
