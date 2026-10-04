import { shell, type WebContents } from 'electron';

/** True for URLs of the app itself (packaged file:// pages or the electron-vite dev server). */
export function isAppUrl(url: string, devUrl = process.env['ELECTRON_RENDERER_URL']): boolean {
  if (url.startsWith('file://')) return true;
  return !!devUrl && url.startsWith(devUrl);
}

/**
 * External links open in the OS browser (https only); the window itself never navigates away
 * from the app. window.open() is always denied.
 */
export function lockNavigation(wc: WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
}
