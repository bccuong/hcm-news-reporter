import { classifyCategory, suggestAssessment } from './classify.js';
import { detectLocation } from './location.js';
import { evaluateRule } from './rules.js';
import type { Article, Settings } from './schemas.js';
import { findWord } from './text.js';

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
export function judgeRelevance(title: string, body: string, sourceId: string, settings: Settings): RelevanceVerdict {
  const location = detectLocation(title, body, settings.location);
  const preset = activePresetFor(settings, sourceId);
  const evidence: string[] = [];
  let ruleTrace: string[] = [];

  for (const p of settings.keywords.excludePhrases) {
    if (p && findWord(title, p) >= 0) {
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

  if (location.status === 'other_province' && settings.location.requireHcmEvidence) {
    // Explicit evidence of another province and no HCM evidence -> excluded WITH reason (visible, overridable)
    return {
      status: location.score > 0 ? 'review' : 'irrelevant',
      reasonCode: 'NOT_GEOGRAPHICALLY_RELEVANT',
      evidence: [...evidence, ...location.evidence],
      ruleTrace,
      location,
    };
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
  if (location.status === 'hcm') return { status: 'relevant', reasonCode: null, evidence: [...evidence, ...location.evidence], ruleTrace, location };
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
  const verdict = judgeRelevance(a.title, body, a.sourceId, settings);
  const cat = classifyCategory(a.title, body, settings.categories);
  const asmt = suggestAssessment(a.title, body);
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
