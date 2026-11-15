import type { Article, Candidate, ReviewDecision, RunManifest } from './schemas.js';

/**
 * Relevance quality measured on REAL editorial decisions.
 *  - Editor label per article: explicit "Liên quan / Không liên quan" (ReviewDecision.relevanceLabel),
 *    or implicitly "relevant" when the article was put into a report (included / merged as a source).
 *  - System verdict = the bucket the collector put the article in:
 *      ready    – ready_for_review without reason (tab "Sẵn sàng")
 *      review   – ready_for_review with a reason, parsed_partial, date_unverified (tab "Cần kiểm tra")
 *      excluded – irrelevant_with_evidence (only visible in the ledger)
 *  Precision(ready) = R / (R + N) among labelled ready items.
 *  Recall = relevant found in ready+review / all labelled relevant (incl. ones the editor rescued from "excluded").
 */
export type Bucket = 'ready' | 'review' | 'excluded';
export type EditorLabel = 'relevant' | 'irrelevant';

export function bucketOf(c: Candidate): Bucket | null {
  if (c.state === 'irrelevant_with_evidence') return 'excluded';
  if (c.state === 'ready_for_review') return c.reasonCode ? 'review' : 'ready';
  if (c.state === 'parsed_partial' || c.state === 'date_unverified' || c.state === 'reviewed') return 'review';
  return null; // outside window, duplicates, fetch errors: not a relevance decision
}

export function labelOf(r: ReviewDecision | undefined): EditorLabel | null {
  if (!r) return null;
  if (r.relevanceLabel) return r.relevanceLabel;
  if (r.included || r.groupId) return 'relevant';
  return null;
}

export interface QualityCounts { ready: { R: number; N: number }; review: { R: number; N: number }; excluded: { R: number; N: number } }
export interface RunQuality extends QualityCounts { runId: string; window: RunManifest['window']; candidates: number; labelled: number }
export interface Missed { runId: string; articleId: string; title: string; url: string; source: string; reasonCode: string | null }
export interface RelevanceQuality {
  runs: RunQuality[];
  total: QualityCounts & { labelled: number };
  precisionReady: number | null;
  recall: number | null;
  missed: Missed[];
  falseReady: Missed[];
}

const empty = (): QualityCounts => ({ ready: { R: 0, N: 0 }, review: { R: 0, N: 0 }, excluded: { R: 0, N: 0 } });

export function computeRelevanceQuality(
  data: Array<{ manifest: Pick<RunManifest, 'runId' | 'window'>; candidates: Candidate[]; articles: Article[]; reviews: Record<string, ReviewDecision> }>,
): RelevanceQuality {
  const total = { ...empty(), labelled: 0 };
  const runs: RunQuality[] = [];
  const missed: Missed[] = [];
  const falseReady: Missed[] = [];
  for (const d of data) {
    const arts = new Map(d.articles.map((a) => [a.id, a]));
    const q: RunQuality = { runId: d.manifest.runId, window: d.manifest.window, candidates: 0, labelled: 0, ...empty() };
    for (const c of d.candidates) {
      const b = bucketOf(c);
      if (!b || !c.articleId) continue;
      q.candidates++;
      const l = labelOf(d.reviews[c.articleId]);
      if (!l) continue;
      q.labelled++;
      q[b][l === 'relevant' ? 'R' : 'N']++;
      const a = arts.get(c.articleId);
      const row = { runId: d.manifest.runId, articleId: c.articleId, title: a?.title ?? c.url, url: c.url, source: a?.sourceName ?? c.sourceId, reasonCode: c.reasonCode };
      if (b === 'excluded' && l === 'relevant') missed.push(row);
      if (b === 'ready' && l === 'irrelevant') falseReady.push(row);
    }
    for (const b of ['ready', 'review', 'excluded'] as const) for (const k of ['R', 'N'] as const) total[b][k] += q[b][k];
    total.labelled += q.labelled;
    runs.push(q);
  }
  const allR = total.ready.R + total.review.R + total.excluded.R;
  return {
    runs,
    total,
    precisionReady: total.ready.R + total.ready.N ? total.ready.R / (total.ready.R + total.ready.N) : null,
    recall: allR ? (total.ready.R + total.review.R) / allR : null,
    missed,
    falseReady,
  };
}
