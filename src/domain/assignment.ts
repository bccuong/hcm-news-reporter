import type { Article, Settings } from './schemas.js';
import { findWord } from './text.js';

/**
 * "Tồn tại cần khắc phục": suggested unit to handle the issue (Sở Xây dựng TP.HCM guidance, 16/11/2026).
 * Rules are user settings (Cài đặt › Báo cáo & mẫu); the editor can always rewrite the proposal.
 * The rule with the strongest evidence wins: a keyword in the title counts 3, in the sapo 1.
 */
export function suggestAssignment(a: Pick<Article, 'title' | 'sapo'>, settings: Settings): { text: string; rule: string | null; evidence: string[] } {
  const rules = settings.editorial.assignmentRules ?? [];
  let best: { score: number; i: number; hits: string[] } | null = null;
  rules.forEach((r, i) => {
    let score = 0;
    const hits: string[] = [];
    for (const k of r.keywords) {
      if (!k.trim()) continue;
      const t = findWord(a.title, k) >= 0;
      const s = findWord(a.sapo, k) >= 0;
      if (t || s) {
        score += t ? 3 : 1;
        hits.push(k);
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { score, i, hits };
  });
  if (!best) return { text: `Đề xuất: ${settings.editorial.assignmentFallback}`, rule: null, evidence: [] };
  const b = best as { score: number; i: number; hits: string[] };
  const r = rules[b.i]!;
  return { text: `Đề xuất: giao ${r.unit}.`, rule: r.name, evidence: b.hits };
}
