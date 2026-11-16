/**
 * Reporting-window math in Asia/Ho_Chi_Minh.
 * Vietnam has used a fixed UTC+07:00 offset with no DST since 1975, so a fixed
 * offset is exact and independent of the host computer's locale/timezone.
 * Windows are half-open: [from, to).
 */
export const VN_OFFSET_MINUTES = 7 * 60;
export const VN_TZ = 'Asia/Ho_Chi_Minh';

export interface ReportWindow {
  /** ISO 8601 with +07:00 offset, inclusive */
  from: string;
  /** ISO 8601 with +07:00 offset, exclusive */
  to: string;
}

export interface VnParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Wall-clock parts in Vietnam for an absolute instant. */
export function toVnParts(d: Date): VnParts {
  const shifted = new Date(d.getTime() + VN_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** Absolute instant for Vietnam wall-clock parts (handles day overflow). */
export function fromVnParts(p: Partial<VnParts> & Pick<VnParts, 'year' | 'month' | 'day'>): Date {
  const utcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
  return new Date(utcMs - VN_OFFSET_MINUTES * 60_000);
}

/** Format instant as ISO 8601 in +07:00, e.g. 2026-11-08T17:00:00+07:00 */
export function toVnIso(d: Date): string {
  const p = toVnParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}+07:00`;
}

/** Human display: 17:00 08/11/2026 */
export function formatVn(d: Date | string): string {
  const p = toVnParts(typeof d === 'string' ? new Date(d) : d);
  return `${pad(p.hour)}:${pad(p.minute)} ${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

export function parseClock(clock: string): { hour: number; minute: number } {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(clock.trim());
  if (!m) throw new Error(`Giờ không hợp lệ: "${clock}" (định dạng HH:mm)`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/**
 * Window for a morning report dated `reportDate` (YYYY-MM-DD, Vietnam calendar date):
 * previous day startClock -> reportDate endClock (when startClock > endClock),
 * otherwise same-day startClock -> endClock.
 */
export function windowForReportDate(reportDate: string, startClock = '17:00', endClock = '08:00'): ReportWindow {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(reportDate);
  if (!m) throw new Error(`Ngày báo cáo không hợp lệ: ${reportDate}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const s = parseClock(startClock);
  const e = parseClock(endClock);
  const crossesMidnight = s.hour * 60 + s.minute >= e.hour * 60 + e.minute;
  const to = fromVnParts({ year, month, day, hour: e.hour, minute: e.minute });
  const from = fromVnParts({ year, month, day: crossesMidnight ? day - 1 : day, hour: s.hour, minute: s.minute });
  return { from: toVnIso(from), to: toVnIso(to) };
}

/** Vietnam calendar date (YYYY-MM-DD) of an instant. */
export function vnDate(d: Date): string {
  const p = toVnParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return vnDate(fromVnParts({ year: y, month: m, day: d + delta, hour: 12 }));
}

/**
 * The most recent window whose end is <= now ("Kỳ gần nhất").
 * Opening the app at 20:00 returns the window that ended at 08:00 today, never an incomplete one.
 */
export function lastCompletedWindow(now: Date, startClock = '17:00', endClock = '08:00'): ReportWindow & { reportDate: string } {
  let date = vnDate(now);
  for (let i = 0; i < 3; i++) {
    const w = windowForReportDate(date, startClock, endClock);
    if (new Date(w.to).getTime() <= now.getTime()) return { ...w, reportDate: date };
    date = addDays(date, -1);
  }
  throw new Error('Không xác định được kỳ gần nhất');
}

/** "Hôm nay": window ending today (may be incomplete if now < end). */
export function todayWindow(now: Date, startClock = '17:00', endClock = '08:00') {
  const reportDate = vnDate(now);
  const w = windowForReportDate(reportDate, startClock, endClock);
  return { ...w, reportDate, incomplete: new Date(w.to).getTime() > now.getTime() };
}

export function yesterdayWindow(now: Date, startClock = '17:00', endClock = '08:00') {
  const reportDate = addDays(vnDate(now), -1);
  return { ...windowForReportDate(reportDate, startClock, endClock), reportDate };
}

/** Half-open membership test: from <= t < to */
export function inWindow(publishedAt: string | null | undefined, w: ReportWindow): boolean {
  if (!publishedAt) return false;
  const t = new Date(publishedAt).getTime();
  if (Number.isNaN(t)) return false;
  return t >= new Date(w.from).getTime() && t < new Date(w.to).getTime();
}

export function validateWindow(w: ReportWindow): string | null {
  const a = new Date(w.from).getTime();
  const b = new Date(w.to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 'Ngày giờ không hợp lệ';
  if (b <= a) return 'Thời điểm kết thúc phải sau thời điểm bắt đầu';
  if (b - a > 31 * 24 * 3600_000) return 'Khoảng thời gian tối đa 31 ngày';
  return null;
}

/** Convert a `datetime-local` value (YYYY-MM-DDTHH:mm, interpreted in Vietnam) to ISO +07:00. */
export function localInputToVnIso(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) throw new Error(`Giá trị ngày giờ không hợp lệ: ${v}`);
  return toVnIso(fromVnParts({ year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +m[4]!, minute: +m[5]! }));
}

/** ISO -> `datetime-local` string in Vietnam wall-clock. */
export function vnIsoToLocalInput(iso: string): string {
  const p = toVnParts(new Date(iso));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Parse timestamps seen on Vietnamese news sites. Strings without offset are interpreted in VN time.
 * Returns ISO +07:00 or null.
 */
export function parsePublisherDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // ISO-like with optional offset
  let m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) {
    const [, y, mo, d, h, mi, se, off] = m;
    if (off) {
      const norm = off === 'Z' ? 'Z' : off.length === 5 ? `${off.slice(0, 3)}:${off.slice(3)}` : off;
      const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se ?? '00'}${norm}`);
      return Number.isNaN(dt.getTime()) ? null : toVnIso(dt);
    }
    return toVnIso(fromVnParts({ year: +y!, month: +mo!, day: +d!, hour: +h!, minute: +mi!, second: +(se ?? 0) }));
  }
  // dd/mm/yyyy hh:mm(:ss)  or  hh:mm dd/mm/yyyy (visible bylines)
  m = /(\d{1,2})\/(\d{1,2})\/(\d{4})\D{0,12}?(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) {
    return toVnIso(fromVnParts({ year: +m[3]!, month: +m[2]!, day: +m[1]!, hour: +m[4]!, minute: +m[5]!, second: +(m[6] ?? 0) }));
  }
  m = /(\d{1,2}):(\d{2})\D{0,12}?(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) {
    return toVnIso(fromVnParts({ year: +m[5]!, month: +m[4]!, day: +m[3]!, hour: +m[1]!, minute: +m[2]! }));
  }
  // RFC 822 (RSS pubDate)
  if (/^[A-Za-z]{3},?\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{2}(?:\d{2})?\s/.test(s)) {
    // RFC 822 allows a two-digit year (Thanh Niên: "Mon, 16 Nov 26 14:20:00 +0700") → 20yy (RFC 2822 §4.3: 00–49 = 20xx)
    let t = s.replace(/^([A-Za-z]{3},?\s+\d{1,2}\s+[A-Za-z]{3}\s+)(\d{2})(\s)/, (_, a: string, yy: string, b: string) => `${a}${Number(yy) < 50 ? 2000 + Number(yy) : 1900 + Number(yy)}${b}`);
    // Some VN feeds emit "+0700" or "GMT+7"
    t = t.replace(/GMT\+7$/i, '+0700');
    const dt = new Date(t);
    if (!Number.isNaN(dt.getTime())) {
      const hasZone = /([+-]\d{4}|GMT|UTC|Z)$/i.test(t.trim());
      if (hasZone) return toVnIso(dt);
      // No zone: JS parsed it as host-local wall clock; re-read those wall-clock parts as VN time
      return toVnIso(
        fromVnParts({
          year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate(),
          hour: dt.getHours(), minute: dt.getMinutes(), second: dt.getSeconds(),
        }),
      );
    }
  }
  return null;
}
