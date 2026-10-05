import type { NextConfig } from 'next';

// Security headers (M1 contract §5.6). The Content-Security-Policy is set per
// request by src/proxy.ts, because its script nonce is new for every response
// (ADR 0003 §9, M4 Package 1).
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const nextConfig: NextConfig = {
  // Only for tests: lets a second dev server run from the same checkout
  // (Next allows one dev server per distDir). Unset in every real environment.
  distDir: process.env.HOME_NEXT_DIST_DIR ?? '.next',
  // `next dev` would otherwise append its own block to CLAUDE.md. That file is
  // HOME's operating instructions and is edited only deliberately.
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
