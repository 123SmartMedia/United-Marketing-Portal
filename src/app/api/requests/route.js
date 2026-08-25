import { NextResponse } from 'next/server';
import { deliverSubmission } from '@/lib/submissions';
import { requestSchema, simpleSchema } from '@/lib/requestSchema';

export const runtime = 'nodejs';

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

  // The multi-step wizard sends source:'wizard' → validate the full schema
  // (conditional requirements enforced server-side). The lightweight inline
  // forms send fewer fields → validate the lenient schema.
  const schema = body.source === 'wizard' ? requestSchema : simpleSchema;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'validation', issues: parsed.error.issues.map((i) => i.path.join('.')) },
      { status: 400 }
    );
  }

  const result = await deliverSubmission(parsed.data);
  if (!result.delivered) {
    return NextResponse.json({ ok: false, error: 'delivery_failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
