// Google Analytics 4. Enabled only in production builds with VITE_GA_MEASUREMENT_ID set
// (e.g. `VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX npm run build`).
const id = import.meta.env.VITE_GA_MEASUREMENT_ID;
const enabled = import.meta.env.PROD && /^G-[A-Z0-9]+$/.test(id || '');

if (enabled) {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', id);
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(s);
}

export function track(event, params) {
  if (enabled) window.gtag('event', event, params);
}
