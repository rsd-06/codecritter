// Download page: detects the visitor's OS, then resolves the exact release asset names/sizes from the
// GitHub API (names contain the version) and points every button at the stable
// releases/latest/download/<name> URL. Without the API the buttons keep their static releases/latest link.
import './style.css';
import { OS_NAMES, currentOs, type Os } from './os';

const REPO = 'rsd-06/codecritter';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const CACHE_KEY = 'codecritter-latest-release';
const CACHE_MS = 10 * 60 * 1000;

interface Asset {
  name: string;
  size: number;
}
interface Release {
  tag_name: string;
  published_at?: string;
  assets: Asset[];
}

/** which release file each button wants (the .sig files end differently, so `$` anchors keep them out) */
const MATCH: Record<string, RegExp> = {
  'win-exe': /_x64-setup\.exe$/i,
  'win-msi': /\.msi$/i,
  'mac-dmg': /\.dmg$/i,
  'mac-tar': /\.app\.tar\.gz$/i,
  'linux-appimage': /\.AppImage$/i,
  'linux-deb': /\.deb$/i,
};

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document): T => root.querySelector(sel) as T;

const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;

function applyOs(os: Os): void {
  const detect = $('#dl-detect');
  const grid = $('#dl-grid');
  if (os === 'windows' || os === 'macos' || os === 'linux') {
    detect.textContent = `We detected ${OS_NAMES[os]}.`;
    const card = $(`#os-${os}`);
    card.classList.add('detected');
    $('.os-tag.you', card).hidden = false;
    grid.prepend(card); // detected system first
  } else if (os === 'mobile') {
    detect.textContent = 'All systems are listed below.';
    $('#dl-mobile').hidden = false;
  } else {
    detect.textContent = 'Pick your system below.';
  }
}

async function loadRelease(): Promise<Release> {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      const c = JSON.parse(raw) as { at: number; data: Release };
      if (Date.now() - c.at < CACHE_MS) return c.data;
    }
  } catch {
    /* storage unavailable */
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' }, signal: ctl.signal });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = (await res.json()) as Release;
    if (!Array.isArray(data.assets) || !data.assets.length) throw new Error('no assets');
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: { tag_name: data.tag_name, published_at: data.published_at, assets: data.assets.map((a) => ({ name: a.name, size: a.size })) } }));
    } catch {
      /* ignore */
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function applyRelease(rel: Release): void {
  const version = rel.tag_name.replace(/^v/i, '');
  const when = rel.published_at ? new Date(rel.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const v = $('#dl-version');
  v.textContent = `Latest version ${version}${when ? `, released ${when}` : ''}.`;
  document.querySelectorAll<HTMLAnchorElement>('[data-asset]').forEach((a) => {
    const asset = rel.assets.find((x) => MATCH[a.dataset.asset!]!.test(x.name));
    if (!asset) return; // keeps the releases-page link
    a.href = `https://github.com/${REPO}/releases/latest/download/${encodeURIComponent(asset.name)}`;
    a.removeAttribute('rel');
    $('[data-file]', a).textContent = asset.name;
    $('[data-size]', a).textContent = `${mb(asset.size)}, v${version}`;
  });
}

applyOs(currentOs());

loadRelease().then(applyRelease, () => {
  $('#dl-fallback').hidden = false;
  $('#dl-version').textContent = 'Latest version on GitHub.';
});
