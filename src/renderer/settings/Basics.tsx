// Reactions, Reminders, Pomodoro, Messages tabs.
import { memo, useEffect, useRef, useState } from 'react';
import type { CustomMessage, PomodoroState, Settings } from '@shared/types';
import {
  MESSAGE_MAX,
  NOTE_MAX,
  fmtClock,
  isHHMM,
  makeId,
  newMessage,
  pomodoroPatch,
  reactionPatch,
  reminderPatch,
  removeMessage,
  savableMessages,
  trimNote,
  upsertMessage,
  validateMessage,
} from './helpers';
import { NumberField, Section, Slider, Toggle, useCtx, useDraft, useVisible } from './ui';

const REACTIONS: { key: keyof Settings['reactions']; label: string; hint: string }[] = [
  { key: 'eyeFollow', label: 'Eyes follow cursor', hint: 'Pupils track your mouse pointer.' },
  { key: 'hunt', label: 'Hunt the cursor', hint: 'Crouches and pounces when the cursor gets close.' },
  { key: 'purr', label: 'Purr on click', hint: 'Happy purring when you click or pet your critter.' },
  { key: 'knead', label: 'Knead while typing', hint: 'Paws knead along as you type at a steady pace.' },
  { key: 'overheat', label: 'Overheat when typing fast', hint: 'Gets flustered during very fast typing.' },
  { key: 'paper', label: 'Paper reaction', hint: 'Plays with paper when you scroll a lot.' },
  { key: 'drag', label: 'Dragging reaction', hint: 'Dangles and complains when you pick it up.' },
  { key: 'sleep', label: 'Fall asleep when idle', hint: 'Curls up for a nap when you have been away.' },
];

export const ReactionsTab = memo(function ReactionsTab() {
  const { settings, save } = useCtx();
  return (
    <Section title="Reactions" intro="Choose how your critter reacts to what you do. Only key counts are used, never which keys.">
      {REACTIONS.map((r) => (
        <Toggle
          key={r.key}
          label={r.label}
          hint={r.hint}
          checked={settings.reactions[r.key]}
          onChange={(on) => save((s) => reactionPatch(s, r.key, on))}
        />
      ))}
      <Slider
        label="Overheat threshold"
        hint="Sustained typing speed (keys per second) that makes it overheat."
        value={settings.overheatKps}
        min={3}
        max={20}
        step={1}
        format={(n) => `${n} keys/s`}
        onCommit={(n) => save({ overheatKps: n })}
      />
    </Section>
  );
});

export const RemindersTab = memo(function RemindersTab() {
  const { settings, save, bridge, toast } = useCtx();
  const test = (kind: 'stretch' | 'water'): void => {
    bridge.testReminder(kind).then(
      () => toast(`Sent a ${kind} reminder`),
      () => toast('Could not send the test reminder', false),
    );
  };
  return (
    <Section title="Reminders" intro="Gentle nudges that pop up as a speech bubble.">
      {(['stretch', 'water'] as const).map((k) => (
        <div key={k} className="group">
          <Toggle
            label={k === 'stretch' ? 'Stretch reminder' : 'Water reminder'}
            hint={k === 'stretch' ? 'Reminds you to stand up and stretch.' : 'Reminds you to drink some water.'}
            checked={settings.reminders[k].enabled}
            onChange={(on) => save((s) => reminderPatch(s, k, { enabled: on }))}
          />
          <NumberField
            label="Every"
            unit="minutes"
            value={settings.reminders[k].everyMin}
            min={1}
            max={480}
            onCommit={(n) => save((s) => reminderPatch(s, k, { everyMin: n }))}
          />
          <div className="actions">
            <button type="button" className="btn" onClick={() => test(k)}>
              Test {k} reminder
            </button>
          </div>
        </div>
      ))}
    </Section>
  );
});

const IDLE: PomodoroState = { phase: 'idle', endsAt: null, cycle: 0, paused: false, remainingMs: 0 };
const PHASE_LABEL: Record<PomodoroState['phase'], string> = {
  idle: 'Idle',
  focus: 'Focus',
  break: 'Break',
  longBreak: 'Long break',
};

export const PomodoroTab = memo(function PomodoroTab() {
  const { settings, save, bridge, toast } = useCtx();
  const [state, setState] = useState<PomodoroState>(IDLE);
  const [now, setNow] = useState(() => Date.now());
  const visible = useVisible();
  const p = settings.pomodoro;

  // The bridge exposes commands only; each returns the new state. Tick a local clock 1 s while visible.
  useEffect(() => {
    if (!visible || state.phase === 'idle' || state.paused) return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [visible, state.phase, state.paused]);

  const cmd = (c: Parameters<typeof bridge.pomodoro>[0]): void => {
    bridge.pomodoro(c).then(
      (s) => {
        setState(s);
        setNow(Date.now());
      },
      () => toast('Pomodoro command failed', false),
    );
  };
  const remaining = state.paused || state.endsAt === null ? state.remainingMs : state.endsAt - now;
  const running = state.phase !== 'idle';
  return (
    <Section title="Pomodoro" intro="Focus in bursts. Your critter announces each phase.">
      <div className="pomo-card" aria-live="off">
        <span className="pomo-phase">{PHASE_LABEL[state.phase]}</span>
        <span className="pomo-clock" role="timer">
          {running ? fmtClock(remaining) : '--:--'}
        </span>
        <span className="pomo-sub">
          {running ? `Cycle ${state.cycle}${state.paused ? ' (paused)' : ''}` : 'Not running'}
        </span>
      </div>
      <div className="actions">
        {!running && (
          <button type="button" className="btn primary" onClick={() => cmd('start')}>
            Start
          </button>
        )}
        {running && !state.paused && (
          <button type="button" className="btn" onClick={() => cmd('pause')}>
            Pause
          </button>
        )}
        {running && state.paused && (
          <button type="button" className="btn primary" onClick={() => cmd('resume')}>
            Resume
          </button>
        )}
        <button type="button" className="btn" disabled={!running} onClick={() => cmd('skip')}>
          Skip
        </button>
        <button type="button" className="btn" disabled={!running} onClick={() => cmd('stop')}>
          Stop
        </button>
      </div>
      <NumberField label="Focus" unit="minutes" value={p.focusMin} min={1} max={180} onCommit={(n) => save((s) => pomodoroPatch(s, { focusMin: n }))} />
      <NumberField label="Break" unit="minutes" value={p.breakMin} min={1} max={60} onCommit={(n) => save((s) => pomodoroPatch(s, { breakMin: n }))} />
      <NumberField label="Long break" unit="minutes" value={p.longBreakMin} min={1} max={120} onCommit={(n) => save((s) => pomodoroPatch(s, { longBreakMin: n }))} />
      <NumberField label="Cycles before long break" value={p.cyclesBeforeLong} min={1} max={12} onCommit={(n) => save((s) => pomodoroPatch(s, { cyclesBeforeLong: n }))} />
    </Section>
  );
});

const REPEAT_LABEL: Record<CustomMessage['repeat'], string> = {
  once: 'Once',
  daily: 'Every day',
  weekdays: 'Weekdays',
};
const ERR_TEXT = {
  time: 'Time must be HH:MM (24 hour).',
  'text-empty': 'Message cannot be empty.',
  'text-long': `Message must be at most ${MESSAGE_MAX} characters.`,
} as const;

function MessageRow(props: {
  m: CustomMessage;
  onChange: (m: CustomMessage) => void;
  onDelete: (id: string) => void;
}) {
  const { m } = props;
  const err = validateMessage(m);
  const base = `msg-${m.id}`;
  return (
    <li className={err ? 'msg invalid' : 'msg'}>
      <div className="msg-main">
        <label htmlFor={`${base}-time`} className="sr">Time</label>
        <input
          id={`${base}-time`}
          type="time"
          className="input time"
          value={isHHMM(m.time) ? m.time : ''}
          onChange={(e) => props.onChange({ ...m, time: e.target.value })}
        />
        <label htmlFor={`${base}-text`} className="sr">Message text</label>
        <input
          id={`${base}-text`}
          className="input grow"
          value={m.text}
          maxLength={MESSAGE_MAX}
          placeholder="What should your critter say?"
          onChange={(e) => props.onChange({ ...m, text: e.target.value })}
        />
        <label htmlFor={`${base}-rep`} className="sr">Repeat</label>
        <select
          id={`${base}-rep`}
          className="input"
          value={m.repeat}
          onChange={(e) => props.onChange({ ...m, repeat: e.target.value as CustomMessage['repeat'] })}
        >
          {(Object.keys(REPEAT_LABEL) as CustomMessage['repeat'][]).map((r) => (
            <option key={r} value={r}>
              {REPEAT_LABEL[r]}
            </option>
          ))}
        </select>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          aria-label="Enabled"
          checked={m.enabled}
          onChange={(e) => props.onChange({ ...m, enabled: e.target.checked })}
        />
        <button type="button" className="btn danger" aria-label={`Delete message ${m.text || m.time}`} onClick={() => props.onDelete(m.id)}>
          Delete
        </button>
      </div>
      {err && <p className="hint err">{ERR_TEXT[err]} Not saved until fixed.</p>}
    </li>
  );
}

function PinnedNote() {
  const { settings, save } = useCtx();
  const { draft, onChange, onBlur } = useDraft<string>(
    settings.pinnedNote,
    (s) => s,
    (s) => trimNote(s),
    (s) => save({ pinnedNote: s }),
  );
  return (
    <div className="group">
      <label htmlFor="note" className="block-label">Pinned note</label>
      <p className="hint">A short note your critter holds up on screen.</p>
      <textarea
        id="note"
        className="input area"
        rows={2}
        maxLength={NOTE_MAX}
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <div className="actions between">
        <span className="hint">{draft.length}/{NOTE_MAX}</span>
        <button
          type="button"
          className="btn"
          disabled={!draft && !settings.pinnedNote}
          onClick={() => {
            onChange('');
            save({ pinnedNote: '' });
          }}
        >
          Clear note
        </button>
      </div>
    </div>
  );
}

export const MessagesTab = memo(function MessagesTab() {
  const { settings, save } = useCtx();
  // Local drafts so half-typed/invalid rows survive; only valid rows are persisted.
  const [list, setList] = useState<CustomMessage[]>(settings.messages);
  const listRef = useRef(list);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef(false);

  const persist = (): void => {
    clearTimeout(timer.current);
    if (!pending.current) return;
    pending.current = false;
    save({ messages: savableMessages(listRef.current) });
  };
  const update = (next: CustomMessage[], immediate = false): void => {
    listRef.current = next;
    setList(next);
    pending.current = true;
    clearTimeout(timer.current);
    if (immediate) persist();
    else timer.current = setTimeout(persist, 300);
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => () => persistRef.current(), []);

  return (
    <Section title="Messages" intro="Scheduled messages your critter will say at a set time.">
      {list.length === 0 && <p className="empty">No messages yet. Add one below.</p>}
      <ul className="msg-list">
        {list.map((m) => (
          <MessageRow
            key={m.id}
            m={m}
            onChange={(nm) => update(upsertMessage(listRef.current, nm), nm.enabled !== m.enabled || nm.repeat !== m.repeat)}
            onDelete={(id) => update(removeMessage(listRef.current, id), true)}
          />
        ))}
      </ul>
      <div className="actions">
        <button type="button" className="btn primary" onClick={() => update(upsertMessage(listRef.current, newMessage(makeId())))}>
          Add message
        </button>
      </div>
      <PinnedNote />
    </Section>
  );
});
