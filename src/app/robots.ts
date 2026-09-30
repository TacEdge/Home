import type { MetadataRoute } from 'next';

// HOME is private. Nothing is for crawlers.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
