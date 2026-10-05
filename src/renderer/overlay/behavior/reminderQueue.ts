import type { ReminderEvent } from '@shared/types';

/** Max reminders waiting behind the one on screen. */
export const REMINDER_QUEUE_MAX = 3;

const same = (a: ReminderEvent, b: ReminderEvent): boolean =>
  a.kind === b.kind && (a.kind !== 'message' || (a.text ?? '') === (b.text ?? ''));

/**
 * Reminders that fire while another one is showing (stretch + water in one scheduler tick) wait
 * their turn instead of overwriting the bubble. Same-kind duplicates are dropped; the queue holds
 * at most `REMINDER_QUEUE_MAX` entries (extra ones are dropped, newest first).
 */
export class ReminderQueue {
  private items: ReminderEvent[] = [];

  get length(): number {
    return this.items.length;
  }

  /** `showing` is the reminder currently on screen (if any). Returns whether it was queued. */
  push(r: ReminderEvent, showing: ReminderEvent | null): boolean {
    if (showing && same(showing, r)) return false;
    if (this.items.some((x) => same(x, r))) return false;
    if (this.items.length >= REMINDER_QUEUE_MAX) return false;
    this.items.push(r);
    return true;
  }

  shift(): ReminderEvent | undefined {
    return this.items.shift();
  }

  clear(): void {
    this.items = [];
  }
}
