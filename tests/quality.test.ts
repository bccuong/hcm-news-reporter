import { describe, expect, it } from 'vitest';
import { bucketOf, computeRelevanceQuality, labelOf } from '../src/domain/quality.js';
import type { Candidate, ReviewDecision } from '../src/domain/schemas.js';

const c = (id: string, state: Candidate['state'], reasonCode: string | null = null): Candidate => ({
  id: `c_${id}`, runId: 'run_q', sourceId: 's', url: `https://x.example.vn/${id}-1851101001.htm`, canonicalUrl: null, discoveredVia: [], discoveredAt: '', state, reasonCode,
  reasonDetail: null, httpStatus: 200, attempts: 1, attemptedAt: null, parserVersion: null, articleId: `a_${id}`, history: [],
});
const r = (id: string, p: Partial<ReviewDecision>): ReviewDecision => ({ articleId: `a_${id}`, included: false, order: 0, updatedAt: '', changes: [], ...p });

describe('filter quality from editor labels', () => {
  it('buckets follow the dashboard tabs', () => {
    expect(bucketOf(c('1', 'ready_for_review'))).toBe('ready');
    expect(bucketOf(c('2', 'ready_for_review', 'HCM_ONLY_IN_BODY'))).toBe('review');
    expect(bucketOf(c('3', 'date_unverified'))).toBe('review');
    expect(bucketOf(c('4', 'irrelevant_with_evidence', 'NO_SECTOR_IN_LEAD'))).toBe('excluded');
    expect(bucketOf(c('5', 'outside_window'))).toBeNull();
  });
  it('explicit label wins; included / merged count as relevant; unlabelled ignored', () => {
    expect(labelOf(r('1', { relevanceLabel: 'irrelevant', included: true }))).toBe('irrelevant');
    expect(labelOf(r('1', { included: true }))).toBe('relevant');
    expect(labelOf(r('1', { groupId: 'a_9' }))).toBe('relevant');
    expect(labelOf(r('1', {}))).toBeNull();
  });
  it('precision of "ready", recall incl. stories rescued from the excluded list', () => {
    const q = computeRelevanceQuality([
      {
        manifest: { runId: 'run_q', window: { from: '', to: '' } },
        candidates: [c('1', 'ready_for_review'), c('2', 'ready_for_review'), c('3', 'ready_for_review', 'X'), c('4', 'irrelevant_with_evidence', 'NO_HCM_EVIDENCE'), c('5', 'irrelevant_with_evidence'), c('6', 'ready_for_review')],
        articles: [],
        reviews: { a_1: r('1', { included: true }), a_2: r('2', { relevanceLabel: 'irrelevant' }), a_3: r('3', { relevanceLabel: 'relevant' }), a_4: r('4', { relevanceLabel: 'relevant' }) },
      },
    ]);
    expect(q.total.labelled).toBe(4);
    expect(q.precisionReady).toBe(0.5); // a_1 R, a_2 N
    expect(q.recall).toBeCloseTo(2 / 3); // a_1, a_3 found; a_4 missed
    expect(q.missed.map((m) => m.articleId)).toEqual(['a_4']);
    expect(q.missed[0]!.reasonCode).toBe('NO_HCM_EVIDENCE');
    expect(q.falseReady.map((m) => m.articleId)).toEqual(['a_2']);
  });
});
