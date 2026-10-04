import type { OverlayBridge, SettingsBridge } from '../shared/types';

declare global {
  interface Window {
    /** Present in the overlay window (preload/overlay.ts); absent in the browser playground. */
    critter?: OverlayBridge;
    /** Present in the settings window (preload/settings.ts). */
    critterSettings?: SettingsBridge;
  }
}

export {};
