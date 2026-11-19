/**
 * Daily collection times on the web (replaces the hourly automatic run, 17/11/2026).
 * Each profile ticks the slots it wants and, since 19/11/2026, can change their times in Settings
 * (`ScheduleTimes`; unchanged slots keep the defaults below). The review worker checks every 5 minutes and, from
 * 2 minutes after the time (cron at :02, :07 … so 08:02 / 16:32 exactly; feeds catch up) until 2 hours after,
 * dispatches ONE collection of that window per profile and day (retried while the collection server is busy).
 * Times are Asia/Ho_Chi_Minh; `to` is not included.
 */
export type ScheduleSlotId = 'morning' | 'afternoon';
export interface ScheduleSlot {
  id: ScheduleSlotId;
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
export const SLOT_NAMES: Record<ScheduleSlotId, string> = { morning: 'Lượt 1', afternoon: 'Lượt 2' };
export type ScheduleState = Partial<Record<ScheduleSlotId, boolean>>;
/** times changed in Settings: run time + start of the window (the window ends at the run time, minute included) */
export type ScheduleTimes = Partial<Record<ScheduleSlotId, { at: string; from: string }>>;

const VN_MS = 7 * 3600_000;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmmOf = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** the latest run time: the 2-hour dispatch window must end the same day (done keys are per Vietnam day) */
export const LATEST_RUN = '21:57';

/** the slots of a profile: defaults, with the times changed in Settings applied */
export function slotsFor(times?: ScheduleTimes | null): ScheduleSlot[] {
  return SCHEDULE_SLOTS.map((d) => {
    const t = times?.[d.id];
    if (!t || (t.at === d.at && t.from === d.from.time)) return d;
    const fromDay = minutesOf(t.from) >= minutesOf(t.at) ? -1 : 0;
    const toM = minutesOf(t.at) + 1; // the run minute is included, like the default 08:00 window
    return {
      id: d.id, at: t.at, from: { day: fromDay, time: t.from }, to: { day: 0, time: hhmmOf(toM) },
      label: `kỳ ${t.from}${fromDay ? ' hôm qua' : ''} → ${t.at} hôm nay (gồm phút ${t.at})`,
    };
  });
}

/** null when valid, else the message shown to the user */
export function validateTimes(times: ScheduleTimes): string | null {
  const ats: string[] = [];
  for (const d of SCHEDULE_SLOTS) {
    const t = times[d.id];
    if (!t) continue;
    if (!HHMM.test(t.at) || !HHMM.test(t.from)) return `${SLOT_NAMES[d.id]}: giờ phải có dạng HH:mm`;
    if (minutesOf(t.at) > minutesOf(LATEST_RUN)) return `${SLOT_NAMES[d.id]}: giờ chạy muộn nhất là ${LATEST_RUN}`;
    if (t.at === t.from) return `${SLOT_NAMES[d.id]}: giờ bắt đầu kỳ phải khác giờ chạy`;
    ats.push(t.at);
  }
  if (new Set(ats).size !== ats.length) return 'Hai lượt không được trùng giờ chạy';
  return null;
}

/** yyyy-mm-dd of a Vietnam calendar day shifted by `days` */
export function vnDay(now: Date, days = 0): string {
  return new Date(now.getTime() + VN_MS + days * 86400_000).toISOString().slice(0, 10);
}
/** the window a slot collects when it runs on the Vietnam day of `now` */
export function slotWindow(slot: ScheduleSlot, now: Date): { from: string; to: string } {
  return { from: `${vnDay(now, slot.from.day)}T${slot.from.time}+07:00`, to: `${vnDay(now, slot.to.day)}T${slot.to.time}+07:00` };
}
/** slots whose dispatch window [at + 2 min, at + 2 h) contains `now` */
export function dueSlots(now: Date, slots: readonly ScheduleSlot[] = SCHEDULE_SLOTS): ScheduleSlot[] {
  const vn = new Date(now.getTime() + VN_MS);
  const m = vn.getUTCHours() * 60 + vn.getUTCMinutes();
  return slots.filter((s) => m >= minutesOf(s.at) + 2 && m < minutesOf(s.at) + 120);
}
/**
 * next run time (ISO) of the ticked slots, or null. `doneToday` = slot ids already collected today (Vietnam day):
 * once the 08:00 run has been dispatched, the next one is 16:30, not 08:00 again until its 2-hour window closes.
 */
export function nextRun(state: ScheduleState | undefined, now: Date, doneToday: readonly string[] = [], slots: readonly ScheduleSlot[] = SCHEDULE_SLOTS): { slot: ScheduleSlot; at: string } | null {
  const on = slots.filter((s) => state?.[s.id]);
  let best: { slot: ScheduleSlot; at: string } | null = null;
  for (const day of [0, 1])
    for (const s of on) {
      const at = `${vnDay(now, day)}T${s.at}:00+07:00`;
      if (Date.parse(at) + 120 * 60_000 <= now.getTime()) continue;
      if (day === 0 && doneToday.includes(s.id)) continue;
      if (!best || Date.parse(at) < Date.parse(best.at)) best = { slot: s, at };
    }
  return best;
}
