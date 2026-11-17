/**
 * Daily filter suggestions learned from the team's review (no AI model: every suggestion is a plain filter change that
 * the editor applies or dismisses in Cài đặt › Gợi ý cải thiện).
 *
 * Ground truth per story: the majority ✓/✗ vote; otherwise the review decision – chosen for the report or moved to
 * "Bài sẵn sàng" = relevant, "Loại" = not relevant. Each candidate phrase is tried by replaying the filter on the
 * stories it touches; a suggestion is kept only when it fixes at least one judged story and breaks none.
 *   include       – add the phrase to the words of the active rule: keeps relevant stories that were excluded
 *   exclude_title – drop stories whose title contains the phrase: removes off-topic stories from "Bài sẵn sàng"
 */
import { annotateArticle } from './relevance.js';
import type { Article, CategoryCode, RuleGroup, RuleNode, RuleTerm, Settings } from './schemas.js';
import { findWord, normText } from './text.js';

export interface FilterSuggestion {
  id: string;
  kind: 'include' | 'exclude_title';
  phrase: string;
  /** include: the sector the word is added to as well (a story needs a sector word in its title/sapo) */
  category?: CategoryCode;
  /** judged stories it puts right */
  fixes: number;
  /** stories not judged yet whose status changes (moved into or out of "Bài sẵn sàng") */
  sideEffects: number;
  examples: string[];
  sideExamples: string[];
}
export interface Judged { relevant: boolean; why: 'label' | 'decision'; category?: string | null }
export type Status = 'relevant' | 'review' | 'irrelevant';

const STOP = new Set(
  'của và ở tại cho với là được các những một trong người khi có không này đã sẽ về từ đến theo sau trên dưới ra vào lên nhiều hơn cũng như đang vẫn còn rất thì mà nên nếu do bị để vì gì nào đó đây ai sao hay hoặc cùng tới qua mới năm ngày tháng giờ lúc phút tp tphcm hcm lại thêm vừa hết rồi luôn nữa chỉ đều sắp từng mỗi bằng'.split(' '),
);
const CITY = /^(tp\.?|tphcm|hcm|thành phố|hồ chí minh|sài gòn)$/;

const wordsOf = (text: string) => normText(text).replace(/[“”"'‘’.,:;!?()[\]{}|/\\–—…-]+/g, ' ').split(' ').filter(Boolean);
/** how often each pair of neighbouring syllables occurs (Vietnamese compounds such as "xây dựng" are frequent pairs) */
export function pairCounts(texts: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of texts) {
    const w = wordsOf(t);
    for (let i = 0; i + 1 < w.length; i++) m.set(`${w[i]} ${w[i + 1]}`, (m.get(`${w[i]} ${w[i + 1]}`) ?? 0) + 1);
  }
  return m;
}
/**
 * 2–4 word phrases of a text, without function words at the ends, digits or the city name. With pair counts, a phrase
 * that cuts a compound at an end ("dựng trung tâm" cuts "xây dựng") is left out.
 */
export function phrasesOf(text: string, pairs?: Map<string, number>): string[] {
  const words = wordsOf(text);
  const c = (a?: string, b?: string) => (a && b && pairs ? pairs.get(`${a} ${b}`) ?? 0 : 0);
  const out = new Set<string>();
  for (let n = 2; n <= 4; n++)
    for (let i = 0; i + n <= words.length; i++) {
      const w = words.slice(i, i + n);
      if (STOP.has(w[0]!) || STOP.has(w[n - 1]!) || w.some((x) => /\d/.test(x) || x.length < 2) || CITY.test(w.join(' '))) continue;
      if (pairs && (c(words[i - 1], w[0]) > c(w[0], w[1]) || c(w[n - 1], words[i + n]) > c(w[n - 2], w[n - 1]))) continue;
      out.add(w.join(' '));
    }
  return [...out];
}

/** the active rule's "one of these words" group (AND[OR words, …]); null when the rule has another shape */
export function includeGroup(s: Settings): { root: RuleGroup; group: RuleGroup } | null {
  const preset = s.rules.presets.find((p) => p.id === s.rules.activePresetId) ?? s.rules.presets[0];
  const root = preset?.root as RuleGroup | undefined;
  const first = root && root.kind === 'group' && root.op === 'AND' && !root.negate ? root.children[0] : undefined;
  return first && first.kind === 'group' && first.op === 'OR' && !first.negate ? { root: root!, group: first } : null;
}
let seq = 0;
/** settings with `word` added to the active rule's words (and the topic list kept in step) */
export function withIncludeWord(s: Settings, word: string): Settings {
  const g = includeGroup(s);
  if (!g) return s;
  if (g.group.children.some((c) => c.kind === 'term' && !c.negate && normText(c.value) === normText(word))) return s;
  const term: RuleTerm = { kind: 'term', id: `t_sg_${Date.now().toString(36)}_${++seq}`, field: 'any', match: 'word', value: word, negate: false };
  const group: RuleGroup = { ...g.group, children: [...g.group.children, term] as RuleNode[] };
  const root: RuleGroup = { ...g.root, children: [group, ...g.root.children.slice(1)] };
  const id = (s.rules.presets.find((p) => p.id === s.rules.activePresetId) ?? s.rules.presets[0])!.id;
  return {
    ...s,
    keywords: { ...s.keywords, topicKeywords: s.keywords.topicKeywords.some((k) => normText(k) === normText(word)) ? s.keywords.topicKeywords : [...s.keywords.topicKeywords, word] },
    rules: { ...s.rules, presets: s.rules.presets.map((p) => (p.id === id ? { ...p, root } : p)) },
  };
}
/** settings with `word` added to a sector's keywords */
export function withCategoryKeyword(s: Settings, code: CategoryCode, word: string): Settings {
  return { ...s, categories: s.categories.map((c) => (c.code === code && !c.keywords.some((k) => normText(k) === normText(word)) ? { ...c, keywords: [...c.keywords, word] } : c)) };
}
/** what applying a suggestion changes */
export function applySuggestion(s: Settings, x: Pick<FilterSuggestion, 'kind' | 'phrase' | 'category'>): Settings {
  if (x.kind === 'exclude_title') return withTitleExclusion(s, x.phrase);
  const r = withIncludeWord(s, x.phrase);
  return x.category ? withCategoryKeyword(r, x.category, x.phrase) : r;
}
/** settings with `phrase` added to the title exclusions */
export function withTitleExclusion(s: Settings, phrase: string): Settings {
  if (s.keywords.excludePhrases.some((k) => normText(k) === normText(phrase))) return s;
  return { ...s, keywords: { ...s.keywords, excludePhrases: [...s.keywords.excludePhrases, phrase] } };
}

export function statusOf(a: Article, s: Settings): Status {
  return annotateArticle(a, s).relevance.status as Status;
}

export function suggestFilter(articles: Article[], judged: Map<string, Judged>, s: Settings, opts: { dismissed?: string[]; max?: number; minFixes?: number } = {}): FilterSuggestion[] {
  const minFixes = opts.minFixes ?? 2;
  const dismissed = new Set(opts.dismissed ?? []);
  const base = new Map(articles.map((a) => [a.id, statusOf(a, s)]));
  const lead = (a: Article) => `${a.title}\n${a.sapo ?? ''}`;
  const known = new Set([...(includeGroup(s)?.group.children ?? []).filter((c): c is RuleTerm => c.kind === 'term').map((c) => normText(c.value)), ...s.keywords.excludePhrases.map(normText)]);
  const missed = articles.filter((a) => judged.get(a.id)?.relevant && base.get(a.id) === 'irrelevant');
  const wrong = articles.filter((a) => judged.get(a.id)?.relevant === false && base.get(a.id) === 'relevant');
  const out: FilterSuggestion[] = [];
  const pairs = pairCounts(articles.map((a) => `${a.title}\n${a.sapo ?? ''}`));

  const evaluate = (kind: FilterSuggestion['kind'], phrase: string, category?: CategoryCode) => {
    const next = applySuggestion(s, { kind, phrase, category });
    let fixes = 0, harms = 0, side = 0;
    const examples: string[] = [], sideExamples: string[] = [];
    for (const a of articles) {
      const hit = kind === 'include' ? findWord(`${a.title}\n${a.sapo ?? ''}\n${a.bodyText ?? ''}`, phrase) >= 0 : findWord(a.title, phrase) >= 0;
      if (!hit) continue;
      const before = base.get(a.id)!;
      const after = statusOf(a, next);
      if (after === before) continue;
      const j = judged.get(a.id);
      const good = kind === 'include' ? before === 'irrelevant' && after !== 'irrelevant' : before === 'relevant' && after !== 'relevant';
      if (j) {
        const right = kind === 'include' ? j.relevant : !j.relevant;
        if (good && right) (fixes++, examples.push(a.title));
        else harms++;
      } else if ((kind === 'include' && after === 'relevant') || (kind === 'exclude_title' && before !== 'irrelevant')) {
        side++;
        if (sideExamples.length < 3) sideExamples.push(a.title);
      }
    }
    return { fixes, harms, side, examples, sideExamples };
  };

  /** sector for an added word: the reviewers' sector, else the one the body points to, else "Xây dựng" */
  const sectorFor = (list: Article[]): CategoryCode => {
    const votes = new Map<string, number>();
    for (const a of list) {
      const c = judged.get(a.id)?.category ?? annotateArticle(a, s).primaryCategory;
      if (c && s.categories.some((x) => x.code === c && x.enabled)) votes.set(c, (votes.get(c) ?? 0) + 1);
    }
    return ([...votes].sort((a, b) => b[1] - a[1])[0]?.[0] as CategoryCode | undefined) ?? 'BUILD';
  };
  const consider = (kind: FilterSuggestion['kind'], targets: Article[], source: (a: Article) => string) => {
    // candidate phrases ranked by how many target stories contain them
    const support = new Map<string, number>();
    for (const a of targets) for (const p of phrasesOf(source(a), pairs)) if (!known.has(p)) support.set(p, (support.get(p) ?? 0) + 1);
    const ranked = [...support].sort((x, y) => y[1] - x[1] || y[0].length - x[0].length).slice(0, 40); // same support: the longer (more specific) phrase first
    const tried: FilterSuggestion[] = [];
    for (const [phrase] of ranked) {
      const id = `${kind}:${phrase}`;
      if (dismissed.has(id)) continue;
      const category = kind === 'include' ? sectorFor(targets.filter((a) => findWord(source(a), phrase) >= 0)) : undefined;
      const r = evaluate(kind, phrase, category);
      if (r.fixes < minFixes || r.harms > 0) continue; // a trend (≥ 2 stories), not one story's wording
      tried.push({ id, kind, phrase, ...(category ? { category } : {}), fixes: r.fixes, sideEffects: r.side, examples: r.examples, sideExamples: r.sideExamples });
    }
    // best first (most stories fixed, fewest side effects, more specific); one suggestion per wrongly filtered story is enough
    tried.sort((a, b) => b.fixes - a.fixes || a.sideEffects - b.sideEffects || b.phrase.length - a.phrase.length);
    const covered = new Set<string>();
    const found: FilterSuggestion[] = [];
    for (const x of tried) {
      if (x.examples.every((e) => covered.has(e))) continue;
      x.examples.forEach((e) => covered.add(e));
      found.push({ ...x, examples: x.examples.slice(0, 3) });
    }
    return found;
  };

  out.push(...consider('include', missed, lead));
  out.push(...consider('exclude_title', wrong, (a) => a.title));
  return out.slice(0, opts.max ?? 12);
}
