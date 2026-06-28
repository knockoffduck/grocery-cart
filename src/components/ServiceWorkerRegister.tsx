"use client";

import { useEffect } from 'react';

// Register the service worker after window load so it never blocks
// the first paint. The browser will install the SW in the background;
// subsequent page loads benefit from the cached app shell.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return; // skip in dev to avoid stale SW during HMR

    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch((err) => console.warn('[sw] registration failed:', err));
    };
    if (document.readyState === 'complete') {
      onLoad();
    } else {
      window.addEventListener('load', onLoad, { once: true });
    }
  }, []);

  return null;
}
