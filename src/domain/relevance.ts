import { classifyCategory, suggestAssessment } from './classify.js';
import { detectLocation } from './location.js';
import { evaluateRule } from './rules.js';
import type { Article, Settings } from './schemas.js';
import { findPhraseNotName, findWord } from './text.js';

export interface RelevanceVerdict {
  status: 'relevant' | 'review' | 'irrelevant';
  reasonCode: string | null;
  evidence: string[];
  ruleTrace: string[];
  location: ReturnType<typeof detectLocation>;
}

export function activePresetFor(settings: Settings, sourceId: string) {
  const specific = settings.rules.presets.find((p) => p.sourceIds.includes(sourceId));
  return specific ?? settings.rules.presets.find((p) => p.id === settings.rules.activePresetId) ?? settings.rules.presets[0] ?? null;
}

/**
 * Combine topic rule + geography into a verdict. Missing evidence -> review (never silently dropped).
 * Only explicit evidence (exclusion phrase, rule NOT branch, other-province title without HCM evidence) yields irrelevant.
 */
export function judgeRelevance(title: string, body: string, sourceId: string, settings: Settings, sapo = ''): RelevanceVerdict {
  const location = detectLocation(title, body, settings.location, sapo);
  const preset = activePresetFor(settings, sourceId);
  const evidence: string[] = [];
  let ruleTrace: string[] = [];

  for (const p of settings.keywords.excludePhrases) {
    if (p && findPhraseNotName(title, p) >= 0) {
      return { status: 'irrelevant', reasonCode: 'EXCLUDED_PHRASE', evidence: [`Tiêu đề chứa cụm loại trừ "${p}"`], ruleTrace, location };
    }
  }

  let topicOk = true;
  if (preset) {
    const r = evaluateRule(preset.root, { title, body }, settings.keywords.synonyms);
    ruleTrace = [`Bộ quy tắc: ${preset.name}`, ...r.lines];
    topicOk = r.matched;
    evidence.push(...r.hits.slice(0, 5).map((h) => `Từ khóa "${h.via}" (${h.field})`));
  }

  // national news of the sector itself (ministry events are mostly held in Hà Nội): never excluded for its place
  const nationalSector = (settings.location.nationalSectorPhrases ?? []).find((p) => p && (findWord(title, p) >= 0 || findWord(sapo, p) >= 0));
  if (location.status === 'other_province' && settings.location.requireHcmEvidence) {
    // Explicit evidence of another province and no HCM evidence -> excluded WITH reason (visible, overridable)
    return {
      status: location.leadHit || nationalSector ? 'review' : 'irrelevant',
      reasonCode: 'NOT_GEOGRAPHICALLY_RELEVANT',
      evidence: [...evidence, ...location.evidence],
      ruleTrace,
      location,
    };
  }
  // Sector must be named in the lead (title/sapo): broad body words ("dự án", "công trình") match too many stories.
  if (settings.rules.requireSectorInLead) {
    const lead = classifyCategory(title, sapo, settings.categories);
    if (!lead.primary) {
      // strong sector evidence in the body (e.g. a road-network plan whose title says "mạng đường bộ") → reviewer decides, never silently lost
      const min = settings.rules.bodySectorScoreForReview;
      const full = min > 0 ? classifyCategory(title, body, settings.categories, sapo) : null;
      const best = full ? Math.max(0, ...Object.values(full.scores).map((v) => v ?? 0)) : 0;
      if (full && best >= min && (location.status === 'hcm' || location.status === 'connected')) {
        return {
          status: 'review', reasonCode: 'SECTOR_ONLY_IN_BODY',
          evidence: [...evidence, ...location.evidence, `Tiêu đề/sapo không nêu lĩnh vực nhưng thân bài có bằng chứng mạnh (điểm ${best} ≥ ${min}): ${full.evidence.filter((e) => !e.includes('không tính'))[0] ?? ''}`], ruleTrace, location,
        };
      }
      return {
        status: 'irrelevant', reasonCode: 'NO_SECTOR_IN_LEAD',
        evidence: [...evidence, 'Tiêu đề và sapo không có từ khóa của lĩnh vực nào (Cài đặt › Từ khóa & quy tắc để tắt quy tắc này)'], ruleTrace, location,
      };
    }
  }
  if (!topicOk) {
    // Rule did not match. If geography is strongly HCM, still keep for review per unknownRelevancePolicy.
    const policyReview = settings.rules.unknownRelevancePolicy === 'review' && location.status === 'hcm';
    return {
      status: policyReview ? 'review' : 'irrelevant',
      reasonCode: 'TOPIC_RULE_NOT_MATCHED',
      evidence: [...evidence, ...location.evidence, 'Không khớp bộ quy tắc chủ đề'],
      ruleTrace,
      location,
    };
  }
  if (location.status === 'unknown' && location.score === 0 && settings.location.noEvidencePolicy === 'exclude_with_reason') {
    // a clear sector keyword in the TITLE keeps the story reviewable even without place names (never silently lose it)
    const titleSector = classifyCategory(title, '', settings.categories);
    // strong sector evidence in title + sapo, or a sector policy/law (national rules apply to the city too);
    // one generic title word ("bồi thường" in a Microsoft story, "xây dựng thế hệ…") is not enough
    const leadSector = classifyCategory(title, sapo, settings.categories);
    const best = Math.max(0, ...Object.values(leadSector.scores).map((v) => v ?? 0));
    const strong = !!nationalSector || (titleSector.scores.POLICY ?? 0) >= 3 || (best >= 3 && best >= settings.location.noPlaceMinLeadScore);
    if (strong) {
      return { status: 'review', reasonCode: 'LOCATION_UNVERIFIED', evidence: [...evidence, ...location.evidence, `Tiêu đề có từ khóa lĩnh vực (${titleSector.evidence[0] ?? ''}) – giữ lại để kiểm tra địa bàn`], ruleTrace, location };
    }
    return { status: 'irrelevant', reasonCode: 'NO_HCM_EVIDENCE', evidence: [...evidence, ...location.evidence], ruleTrace, location };
  }
  if (location.status === 'hcm') {
    // HCM named only in passing deep in the body → editor confirms
    if (!location.leadHit && (location.distinct ?? 0) < settings.location.minBodyAreasWithoutLead) {
      return {
        status: 'review', reasonCode: 'HCM_ONLY_IN_BODY',
        evidence: [...evidence, ...location.evidence, `${settings.location.regionName} không có trong tiêu đề/sapo, chỉ ${location.distinct} địa danh trong thân bài`], ruleTrace, location,
      };
    }
    return { status: 'relevant', reasonCode: null, evidence: [...evidence, ...location.evidence], ruleTrace, location };
  }
  if (location.status === 'connected' && settings.location.connectedAreasForReview) {
    return { status: 'review', reasonCode: 'CONNECTED_AREA', evidence: [...evidence, ...location.evidence], ruleTrace, location };
  }
  return {
    status: settings.location.requireHcmEvidence ? 'review' : 'relevant',
    reasonCode: 'LOCATION_UNVERIFIED',
    evidence: [...evidence, ...location.evidence],
    ruleTrace,
    location,
  };
}

/** Fill relevance/classification fields on an extracted article. */
export function annotateArticle(a: Article, settings: Settings): Article & { _verdict: RelevanceVerdict } {
  const body = [a.sapo, a.bodyText].join('\n');
  const verdict = judgeRelevance(a.title, body, a.sourceId, settings, a.sapo);
  const cat = classifyCategory(a.title, body, settings.categories, a.sapo);
  const asmt = suggestAssessment(a.title, body);
  // Broad keywords ("dự án", "đất"…) match many unrelated stories: without sector evidence in the title or
  // ≥3 sector keyword hits, a rule match is not enough to be "ready" – it goes to the review queue (not dropped).
  const best = Math.max(0, ...Object.values(cat.scores).map((v) => v ?? 0));
  if (verdict.status === 'relevant' && best < 3) {
    verdict.status = 'review';
    verdict.reasonCode = 'WEAK_TOPIC_EVIDENCE';
    verdict.evidence.push(`Bằng chứng lĩnh vực yếu (điểm ${best} < 3) – cần biên tập viên xác nhận`);
  }
  return {
    ...a,
    location: { status: verdict.location.status, evidence: verdict.location.evidence },
    relevance: { status: verdict.status, score: verdict.location.score, evidence: [...verdict.evidence, ...verdict.ruleTrace.slice(0, 1)] },
    primaryCategory: cat.primary,
    secondaryCategories: cat.secondary,
    classificationEvidence: cat.evidence,
    suggestedAssessment: asmt.value,
    assessmentEvidence: [`Độ tin cậy: ${asmt.confidence === 'medium' ? 'trung bình' : 'thấp'} (gợi ý, cần biên tập viên xác nhận)`, ...asmt.evidence],
    _verdict: verdict,
  };
}
