/**
 * Shared review store for HCM News Reporter (Cloudflare Worker + KV, free tier).
 *
 * Reviewers open the GitHub Pages app, enter their name + the shared ACCESS_CODE, and label collected articles:
 * relevant / not relevant, correct sector and editorial assessment, optional note. Labels from all reviewers are
 * visible to each other (vote counts). A nightly GitHub Action pulls everything via /export (EXPORT_TOKEN) into
 * the repo, where reviewer names are replaced by pseudonyms, to tune the collector.
 *
 * KV key:   l:<reportDate>:<articleId>:<reviewerId>
 * metadata: compact label for fast listing (≤ 1 KB)   value: full record (title/url for export)
 */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<{ keys: Array<{ name: string; metadata?: unknown }>; list_complete: boolean; cursor?: string }>;
}
export interface Env {
  REVIEWS: KVLike;
  ACCESS_CODE: string;
  EXPORT_TOKEN: string;
  ALLOWED_ORIGINS: string; // comma separated
}

export const CATEGORIES = ['LAND', 'BUILD', 'INFRA', 'TRAFFIC', 'REALESTATE', 'FLOOD', 'INVEST', 'POLICY'] as const;
export const ASSESSMENTS = ['needs_attention', 'positive', 'neutral'] as const;

export interface LabelRecord {
  v: 1;
  reportDate: string;
  articleId: string;
  url: string;
  title: string;
  sourceId: string;
  reviewer: string;
  reviewerId: string;
  label: 'relevant' | 'irrelevant' | null;
  category: (typeof CATEGORIES)[number] | null;
  assessment: (typeof ASSESSMENTS)[number] | null;
  note: string;
  at: string;
}
/** what the app needs to show votes (stored as KV metadata) */
export interface Vote { r: string; l: LabelRecord['label']; c: LabelRecord['category']; a: LabelRecord['assessment']; n: string; t: string }

export function reviewerId(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'an-danh';
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  return ok
    ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-review-code', vary: 'origin' }
    : {};
}
const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ART = /^a_[a-z0-9]{6,40}$/;

async function listAll(kv: KVLike, prefix: string) {
  const keys: Array<{ name: string; metadata?: unknown }> = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const r = await kv.list({ prefix, cursor, limit: 1000 });
    keys.push(...r.keys);
    if (r.list_complete || !r.cursor) break;
    cursor = r.cursor;
  }
  return keys;
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const h = cors(req, env);
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (url.pathname === '/health') return json({ ok: true }, 200, h);

  // nightly export for the GitHub Action (bearer token, never sent to browsers)
  if (url.pathname === '/export' && req.method === 'GET') {
    const auth = req.headers.get('authorization') ?? '';
    if (!safeEqual(auth, `Bearer ${env.EXPORT_TOKEN}`)) return json({ error: 'UNAUTHORIZED' }, 401, {});
    const since = url.searchParams.get('since') ?? '';
    const keys = await listAll(env.REVIEWS, since && DATE.test(since) ? `l:${since.slice(0, 7)}` : 'l:');
    const out: LabelRecord[] = [];
    for (const k of keys) {
      const v = await env.REVIEWS.get(k.name);
      if (v) out.push(JSON.parse(v) as LabelRecord);
    }
    return json({ exportedAt: new Date().toISOString(), count: out.length, labels: out }, 200, {});
  }

  // reviewer endpoints: shared access code
  const code = req.headers.get('x-review-code') ?? '';
  if (!safeEqual(code, env.ACCESS_CODE)) return json({ error: 'Mã truy cập không đúng' }, 401, h);

  if (url.pathname === '/login' && req.method === 'POST') return json({ ok: true }, 200, h);

  if (url.pathname === '/labels' && req.method === 'GET') {
    const date = url.searchParams.get('date') ?? '';
    if (!DATE.test(date)) return json({ error: 'INVALID_DATE' }, 400, h);
    const keys = await listAll(env.REVIEWS, `l:${date}:`);
    const votes: Record<string, Vote[]> = {};
    for (const k of keys) {
      const articleId = k.name.split(':')[2]!;
      (votes[articleId] ??= []).push(k.metadata as Vote);
    }
    return json({ date, votes }, 200, h);
  }

  if (url.pathname === '/labels' && req.method === 'POST') {
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > 8000) return json({ error: 'TOO_LARGE' }, 413, h);
    let b: Partial<LabelRecord>;
    try {
      b = (await req.json()) as Partial<LabelRecord>;
    } catch {
      return json({ error: 'INVALID_JSON' }, 400, h);
    }
    const reviewer = String(b.reviewer ?? '').trim().slice(0, 40);
    if (!reviewer) return json({ error: 'Cần nhập tên người duyệt' }, 400, h);
    if (!DATE.test(String(b.reportDate)) || !ART.test(String(b.articleId))) return json({ error: 'INVALID_ARTICLE' }, 400, h);
    if (b.label != null && b.label !== 'relevant' && b.label !== 'irrelevant') return json({ error: 'INVALID_LABEL' }, 400, h);
    if (b.category != null && !CATEGORIES.includes(b.category)) return json({ error: 'INVALID_CATEGORY' }, 400, h);
    if (b.assessment != null && !ASSESSMENTS.includes(b.assessment)) return json({ error: 'INVALID_ASSESSMENT' }, 400, h);
    const rec: LabelRecord = {
      v: 1, reportDate: b.reportDate!, articleId: b.articleId!, url: String(b.url ?? '').slice(0, 500), title: String(b.title ?? '').slice(0, 300),
      sourceId: String(b.sourceId ?? '').slice(0, 60), reviewer, reviewerId: reviewerId(reviewer), label: b.label ?? null, category: b.category ?? null,
      assessment: b.assessment ?? null, note: String(b.note ?? '').slice(0, 1000), at: new Date().toISOString(),
    };
    const key = `l:${rec.reportDate}:${rec.articleId}:${rec.reviewerId}`;
    if (!rec.label && !rec.category && !rec.assessment && !rec.note) {
      await env.REVIEWS.delete(key);
      return json({ ok: true, deleted: true }, 200, h);
    }
    const vote: Vote = { r: rec.reviewer, l: rec.label, c: rec.category, a: rec.assessment, n: rec.note.slice(0, 200), t: rec.at };
    await env.REVIEWS.put(key, JSON.stringify(rec), { metadata: vote });
    return json({ ok: true, vote }, 200, h);
  }
  return json({ error: 'NOT_FOUND' }, 404, h);
}
