/**
 * Submission delivery abstraction.
 * -------------------------------
 * Every request form on the site posts to /api/requests, which calls
 * deliverSubmission(). Today that delivers an email to the marketing desk
 * (matching the current site's behavior). The abstraction exists so Phase 2 can
 * ALSO route the same submission to Total Expert / a CRM — add a channel here,
 * and every form gains the new destination with zero form changes.
 *
 * Email is sent through SendGrid's REST API (no SDK dependency). If
 * SENDGRID_API_KEY is not configured (e.g. local dev), the submission is logged
 * and reported as "logged" so the UX can still be exercised end-to-end.
 *
 * The FROM address must be a verified sender / authenticated domain in SendGrid.
 */

const REQUEST_EMAIL = process.env.REQUEST_EMAIL || 'marketing@unitedmortgage.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'United Marketing Desk <marketing@unitedmortgage.com>';

// Parse a "Display Name <email@x.com>" string into { email, name }.
function parseFrom(value) {
  const m = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || undefined, email: m[2] };
  return { email: value.trim() };
}

export async function deliverSubmission(submission) {
  const channels = [];

  // Channel 1: notify the marketing desk. This is the delivery that must succeed.
  const desk = await sendEmail(submission);
  channels.push(desk);

  // Channel 2: auto-acknowledge the submitter (best-effort — never blocks the
  // request; a failed ack still leaves the desk notified).
  if (submission.email) {
    channels.push(await sendAck(submission));
  }

  // Channel 3 (Phase 2 placeholder): post to Total Expert / CRM.
  // if (process.env.TOTAL_EXPERT_API_KEY) channels.push(await sendToTotalExpert(submission));

  // "delivered" is gated on the desk notification, not the courtesy ack.
  return { delivered: desk.ok, channels };
}

/**
 * Low-level SendGrid send. Returns {ok, mode|error}. When SENDGRID_API_KEY is
 * unset (local/dev) it logs and reports mode:'logged' so flows still work.
 */
async function sendViaSendGrid({ to, toName, subject, html, replyTo }, label) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) {
    console.log(`\n[submission] SENDGRID_API_KEY not set — logging ${label} instead of sending:`);
    console.log(JSON.stringify({ to, subject }, null, 2));
    return { channel: label, ok: true, mode: 'logged' };
  }
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to, name: toName }] }],
        from: parseFrom(FROM_EMAIL),
        reply_to: replyTo,
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    });
    if (res.status !== 202) {
      const text = await res.text();
      console.error(`[submission] SendGrid error (${label}):`, res.status, text);
      return { channel: label, ok: false, error: `sendgrid_${res.status}` };
    }
    return { channel: label, ok: true, mode: 'sent' };
  } catch (err) {
    console.error(`[submission] SendGrid request failed (${label}):`, err);
    return { channel: label, ok: false, error: 'network' };
  }
}

// Desk notification → marketing@, reply-to the submitter.
function sendEmail(submission) {
  const rush = submission.rush ? ' · RUSH' : '';
  return sendViaSendGrid(
    {
      to: REQUEST_EMAIL,
      subject: `[Marketing Desk] ${submission.requestType} — ${submission.name}${rush}`,
      html: renderEmail(submission),
      replyTo: submission.email ? { email: submission.email, name: submission.name } : undefined,
    },
    'desk-email'
  );
}

// Courtesy acknowledgment → the submitter, reply-to the marketing desk.
function sendAck(submission) {
  return sendViaSendGrid(
    {
      to: submission.email,
      toName: submission.name,
      subject: 'We’ve received your marketing request',
      html: renderAck(submission),
      replyTo: { email: REQUEST_EMAIL, name: 'United Marketing Desk' },
    },
    'ack-email'
  );
}

function esc(s = '') {
  return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

// Auto-acknowledgment sent to the person who submitted the request.
function renderAck(s) {
  const firstName = (s.name || '').trim().split(/\s+/)[0] || 'there';
  const summary = [
    ['Request', s.requestType],
    ['Project', s.projectTitle],
    ['Needed by', s.dateNeeded],
  ]
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px;color:#5478ac;font-weight:600;width:110px">${esc(k)}</td><td style="padding:4px 12px;color:#24395c">${esc(v)}</td></tr>`
    )
    .join('');

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#24395c;line-height:1.5">
    <div style="background:#14213d;padding:20px 24px;border-radius:10px 10px 0 0">
      <span style="color:#ffffff;font-weight:800;font-size:18px;letter-spacing:.02em">UNITED</span>
      <span style="color:#a3c8ec;font-weight:600;font-size:11px;letter-spacing:.3em">&nbsp;MORTGAGE&nbsp;CORP</span>
    </div>
    <div style="border:1px solid #eef2f8;border-top:0;border-radius:0 0 10px 10px;padding:24px">
      <h2 style="margin:0 0 8px;color:#14213d;font-size:19px">Thanks, ${esc(firstName)} — we’ve got your request.</h2>
      <p style="margin:0 0 16px">
        The United Mortgage marketing team has received your request and we’re on it.
        We’ll reach out directly if we have any questions or need anything else from you.
      </p>
      ${summary ? `<table style="border-collapse:collapse;background:#f7f9fc;border-radius:8px;margin:0 0 16px">${summary}</table>` : ''}
      <p style="margin:0 0 4px">Questions in the meantime? Just reply to this email or reach us at:</p>
      <p style="margin:0 0 20px">
        <a href="mailto:marketing@unitedmortgage.com" style="color:#2e6db4">marketing@unitedmortgage.com</a>
        &nbsp;·&nbsp; <a href="tel:6312037480" style="color:#2e6db4">631-203-7480</a>
      </p>
      <p style="margin:0;color:#5478ac;font-size:13px">— The United Marketing Desk</p>
    </div>
    <p style="color:#7e9bc6;font-size:11px;margin:12px 4px 0">
      This is an automated confirmation from marketing.unitedmortgage.com. Please don’t share it externally.
    </p>
  </div>`;
}

function renderEmail(s) {
  // Grouped so empty sections are omitted entirely.
  const sections = [
    {
      title: null,
      fields: [
        ['Request type', s.requestType],
        ['Rush?', s.rush ? 'YES — needed in under 7 business days' : ''],
        ['Date needed by', s.dateNeeded],
      ],
    },
    {
      title: 'Contact',
      fields: [
        ['Name', s.name],
        ['Email', s.email],
        ['Phone', s.phone],
        ['NMLS ID', s.nmls],
        ['Branch / office', s.branch],
        ['Related asset', s.asset],
      ],
    },
    {
      title: 'Print details',
      fields: [
        ['Printing needed', s.printingNeeded],
        ['Estimated quantity', s.quantity],
        ['Size / format', s.size],
        ['Finish / paper', s.finish],
      ],
    },
    {
      title: 'Co-branding',
      fields: [
        ['Co-branding', s.cobrand],
        ['Partner company', s.partnerName],
        ['Compliance confirmed', s.complianceApproved ? 'Yes' : ''],
      ],
    },
    {
      title: 'Creative',
      fields: [
        ['Project title', s.projectTitle],
        ['Key message / CTA', s.keyMessage],
        ['Additional details', s.additionalDetails],
        ['Details', s.details],
      ],
    },
  ];

  const rowCell = (k, v) =>
    `<tr><td style="padding:6px 12px;font-weight:600;color:#14213d;vertical-align:top;width:150px">${esc(
      k
    )}</td><td style="padding:6px 12px;color:#24395c">${esc(v).replace(/\n/g, '<br>')}</td></tr>`;
  const headerCell = (t) =>
    `<tr><td colspan="2" style="padding:12px 12px 4px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#5478ac">${esc(t)}</td></tr>`;

  const rows = sections
    .map((sec) => {
      const present = sec.fields.filter(([, v]) => v);
      if (!present.length) return '';
      return (sec.title ? headerCell(sec.title) : '') + present.map(([k, v]) => rowCell(k, v)).join('');
    })
    .join('');

  const files = Array.isArray(s.files) ? s.files : [];
  const filesBlock = files.length
    ? `<div style="margin-top:16px">
        <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#5478ac;margin:0 0 6px">Attachments (${files.length})</p>
        <ul style="margin:0;padding-left:18px;color:#2e6db4">${files
          .map((f) => `<li style="margin:2px 0"><a href="${esc(f.url)}" style="color:#2e6db4">${esc(f.name)}</a> <span style="color:#7e9bc6">(${Math.round((f.size || 0) / 1024)} KB)</span></li>`)
          .join('')}</ul>
       </div>`
    : '';

  return `
  <div style="font-family:Arial,sans-serif;max-width:640px">
    <h2 style="color:#14213d;margin:0 0 4px">New marketing request${s.rush ? ' · <span style="color:#c0392b">RUSH</span>' : ''}</h2>
    <p style="color:#5478ac;margin:0 0 14px">Submitted via marketing.unitedmortgage.com</p>
    <table style="border-collapse:collapse;width:100%;background:#f7f9fc;border-radius:8px">${rows}</table>
    ${filesBlock}
  </div>`;
}
