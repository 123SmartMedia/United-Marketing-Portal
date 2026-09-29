/**
 * Content-Security-Policy — REPORT-ONLY for now.
 * Browsers log violations to the console but block nothing, so a mistake here
 * cannot break Turnstile, R2 media/PDF previews or presigned uploads.
 *
 * To promote to enforcing: deploy, then exercise the site in a browser (home,
 * category + item pages with image/video/PDF previews, /custom-requests incl. a
 * file upload, /podcast-studio, /total-expert, /admin upload) with DevTools open.
 * When the console shows no "[Report Only] Refused to …" messages, change the
 * header key below from `Content-Security-Policy-Report-Only` to
 * `Content-Security-Policy` (and drop the separate frame-ancestors-only header).
 */
function assetOrigin() {
  const raw = (process.env.NEXT_PUBLIC_ASSET_BASE_URL || '').split(/[\r\n]+/)[0].trim();
  try {
    return raw ? new URL(raw).origin : '';
  } catch {
    return '';
  }
}

function contentSecurityPolicy() {
  const asset = assetOrigin();
  const turnstile = 'https://challenges.cloudflare.com';
  const r2Api = 'https://*.r2.cloudflarestorage.com'; // presigned PUTs from the browser
  // Next's dev server evaluates code with eval(); production does not.
  const devEval = process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'";
  const src = (...values) => values.filter(Boolean).join(' ');

  return [
    `default-src 'self'`,
    // 'unsafe-inline': Next's inline bootstrap scripts. Tighten with nonces
    // (middleware) before enforcing if stricter script control is wanted.
    `script-src 'self' 'unsafe-inline'${devEval} ${turnstile}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src ${src("'self'", 'data:', 'blob:', asset)}`,
    `media-src ${src("'self'", 'blob:', asset)}`,
    `object-src ${src("'self'", asset)}`, // PDF <object> previews
    `frame-src ${src("'self'", turnstile, asset)}`,
    `connect-src ${src("'self'", asset, r2Api, turnstile)}`,
    `font-src 'self' data:`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Assets (PDFs, images, videos) are served as static files from /public/assets,
  // which is a directory junction to ../UnitedMarketingDesk-Assets (see scripts/link-assets).
  images: {
    // The catalog references large source images directly; disable optimization so the
    // static export / dev server serves the originals without a build-time image pipeline.
    unoptimized: true,
  },
  async headers() {
    return [
      {
        // Baseline hardening for every response. No enforcing CSP yet: Turnstile,
        // R2-hosted media/PDF previews and Next's inline bootstrap scripts need a
        // policy verified in a browser first, and a wrong one would break forms.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy() },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        source: '/assets/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
