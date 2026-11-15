/**
 * Same-event clustering (SUGGESTIONS only – reviewers merge/split in the UI).
 *  A (strong, transitive):  title content-token Jaccard ≥ 0.45, ≥ 3 title tokens each, published ≤ 72 h apart.
 *  B (content, guarded):    different publishers, ≤ 36 h apart, IDF-weighted overlap of title+sapo tokens ≥ 0.35
 *                           with ≥ 3 shared rare tokens, and the pair must be MUTUAL best B-matches (no chaining).
 * Union-find joins A and B edges so one event never ends up split across two clusters.
 * Tuned on the live 15/11/2026 run (scripts/eval-clusters.ts).
 */
export interface Clusterable {
  id: string;
  sourceId: string;
  title: string;
  sapo: string;
  publishedAt: string | null;
  duplicateGroupId: string | null;
}

const STOP = new Set(
  ('của và các những trong cho với được đã là có người khi tại ở từ về này một không sẽ để theo ra vào lên đến hơn nhiều ' +
    'cũng như thì mà nhưng nên vì do bị sau trước đang vẫn còn rất đó đây năm ngày tháng giờ chiều sáng tối hôm qua nay ' +
    'tp hcm tphcm thành phố hồ chí minh việt nam ông bà anh chị cùng gần khoảng hàng hay hoặc tới qua lại số mới nào gì thế sao') .split(' '),
);

export function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w)));
}
const inter = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
};
const H = 3600_000;

export interface PairEvidence { a: string; b: string; rule: 'A' | 'B'; score: number }

export function clusterArticles<T extends Clusterable>(list: T[], evidence?: PairEvidence[]): Map<string, string[]> {
  const n = list.length;
  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (i: number, j: number) => (parent[find(i)] = find(j));
  const t = list.map((a) => tokens(a.title));
  const c = list.map((a) => tokens(`${a.title} ${a.sapo}`));
  const at = list.map((a) => (a.publishedAt ? new Date(a.publishedAt).getTime() : null));
  const df = new Map<string, number>();
  for (const s of c) for (const w of s) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w: string) => Math.log((n + 1) / (df.get(w) ?? 1));
  const mass = c.map((s) => [...s].reduce((x, w) => x + idf(w), 0));
  const within = (i: number, j: number, hours: number) => at[i] == null || at[j] == null || Math.abs(at[i]! - at[j]!) <= hours * H;

  // A edges
  for (let i = 0; i < n; i++) {
    if (t[i]!.size < 3) continue;
    for (let j = i + 1; j < n; j++) {
      if (t[j]!.size < 3 || !within(i, j, 72)) continue;
      const it = inter(t[i]!, t[j]!);
      const jac = it / (t[i]!.size + t[j]!.size - it);
      if (jac >= 0.45) {
        union(i, j);
        evidence?.push({ a: list[i]!.id, b: list[j]!.id, rule: 'A', score: jac });
      }
    }
  }
  // B: best content match per article OUTSIDE its current cluster (cross-publisher), keep mutual pairs only.
  // Looking outside the cluster lets two half-clusters of one event join (e.g. "Bộ Quốc phòng thông tin…" + "Xe thiết giáp chìm…").
  const best = new Array<{ j: number; s: number } | null>(n).fill(null);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j || find(i) === find(j) || list[i]!.sourceId === list[j]!.sourceId || !within(i, j, 36)) continue;
      let shared = 0;
      let rare = 0;
      for (const w of c[i]!) {
        if (!c[j]!.has(w)) continue;
        shared += idf(w);
        if ((df.get(w) ?? 0) <= 4) rare++;
      }
      const s = shared / (Math.min(mass[i]!, mass[j]!) || 1);
      if (rare >= 3 && s >= 0.35 && (!best[i] || s > best[i]!.s)) best[i] = { j, s };
    }
  }
  for (let i = 0; i < n; i++) {
    const b = best[i];
    if (b && best[b.j]?.j === i && i < b.j) {
      union(i, b.j);
      evidence?.push({ a: list[i]!.id, b: list[b.j]!.id, rule: 'B', score: b.s });
    }
  }

  const members = new Map<number, number[]>();
  list.forEach((_, i) => members.set(find(i), [...(members.get(find(i)) ?? []), i]));
  const groups = new Map<string, string[]>();
  for (const idx of members.values()) {
    if (idx.length < 2) {
      list[idx[0]!]!.duplicateGroupId = null;
      continue;
    }
    const ids = idx.map((i) => list[i]!.id).sort(); // deterministic id → stable across re-runs
    const g = `g_${ids[0]!.slice(2, 12)}`;
    for (const i of idx) list[i]!.duplicateGroupId = g;
    groups.set(g, ids);
  }
  return groups;
}
