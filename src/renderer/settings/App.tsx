import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Settings, SettingsBridge } from '@shared/types';
import { drawText } from '../overlay/engine/font';
import { AboutTab } from './About';
import { AgentsTab } from './Agents';
import { MessagesTab, PomodoroTab, ReactionsTab, RemindersTab } from './Basics';
import { CharacterTab } from './Character';
import { GeneralTab } from './General';
import { InputAccessBanner } from './InputAccessBanner';
import type { Patch } from './helpers';
import { SettingsCtx, type Ctx } from './ui';

const TABS = [
  ['character', 'Character', CharacterTab],
  ['reactions', 'Reactions', ReactionsTab],
  ['reminders', 'Reminders', RemindersTab],
  ['pomodoro', 'Pomodoro', PomodoroTab],
  ['messages', 'Messages', MessagesTab],
  ['agents', 'AI Agents', AgentsTab],
  ['general', 'General', GeneralTab],
  ['about', 'About', AboutTab],
] as const;
type TabId = (typeof TABS)[number][0];

/** Heading rendered with the engine's own pixel font (no web fonts). */
const Logo = memo(function Logo() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    drawText(ctx, 'CODECRITTER', 1, 2, '#ffb347');
  }, []);
  return <canvas ref={ref} className="logo" width={72} height={10} role="img" aria-label="CodeCritter" />;
});

interface Toast {
  id: number;
  msg: string;
  ok: boolean;
}

export function App(props: { bridge: SettingsBridge; mock?: boolean }) {
  const { bridge } = props;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<TabId>('character');
  const [saved, setSaved] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const ref = useRef<Settings | null>(null);
  const seq = useRef(0);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastId = useRef(0);
  const pending = useRef(0);

  useEffect(() => {
    bridge.get().then((s) => {
      ref.current = s;
      setSettings(s);
    });
    // Changes made elsewhere (tray, sync folder, import, a 'once' message disabling itself) must show up
    // here too, otherwise the next edit starts from stale values. Ignored while our own saves are in flight.
    return bridge.onSettings?.((s) => {
      if (pending.current > 0) return;
      ref.current = s;
      setSettings(s);
    });
  }, [bridge]);

  const toast = useCallback((msg: string, ok = true) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, msg, ok }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ok ? 3500 : 6000);
  }, []);

  const save = useCallback(
    (p: Patch | ((s: Settings) => Patch)) => {
      const cur = ref.current;
      if (!cur) return;
      const patch = typeof p === 'function' ? p(cur) : p;
      const next = { ...cur, ...patch };
      ref.current = next;
      setSettings(next);
      const mine = ++seq.current;
      pending.current++;
      bridge.set(patch).then(
        (res) => {
          pending.current--;
          if (mine === seq.current) {
            ref.current = res;
            setSettings(res);
          }
          setSaved(true);
          clearTimeout(savedTimer.current);
          savedTimer.current = setTimeout(() => setSaved(false), 1500);
        },
        () => {
          pending.current--;
          toast('Could not save settings', false);
        },
      );
    },
    [bridge, toast],
  );

  const ctx = useMemo<Ctx | null>(
    () => (settings ? { settings, bridge, save, toast } : null),
    [settings, bridge, save, toast],
  );

  const onNavKey = (e: React.KeyboardEvent): void => {
    const i = TABS.findIndex((t) => t[0] === tab);
    let n: number;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
    else return;
    e.preventDefault();
    const id = TABS[n]![0];
    setTab(id);
    document.getElementById(`tab-${id}`)?.focus();
  };

  if (!ctx) return <div className="loading">Loading settings...</div>;
  const Active = TABS.find((t) => t[0] === tab)![2];

  return (
    <SettingsCtx.Provider value={ctx}>
      <div className="shell">
        <nav className="nav" aria-label="Settings sections">
          <Logo />
          <div role="tablist" aria-orientation="vertical" onKeyDown={onNavKey}>
            {TABS.map(([id, label]) => (
              <button
                key={id}
                id={`tab-${id}`}
                type="button"
                role="tab"
                aria-selected={tab === id}
                aria-controls="panel"
                tabIndex={tab === id ? 0 : -1}
                className={tab === id ? 'tab on' : 'tab'}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="nav-foot">
            <span className={saved ? 'saved on' : 'saved'} role="status" aria-live="polite">
              {saved ? 'Saved' : ''}
            </span>
            {props.mock && <span className="mock">mock bridge</span>}
          </div>
        </nav>
        <main id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="main">
          <InputAccessBanner bridge={bridge} />
          <Active />
        </main>
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={t.ok ? 'toast' : 'toast bad'}>
              {t.msg}
            </div>
          ))}
        </div>
      </div>
    </SettingsCtx.Provider>
  );
}
