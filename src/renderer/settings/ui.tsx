// Shared hooks + small form components for the settings app.
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Settings, SettingsBridge } from '@shared/types';
import type { Patch } from './helpers';

export type Save = (p: Patch | ((s: Settings) => Patch)) => void;
export interface Ctx {
  settings: Settings;
  bridge: SettingsBridge;
  save: Save;
  toast: (msg: string, ok?: boolean) => void;
}
export const SettingsCtx = createContext<Ctx | null>(null);
export function useCtx(): Ctx {
  const c = useContext(SettingsCtx);
  if (!c) throw new Error('SettingsCtx missing');
  return c;
}

export const DEBOUNCE_MS = 300;

/** Draft text with debounced commit. Flushes on blur/unmount; reverts invalid drafts on blur. */
export function useDraft<T>(
  value: T,
  format: (v: T) => string,
  parse: (s: string) => T | null,
  commit: (v: T) => void,
) {
  const [draft, setDraft] = useState(() => format(value));
  const dirty = useRef(false);
  const pending = useRef<{ v: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const fmtRef = useRef(format);
  fmtRef.current = format;

  useEffect(() => {
    if (!dirty.current) setDraft(fmtRef.current(value));
  }, [value]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    dirty.current = false;
    if (p) commitRef.current(p.v);
  }, []);

  useEffect(() => flush, [flush]);

  const onChange = (s: string): void => {
    setDraft(s);
    dirty.current = true;
    clearTimeout(timer.current);
    const v = parse(s);
    if (v === null) {
      pending.current = null;
      return;
    }
    pending.current = { v };
    timer.current = setTimeout(flush, DEBOUNCE_MS);
  };
  const onBlur = (): void => {
    if (pending.current) flush();
    else {
      dirty.current = false;
      setDraft(fmtRef.current(value));
    }
  };
  const invalid = dirty.current && parse(draft) === null;
  return { draft, onChange, onBlur, invalid };
}

export const Toggle = memo(function Toggle(props: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="row">
      <div className="row-text">
        <label htmlFor={id}>{props.label}</label>
        {props.hint && <p className="hint">{props.hint}</p>}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </div>
  );
});

export const NumberField = memo(function NumberField(props: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onCommit: (n: number) => void;
}) {
  const id = useId();
  const { draft, onChange, onBlur, invalid } = useDraft<number>(
    props.value,
    String,
    (s) => {
      const t = s.trim();
      if (!/^\d+$/.test(t)) return null;
      const n = Number(t);
      return n >= props.min && n <= props.max ? n : null;
    },
    props.onCommit,
  );
  return (
    <div className="row">
      <div className="row-text">
        <label htmlFor={id}>{props.label}</label>
        <p className={invalid ? 'hint err' : 'hint'}>
          {invalid ? `Enter a whole number from ${props.min} to ${props.max}.` : props.hint}
        </p>
      </div>
      <span className="num-wrap">
        <input
          id={id}
          className="input num"
          inputMode="numeric"
          value={draft}
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
        {props.unit && <span className="unit">{props.unit}</span>}
      </span>
    </div>
  );
});

export const TextField = memo(function TextField(props: {
  label: string;
  hint?: string;
  value: string;
  maxLength?: number;
  placeholder?: string;
  onCommit: (s: string) => void;
  wide?: boolean;
}) {
  const id = useId();
  const { draft, onChange, onBlur } = useDraft<string>(
    props.value,
    (s) => s,
    (s) => s,
    props.onCommit,
  );
  return (
    <div className="row">
      <div className="row-text">
        <label htmlFor={id}>{props.label}</label>
        {props.hint && <p className="hint">{props.hint}</p>}
      </div>
      <input
        id={id}
        className={props.wide ? 'input wide' : 'input'}
        value={draft}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </div>
  );
});

export const TimeField = memo(function TimeField(props: {
  label: string;
  value: string;
  onCommit: (s: string) => void;
}) {
  const id = useId();
  return (
    <span className="time-field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="time"
        className="input time"
        value={props.value}
        onChange={(e) => {
          if (/^\d\d:\d\d$/.test(e.target.value)) props.onCommit(e.target.value);
        }}
      />
    </span>
  );
});

export const Slider = memo(function Slider(props: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (n: number) => string;
  onCommit: (n: number) => void;
}) {
  const id = useId();
  const [v, setV] = useState(props.value);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitRef = useRef(props.onCommit);
  commitRef.current = props.onCommit;
  useEffect(() => {
    if (!dirty.current) setV(props.value);
  }, [props.value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const fmt = props.format ?? String;
  return (
    <div className="row">
      <div className="row-text">
        <label htmlFor={id}>{props.label}</label>
        {props.hint && <p className="hint">{props.hint}</p>}
      </div>
      <span className="slider-wrap">
        <input
          id={id}
          type="range"
          className="range"
          min={props.min}
          max={props.max}
          step={props.step}
          value={v}
          onChange={(e) => {
            const n = Number(e.target.value);
            setV(n);
            dirty.current = true;
            clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              dirty.current = false;
              commitRef.current(n);
            }, DEBOUNCE_MS);
          }}
        />
        <output className="slider-val">{fmt(v)}</output>
      </span>
    </div>
  );
});

export const ColorField = memo(function ColorField(props: {
  label: string;
  value: string;
  onCommit: (hex: string) => void;
}) {
  const id = useId();
  const [v, setV] = useState(props.value);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitRef = useRef(props.onCommit);
  commitRef.current = props.onCommit;
  useEffect(() => {
    if (!dirty.current) setV(props.value);
  }, [props.value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="color-field">
      <input
        id={id}
        type="color"
        className="color"
        value={v}
        onChange={(e) => {
          const hex = e.target.value;
          setV(hex);
          dirty.current = true;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            dirty.current = false;
            commitRef.current(hex);
          }, DEBOUNCE_MS);
        }}
      />
      <label htmlFor={id}>
        {props.label}
        <code>{v}</code>
      </label>
    </div>
  );
});

export function Section(props: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="panel" aria-labelledby="section-title">
      <h2 id="section-title">{props.title}</h2>
      {props.intro && <p className="intro">{props.intro}</p>}
      {props.children}
    </section>
  );
}

/** True while the document is visible. Components gate timers on this. */
export function useVisible(): boolean {
  const [vis, setVis] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const f = (): void => setVis(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);
  return vis;
}

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog ref={ref} className="dialog" onCancel={props.onCancel} aria-labelledby="dlg-title">
      <h3 id="dlg-title">{props.title}</h3>
      <div className="dialog-body">{props.body}</div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={props.onCancel} autoFocus>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={props.onConfirm}>
          {props.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
