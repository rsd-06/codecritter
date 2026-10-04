import { memo } from 'react';
import type { Settings } from '@shared/types';
import { clamp } from './helpers';
import { Section, Slider, TextField, TimeField, Toggle, useCtx } from './ui';

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
        hint="Tiny synthesised chirps."
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
