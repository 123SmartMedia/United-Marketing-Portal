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
        source: '/assets/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
