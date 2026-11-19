import type { CategoryCode, EditorialAssessment, Settings } from './schemas.js';
import { blankPhrases, findWord } from './text.js';

export interface CategoryResult {
  primary: CategoryCode | null;
  secondary: CategoryCode[];
  evidence: string[];
  scores: Partial<Record<CategoryCode, number>>;
}

/** removes a category's excluded phrases ("yêu cầu" for the keyword "cầu") before matching */
const stripPhrases = blankPhrases;

/**
 * Keyword-scored topic suggestion; title hits weigh 3x. A suggestion only – reviewer decides.
 * `lead` = the sapo (defaults to `body`, for callers that pass only title + sapo): a category with
 * `requiresCategories` (e.g. "Chính sách, pháp quy") counts only when the title or lead also names one of them.
 */
export function classifyCategory(title: string, body: string, categories: Settings['categories'], lead: string = body): CategoryResult {
  const scores: Partial<Record<CategoryCode, number>> = {};
  const evidence: string[] = [];
  const inLead = new Set<CategoryCode>();
  const raw: Array<{ c: Settings['categories'][number]; s: number; hits: string[] }> = [];
  for (const c of categories) {
    if (!c.enabled) continue;
    const ex = c.excludePhrases ?? [];
    const [ti, bo, le] = ex.length ? [stripPhrases(title, ex), stripPhrases(body, ex), stripPhrases(lead, ex)] : [title, body, lead];
    let s = 0;
    const hits: string[] = [];
    for (const k of c.keywords) {
      const t = findWord(ti, k) >= 0;
      const b = findWord(bo, k) >= 0;
      if (t || b) {
        s += t ? 3 : 1;
        hits.push(`${k}${t ? '*' : ''}`);
      }
      if (t || findWord(le, k) >= 0) inLead.add(c.code);
    }
    if (s > 0) raw.push({ c, s, hits });
  }
  for (const { c, s, hits } of raw) {
    const req = c.requiresCategories ?? [];
    if (req.length && !req.some((r) => r !== c.code && inLead.has(r))) {
      const names = req.map((r) => categories.find((x) => x.code === r)?.label ?? r).join(', ');
      evidence.push(`${c.label}: không tính (${hits.slice(0, 3).join(', ')}) – tiêu đề/sapo không thuộc lĩnh vực ${names}`);
      continue;
    }
    scores[c.code] = s;
    evidence.push(`${c.label}: ${hits.slice(0, 6).join(', ')} (điểm ${s})`);
  }
  const ranked = (Object.entries(scores) as Array<[CategoryCode, number]>).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    const pa = categories.find((c) => c.code === a[0])?.priority ?? 99;
    const pb = categories.find((c) => c.code === b[0])?.priority ?? 99;
    return pa - pb;
  });
  return {
    primary: ranked[0]?.[0] ?? null,
    secondary: ranked.slice(1, 3).filter(([, s]) => s >= 2).map(([c]) => c),
    evidence,
    scores,
  };
}

const NEGATIVE = [
  'ngập sâu', 'ngập nặng', 'ngập', 'sập', 'sụp', 'sụt lún', 'sạt lở', 'nứt', 'nguy hiểm', 'cấp d', 'sự cố', 'ùn tắc', 'kẹt xe',
  'vi phạm', 'trái phép', 'không phép', 'chậm tiến độ', 'đình trệ', 'bỏ hoang', 'xuống cấp', 'cháy', 'tai nạn', 'bức xúc',
  'khiếu nại', 'ô nhiễm', 'thất thoát', 'treo', 'dang dở', 'chật vật',
];
const POSITIVE = [
  'khánh thành', 'thông xe', 'hoàn thành', 'đưa vào sử dụng', 'đưa vào khai thác', 'vượt tiến độ', 'về đích', 'khởi công',
  'giải ngân đạt', 'tháo gỡ', 'hết ngập', 'chống ngập hiệu quả', 'bàn giao', 'cấp sổ', 'cải thiện',
];
/** Concrete incidents – these override forecast/plan wording */
const STRONG_NEGATIVE = ['ngập sâu', 'ngập nặng', 'sập', 'sụp', 'cấp d', 'sự cố', 'vi phạm', 'trái phép', 'cháy', 'tai nạn', 'sạt lở', 'sụt lún'];
const NEUTRAL_HINTS = ['dự thảo', 'lấy ý kiến', 'đề xuất', 'kiến nghị', 'kế hoạch', 'dự báo', 'cảnh báo', 'nghiên cứu', 'dự kiến'];

/**
 * Editorial-assessment suggestion, independent of topic. "Flood" ≠ negative by itself:
 * completion/hết ngập phrases outweigh it; forecasts/warnings are neutral.
 */
export function suggestAssessment(title: string, body: string): { value: EditorialAssessment; evidence: string[]; confidence: 'low' | 'medium' } {
  const lead = `${title}\n${body.slice(0, 600)}`;
  const neg = NEGATIVE.filter((k) => findWord(lead, k) >= 0);
  const pos = POSITIVE.filter((k) => findWord(lead, k) >= 0);
  const neu = NEUTRAL_HINTS.filter((k) => findWord(title, k) >= 0);
  const titleNeg = NEGATIVE.filter((k) => findWord(title, k) >= 0).length;
  const titlePos = POSITIVE.filter((k) => findWord(title, k) >= 0).length;
  const ev = [
    ...neg.map((k) => `tiêu cực: "${k}"`),
    ...pos.map((k) => `tích cực: "${k}"`),
    ...neu.map((k) => `trung lập: "${k}"`),
  ];
  const strongNegInTitle = STRONG_NEGATIVE.some((k) => findWord(title, k) >= 0);
  if (neu.length && !strongNegInTitle && titlePos === 0) return { value: 'neutral', evidence: ev, confidence: 'medium' };
  const n = neg.length + titleNeg * 2;
  const p = pos.length + titlePos * 2;
  if (n > p && n > 0) return { value: 'needs_attention', evidence: ev, confidence: n >= 3 ? 'medium' : 'low' };
  if (p > n && p > 0) return { value: 'positive', evidence: ev, confidence: p >= 3 ? 'medium' : 'low' };
  return { value: 'neutral', evidence: ev.length ? ev : ['không có tín hiệu rõ – mặc định trung lập'], confidence: 'low' };
}

export const ASSESSMENT_LABEL: Record<EditorialAssessment, string> = {
  needs_attention: 'Cần nghiên cứu, xử lý',
  positive: 'Chuyển động tích cực',
  neutral: 'Tin trung lập',
};
