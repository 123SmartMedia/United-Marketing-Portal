import { NextResponse } from 'next/server';
import { getTurnstileClientConfig } from '@/lib/turnstileClientConfig';

export const dynamic = 'force-dynamic';

/**
 * Public Turnstile widget config for forms that render on static/ISR pages
 * (e.g. the inline RequestForm), which cannot receive a request-time server prop.
 * The site key is public by design; the secret key is never read here.
 */
export function GET() {
  return NextResponse.json(getTurnstileClientConfig(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
