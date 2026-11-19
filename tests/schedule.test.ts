import { describe, expect, it } from 'vitest';
import { dueSlots, nextRun, SCHEDULE_SLOTS, slotsFor, slotWindow, validateTimes } from '../src/domain/schedule.js';

const at = (vn: string) => new Date(`${vn}+07:00`);
const both = { morning: true, afternoon: true };
const label = (r: ReturnType<typeof nextRun>) => (r ? `${r.slot.at} ${r.at.slice(0, 10)}` : null);

describe('"Tiếp:" – next automatic run', () => {
  it('before 08:00 → 08:00 today; nothing ticked → none', () => {
    expect(label(nextRun(both, at('2026-11-18T07:30')))).toBe('08:00 2026-11-18');
    expect(nextRun({}, at('2026-11-18T07:30'))).toBeNull();
  });
  it('the 08:00 run already collected today → 16:30 at once, not 08:00 until 10:00 (18/11/2026)', () => {
    expect(label(nextRun(both, at('2026-11-18T08:10'), ['morning']))).toBe('16:30 2026-11-18');
    // not yet dispatched (server busy, retrying) → still 08:00
    expect(label(nextRun(both, at('2026-11-18T08:10')))).toBe('08:00 2026-11-18');
  });
  it('after the 16:30 run → 08:00 tomorrow; only 08:00 ticked and done → 08:00 tomorrow', () => {
    expect(label(nextRun(both, at('2026-11-18T16:40'), ['morning', 'afternoon']))).toBe('08:00 2026-11-19');
    expect(label(nextRun({ morning: true }, at('2026-11-18T08:10'), ['morning']))).toBe('08:00 2026-11-19');
  });
});

describe('times changed in Settings (19/11/2026)', () => {
  it('unchanged or missing times keep the default slots exactly', () => {
    expect(slotsFor(undefined)).toEqual(SCHEDULE_SLOTS);
    expect(slotsFor({ morning: { at: '08:00', from: '17:00' } })).toEqual(SCHEDULE_SLOTS);
  });
  it('custom times: window from the start (yesterday when later than the run) to the run minute included', () => {
    const s = slotsFor({ morning: { at: '07:30', from: '17:30' }, afternoon: { at: '17:00', from: '07:31' } });
    expect(slotWindow(s[0]!, at('2026-11-19T07:40'))).toEqual({ from: '2026-11-18T17:30+07:00', to: '2026-11-19T07:31+07:00' });
    expect(slotWindow(s[1]!, at('2026-11-19T17:10'))).toEqual({ from: '2026-11-19T07:31+07:00', to: '2026-11-19T17:01+07:00' });
    expect(dueSlots(at('2026-11-19T07:32'), s).map((x) => x.id)).toEqual(['morning']);
    expect(dueSlots(at('2026-11-19T08:02'), s).map((x) => x.id)).toEqual(['morning']); // default 08:00 no longer used
    expect(dueSlots(at('2026-11-19T16:32'), s)).toEqual([]);
    expect(label(nextRun({ morning: true, afternoon: true }, at('2026-11-19T07:40'), ['morning'], s))).toBe('17:00 2026-11-19');
  });
  it('"Đến" changed by hand: the window ends there (minute included), the run time stays', () => {
    const s = slotsFor({ afternoon: { at: '16:00', from: '08:05', to: '15:45' } });
    expect(s[1]).toMatchObject({ at: '16:00', label: 'kỳ 08:05 → 15:45 hôm nay (gồm phút 15:45)' });
    expect(slotWindow(s[1]!, at('2026-11-19T16:05'))).toEqual({ from: '2026-11-19T08:05+07:00', to: '2026-11-19T15:46+07:00' });
    // "Từ" later than "Đến" → yesterday
    expect(slotWindow(slotsFor({ morning: { at: '08:00', from: '16:05', to: '07:30' } })[0]!, at('2026-11-19T08:05')).from).toBe('2026-11-18T16:05+07:00');
    expect(slotsFor({ morning: { at: '08:00', from: '17:00', to: '08:00' } })).toEqual(SCHEDULE_SLOTS);
    expect(validateTimes({ afternoon: { at: '16:00', from: '08:05', to: '16:30' } })).toMatch(/không được muộn hơn giờ chạy/);
    expect(validateTimes({ afternoon: { at: '16:00', from: '15:00', to: '15:00' } })).toMatch(/"Từ" phải khác "Đến"/);
  });
  it('validation', () => {
    expect(validateTimes({ morning: { at: '07:30', from: '17:30' } })).toBeNull();
    expect(validateTimes({ morning: { at: '7:30', from: '17:30' } })).toMatch(/HH:mm/);
    expect(validateTimes({ morning: { at: '23:00', from: '17:30' } })).toMatch(/muộn nhất/);
    expect(validateTimes({ morning: { at: '09:00', from: '09:00' } })).toMatch(/phải khác "Đến"/);
    expect(validateTimes({ morning: { at: '09:00', from: '17:00' }, afternoon: { at: '09:00', from: '08:00' } })).toMatch(/trùng/);
  });
});
