import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { Settings, SoundCategory, UpdateStatus } from '@shared/types';
import { SoundEngine } from '../overlay/engine/sound';
import { CATEGORY_LABEL, SOUND_CATEGORIES, auditionPlan } from '../overlay/engine/soundPlan';
import { VERSION } from './About';
import { clamp } from './helpers';
import { Section, Slider, TextField, TimeField, Toggle, useCtx } from './ui';

/** One line describing the last update check. */
export function updateStatusLine(s: UpdateStatus | null): string {
  if (!s) return 'Not checked yet.';
  if (s.downloaded && s.version) return `v${s.version} is downloaded and installs when you are away (or on quit).`;
  if (s.available && s.version) return `v${s.version} is available.`;
  if (s.error) return 'Could not check (offline?). Will retry automatically.';
  if (s.lastCheckedAt) return `Up to date (checked ${new Date(s.lastCheckedAt).toLocaleTimeString()}).`;
  return 'Not checked yet.';
}

const UpdatesGroup = memo(function UpdatesGroup() {
  const { settings, save, bridge, toast } = useCtx();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    bridge.updateStatus().then(setStatus, () => undefined);
  }, [bridge]);
  useEffect(refresh, [refresh]);

  const check = (): void => {
    setBusy(true);
    bridge.checkUpdate().then(
      () => {
        setBusy(false);
        refresh();
      },
      () => {
        setBusy(false);
        toast('Update check failed', false);
        refresh();
      },
    );
  };
  const install = (): void => {
    setBusy(true);
    bridge.installUpdate().then(
      () => setBusy(false),
      () => {
        setBusy(false);
        toast('Update failed', false);
      },
    );
  };

  return (
    <div className="group">
      <Toggle
        label="Automatic updates"
        hint="Download new versions in the background and install them when you are away. The only network request CodeCritter makes."
        checked={settings.updates.auto}
        onChange={(on) => save({ updates: { auto: on } })}
      />
      <p className="hint" data-testid="update-status">
        Version {status?.currentVersion ?? VERSION}. {updateStatusLine(status)}
      </p>
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={check}>
          {busy ? 'Checking...' : 'Check for updates now'}
        </button>
        {status?.available && status.version && (
          <button type="button" className="btn" disabled={busy} onClick={install}>
            Install v{status.version} and restart
          </button>
        )}
      </div>
    </div>
  );
});

/** Per-category sound toggles with an audition button each (plays through this window's own engine). */
const SoundGroup = memo(function SoundGroup() {
  const { settings, save } = useCtx();
  const engine = useRef<SoundEngine | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      engine.current?.dispose();
    },
    [],
  );
  const audition = (cat: SoundCategory): void => {
    const e = (engine.current ??= new SoundEngine());
    e.configure({ enabled: true, volume: settings.sound.volume, character: settings.character });
    timers.current.forEach(clearTimeout);
    timers.current = auditionPlan(cat).map((st) =>
      setTimeout(() => e.play(st.name, { ...st.opts, force: true }), st.at * 1000),
    );
  };
  return (
    <div className="group" data-testid="sound-categories">
      {SOUND_CATEGORIES.map((cat) => (
        <div key={cat}>
          <Toggle
            label={CATEGORY_LABEL[cat].label}
            hint={CATEGORY_LABEL[cat].hint}
            checked={settings.sound.categories[cat]}
            onChange={(on) =>
              save((s) => ({ sound: { ...s.sound, categories: { ...s.sound.categories, [cat]: on } } }))
            }
          />
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={settings.sound.volume <= 0}
              onClick={() => audition(cat)}
              aria-label={`Play ${CATEGORY_LABEL[cat].label} sounds`}
            >
              Play
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});

export const GeneralTab = memo(function GeneralTab() {
  const { settings, save, bridge, toast } = useCtx();
  const pct = (n: number): string => `${Math.round(n * 100)}%`;

  const doExport = (): void => {
    bridge.exportSettings().then(
      (p) => p && toast(`Exported to ${p}`),
      () => toast('Export failed', false),
    );
  };
  const doImport = (): void => {
    bridge.importSettings().then(
      (ok) => ok && toast('Settings imported'),
      () => toast('Import failed', false),
    );
  };

  return (
    <Section title="General">
      <TextField
        label="Your name"
        hint="Used in friendly messages."
        value={settings.userName}
        maxLength={32}
        onCommit={(s) => save({ userName: s.trim() })}
      />
      <div className="row">
        <div className="row-text">
          <label htmlFor="scale">Size</label>
          <p className="hint">Pixel scale of your critter on screen.</p>
        </div>
        <select
          id="scale"
          className="input"
          value={settings.scale}
          onChange={(e) => save({ scale: clamp(Number(e.target.value), 1, 4) as Settings['scale'] })}
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}x
            </option>
          ))}
        </select>
      </div>
      <Slider label="Opacity" value={settings.opacity} min={0.2} max={1} step={0.05} format={pct} onCommit={(n) => save({ opacity: n })} />

      <Toggle
        label="Sound effects"
        hint="Tiny synthesised clacks and chimes. The tray Mute item switches this off too."
        checked={settings.sound.enabled}
        onChange={(on) => save((s) => ({ sound: { ...s.sound, enabled: on } }))}
      />
      <Slider
        label="Volume"
        value={settings.sound.volume}
        min={0}
        max={1}
        step={0.05}
        format={pct}
        onCommit={(n) => save((s) => ({ sound: { ...s.sound, volume: n } }))}
      />

      <SoundGroup />

      <Toggle label="Start with Windows" hint="Launch CodeCritter when you sign in (installed app only)." checked={settings.autostart} onChange={(on) => save({ autostart: on })} />

      <div className="group">
        <Toggle
          label="Do not disturb"
          hint="Silence reminders during these hours."
          checked={settings.dnd.enabled}
          onChange={(on) => save((s) => ({ dnd: { ...s.dnd, enabled: on } }))}
        />
        <div className="row inline">
          <TimeField label="From" value={settings.dnd.from} onCommit={(v) => save((s) => ({ dnd: { ...s.dnd, from: v } }))} />
          <TimeField label="To" value={settings.dnd.to} onCommit={(v) => save((s) => ({ dnd: { ...s.dnd, to: v } }))} />
        </div>
      </div>

      <div className="group">
        <Toggle
          label="Peek automatically"
          hint="Tuck away at a screen edge when a fullscreen app is in front."
          checked={settings.peek.auto}
          onChange={(on) => save((s) => ({ peek: { ...s.peek, auto: on } }))}
        />
        <div className="row">
          <div className="row-text">
            <label htmlFor="edge">Peek edge</label>
          </div>
          <select
            id="edge"
            className="input"
            value={settings.peek.edge}
            onChange={(e) => save((s) => ({ peek: { ...s.peek, edge: e.target.value as Settings['peek']['edge'] } }))}
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
            <option value="bottom">Bottom</option>
          </select>
        </div>
      </div>

      <UpdatesGroup />

      <div className="group">
        <TextField
          label="Sync folder"
          hint="Optional folder (e.g. in a cloud drive) to share settings between machines."
          value={settings.syncFolder ?? ''}
          placeholder="Not set"
          wide
          onCommit={(s) => save({ syncFolder: s.trim() === '' ? null : s.trim() })}
        />
        <div className="actions">
          <button type="button" className="btn" disabled={!settings.syncFolder} onClick={() => save({ syncFolder: null })}>
            Clear folder
          </button>
          <button type="button" className="btn" onClick={doExport}>
            Export settings
          </button>
          <button type="button" className="btn" onClick={doImport}>
            Import settings
          </button>
        </div>
      </div>
    </Section>
  );
});
