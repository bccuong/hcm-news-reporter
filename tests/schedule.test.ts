import { describe, expect, it } from 'vitest';
import { nextRun } from '../src/domain/schedule.js';

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
