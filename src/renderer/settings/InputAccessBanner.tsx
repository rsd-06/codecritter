import { useCallback, useEffect, useState } from 'react';
import type { InputAccess, SettingsBridge } from '@shared/types';

/** Whether the banner is shown: only when the OS reports that input access is missing. */
export function bannerVisible(state: InputAccess | null): boolean {
  return state === 'denied';
}

/**
 * macOS asks for Input Monitoring before an app may observe global keyboard/mouse activity. CodeCritter
 * only counts events, never which keys. Hidden everywhere the permission is not needed (and in the playground).
 */
export function InputAccessBanner(props: { bridge: SettingsBridge }) {
  const { bridge } = props;
  const [state, setState] = useState<InputAccess | null>(null);
  const refresh = useCallback(() => {
    bridge.inputAccess?.().then(setState, () => undefined);
  }, [bridge]);

  useEffect(() => {
    refresh();
    const off = bridge.onInputAccess?.(setState);
    window.addEventListener('focus', refresh); // coming back from System Settings
    return () => {
      off?.();
      window.removeEventListener('focus', refresh);
    };
  }, [bridge, refresh]);

  if (!bannerVisible(state)) return null;
  return (
    <div className="access-banner" role="alert" data-testid="input-access-banner">
      <div>
        <strong>CodeCritter can&apos;t see your typing yet.</strong>
        <p className="hint">
          macOS needs your OK before any app may watch the keyboard and mouse. CodeCritter only counts keystrokes
          and clicks, never which keys. Turn on CodeCritter under Privacy &amp; Security &gt; Input Monitoring;
          the reactions start by themselves a moment later. Until then only mouse movement is noticed.
        </p>
      </div>
      <button type="button" className="btn primary" onClick={() => void bridge.openInputAccess?.()}>
        Open System Settings
      </button>
    </div>
  );
}
