/**
 * Submission delivery abstraction.
 * -------------------------------
 * Every request form on the site posts to /api/requests, which calls
 * deliverSubmission(). Today that delivers an email to the marketing desk
 * (matching the current site's behavior). The abstraction exists so Phase 2 can
 * ALSO route the same submission to Total Expert / a CRM — add a channel here,
 * and every form gains the new destination with zero form changes.
 *
 * Email is sent through Resend's REST API (no SDK dependency). If RESEND_API_KEY
 * is not configured (e.g. local dev), the submission is logged and reported as
 * "logged" so the UX can still be exercised end-to-end.
 */

const REQUEST_EMAIL = process.env.REQUEST_EMAIL || 'marketing@unitedmortgage.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'United Marketing Desk <marketing@unitedmortgage.com>';

export async function deliverSubmission(submission) {
  const channels = [];

  // Channel 1: email the marketing desk.
  channels.push(await sendEmail(submission));

  // Channel 2 (Phase 2 placeholder): post to Total Expert / CRM.
  // if (process.env.TOTAL_EXPERT_API_KEY) channels.push(await sendToTotalExpert(submission));

  const delivered = channels.some((c) => c.ok);
  return { delivered, channels };
}

async function sendEmail(submission) {
  const key = process.env.RESEND_API_KEY;
  const subject = `[Marketing Desk] ${submission.requestType} — ${submission.name}`;
  const html = renderEmail(submission);

  if (!key) {
    console.log('\n[submission] RESEND_API_KEY not set — logging instead of sending:');
    console.log(JSON.stringify({ to: REQUEST_EMAIL, subject, submission }, null, 2));
    return { channel: 'email', ok: true, mode: 'logged' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [REQUEST_EMAIL],
        reply_to: submission.email,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[submission] Resend error:', res.status, text);
      return { channel: 'email', ok: false, error: `resend_${res.status}` };
    }
    return { channel: 'email', ok: true, mode: 'sent' };
  } catch (err) {
    console.error('[submission] Resend request failed:', err);
    return { channel: 'email', ok: false, error: 'network' };
  }
}

function esc(s = '') {
  return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

function renderEmail(s) {
  const rows = [
    ['Request type', s.requestType],
    ['Name', s.name],
    ['Email', s.email],
    ['Phone', s.phone],
    ['NMLS ID', s.nmls],
    ['Related asset', s.asset],
    ['Details', s.details],
  ]
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px;font-weight:600;color:#14213d;vertical-align:top">${esc(
          k
        )}</td><td style="padding:6px 12px;color:#24395c">${esc(v).replace(/\n/g, '<br>')}</td></tr>`
    )
    .join('');

  return `
  <div style="font-family:Arial,sans-serif;max-width:600px">
    <h2 style="color:#14213d">New marketing request</h2>
    <p style="color:#5478ac">Submitted via marketing.unitedmortgage.com</p>
    <table style="border-collapse:collapse;width:100%;background:#f7f9fc;border-radius:8px">${rows}</table>
  </div>`;
}
