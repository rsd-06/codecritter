// Visitor OS detection shared by the landing page and the download page.
export type Os = 'windows' | 'macos' | 'linux' | 'mobile' | 'unknown';

function detectOs(ua: string, platform: string, touchPoints: number): Os {
  const u = ua.toLowerCase();
  const p = platform.toLowerCase();
  if (/android|iphone|ipad|ipod/.test(u)) return 'mobile';
  // iPadOS reports a Mac platform; real Macs have no touch screen
  if (p.includes('mac') && touchPoints > 1) return 'mobile';
  if (p.includes('win') || u.includes('windows')) return 'windows';
  if (p.includes('mac') || u.includes('mac os') || u.includes('macintosh')) return 'macos';
  if (p.includes('linux') || u.includes('linux') || u.includes('x11') || u.includes('cros')) return 'linux';
  return 'unknown';
}

export function currentOs(): Os {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return detectOs(navigator.userAgent, nav.userAgentData?.platform ?? navigator.platform ?? '', navigator.maxTouchPoints ?? 0);
}

export const OS_NAMES: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
