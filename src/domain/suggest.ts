/**
 * Daily filter suggestions learned from the team's review (no AI model: every suggestion is a plain filter change that
 * the editor applies or dismisses in Cài đặt › Gợi ý cải thiện).
 *
 * Ground truth per story: the majority ✓/✗ vote; otherwise the review decision – chosen for the report or moved to
 * "Bài sẵn sàng" = relevant, "Loại" = not relevant. Each candidate phrase is tried by replaying the filter on the
 * stories it touches; a suggestion is kept only when it fixes at least one judged story and breaks none.
 *   include       – add the phrase to the words of the active rule: keeps relevant stories that were excluded
 *   exclude_title – drop stories whose title contains the phrase: removes off-topic stories from "Bài sẵn sàng"
 *   place         – a place of the city the filter does not know yet
 *   sector        – a sector keyword: relevant stories stuck in "Cần kiểm tra" for weak sector evidence go to "Sẵn sàng"
 *   setting       – a rule setting (e.g. national stories with the sector in the title → Sẵn sàng), tried on every judged
 *                   story; kept when it puts clearly more stories right than wrong (the editor sees both counts)
 * Stories the team moved to "Sẵn sàng" by hand while the filter left them in "Cần kiểm tra" are lessons too (18/11/2026).
 */
import { classifyCategory } from './classify.js';
import { annotateArticle } from './relevance.js';
import type { Article, CategoryCode, RuleGroup, RuleNode, RuleTerm, Settings } from './schemas.js';
import { findWord, normText } from './text.js';
import { scoreStory, type LearnedModel } from './learn.js';

export interface FilterSuggestion {
  id: string;
  kind: 'include' | 'exclude_title' | 'place' | 'sector' | 'setting';
  /** the word / place / title phrase; for a setting, a short text of the change */
  phrase: string;
  /** setting: which value it changes, from what to what */
  setting?: { path: string; value: string | number | boolean; from: string | number | boolean; label: string };
  /** setting: judged stories it would put wrong (shown to the editor) */
  harms?: number;
  harmExamples?: string[];
  /** include: the sector the word is added to as well (a story needs a sector word in its title/sapo) */
  category?: CategoryCode;
  /** judged stories it puts right */
  fixes: number;
  /** stories not judged yet whose status changes (moved into or out of "Bài sẵn sàng") */
  sideEffects: number;
  examples: string[];
  /** example title → address of the original article (the editor opens it from the suggestion) */
  links?: Record<string, string>;
  sideExamples: string[];
}
export interface Judged { relevant: boolean; why: 'label' | 'decision'; category?: string | null }
export type Status = 'relevant' | 'review' | 'irrelevant';

const STOP = new Set(
  'của và ở tại cho với là được các những một trong người khi có không này đã sẽ về từ đến theo sau trên dưới ra vào lên nhiều hơn cũng như đang vẫn còn rất thì mà nên nếu do bị để vì gì nào đó đây ai sao hay hoặc cùng tới qua mới năm ngày tháng giờ lúc phút tp tphcm hcm lại thêm vừa hết rồi luôn nữa chỉ đều sắp từng mỗi bằng triệu tỷ tỉ nghìn ngàn đồng usd gần hơn khoảng hàng chục trăm'.split(' '), // amounts ("triệu đồng", 18/11/2026) are no topic
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
export function applySuggestion(s: Settings, x: Pick<FilterSuggestion, 'kind' | 'phrase' | 'category' | 'setting'>): Settings {
  if (x.kind === 'exclude_title') return withTitleExclusion(s, x.phrase);
  if (x.kind === 'place') return withPlace(s, x.phrase);
  if (x.kind === 'sector') return withCategoryKeyword(s, x.category ?? 'BUILD', x.phrase);
  if (x.kind === 'setting') return x.setting ? withSetting(s, x.setting.path, x.setting.value) : s;
  const r = withIncludeWord(s, x.phrase);
  return x.category ? withCategoryKeyword(r, x.category, x.phrase) : r;
}
/** settings with one value changed: "location.nationalToReady" = true */
export function withSetting(s: Settings, path: string, value: string | number | boolean): Settings {
  const [group, key] = path.split('.') as [keyof Settings, string];
  const g = s[group] as unknown as Record<string, unknown> | undefined;
  if (!g || typeof g !== 'object' || !(key in g)) return s;
  return { ...s, [group]: { ...g, [key]: value } } as Settings;
}
/** rule settings worth trying on the judged stories (only those that differ from the current configuration) */
function settingTries(s: Settings): Array<{ path: string; value: string | number | boolean; from: string | number | boolean; label: string }> {
  const R = s.location.regionName;
  const out: Array<{ path: string; value: string | number | boolean; from: string | number | boolean; label: string }> = [];
  const add = (path: string, from: string | number | boolean | undefined, value: string | number | boolean, label: string) => {
    if (from !== undefined && from !== value) out.push({ path, value, from, label });
  };
  add('location.nationalToReady', s.location.nationalToReady, true, `Tin chung (chính sách cả nước, hoặc chỉ nhắc ${R} trong thân bài) có từ khóa lĩnh vực ở tiêu đề → Bài sẵn sàng`);
  add('location.nationalToReady', s.location.nationalToReady, false, `Tin chung có từ khóa lĩnh vực ở tiêu đề → để ở Cần kiểm tra (không tự vào Bài sẵn sàng)`);
  if (s.location.minBodyAreasWithoutLead > 1) add('location.minBodyAreasWithoutLead', s.location.minBodyAreasWithoutLead, s.location.minBodyAreasWithoutLead - 1, `${R} không có ở tiêu đề/sapo: chỉ cần ${s.location.minBodyAreasWithoutLead - 1} địa danh trong thân bài để vào Bài sẵn sàng`);
  add('location.minBodyAreasWithoutLead', s.location.minBodyAreasWithoutLead, s.location.minBodyAreasWithoutLead + 1, `${R} không có ở tiêu đề/sapo: cần ${s.location.minBodyAreasWithoutLead + 1} địa danh trong thân bài để vào Bài sẵn sàng`);
  add('location.noPlaceKeep', s.location.noPlaceKeep, s.location.noPlaceKeep === 'policy_only' ? 'strong_sector' : 'policy_only', s.location.noPlaceKeep === 'policy_only' ? `Bài không có địa danh ${R} nhưng tiêu đề + sapo có từ khóa lĩnh vực mạnh → giữ lại (Cần kiểm tra)` : `Bài không có địa danh ${R}: chỉ giữ chính sách, pháp quy chung của ngành`);
  add('location.connectedNeedsLead', s.location.connectedNeedsLead, !s.location.connectedNeedsLead, s.location.connectedNeedsLead ? 'Dự án liên vùng chỉ có trong thân bài → giữ lại (không loại)' : 'Dự án liên vùng chỉ có trong thân bài (không có địa danh thành phố) → loại kèm lý do');
  if (s.rules.bodySectorScoreForReview > 3) add('rules.bodySectorScoreForReview', s.rules.bodySectorScoreForReview, s.rules.bodySectorScoreForReview - 1, `Tiêu đề/sapo không nêu lĩnh vực: giữ lại (Cần kiểm tra) khi thân bài đạt ${s.rules.bodySectorScoreForReview - 1} điểm lĩnh vực`);
  return out;
}
/** settings with a place of the city (e.g. "khu đô thị Vạn Phúc") added to Địa điểm */
export function withPlace(s: Settings, name: string): Settings {
  if (s.location.areas.some((a) => [a.name, ...a.aliases].some((x) => normText(x) === normText(name)))) return s;
  return { ...s, location: { ...s.location, areas: [...s.location.areas, { id: `loc_sg_${normText(name).replace(/[^\p{L}\p{N}]+/gu, '_')}`, name, kind: 'landmark', aliases: [], requirePrefix: false }] } };
}
const PLACE_PREFIX = 'phường|xã|đường|khu đô thị|khu dân cư|khu công nghiệp|khu chế xuất|chợ|cầu|kênh|rạch|công viên|bến xe|bến phà|cảng|ga|nút giao|vòng xoay|chung cư';
/** "<kind of place> <Proper Name>" in a text, e.g. "khu đô thị Vạn Phúc", "chợ Bình Điền" (kept as written) */
export function placesOf(text: string): string[] {
  // the kind of place in any case ("phường" / "Phường"), the name itself capitalised word by word
  const prefix = PLACE_PREFIX.split('|').map((w) => `[${w[0]}${w[0]!.toUpperCase()}]${w.slice(1)}`).join('|');
  const re = new RegExp(`(?<![\\p{L}])(${prefix})\\s+((?:\\p{Lu}[\\p{Ll}\\p{M}]*(?:[ \\t]+|(?=[^\\p{L}\\p{M}])|$)){1,4})`, 'gu');
  const out = new Set<string>();
  for (const m of text.normalize('NFC').matchAll(re)) out.add(`${m[1]!.toLowerCase()} ${m[2]!.trim()}`.replace(/\s+/g, ' '));
  return [...out];
}
/** settings with `phrase` added to the title exclusions */
export function withTitleExclusion(s: Settings, phrase: string): Settings {
  if (s.keywords.excludePhrases.some((k) => normText(k) === normText(phrase))) return s;
  return { ...s, keywords: { ...s.keywords, excludePhrases: [...s.keywords.excludePhrases, phrase] } };
}

/** titles of different stories: near-identical titles (one press release on two sites, a re-published story) count once */
export function distinctStories(titles: string[]): string[] {
  const set = (t: string) => new Set(normText(t).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1));
  const kept: Array<Set<string>> = [];
  const out: string[] = [];
  for (const t of titles) {
    const w = set(t);
    const same = kept.some((k) => {
      let both = 0;
      for (const x of w) if (k.has(x)) both++;
      return both / Math.max(1, w.size + k.size - both) >= 0.75; // share of all words: ≥ 75 % the same
    });
    if (!same) (kept.push(w), out.push(t));
  }
  return out;
}

/** the suggestion is already in the settings (applied and saved): not shown again until the nightly list is renewed */
export function alreadyApplied(s: Settings, x: Pick<FilterSuggestion, 'kind' | 'phrase' | 'category' | 'setting'>): boolean {
  const p = normText(x.phrase);
  if (x.kind === 'include') return (includeGroup(s)?.group.children ?? []).some((c) => c.kind === 'term' && !c.negate && normText(c.value) === p);
  if (x.kind === 'sector') return s.categories.some((c) => c.keywords.some((k) => normText(k) === p));
  if (x.kind === 'place') return s.location.areas.some((a) => [a.name, ...a.aliases].some((n) => normText(n) === p));
  if (x.kind === 'exclude_title') return s.keywords.excludePhrases.some((k) => normText(k) === p);
  if (x.kind === 'setting' && x.setting) {
    const [g, k] = x.setting.path.split('.') as [keyof Settings, string];
    return (s[g] as unknown as Record<string, unknown> | undefined)?.[k] === x.setting.value;
  }
  return false;
}

export function statusOf(a: Article, s: Settings): Status {
  return annotateArticle(a, s).relevance.status as Status;
}

export function suggestFilter(articles: Article[], judged: Map<string, Judged>, s: Settings, opts: { dismissed?: string[]; max?: number; minFixes?: number } = {}): FilterSuggestion[] {
  const minFixes = opts.minFixes ?? 2;
  const dismissed = new Set(opts.dismissed ?? []);
  const base = new Map(articles.map((a) => [a.id, statusOf(a, s)]));
  const lead = (a: Article) => `${a.title}\n${a.sapo ?? ''}`;
  // another province's / region's name is never a word to look for ("hà nội" was proposed on 18/11/2026)
  const elsewhere = s.location.otherProvinces.filter(Boolean).map(normText);
  const placeWord = (p: string) => elsewhere.some((o) => findWord(p, o) >= 0);
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
      const hit = kind === 'exclude_title' ? findWord(a.title, phrase) >= 0 : findWord(`${a.title}\n${a.sapo ?? ''}\n${a.bodyText ?? ''}`, phrase) >= 0;
      if (!hit) continue;
      const before = base.get(a.id)!;
      const after = statusOf(a, next);
      if (after === before) continue;
      const j = judged.get(a.id);
      const rank = (x: Status) => (x === 'relevant' ? 2 : x === 'review' ? 1 : 0);
      const good = kind === 'include' ? before === 'irrelevant' && after !== 'irrelevant' : kind === 'place' ? rank(after) > rank(before) : before === 'relevant' && after !== 'relevant';
      if (j) {
        const right = kind === 'exclude_title' ? !j.relevant : j.relevant;
        if (good && right) (fixes++, examples.push(a.title));
        else harms++;
      } else if ((kind !== 'exclude_title' && after === 'relevant') || (kind === 'exclude_title' && before !== 'irrelevant')) {
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
  const consider = (kind: FilterSuggestion['kind'], targets: Article[], source: (a: Article) => string, candidates: (text: string) => string[] = (x) => phrasesOf(x, pairs)) => {
    // candidate phrases ranked by how many target stories contain them
    const support = new Map<string, number>();
    for (const a of targets) for (const p of candidates(source(a))) if (!known.has(normText(p)) && (kind === 'place' || !placeWord(p))) support.set(p, (support.get(p) ?? 0) + 1);
    const ranked = [...support].sort((x, y) => y[1] - x[1] || y[0].length - x[0].length).slice(0, 40); // same support: the longer (more specific) phrase first
    const tried: FilterSuggestion[] = [];
    for (const [phrase] of ranked) {
      const id = `${kind}:${phrase}`;
      if (dismissed.has(id)) continue;
      const category = kind === 'include' ? sectorFor(targets.filter((a) => findWord(source(a), phrase) >= 0)) : undefined;
      const r = evaluate(kind, phrase, category);
      const fixes = distinctStories(r.examples).length;
      if (fixes < minFixes || r.harms > 0) continue; // a trend (≥ 2 different stories), not one story's wording
      tried.push({ id, kind, phrase, ...(category ? { category } : {}), fixes, sideEffects: r.side, examples: r.examples, sideExamples: r.sideExamples });
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
  // relevant stories the team moved to "Sẵn sàng" by hand while the filter left them in "Cần kiểm tra": a sector word in
  // their title is often all that is missing (weak sector evidence / national story)
  const stuck = articles.filter((a) => judged.get(a.id)?.relevant && base.get(a.id) === 'review');
  out.push(...considerUp('sector', stuck));
  out.push(...settingSuggestions());
  out.push(...consider('exclude_title', wrong, (a) => a.title));
  // places the filter does not know: relevant stories held back because no place of the city was recognised
  const placeless = articles.filter((a) => judged.get(a.id)?.relevant && base.get(a.id) !== 'relevant' && annotateArticle(a, s)._verdict.location.status !== 'hcm');
  const knownPlaces = new Set(s.location.areas.flatMap((x) => [x.name, ...x.aliases]).map(normText));
  out.push(...consider('place', placeless, (a) => `${a.title}\n${a.sapo ?? ''}\n${a.bodyText ?? ''}`, (x) => placesOf(x).filter((pl) => !knownPlaces.has(normText(pl)) && !knownPlaces.has(normText(pl.replace(/^\S+(?:\s(?:đô thị|dân cư|công nghiệp|chế xuất|viên|xe|phà|giao|xoay|cư))?\s/, ''))))));
  const urlOf = new Map(articles.map((a) => [a.title, (a as Article & { url?: string }).canonicalUrl ?? a.originalUrl ?? (a as Article & { url?: string }).url ?? '']));
  return out.slice(0, opts.max ?? 12).map((x) => ({
    ...x,
    links: Object.fromEntries([...x.examples, ...x.sideExamples, ...(x.harmExamples ?? [])].map((t) => [t, urlOf.get(t) ?? '']).filter(([, u]) => u)),
  }));

  /** a change judged on every judged story it moves: up for a relevant one / down for an off-topic one is right */
  function judgeChange(next: Settings, touch: (a: Article) => boolean) {
    const rank = (x: Status) => (x === 'relevant' ? 2 : x === 'review' ? 1 : 0);
    let fixes = 0, harms = 0, side = 0;
    const examples: string[] = [], harmExamples: string[] = [], sideExamples: string[] = [];
    for (const a of articles) {
      if (!touch(a)) continue;
      const before = base.get(a.id)!;
      const after = statusOf(a, next);
      if (after === before) continue;
      const j = judged.get(a.id);
      if (j) {
        const right = j.relevant ? rank(after) > rank(before) : rank(after) < rank(before);
        if (right) (fixes++, examples.push(a.title));
        else (harms++, harmExamples.push(a.title));
      } else if (after === 'relevant' || before === 'relevant') {
        side++;
        if (sideExamples.length < 3) sideExamples.push(a.title);
      }
    }
    return { fixes, harms, side, examples, harmExamples, sideExamples };
  }
  /** sector keywords from the titles of stuck relevant stories (no judged story may get worse) */
  function considerUp(kind: 'sector', targets: Article[]): FilterSuggestion[] {
    const support = new Map<string, number>();
    const inSector = new Set(s.categories.flatMap((c) => c.keywords.map(normText)));
    for (const a of targets) for (const p of phrasesOf(a.title, pairs)) if (!inSector.has(normText(p)) && !known.has(normText(p)) && !placeWord(p)) support.set(p, (support.get(p) ?? 0) + 1);
    const tried: FilterSuggestion[] = [];
    for (const [phrase] of [...support].sort((x, y) => y[1] - x[1] || y[0].length - x[0].length).slice(0, 30)) {
      const id = `${kind}:${phrase}`;
      if (dismissed.has(id)) continue;
      const category = sectorFor(targets.filter((a) => findWord(a.title, phrase) >= 0));
      const r = judgeChange(withCategoryKeyword(s, category, phrase), (a) => findWord(`${a.title}\n${a.sapo ?? ''}\n${a.bodyText ?? ''}`, phrase) >= 0);
      const fixes = distinctStories(r.examples).length;
      if (fixes < minFixes || r.harms > 0) continue;
      tried.push({ id, kind, phrase, category, fixes, sideEffects: r.side, examples: r.examples.slice(0, 3), sideExamples: r.sideExamples });
    }
    tried.sort((a, b) => b.fixes - a.fixes || a.sideEffects - b.sideEffects || b.phrase.length - a.phrase.length);
    const covered = new Set<string>();
    return tried.filter((x) => (x.examples.every((e) => covered.has(e)) ? false : (x.examples.forEach((e) => covered.add(e)), true)));
  }
  /** rule settings: kept when they put at least minFixes judged stories right and at most a quarter as many wrong */
  function settingSuggestions(): FilterSuggestion[] {
    const found: FilterSuggestion[] = [];
    for (const t of settingTries(s)) {
      const id = `setting:${t.path}=${t.value}`;
      if (dismissed.has(id)) continue;
      const r = judgeChange(withSetting(s, t.path, t.value), () => true);
      if (r.fixes < Math.max(minFixes, 3) || r.harms * 4 > r.fixes) continue;
      found.push({ id, kind: 'setting', phrase: t.label.slice(0, 80), setting: t, fixes: r.fixes, harms: r.harms, harmExamples: r.harmExamples.slice(0, 3), sideEffects: r.side, examples: r.examples.slice(0, 3), sideExamples: r.sideExamples });
    }
    return found.sort((a, b) => b.fixes - (b.harms ?? 0) - (a.fixes - (a.harms ?? 0)));
  }
}

/* ---------- impact preview of a settings change on the judged stories ("bộ bài chuẩn") ---------- */
export interface FilterScore { judged: number; precision: number | null; recall: number | null; ready: number; readyRight: number; relevant: number; kept: number }
export function scoreFilter(articles: Article[], judged: Map<string, Judged>, s: Settings, statuses?: Map<string, Status>): FilterScore {
  let ready = 0, readyRight = 0, relevant = 0, kept = 0, n = 0;
  for (const a of articles) {
    const j = judged.get(a.id);
    if (!j) continue;
    n++;
    const st = statuses?.get(a.id) ?? statusOf(a, s);
    if (st === 'relevant') (ready++, j.relevant && readyRight++);
    if (j.relevant) (relevant++, st !== 'irrelevant' && kept++);
  }
  return { judged: n, precision: ready ? readyRight / ready : null, recall: relevant ? kept / relevant : null, ready, readyRight, relevant, kept };
}
export interface ImpactChange { id: string; title: string; relevant: boolean; before: Status; after: Status; better: boolean }
export function impactOf(articles: Article[], judged: Map<string, Judged>, before: Settings, after: Settings) {
  const sb = new Map<string, Status>(), sa = new Map<string, Status>();
  const changes: ImpactChange[] = [];
  for (const a of articles) {
    const j = judged.get(a.id);
    if (!j) continue;
    const b = statusOf(a, before), x = statusOf(a, after);
    sb.set(a.id, b);
    sa.set(a.id, x);
    if (b === x) continue;
    // better: a relevant story kept / moved up, an off-topic one moved out of "Sẵn sàng"
    const rank = (st: Status) => (st === 'relevant' ? 2 : st === 'review' ? 1 : 0);
    changes.push({ id: a.id, title: a.title, relevant: j.relevant, before: b, after: x, better: j.relevant ? rank(x) > rank(b) : rank(x) < rank(b) });
  }
  return { before: scoreFilter(articles, judged, before, sb), after: scoreFilter(articles, judged, after, sa), changes };
}

/* ---------- "Hỏi nhanh": the stories the filter is least sure about (one vote on these teaches the most) ---------- */
export interface UncertainStory { article: Article; status: Status; why: string; weight: number; /** self-learned probability of relevant */ learned?: number }
export function uncertainStories(articles: Article[], s: Settings, skip: Set<string>, max = 8, model?: Pick<LearnedModel, 'prior' | 'w'> | null): UncertainStory[] {
  const out: UncertainStory[] = [];
  for (const a of articles) {
    if (skip.has(a.id)) continue;
    const r = annotateArticle(a, s);
    const v = r._verdict;
    // the self-learned model knows the TOPIC the team wants, not the place: its disagreement with a topic decision of the
    // rules is the most useful question (excluded for the place → never asked)
    const p = model ? scoreStory(model, a) : null;
    const pct = p === null ? '' : `${Math.round(p * 100)}%`;
    const placeReason = ['NOT_GEOGRAPHICALLY_RELEVANT', 'NO_HCM_EVIDENCE'].includes(v.reasonCode ?? '');
    if (p !== null && v.status === 'irrelevant' && !placeReason && v.reasonCode !== 'EXCLUDED_PHRASE' && p >= 0.8) {
      out.push({ article: a, status: 'irrelevant', why: `Máy tự học chấm ${pct} là bài liên quan, nhưng bộ lọc đã loại (${v.reasonCode === 'NO_SECTOR_IN_LEAD' ? 'tiêu đề/sapo không có từ của ngành' : 'không khớp quy tắc'})`, weight: 1 + p / 10, learned: p });
      continue;
    }
    if (p !== null && v.status === 'relevant' && p <= 0.2) {
      out.push({ article: a, status: 'relevant', why: `Đang ở Bài sẵn sàng nhưng máy tự học chỉ chấm ${pct} là bài liên quan`, weight: 0.95 + (1 - p) / 20, learned: p });
      continue;
    }
    const body = `${a.sapo ?? ''}\n${a.bodyText ?? ''}`;
    const best = Math.max(0, ...Object.values(classifyCategory(a.title, body, s.categories, a.sapo ?? '').scores).map((x) => x ?? 0));
    const st = v.status as Status;
    const hcm = v.location.status === 'hcm';
    let why = '', weight = 0;
    if (st === 'irrelevant' && hcm && ['NO_SECTOR_IN_LEAD', 'TOPIC_RULE_NOT_MATCHED', 'EXCLUDED_PHRASE'].includes(v.reasonCode ?? '') && best >= 2) {
      why = v.reasonCode === 'EXCLUDED_PHRASE' ? 'Bị loại vì một cụm loại trừ, nhưng đúng địa bàn và có từ của ngành' : 'Bị loại sát nút: đúng địa bàn, thân bài có từ của ngành nhưng tiêu đề/sapo không có';
      weight = 0.9 + Math.min(best, 10) / 100;
    } else if (st === 'relevant' && best <= 3) {
      why = 'Vào Sẵn sàng với điểm lĩnh vực vừa đủ ngưỡng';
      weight = 0.7;
    } else if (st === 'relevant' && hcm && !v.location.leadHit) {
      why = 'Vào Sẵn sàng nhưng TP.HCM chỉ có trong thân bài';
      weight = 0.6;
    } else if (st === 'review') {
      // the filter could not decide: exactly what a reviewer's answer teaches
      // (stories excluded because the title / sapo names another province are NOT asked: clear without a person, 17/11/2026)
      why = `Máy chưa quyết được – đang ở Cần kiểm tra${p !== null ? ` (máy tự học: ${pct} liên quan)` : ''}`;
      // the model unsure too (near 50 %) → asked a little earlier
      weight = 0.5 + Math.min(best, 10) / 100 + (p !== null ? (0.5 - Math.abs(p - 0.5)) / 10 : 0);
    }
    if (weight) out.push({ article: a, status: st, why, weight, ...(p !== null ? { learned: p } : {}) });
  }
  return out.sort((x, y) => y.weight - x.weight).slice(0, max);
}
