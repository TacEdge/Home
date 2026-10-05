import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import './globals.css';

export const metadata: Metadata = {
  title: 'HOME',
  description: 'A private family operating system.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f4ee' },
    { media: '(prefers-color-scheme: dark)', color: '#161d1b' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page renders per request, so Next.js can put this request's CSP
  // nonce on its scripts (src/proxy.ts). A page prerendered at build time
  // would carry no nonce and its scripts would be refused.
  await connection();
  return (
    <html lang="en-NZ" className="h-full">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
