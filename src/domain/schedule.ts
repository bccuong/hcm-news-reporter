/**
 * Fixed daily collection times on the web (replaces the hourly automatic run, 17/11/2026).
 * Each profile ticks the times it wants; the review worker checks every 5 minutes and, from 2 minutes after the time (cron at :02, :07 … so 08:02 / 16:32 exactly)
 * (feeds catch up) until 2 hours after, dispatches ONE collection of that window per profile and day (retried while the
 * collection server is busy). Times are Asia/Ho_Chi_Minh; `to` is not included.
 */
export interface ScheduleSlot {
  id: 'morning' | 'afternoon';
  /** run time HH:mm */
  at: string;
  /** window: day offset from the run day + clock time */
  from: { day: number; time: string };
  to: { day: number; time: string };
  /** what the window covers, as shown on the web */
  label: string;
}
// The two windows join without a gap: the morning one includes the minute 08:00 (to = 08:01, not included),
// the afternoon one starts at 08:01 (user, 17/11/2026).
export const SCHEDULE_SLOTS: readonly ScheduleSlot[] = [
  { id: 'morning', at: '08:00', from: { day: -1, time: '17:00' }, to: { day: 0, time: '08:01' }, label: 'kỳ 17:00 hôm qua → 08:00 hôm nay (gồm phút 08:00)' },
  { id: 'afternoon', at: '16:30', from: { day: 0, time: '08:01' }, to: { day: 0, time: '16:30' }, label: 'kỳ 08:01 → 16:30 hôm nay' },
];
export type ScheduleState = Partial<Record<ScheduleSlot['id'], boolean>>;

const VN_MS = 7 * 3600_000;
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** yyyy-mm-dd of a Vietnam calendar day shifted by `days` */
export function vnDay(now: Date, days = 0): string {
  return new Date(now.getTime() + VN_MS + days * 86400_000).toISOString().slice(0, 10);
}
/** the window a slot collects when it runs on the Vietnam day of `now` */
export function slotWindow(slot: ScheduleSlot, now: Date): { from: string; to: string } {
  return { from: `${vnDay(now, slot.from.day)}T${slot.from.time}+07:00`, to: `${vnDay(now, slot.to.day)}T${slot.to.time}+07:00` };
}
/** slots whose dispatch window [at + 2 min, at + 2 h) contains `now` */
export function dueSlots(now: Date): ScheduleSlot[] {
  const vn = new Date(now.getTime() + VN_MS);
  const m = vn.getUTCHours() * 60 + vn.getUTCMinutes();
  return SCHEDULE_SLOTS.filter((s) => m >= minutesOf(s.at) + 2 && m < minutesOf(s.at) + 120);
}
/** next run time (ISO) of the ticked slots, or null */
export function nextRun(state: ScheduleState | undefined, now: Date): { slot: ScheduleSlot; at: string } | null {
  const on = SCHEDULE_SLOTS.filter((s) => state?.[s.id]);
  let best: { slot: ScheduleSlot; at: string } | null = null;
  for (const day of [0, 1])
    for (const s of on) {
      const at = `${vnDay(now, day)}T${s.at}:00+07:00`;
      if (Date.parse(at) + 120 * 60_000 <= now.getTime()) continue;
      if (!best || Date.parse(at) < Date.parse(best.at)) best = { slot: s, at };
    }
  return best;
}
