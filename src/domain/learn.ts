/**
 * Self-learned second opinion (no AI service, no paid API): a small word-statistics model (naive Bayes over words and
 * word pairs of the title, sapo and the start of the body), trained every night on the stories the team judged
 * (✓/✗ votes, and stories chosen / moved to "Sẵn sàng" / removed). The rule-based filter still decides; the model only
 * points at stories where it disagrees with the rules, which "Hỏi nhanh" asks first (an answer there teaches the most).
 */
import type { Article } from './schemas.js';

export interface LearnedModel {
  v: 1;
  trainedAt: string;
  /** judged stories it was trained on */
  n: { relevant: number; irrelevant: number };
  /** log prior odds relevant : not relevant */
  prior: number;
  /** log odds per feature (word or word pair); features seen fewer than twice are left out */
  w: Record<string, number>;
  /** share of judged stories the model gets right when they were left out of training (5-fold cross-validation) */
  accuracy: number | null;
}

const STOP = new Set('của và ở tại cho với là được các những một trong người khi có không này đã sẽ về từ đến theo sau trên dưới ra vào lên nhiều hơn cũng như đang vẫn còn rất thì mà nên nếu do bị để vì gì nào đó đây ai sao hay hoặc cùng tới qua mới năm ngày tháng giờ lúc phút lại thêm vừa hết rồi luôn nữa chỉ đều sắp từng mỗi bằng'.split(' '));
const words = (s: string) =>
  s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter((x) => x.length > 1 && !/^\d+$/.test(x));

/** features of a story: title words count twice (the title says what the story is about) */
export function featuresOf(a: Pick<Article, 'title' | 'sapo' | 'bodyText'>): Map<string, number> {
  const f = new Map<string, number>();
  const add = (text: string, weight: number) => {
    const ws = words(text);
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i]!;
      if (!STOP.has(w)) f.set(w, (f.get(w) ?? 0) + weight);
      const p = ws[i + 1];
      if (p && !(STOP.has(w) && STOP.has(p))) f.set(`${w} ${p}`, (f.get(`${w} ${p}`) ?? 0) + weight);
    }
  };
  add(a.title ?? '', 2);
  add(a.sapo ?? '', 1);
  add((a.bodyText ?? '').slice(0, 800), 1);
  // presence, not frequency: a long story must not outweigh a short one
  for (const [k, v] of f) f.set(k, Math.min(v, 2));
  return f;
}

function fit(items: Array<{ f: Map<string, number>; relevant: boolean }>): Omit<LearnedModel, 'v' | 'trainedAt' | 'accuracy'> {
  const cnt = [new Map<string, number>(), new Map<string, number>()]; // [irrelevant, relevant]
  const tot = [0, 0];
  const docs = new Map<string, number>();
  let nr = 0, ni = 0;
  for (const it of items) {
    const c = it.relevant ? 1 : 0;
    it.relevant ? nr++ : ni++;
    for (const [k, v] of it.f) {
      cnt[c]!.set(k, (cnt[c]!.get(k) ?? 0) + v);
      tot[c]! += v;
      docs.set(k, (docs.get(k) ?? 0) + 1);
    }
  }
  const vocab = [...docs].filter(([, d]) => d >= 2).map(([k]) => k);
  const V = vocab.length || 1;
  const w: Record<string, number> = {};
  for (const k of vocab) {
    const lr = Math.log(((cnt[1]!.get(k) ?? 0) + 1) / (tot[1]! + V));
    const li = Math.log(((cnt[0]!.get(k) ?? 0) + 1) / (tot[0]! + V));
    const d = lr - li;
    if (Math.abs(d) > 0.15) w[k] = Math.round(d * 1000) / 1000;
  }
  return { n: { relevant: nr, irrelevant: ni }, prior: Math.log((nr + 1) / (ni + 1)), w };
}

/** probability (0..1) that the team would judge the story relevant */
export function scoreStory(m: Pick<LearnedModel, 'prior' | 'w'>, a: Pick<Article, 'title' | 'sapo' | 'bodyText'>): number {
  let z = m.prior;
  for (const [k, v] of featuresOf(a)) z += (m.w[k] ?? 0) * v;
  // naive Bayes over-counts correlated words: damp before the logistic
  return 1 / (1 + Math.exp(-z / 4));
}
/** the words that pushed the score most (for "Vì sao?") */
export function explainScore(m: Pick<LearnedModel, 'w'>, a: Pick<Article, 'title' | 'sapo' | 'bodyText'>, k = 4): { up: string[]; down: string[] } {
  const c = [...featuresOf(a)].map(([f, v]) => [f, (m.w[f] ?? 0) * v] as const).filter(([, x]) => x !== 0);
  return {
    up: c.filter(([, x]) => x > 0).sort((x, y) => y[1] - x[1]).slice(0, k).map(([f]) => f),
    down: c.filter(([, x]) => x < 0).sort((x, y) => x[1] - y[1]).slice(0, k).map(([f]) => f),
  };
}

/** trains on the judged stories; accuracy from 5-fold cross-validation (null with fewer than 30 stories) */
export function trainModel(stories: Array<{ article: Pick<Article, 'id' | 'title' | 'sapo' | 'bodyText'>; relevant: boolean }>, now = new Date()): LearnedModel {
  const items = stories.map((s) => ({ id: s.article.id, f: featuresOf(s.article), relevant: s.relevant, a: s.article }));
  let accuracy: number | null = null;
  if (items.length >= 30) {
    let right = 0;
    for (let k = 0; k < 5; k++) {
      // deterministic folds by id (same split every night for the same stories)
      const fold = (id: string) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 5;
      const train = items.filter((x) => fold(x.id) !== k);
      const test = items.filter((x) => fold(x.id) === k);
      const m = fit(train);
      for (const t of test) if (scoreStory(m, t.a) >= 0.5 === t.relevant) right++;
    }
    accuracy = Math.round((right / items.length) * 1000) / 1000;
  }
  return { v: 1, trainedAt: now.toISOString(), accuracy, ...fit(items) };
}
