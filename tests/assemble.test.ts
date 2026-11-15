import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/domain/defaults.js';
import type { Article, ReviewDecision } from '../src/domain/schemas.js';
import { assembleStories, mergePatches, rootOf, secondariesOf } from '../src/reports/assemble.js';

const art = (id: string, sourceName: string, publishedAt: string | null, img?: string, dateConfidence: Article['dateConfidence'] = 'verified'): Article => ({
  id, runId: 'run_x', sourceId: sourceName.toLowerCase(), sourceName, originType: 'website', originalUrl: `https://${id}.example.vn/a-1851101001.htm`, canonicalUrl: null,
  title: `[Mẫu thử] ${id}`, sapo: `Tóm tắt ${id}`, bodyText: '', contentSections: [], articleLinks: [], author: null, publishedAt, modifiedAt: null, collectedAt: '',
  dateConfidence, dateEvidence: [], extractionAdapterVersion: 't', extractionCompleteness: 'auto_checks_passed', extractionWarnings: [], continuation: { detected: false, urls: [] },
  location: { status: 'hcm', evidence: [] }, relevance: { status: 'relevant', score: 3, evidence: [] }, primaryCategory: 'FLOOD', secondaryCategories: [], classificationEvidence: [],
  suggestedAssessment: 'needs_attention', assessmentEvidence: [],
  imageCandidates: img ? [{ url: img, sourceArticleUrl: '', origin: 'og:image', rightsStatus: 'review' }] : [], duplicateGroupId: 'g1', warnings: [],
});
const rev = (articleId: string, p: Partial<ReviewDecision> = {}): ReviewDecision => ({ articleId, included: false, order: 0, updatedAt: '', changes: [], ...p });

describe('same-event multi-source stories (DIS-06)', () => {
  const arts = [
    art('p', 'Thanh Niên', '2026-11-08T19:30:00+07:00'),
    art('s1', 'VnExpress', '2026-11-08T18:10:00+07:00', 'https://s1.example.vn/photo.jpg'),
    art('s2', 'Thanh Niên', '2026-11-08T21:00:00+07:00'),
    art('s3', 'Tuổi Trẻ', null, undefined, 'unknown'),
  ];
  it('one story with every publisher, chronological, photo from a merged source, unverified source excluded with warning', () => {
    const reviews = {
      p: rev('p', { included: true, order: 1 }),
      s1: rev('s1', { groupId: 'p' }),
      s2: rev('s2', { groupId: 'p' }),
      s3: rev('s3', { groupId: 'p', included: true }),
    };
    const r = assembleStories(arts, reviews, defaultSettings());
    expect(r.blockers).toEqual([]);
    expect(r.stories).toHaveLength(1); // merged items never become separate stories
    const st = r.stories[0]!;
    expect(st.sources.map((s) => s.name)).toEqual(['VnExpress', 'Thanh Niên']); // ordered by time, one per publisher
    expect(st.imageUrl).toBe('https://s1.example.vn/photo.jpg');
    expect(st.mergedArticleIds.sort()).toEqual(['s1', 's2']);
    expect(r.warnings.join(' ')).toContain('Tuổi Trẻ chưa xác minh giờ đăng');
    expect(r.warnings.join(' ')).toContain('đã gộp vào tin khác');
  });
  it('default cover label is cut at a word boundary within 42 chars', async () => {
    const { cutWords } = await import('../src/reports/assemble.js');
    const l = cutWords('Mưa lớn tối 8.11 khiến nhiều tuyến đường ở phường Hiệp Bình ngập sâu', 42);
    expect(l.length).toBeLessThanOrEqual(42);
    expect(l).toBe('Mưa lớn tối 8.11 khiến nhiều tuyến đường…');
    expect(cutWords('Ngắn gọn', 42)).toBe('Ngắn gọn');
  });
  it('merge patches: no self-merge, one level only, re-points children, split restores', () => {
    const reviews: Record<string, ReviewDecision> = { p: rev('p', { included: true }), s1: rev('s1', { groupId: 'p' }), x: rev('x', { included: true }) };
    expect(mergePatches('p', 'p', reviews)).toEqual([]);
    expect(mergePatches('s1', 'p', reviews)).toEqual([]); // already in that story
    // merging story p (which has child s1) into x: p and s1 both point at x
    const ps = mergePatches('p', 'x', reviews);
    expect(ps).toContainEqual({ articleId: 'p', patch: { groupId: 'x', included: false } });
    expect(ps).toContainEqual({ articleId: 's1', patch: { groupId: 'x' } });
    // merging into a secondary resolves to its root primary
    expect(mergePatches('x', 's1', reviews)[0]).toEqual({ articleId: 'x', patch: { groupId: 'p', included: false } });
    expect(rootOf('s1', reviews)).toBe('p');
    expect(secondariesOf('p', reviews)).toEqual(['s1']);
  });
});
