// Vercel Web Analytics: cookieless page-view counts for the website only (the desktop app has no telemetry).
// The script is served by Vercel at /_vercel/insights; elsewhere (local preview) it is a no-op.
import { inject } from '@vercel/analytics';

inject({ mode: import.meta.env.PROD ? 'production' : 'development' });
