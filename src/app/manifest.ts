import type { MetadataRoute } from 'next';

// Web App Manifest per the Next 16 PWA guide
// (node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md).
// The file lives at app/manifest.ts and Next.js emits a
// /manifest.webmanifest route automatically.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aldi Cart',
    short_name: 'Aldi Cart',
    description: 'Scan Aldi items in-store and track your shopping total',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#0019a5',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
