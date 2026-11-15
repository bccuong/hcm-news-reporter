import type { Article, CategoryCode, EditorialAssessment, ReviewDecision, Settings } from '../domain/schemas.js';
import type { ReportStory } from './pptx.js';

export interface AssembleResult {
  stories: Array<ReportStory & { articleId: string; imageUrl: string | null; mergedArticleIds: string[] }>;
  blockers: string[];
  warnings: string[];
}

/**
 * Same-event merge model: a secondary article carries `groupId = <primary articleId>` and is not a story on its own.
 * The primary story lists every source (one per publisher, ordered by publication time) – like the template's
 * "Nguồn: Thanh Niên | VnExpress". Only one level: a primary is never itself merged.
 */
export function rootOf(articleId: string, reviews: Record<string, ReviewDecision>): string {
  let id = articleId;
  for (let i = 0; i < 5; i++) {
    const g = reviews[id]?.groupId;
    if (!g || g === id) return id;
    id = g;
  }
  return id;
}

/** Patches needed to merge `secondaryId` into the story of `targetId` (re-points the secondary's own secondaries). */
export function mergePatches(secondaryId: string, targetId: string, reviews: Record<string, ReviewDecision>): Array<{ articleId: string; patch: Partial<ReviewDecision> }> {
  const primary = rootOf(targetId, reviews);
  if (primary === secondaryId || rootOf(secondaryId, reviews) === primary) return [];
  const out: Array<{ articleId: string; patch: Partial<ReviewDecision> }> = [{ articleId: secondaryId, patch: { groupId: primary, included: false } }];
  for (const r of Object.values(reviews)) {
    if (r.groupId === secondaryId) out.push({ articleId: r.articleId, patch: { groupId: primary } });
  }
  if (reviews[primary]?.groupId) out.push({ articleId: primary, patch: { groupId: null } });
  return out;
}

/** Default cover label: cut at a word boundary within `max` chars (editor can always override). */
export function cutWords(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s,:;–-]+$/, '')}…`;
}

export function secondariesOf(primaryId: string, reviews: Record<string, ReviewDecision>): string[] {
  return Object.values(reviews)
    .filter((r) => r.groupId === primaryId && r.articleId !== primaryId)
    .map((r) => r.articleId);
}

/** Build report stories ONLY from reviewer-included items. Missing required facts become blockers, never invented. */
export function assembleStories(articles: Article[], reviews: Record<string, ReviewDecision>, settings: Settings): AssembleResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const catLabel = (c: CategoryCode | null | undefined) => settings.categories.find((x) => x.code === c)?.label ?? 'Chưa phân loại';
  const byId = new Map(articles.map((a) => [a.id, a]));
  const included = Object.values(reviews)
    .filter((r) => r.included && !r.groupId)
    .sort((a, b) => a.order - b.order);
  for (const r of Object.values(reviews)) {
    if (r.included && r.groupId) warnings.push(`"${byId.get(r.articleId)?.title ?? r.articleId}" đã gộp vào tin khác – không xuất thành tin riêng`);
  }
  if (!included.length) blockers.push('Chưa chọn tin nào để xuất báo cáo');
  const counters: Record<EditorialAssessment, number> = { needs_attention: 0, positive: 0, neutral: 0 };
  const stories: AssembleResult['stories'] = [];
  for (const r of included) {
    const a = byId.get(r.articleId);
    if (!a) {
      blockers.push(`Không tìm thấy bài ${r.articleId} trong dữ liệu đã thu thập`);
      continue;
    }
    const group = r.assessment ?? a.suggestedAssessment;
    if (!group) {
      blockers.push(`"${a.title}": chưa chọn tính chất tin`);
      continue;
    }
    if (!a.publishedAt || (a.dateConfidence !== 'verified' && !r.timeVerifiedManually)) {
      blockers.push(`"${a.title}": giờ đăng chưa xác minh`);
      continue;
    }
    if (a.extractionCompleteness !== 'auto_checks_passed' && !r.extractionMarkedComplete) {
      warnings.push(`"${a.title}": nội dung bóc tách chưa đầy đủ, biên tập viên chưa xác nhận`);
    }
    const summary = (r.summary ?? a.sapo ?? '').trim();
    if (!summary) blockers.push(`"${a.title}": chưa có tóm tắt (nhập trong khung biên tập)`);

    // sources: primary + merged secondaries with verified publication time, one link per publisher, chronological
    const merged = secondariesOf(a.id, reviews)
      .map((id) => byId.get(id))
      .filter((x): x is Article => !!x);
    const verifiedMerged: Article[] = [];
    for (const m of merged) {
      const mr = reviews[m.id];
      if (!m.publishedAt || (m.dateConfidence !== 'verified' && !mr?.timeVerifiedManually)) {
        warnings.push(`"${a.title}": nguồn gộp ${m.sourceName} chưa xác minh giờ đăng – không đưa vào dòng Nguồn`);
        continue;
      }
      verifiedMerged.push(m);
    }
    const seen = new Set<string>();
    const sources = [a, ...verifiedMerged] // copy: sorting must not reorder primary/merged bookkeeping
      .sort((x, y) => (x.publishedAt ?? '').localeCompare(y.publishedAt ?? ''))
      .filter((x) => (seen.has(x.sourceName) ? false : (seen.add(x.sourceName), true)))
      .map((x) => ({ name: x.sourceName, url: x.canonicalUrl ?? x.originalUrl, publishedAt: x.publishedAt! }));

    // photo: reviewer choice, else primary's first usable, else first merged article that has one
    let imageUrl: string | null;
    if (r.primaryImageUrl !== undefined) imageUrl = r.primaryImageUrl;
    else {
      const pick = (x: Article) => x.imageCandidates.find((i) => i.rightsStatus !== 'not_usable')?.url ?? null;
      imageUrl = pick(a) ?? verifiedMerged.map(pick).find(Boolean) ?? null;
    }
    const prefix = group === 'needs_attention' ? 'tt' : group === 'positive' ? 'tc' : 'tl';
    counters[group]++;
    stories.push({
      id: `${prefix}${counters[group]}`,
      articleId: a.id,
      mergedArticleIds: verifiedMerged.map((x) => x.id),
      group,
      sector: catLabel(r.primaryCategory ?? a.primaryCategory),
      shortLabel: r.shortLabel ?? cutWords(r.title ?? a.title, 42),
      title: r.title ?? a.title,
      summary,
      sources,
      proposal: group === 'needs_attention' ? r.proposal || 'Đề xuất: đầu mối đề xuất, chờ rà soát.' : undefined,
      image: null,
      imageUrl,
    });
  }
  return { stories, blockers, warnings };
}
