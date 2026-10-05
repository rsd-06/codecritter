/* global process, console, Buffer, window */
// Renders the landing-site feature clips: runs tools/clips/capture.ts (the real overlay engine on a
// manual clock) in a headless Chromium via Playwright, grabs every frame as PNG, then encodes seamless
// loops with ffmpeg: WebM (VP9) + MP4 (H.264, yuv420p, faststart) + a WebP poster per clip.
//
//   npm run site:clips                 all clips
//   npm run site:clips -- eye-follow   only these ids
//   FRAMES_ONLY=1 npm run site:clips   keep PNG frames only (for visual checks), no encoding
//
// Needs ffmpeg on PATH and a Chromium-family browser (CHROME_PATH, else system Chrome/Edge).
// Output: site/public/media/clips/<id>.{webm,mp4,webp}. Frames: <tmp>/codecritter-clips/<id>/.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const outDir = join(root, 'site/public/media/clips');
const framesRoot = join(tmpdir(), 'codecritter-clips');
const MAX_BYTES = 350 * 1024;
const framesOnly = !!process.env.FRAMES_ONLY;
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

function findBrowser() {
  const cands = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const found = cands.find((c) => c && existsSync(c));
  if (!found) throw new Error('No Chrome/Edge found. Set CHROME_PATH.');
  return found;
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr || r.error}`);
}

/** Encode with rising CRF until the file fits the budget. */
function encode(label, out, make, start, step, max) {
  let crf = start;
  for (;;) {
    make(crf);
    const size = statSync(out).size;
    if (size <= MAX_BYTES || crf >= max) return { size, crf };
    crf += step;
  }
}

mkdirSync(outDir, { recursive: true });
const server = await createServer({
  configFile: false,
  root: here,
  logLevel: 'error',
  resolve: { alias: { '@shared': resolve(root, 'src/shared') } },
  server: { host: '127.0.0.1', port: 5182, strictPort: true, fs: { allow: [root] } },
});
await server.listen();
const browser = await chromium.launch({ executablePath: findBrowser(), headless: true, args: ['--force-device-scale-factor=1'] });
const report = [];
try {
  const page = await browser.newPage({ viewport: { width: 700, height: 700 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
  await page.goto('http://127.0.0.1:5182/capture.html');
  await page.waitForFunction(() => window.clips);
  const list = await page.evaluate(() => window.clips.list());
  for (const clip of list) {
    if (only.length && !only.includes(clip.id)) continue;
    const dir = join(framesRoot, clip.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    await page.evaluate((id) => window.clips.begin(id), clip.id);
    for (let i = 0; i < clip.frames; i++) {
      const b64 = await page.evaluate(() => window.clips.next());
      writeFileSync(join(dir, `f${String(i).padStart(4, '0')}.png`), Buffer.from(b64, 'base64'));
    }
    console.log(`${clip.id}: ${clip.frames} frames -> ${dir}`);
    if (framesOnly) continue;

    const input = ['-framerate', String(clip.fps), '-i', join(dir, 'f%04d.png')];
    const webm = join(outDir, `${clip.id}.webm`);
    const mp4 = join(outDir, `${clip.id}.mp4`);
    const w = encode(
      'webm',
      webm,
      (crf) =>
        ffmpeg([...input, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-deadline', 'good', '-cpu-used', '1', '-row-mt', '1', '-g', '240', '-an', webm]),
      22,
      2,
      44,
    );
    const m = encode(
      'mp4',
      mp4,
      (crf) =>
        ffmpeg([...input, '-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'animation', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-g', '240', '-movflags', '+faststart', '-an', mp4]),
      14,
      2,
      40,
    );
    // poster: a representative frame (not frame 0, which is usually a calm idle)
    ffmpeg(['-i', join(dir, `f${String(clip.poster).padStart(4, '0')}.png`), '-c:v', 'libwebp', '-quality', '80', join(outDir, `${clip.id}.webp`)]);
    const poster = statSync(join(outDir, `${clip.id}.webp`)).size;
    report.push({ id: clip.id, secs: (clip.frames / clip.fps).toFixed(1), webm: w.size, mp4: m.size, poster });
    console.log(`  webm ${(w.size / 1024).toFixed(0)} KB (crf ${w.crf}) | mp4 ${(m.size / 1024).toFixed(0)} KB (crf ${m.crf}) | poster ${(poster / 1024).toFixed(0)} KB`);
  }
} finally {
  await browser.close();
  await server.close();
}
if (report.length) {
  const total = report.reduce((a, r) => a + r.webm + r.mp4 + r.poster, 0);
  console.log(`total media: ${(total / 1024).toFixed(0)} KB (webm+mp4+posters, all clips)`);
}
