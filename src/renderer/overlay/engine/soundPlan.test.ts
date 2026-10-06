import { DEFAULT_SETTINGS } from '@shared/defaults';
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_OF,
  NAG_TOTAL_S,
  ReminderNag,
  SOUND_CATEGORIES,
  WAIT_TAP_TIMES_S,
  WaitingTapper,
  auditionPlan,
  inDnd,
  nagSchedule,
  planDuration,
  planSound,
  reminderGain,
  reminderLayers,
  soundAllowed,
  type SoundGate,
  type SoundName,
} from './soundPlan';

function seeded(seed = 3): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const gate = (patch: Partial<SoundGate> = {}): SoundGate => ({
  enabled: true,
  volume: 0.5,
  categories: { ...DEFAULT_SETTINGS.sound.categories },
  dnd: { enabled: false, from: '22:00', to: '07:00' },
  peeking: false,
  ...patch,
});

const ALL = Object.keys(CATEGORY_OF) as SoundName[];

describe('planSound', () => {
  it('every sound is short, loudness-bounded and deterministic for a seed', () => {
    for (const name of ALL) {
      for (const level of [0, 1]) {
        const steps = planSound(name, { level }, seeded());
        expect(JSON.stringify(steps)).toBe(JSON.stringify(planSound(name, { level }, seeded())));
        for (const s of steps) {
          expect(s.g).toBeGreaterThan(0);
          expect(s.g).toBeLessThanOrEqual(1);
        }
        expect(planDuration(steps)).toBeLessThan(1.6);
      }
    }
  });

  it('keyboard base: clacks have a transient and a body, with pitch variation', () => {
    const a = planSound('key', {}, seeded(1))[0]!;
    const b = planSound('key', {}, seeded(2))[0]!;
    expect(a.k).toBe('clack');
    expect(a).not.toEqual(b);
  });

  it('agent sounds: double-clack, ka-chunk + rising blip, two dull thunks, one soft tap', () => {
    expect(planSound('agentWork', {}, seeded()).filter((s) => s.k === 'clack').length).toBe(2);
    const done = planSound('agentDone', {}, seeded());
    expect(done.filter((s) => s.k === 'clack').length).toBe(2);
    const tones = done.filter((s) => s.k === 'tone');
    expect(tones.length).toBe(2);
    expect(tones[1]!.k === 'tone' && tones[0]!.k === 'tone' && tones[1]!.f > tones[0]!.f).toBe(true);
    expect(planSound('agentError', {}, seeded()).filter((s) => s.k === 'thunk').length).toBe(2);
    expect(planSound('agentWaiting', {}, seeded()).length).toBe(1);
  });

  it('click frenzy is a rapid rattle; overheat rattles get faster', () => {
    const fr = planSound('clickFrenzy', {}, seeded());
    expect(fr.length).toBeGreaterThanOrEqual(8);
    expect(fr[fr.length - 1]!.t).toBeLessThan(0.7);
    const oh = planSound('overheat', {}, seeded());
    const gaps = oh.slice(1).map((s, i) => s.t - oh[i]!.t);
    expect(gaps[gaps.length - 1]!).toBeLessThan(gaps[0]!);
  });

  it('sleep is much quieter than anything else', () => {
    const sleep = Math.max(...planSound('sleep', {}, seeded()).map((s) => s.g));
    for (const name of ALL.filter((n) => n !== 'sleep' && n !== 'speak' && n !== 'purrClick')) {
      expect(Math.max(...planSound(name, {}, seeded()).map((s) => s.g))).toBeGreaterThan(sleep * 2);
    }
  });

  it('reminders get louder and more layered with the escalation level (never past 1)', () => {
    const lo = planSound('reminder', { level: 0 }, seeded());
    const hi = planSound('reminder', { level: 1 }, seeded());
    expect(hi.length).toBeGreaterThan(lo.length);
    expect(reminderGain(1)).toBe(1);
    expect(reminderGain(0)).toBeLessThan(reminderGain(0.5));
    expect(reminderGain(0.5)).toBeLessThan(reminderGain(1));
    expect(reminderLayers(0)).toBe(1);
    expect(reminderLayers(0.5)).toBe(2);
    expect(reminderLayers(1)).toBe(3);
  });
});

describe('soundAllowed', () => {
  it('respects Sound effects, Volume and the per-category toggles', () => {
    expect(soundAllowed('key', gate(), 600)).toBe(true);
    expect(soundAllowed('key', gate({ enabled: false }), 600)).toBe(false);
    expect(soundAllowed('key', gate({ volume: 0 }), 600)).toBe(false);
    const cats = { ...DEFAULT_SETTINGS.sound.categories, typing: false };
    expect(soundAllowed('key', gate({ categories: cats }), 600)).toBe(false);
    expect(soundAllowed('agentDone', gate({ categories: cats }), 600)).toBe(true);
  });

  it('is silent during do-not-disturb hours, including overnight ranges', () => {
    const dnd = { enabled: true, from: '22:00', to: '07:00' };
    expect(inDnd(dnd, 23 * 60)).toBe(true);
    expect(inDnd(dnd, 3 * 60)).toBe(true);
    expect(inDnd(dnd, 12 * 60)).toBe(false);
    expect(inDnd({ ...dnd, enabled: false }, 23 * 60)).toBe(false);
    expect(inDnd({ enabled: true, from: '09:00', to: '17:00' }, 12 * 60)).toBe(true);
    expect(soundAllowed('agentDone', gate({ dnd }), 23 * 60)).toBe(false);
  });

  it('fullscreen peek lets only reminders (and pomodoro bells) through', () => {
    const g = gate({ peeking: true });
    expect(soundAllowed('reminder', g, 600)).toBe(true);
    expect(soundAllowed('pomodoroDone', g, 600)).toBe(true);
    for (const n of ALL.filter((x) => CATEGORY_OF[x] !== 'reminders' && CATEGORY_OF[x] !== 'pomodoro')) {
      expect(soundAllowed(n, g, 600)).toBe(false);
    }
  });

  it('every category has at least one sound and an audition', () => {
    for (const c of SOUND_CATEGORIES) {
      expect(ALL.some((n) => CATEGORY_OF[n] === c)).toBe(true);
      const a = auditionPlan(c);
      expect(a.length).toBeGreaterThan(0);
      for (const s of a) expect(CATEGORY_OF[s.name]).toBe(c);
    }
  });
});

describe('reminder escalation schedule', () => {
  it('repeats every ~20 s, speeds up, and stops after ~2 minutes', () => {
    const s = nagSchedule();
    expect(s[0]!.at).toBe(20);
    expect(s.length).toBeGreaterThanOrEqual(6);
    expect(s[s.length - 1]!.at).toBeLessThanOrEqual(NAG_TOTAL_S);
    expect(s[s.length - 1]!.at).toBeGreaterThan(NAG_TOTAL_S - 20);
    const gaps = s.slice(1).map((x, i) => x.at - s[i]!.at);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeLessThanOrEqual(gaps[i - 1]!);
    expect(gaps[gaps.length - 1]!).toBeLessThan(gaps[0]!);
    for (let i = 1; i < s.length; i++) expect(s[i]!.level).toBeGreaterThan(s[i - 1]!.level);
    expect(s[s.length - 1]!.level).toBe(1);
  });

  it('ReminderNag fires each step once and ack() stops it at once', () => {
    const n = new ReminderNag();
    n.start('stretch', 100);
    expect(n.poll(110)).toBeNull();
    const first = n.poll(120);
    expect(first?.at).toBe(20);
    expect(n.poll(120)).toBeNull();
    n.ack();
    expect(n.active).toBe(false);
    expect(n.poll(500)).toBeNull();
    expect(n.nextIn(500)).toBe(Infinity);
  });

  it('ReminderNag ends by itself after the last step', () => {
    const n = new ReminderNag();
    n.start('water', 0);
    let fired = 0;
    for (let t = 0; t < 400; t += 1) if (n.poll(t)) fired++;
    expect(fired).toBe(nagSchedule().length);
    expect(n.active).toBe(false);
  });
});

describe('WaitingTapper', () => {
  it('taps at most 3 times and cancel() stops it', () => {
    const w = new WaitingTapper();
    expect(w.poll(0)).toBe(false);
    w.start(10);
    let taps = 0;
    for (let t = 10; t < 40; t += 0.25) if (w.poll(t)) taps++;
    expect(taps).toBe(WAIT_TAP_TIMES_S.length);
    expect(taps).toBe(3);
    w.start(100);
    expect(w.poll(100)).toBe(true);
    w.cancel();
    expect(w.poll(120)).toBe(false);
    expect(w.nextIn(120)).toBe(Infinity);
  });
});
