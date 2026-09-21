import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * RETIRED — this endpoint no longer issues upload URLs.
 * ------------------------------------------------------
 * It used to presign a PUT for any same-origin caller that asked, before any bot
 * check had run. That made the private bucket a free file host for anything that
 * could find the route: Turnstile was verified at submission time, long after the
 * bytes had already been written.
 *
 * Uploads now go through the two-stage flow, where a presigned PUT is only minted
 * after the honeypot, the rate limit, form and attachment validation, the
 * submitter allow-list and a redeemed Turnstile token have all passed:
 *
 *   POST /api/jira/requests/init      -> validates everything, then returns the
 *                                        presigned PUTs and a signed finalize token
 *   POST /api/jira/requests/finalize  -> verifies the token and the stored objects,
 *                                        creates the Jira request, attaches, cleans up
 *
 * The route is kept (rather than deleted) so a stale cached bundle gets an
 * explicit, actionable 410 instead of a confusing 404 that looks like an outage.
 *
 * NOTE: `/api/admin/upload-url` is a SEPARATE, authenticated endpoint used by the
 * admin CMS to publish public assets. It is unaffected by this change.
 */

const GONE = {
  ok: false,
  error: 'endpoint_retired',
  message:
    'This upload endpoint has been replaced. Please refresh the page and submit your request again.',
};

export async function POST() {
  return NextResponse.json(GONE, { status: 410 });
}

export async function GET() {
  return NextResponse.json(GONE, { status: 410 });
}
