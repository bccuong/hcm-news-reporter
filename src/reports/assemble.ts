import type { Article, CategoryCode, EditorialAssessment, ReviewDecision, Settings } from '../domain/schemas.js';
import type { ReportStory } from './pptx.js';

export interface AssembleResult {
  stories: Array<ReportStory & { articleId: string; imageUrl: string | null }>;
  blockers: string[];
  warnings: string[];
}

/** Build report stories ONLY from reviewer-included items. Missing required facts become blockers, never invented. */
export function assembleStories(articles: Article[], reviews: Record<string, ReviewDecision>, settings: Settings): AssembleResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const catLabel = (c: CategoryCode | null | undefined) => settings.categories.find((x) => x.code === c)?.label ?? 'Chưa phân loại';
  const included = Object.values(reviews)
    .filter((r) => r.included)
    .sort((a, b) => a.order - b.order);
  if (!included.length) blockers.push('Chưa chọn tin nào để xuất báo cáo');
  const counters: Record<EditorialAssessment, number> = { needs_attention: 0, positive: 0, neutral: 0 };
  const stories: AssembleResult['stories'] = [];
  for (const r of included) {
    const a = articles.find((x) => x.id === r.articleId);
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
    const prefix = group === 'needs_attention' ? 'tt' : group === 'positive' ? 'tc' : 'tl';
    counters[group]++;
    const imageUrl = r.primaryImageUrl === undefined ? (a.imageCandidates.find((i) => i.rightsStatus !== 'not_usable')?.url ?? null) : r.primaryImageUrl;
    stories.push({
      id: `${prefix}${counters[group]}`,
      articleId: a.id,
      group,
      sector: catLabel(r.primaryCategory ?? a.primaryCategory),
      shortLabel: (r.shortLabel ?? (r.title ?? a.title)).slice(0, 60),
      title: r.title ?? a.title,
      summary,
      sources: [{ name: a.sourceName, url: a.canonicalUrl ?? a.originalUrl, publishedAt: a.publishedAt }],
      proposal: group === 'needs_attention' ? r.proposal || 'Đề xuất: đầu mối đề xuất, chờ rà soát.' : undefined,
      image: null,
      imageUrl,
    });
  }
  return { stories, blockers, warnings };
}
