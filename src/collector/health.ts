import type { AdapterHealth, Article, Candidate } from '../domain/schemas.js';

/**
 * DIS-08 – detect a publisher markup change ("adapter degraded").
 * Per source and run we record extraction health; a run is compared with up to 3 previous HEALTHY runs.
 * Degraded → the source's articles lose automatic "complete" labelling and go to the review queue until a later
 * healthy run (after the operator rescans / adjusts the source) re-establishes the baseline.
 */
export function measureHealth(sourceId: string, cands: Candidate[], arts: Article[]): Omit<AdapterHealth, 'status' | 'reasons' | 'baseline'> {
  const mine = cands.filter((c) => c.sourceId === sourceId);
  const fetched = mine.filter((c) => c.httpStatus === 200).length;
  const parseFailed = mine.filter((c) => c.state === 'parse_failed').length;
  const ids = new Set(mine.map((c) => c.articleId).filter(Boolean));
  const myArts = arts.filter((a) => a.sourceId === sourceId && ids.has(a.id));
  // video/podcast stories are partial by nature, not an adapter fault
  const partial = myArts.filter((a) => a.extractionCompleteness === 'partial' && !a.extractionWarnings.every((w) => /^(MEDIA_ARTICLE|ADAPTER_DEGRADED)/.test(w))).length;
  const dateUnknown = myArts.filter((a) => a.dateConfidence === 'unknown').length;
  const containers = new Map<string, number>();
  for (const a of myArts) {
    // undefined = not recorded (article carried over from data published before the field existed) – not evidence of drift
    if (a.extractionContainer === undefined) continue;
    const k = a.extractionContainer ?? '(none)';
    containers.set(k, (containers.get(k) ?? 0) + 1);
  }
  const top = [...containers.entries()].sort((x, y) => y[1] - x[1])[0];
  return {
    fetched,
    parseFailed,
    partial,
    dateUnknown,
    failRate: fetched ? (parseFailed + partial + dateUnknown) / fetched : 0,
    mainContainer: top?.[0] ?? null,
    containerShare: top && myArts.length ? top[1] / myArts.length : 0,
    containers: Object.fromEntries(containers),
  };
}

export const MIN_SAMPLE = 5;

export function assessHealth(current: ReturnType<typeof measureHealth>, history: AdapterHealth[]): AdapterHealth {
  const reasons: string[] = [];
  const healthy = history.filter((h) => h.status === 'ok' && h.fetched >= MIN_SAMPLE).slice(0, 3);
  const baseline = {
    runs: healthy.length,
    failRate: healthy.length ? healthy.reduce((s, h) => s + h.failRate, 0) / healthy.length : null,
    mainContainer: healthy[0]?.mainContainer ?? null,
  };
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (current.fetched < MIN_SAMPLE) {
    return { ...current, status: 'unknown', reasons: [`Chỉ ${current.fetched} bài được tải – chưa đủ mẫu để đánh giá bộ bóc tách`], baseline };
  }
  if (baseline.failRate != null) {
    if (current.failRate >= 0.3 && current.failRate >= baseline.failRate + 0.25) {
      reasons.push(`Tỉ lệ bài lỗi/thiếu/không rõ giờ tăng từ ${pct(baseline.failRate)} (${baseline.runs} lượt trước) lên ${pct(current.failRate)}`);
    }
    if (baseline.mainContainer && baseline.mainContainer !== '(none)') {
      // share among the articles whose container is known (= fetched − parse failures for a fresh run)
      // needs evidence: at least MIN_SAMPLE articles with a known container (an hourly run that only carried articles over has none)
      const known = Object.values(current.containers).reduce((s, n) => s + n, 0);
      const stillUsed = (current.containers[baseline.mainContainer] ?? 0) / Math.max(1, known);
      if (known >= MIN_SAMPLE && current.mainContainer !== baseline.mainContainer && stillUsed < 0.5) {
        reasons.push(`Khung nội dung bài đổi từ "${baseline.mainContainer}" sang "${current.mainContainer ?? 'không xác định'}" – báo có thể đã đổi giao diện`);
      }
    }
  } else if (current.failRate >= 0.5) {
    reasons.push(`${pct(current.failRate)} bài lỗi/thiếu/không rõ giờ (chưa có lượt trước để so sánh)`);
  }
  return { ...current, status: reasons.length ? 'degraded' : 'ok', reasons, baseline };
}
