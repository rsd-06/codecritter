import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * SEO plugin: the single source of truth for the public site URL.
 *  - replaces %SITE_URL% (no trailing slash), %VERSION% (root package.json) and %FILE_SIZE% in every HTML page
 *  - builds the FAQPage JSON-LD (%FAQ_JSONLD%) FROM the visible `<details class="faq-item">` markup, so the
 *    structured data can never drift from the text people read
 *  - emits robots.txt and sitemap.xml (lastmod = build date)
 * Switch domains: set SITE_URL (e.g. https://codecritter.app) in the Vercel project env and redeploy.
 */
const DEFAULT_SITE_URL = 'https://codecritter.vercel.app';
const WINDOWS_INSTALLER_SIZE = '2.1 MB'; // CodeCritter_<ver>_x64-setup.exe of the latest release (2,237,286 bytes in v0.2.1)
const SITEMAP_PATHS = ['/', '/download'];

const decode = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
const plain = (html: string): string => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

function faqJsonLd(html: string): string {
  const items = [...html.matchAll(/<details class="faq-item">\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g)];
  return JSON.stringify({
    '@type': 'FAQPage',
    mainEntity: items.map((m) => ({
      '@type': 'Question',
      name: plain(m[1]!),
      acceptedAnswer: { '@type': 'Answer', text: plain(m[2]!) },
    })),
  });
}

function seo(): Plugin {
  const siteUrl = (process.env.SITE_URL || DEFAULT_SITE_URL).trim().replace(/\/+$/, '');
  const version = (JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as { version: string }).version;
  const today = new Date().toISOString().slice(0, 10);
  return {
    name: 'codecritter-seo',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const withFaq = html.replace('%FAQ_JSONLD%', () => faqJsonLd(html));
        return withFaq
          .replaceAll('%SITE_URL%', siteUrl)
          .replaceAll('%VERSION%', version)
          .replaceAll('%FILE_SIZE%', WINDOWS_INSTALLER_SIZE);
      },
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`,
      });
      const urls = SITEMAP_PATHS.map(
        (p) => `  <url>\n    <loc>${siteUrl}${p === '/' ? '/' : p}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`,
      ).join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
    },
  };
}

// The page imports the real overlay engine from ../src (not copied), so the dev server must be
// allowed to read the repo root and `@shared` must resolve like it does in the app.
export default defineConfig({
  root: __dirname,
  base: '/',
  plugins: [seo()],
  resolve: { alias: { '@shared': resolve(__dirname, '../src/shared') } },
  server: { port: 5180, fs: { allow: [resolve(__dirname, '..')] } },
  preview: { port: 5181 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    // pages: / , /download (vercel cleanUrls serves download.html at /download) and the 404 page
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        download: resolve(__dirname, 'download.html'),
        notfound: resolve(__dirname, '404.html'),
      },
    },
  },
});
