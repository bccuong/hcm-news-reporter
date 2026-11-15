/**
 * Shared review store for News Reporter (Cloudflare Worker + KV, free tier).
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
  /** fine-grained PAT (this repo only, Actions: read & write) – lets reviewers start an on-demand collection */
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string; // e.g. bccuong/news-reporter
  COLLECT_WORKFLOW?: string; // e.g. pages.yml
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const VN_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+07:00$/;
export const MAX_WINDOW_HOURS = 72;

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

async function gh(env: Env, f: Fetch, path: string, init: RequestInit = {}) {
  return f(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${(env.GITHUB_TOKEN ?? '').trim()}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'hcm-news-review-worker',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
}
interface RunInfo { id: number; status: string; conclusion: string | null; created_at: string; updated_at: string; event: string; display_title: string; html_url: string }

const ghReady = (env: Env) => !!(env.GITHUB_TOKEN && env.GITHUB_REPO && env.COLLECT_WORKFLOW);

/** is a collection workflow run queued or running? */
async function busy(env: Env, f: Fetch): Promise<boolean> {
  for (const st of ['in_progress', 'queued']) {
    const r = await gh(env, f, `/actions/workflows/${env.COLLECT_WORKFLOW}/runs?status=${st}&per_page=1`);
    if (r.ok && ((await r.json()) as { total_count: number }).total_count > 0) return true;
  }
  return false;
}

/* ---------- profiles (cấu hình theo địa bàn): each has its own configuration, data and hourly switch ---------- */
export interface ProfileMeta {
  id: string; name: string; description: string; autoCollect: boolean; clonedFrom: string | null; createdAt: string; updatedAt: string;
  /** who switched the hourly collection on/off, and when */
  autoBy?: string; autoAt?: string;
}
export const DEFAULT_PROFILE = 'hcm';
const PROFILES_KEY = 'cfg:profiles';
const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_PROFILES = 20;

export async function getProfiles(env: Env): Promise<ProfileMeta[]> {
  const v = await env.REVIEWS.get(PROFILES_KEY);
  if (v) return JSON.parse(v) as ProfileMeta[];
  // before profiles existed: one TP.HCM configuration and one global hourly switch (cfg:auto)
  const legacy = await env.REVIEWS.get('cfg:auto');
  const a = legacy ? (JSON.parse(legacy) as { enabled: boolean; by: string; at: string }) : null;
  return [{
    id: DEFAULT_PROFILE, name: 'TP.HCM', description: 'Cấu hình mặc định: ngành xây dựng TP.HCM (từ Skill)', autoCollect: a?.enabled ?? true,
    clonedFrom: null, createdAt: '', updatedAt: '', autoBy: a?.by, autoAt: a?.at,
  }];
}
const saveProfiles = (env: Env, list: ProfileMeta[]) => env.REVIEWS.put(PROFILES_KEY, JSON.stringify(list));

/* ---------- hourly automatic collection (Cloudflare cron → workflow_dispatch), switchable per profile on the web ---------- */
export interface AutoLast { at: string; result: 'dispatched' | 'off' | 'busy' | 'error' | 'not_configured'; detail?: string; profiles?: string[] }
const AUTO_LAST_KEY = 'cfg:autoLast';
export const AUTO_TITLE = 'Thu thập tự động hằng giờ';

/** called by the Worker's cron trigger every hour: ONE workflow run collects every profile switched on */
export async function scheduledCollect(env: Env, f: Fetch = (i, init) => fetch(i, init)): Promise<AutoLast> {
  const at = new Date().toISOString();
  const on = (await getProfiles(env)).filter((p) => p.autoCollect).map((p) => p.id);
  let last: AutoLast;
  if (!ghReady(env)) last = { at, result: 'not_configured' };
  else if (!on.length) last = { at, result: 'off' };
  else if (await busy(env, f)) last = { at, result: 'busy', profiles: on };
  else {
    const d = await gh(env, f, `/actions/workflows/${env.COLLECT_WORKFLOW}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { trigger: 'auto' } }) });
    last = d.status === 204 ? { at, result: 'dispatched', profiles: on } : { at, result: 'error', detail: `HTTP ${d.status}` };
  }
  await env.REVIEWS.put(AUTO_LAST_KEY, JSON.stringify(last));
  return last;
}

/** what kind of workflow run this is (shown to users) */
export function runKind(x: { event: string; display_title: string }): 'auto' | 'request' | 'deploy' {
  if (x.event === 'schedule' || x.display_title.startsWith(AUTO_TITLE)) return 'auto';
  if (x.event === 'workflow_dispatch') return 'request';
  return 'deploy';
}
const mapRun = (x: RunInfo) => ({
  id: x.id, status: x.status, conclusion: x.conclusion, createdAt: x.created_at, updatedAt: x.updated_at, event: x.event, kind: runKind(x), title: x.display_title, url: x.html_url,
});

/** public server status: per-profile hourly switch + what the collection server is doing right now */
async function serverStatus(env: Env, f: Fetch, h: Record<string, string>) {
  const profiles = await getProfiles(env);
  const lv = await env.REVIEWS.get(AUTO_LAST_KEY);
  const lastAuto = lv ? (JSON.parse(lv) as AutoLast) : null;
  if (!ghReady(env)) return json({ collectEnabled: false, profiles, lastAuto, running: [] }, 200, h);
  const r = await gh(env, f, `/actions/workflows/${env.COLLECT_WORKFLOW}/runs?per_page=6`);
  const runs = r.ok ? ((await r.json()) as { workflow_runs: RunInfo[] }).workflow_runs.map(mapRun) : [];
  return json({ collectEnabled: true, profiles, lastAuto, running: runs.filter((x) => x.status !== 'completed') }, r.ok ? 200 : 502, h);
}

/* ---------- shared collector configuration (settings + sources) per profile, edited on the web, used by the server ---------- */
export interface SharedConfig { settings: Record<string, unknown>; sources: unknown[]; by: string; at: string; summary: string }
const configKey = (pid: string) => `cfg:config:${pid}`;
const histPrefix = (pid: string) => `cfg:hist:${pid}:`;
const KEEP_HISTORY = 30;
const MAX_CONFIG_BYTES = 1_000_000;

async function readConfig(env: Env, pid: string): Promise<string | null> {
  // TP.HCM: configuration saved before profiles existed
  return (await env.REVIEWS.get(configKey(pid))) ?? (pid === DEFAULT_PROFILE ? await env.REVIEWS.get('cfg:config') : null);
}
async function saveConfig(env: Env, pid: string, next: SharedConfig) {
  const prev = await readConfig(env, pid);
  if (prev) {
    const p = JSON.parse(prev) as SharedConfig;
    // history key sorts by time; metadata lets the web list versions without reading values
    await env.REVIEWS.put(`${histPrefix(pid)}${p.at}`, prev, { metadata: { by: p.by, at: p.at, summary: p.summary.slice(0, 200) } });
    const old = (await listAll(env.REVIEWS, histPrefix(pid))).map((k) => k.name).sort();
    for (const k of old.slice(0, Math.max(0, old.length - KEEP_HISTORY))) await env.REVIEWS.delete(k);
  }
  await env.REVIEWS.put(configKey(pid), JSON.stringify(next));
}
function parseConfigBody(b: { settings?: unknown; sources?: unknown; summary?: unknown; reviewer?: unknown }): SharedConfig | null {
  if (!b.settings || typeof b.settings !== 'object' || Array.isArray(b.settings) || !Array.isArray(b.sources)) return null;
  return {
    settings: b.settings as Record<string, unknown>, sources: b.sources, by: String(b.reviewer ?? '').trim().slice(0, 40) || 'web',
    at: new Date().toISOString(), summary: String(b.summary ?? '').slice(0, 300) || 'Cập nhật cấu hình',
  };
}
function profileSlug(name: string, taken: string[]): string {
  const base = reviewerId(name) === 'an-danh' ? 'cau-hinh' : reviewerId(name).slice(0, 36);
  let id = base;
  for (let k = 2; taken.includes(id); k++) id = `${base}-${k}`;
  return id;
}

/** reviewer-only routes (access code already checked) */
async function profileRoutes(req: Request, url: URL, env: Env, h: Record<string, string>): Promise<Response | null> {
  const body = async <T>() => (await req.json().catch(() => null)) as T | null;
  const pidOf = (v: unknown) => (typeof v === 'string' && PROFILE_ID.test(v) ? v : DEFAULT_PROFILE);

  if (url.pathname === '/config' && req.method === 'POST') {
    if (Number(req.headers.get('content-length') ?? 0) > MAX_CONFIG_BYTES) return json({ error: 'Cấu hình quá lớn' }, 413, h);
    const b = await body<{ profile?: string; settings?: unknown; sources?: unknown; summary?: unknown; reviewer?: unknown }>();
    if (!b) return json({ error: 'INVALID_JSON' }, 400, h);
    const pid = pidOf(b.profile);
    if (!(await getProfiles(env)).some((p) => p.id === pid)) return json({ error: `Không có cấu hình "${pid}"` }, 404, h);
    const cfg = parseConfigBody(b);
    if (!cfg) return json({ error: 'Cấu hình không hợp lệ (cần settings + sources)' }, 400, h);
    await saveConfig(env, pid, cfg);
    return json({ ok: true, by: cfg.by, at: cfg.at }, 200, h);
  }
  if (url.pathname === '/config/history' && req.method === 'GET') {
    const pid = pidOf(url.searchParams.get('profile'));
    const keys = await listAll(env.REVIEWS, histPrefix(pid));
    const items = keys.map((k) => ({ id: k.name.slice(histPrefix(pid).length), ...(k.metadata as { by: string; at: string; summary: string }) })).sort((a, b) => b.id.localeCompare(a.id));
    return json({ items }, 200, h);
  }
  if (url.pathname === '/config/rollback' && req.method === 'POST') {
    const b = (await body<{ id?: string; reviewer?: string; profile?: string }>()) ?? {};
    const pid = pidOf(b.profile);
    const v = b.id ? await env.REVIEWS.get(`${histPrefix(pid)}${b.id}`) : null;
    if (!v) return json({ error: 'Không tìm thấy phiên bản' }, 404, h);
    const old = JSON.parse(v) as SharedConfig;
    await saveConfig(env, pid, { ...old, by: String(b.reviewer ?? '').trim().slice(0, 40) || 'web', at: new Date().toISOString(), summary: `Khôi phục phiên bản ${b.id}` });
    return json({ ok: true }, 200, h);
  }
  // create: the browser builds the configuration (new region from the defaults, or a clone) and sends it
  if (url.pathname === '/profiles' && req.method === 'POST') {
    if (Number(req.headers.get('content-length') ?? 0) > MAX_CONFIG_BYTES) return json({ error: 'Cấu hình quá lớn' }, 413, h);
    const b = await body<{ name?: string; description?: string; clonedFrom?: string; settings?: unknown; sources?: unknown; reviewer?: string }>();
    const name = String(b?.name ?? '').trim().slice(0, 60);
    if (!b || !name) return json({ error: 'Cần tên cấu hình' }, 400, h);
    const cfg = parseConfigBody({ ...b, summary: `Tạo cấu hình "${name}"` });
    if (!cfg) return json({ error: 'Cấu hình không hợp lệ (cần settings + sources)' }, 400, h);
    const list = await getProfiles(env);
    if (list.length >= MAX_PROFILES) return json({ error: `Tối đa ${MAX_PROFILES} cấu hình` }, 400, h);
    const now = new Date().toISOString();
    const meta: ProfileMeta = {
      id: profileSlug(name, list.map((p) => p.id)), name, description: String(b.description ?? '').slice(0, 300), autoCollect: false,
      clonedFrom: b.clonedFrom && PROFILE_ID.test(b.clonedFrom) ? b.clonedFrom : null, createdAt: now, updatedAt: now,
    };
    await saveConfig(env, meta.id, cfg);
    await saveProfiles(env, [...list, meta]);
    return json(meta, 200, h);
  }
  const m = /^\/profiles\/([a-z0-9-]{1,40})$/.exec(url.pathname);
  if (m && (req.method === 'PATCH' || req.method === 'DELETE')) {
    const list = await getProfiles(env);
    const i = list.findIndex((p) => p.id === m[1]);
    if (i < 0) return json({ error: 'Không tìm thấy cấu hình' }, 404, h);
    if (req.method === 'DELETE') {
      if (list.length <= 1) return json({ error: 'Phải còn ít nhất một cấu hình' }, 400, h);
      await saveProfiles(env, list.filter((p) => p.id !== m[1]));
      return json({ ok: true }, 200, h); // configuration + history stay in KV (recoverable by an administrator)
    }
    const b = (await body<{ name?: string; description?: string }>()) ?? {};
    list[i] = { ...list[i]!, ...(b.name?.trim() ? { name: b.name.trim().slice(0, 60) } : {}), ...(b.description !== undefined ? { description: String(b.description).slice(0, 300) } : {}), updatedAt: new Date().toISOString() };
    await saveProfiles(env, list);
    return json(list[i], 200, h);
  }
  return null;
}
/** Article photo for the report (browser export): https only, real jpeg/png/webp, ≤ 8 MB. */
async function imageProxy(url: URL, f: Fetch, h: Record<string, string>) {
  const target = url.searchParams.get('url') ?? '';
  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return json({ error: 'URL không hợp lệ' }, 400, h);
  }
  if (u.protocol !== 'https:' || /^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(u.hostname)) return json({ error: 'Chỉ nhận ảnh https công khai' }, 400, h);
  const r = await f(u.toString(), { headers: { 'user-agent': 'Mozilla/5.0 HCMNewsReporter/0.1', accept: 'image/jpeg,image/png;q=0.9,image/*;q=0.5' }, redirect: 'follow' });
  const type = r.headers.get('content-type') ?? '';
  if (!r.ok || !/^image\//.test(type)) return json({ error: `Không tải được ảnh (HTTP ${r.status})` }, 502, h);
  const buf = await r.arrayBuffer();
  if (buf.byteLength > 8_000_000) return json({ error: 'Ảnh quá lớn' }, 413, h);
  return new Response(buf, { status: 200, headers: { 'content-type': type, 'cache-control': 'private, max-age=3600', ...h } });
}

/** On-demand collection for a custom window: dispatch the collection workflow (one at a time). */
async function collect(req: Request, env: Env, f: Fetch, h: Record<string, string>) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO || !env.COLLECT_WORKFLOW) return json({ error: 'Chưa cấu hình thu thập theo yêu cầu (GITHUB_TOKEN)' }, 503, h);
  let b: { from?: string; to?: string; reviewer?: string; profile?: string };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return json({ error: 'INVALID_JSON' }, 400, h);
  }
  const from = String(b.from ?? '');
  const to = String(b.to ?? '');
  if (!VN_ISO.test(from) || !VN_ISO.test(to)) return json({ error: 'Ngày giờ phải theo dạng 2026-11-15T17:00+07:00' }, 400, h);
  const a = Date.parse(from);
  const z = Date.parse(to);
  if (!(z > a)) return json({ error: 'Thời điểm kết thúc phải sau thời điểm bắt đầu' }, 400, h);
  if (z - a > MAX_WINDOW_HOURS * 3600_000) return json({ error: `Khung giờ tối đa ${MAX_WINDOW_HOURS} giờ cho mỗi lần thu thập trên web` }, 400, h);
  if (a > Date.now()) return json({ error: 'Thời điểm bắt đầu ở tương lai' }, 400, h);
  const reviewer = String(b.reviewer ?? '').trim().slice(0, 40) || 'web';
  const profile = String(b.profile ?? DEFAULT_PROFILE);
  if (!(await getProfiles(env)).some((p) => p.id === profile)) return json({ error: `Không có cấu hình "${profile}"`}, 400, h);
  // one collection at a time (the workflow also serialises runs)
  if (await busy(env, f)) return json({ error: 'Máy chủ đang chạy một lượt thu thập khác (xem dòng trạng thái máy chủ) – vui lòng chờ lượt đó xong', busy: true }, 409, h);
  const d = await gh(env, f, `/actions/workflows/${env.COLLECT_WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs: { from, to, requested_by: reviewer, profile } }),
  });
  if (d.status !== 204) return json({ error: `GitHub từ chối yêu cầu (HTTP ${d.status})` }, 502, h);
  return json({ ok: true, from, to, profile, requestedAt: new Date().toISOString() }, 202, h);
}

async function collectStatus(env: Env, f: Fetch, h: Record<string, string>) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO || !env.COLLECT_WORKFLOW) return json({ enabled: false, runs: [] }, 200, h);
  const r = await gh(env, f, `/actions/workflows/${env.COLLECT_WORKFLOW}/runs?per_page=6`);
  if (!r.ok) return json({ error: `GitHub HTTP ${r.status}` }, 502, h);
  const runs = ((await r.json()) as { workflow_runs: RunInfo[] }).workflow_runs.map(mapRun);
  return json({ enabled: true, runs }, 200, h);
}

export async function handle(req: Request, env: Env, f: Fetch = (i, init) => fetch(i, init)): Promise<Response> {
  const h = cors(req, env);
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (url.pathname === '/health') return json({ ok: true }, 200, h);
  if (url.pathname === '/status' && req.method === 'GET') return serverStatus(env, f, h);
  // profiles + their collector configuration: public read (the GitHub collector and every browser use them; no secrets)
  if (url.pathname === '/profiles' && req.method === 'GET') return json({ profiles: await getProfiles(env) }, 200, h);
  if (url.pathname === '/config' && req.method === 'GET') {
    const pid = url.searchParams.get('profile') ?? DEFAULT_PROFILE;
    const v = PROFILE_ID.test(pid) ? await readConfig(env, pid) : null;
    return json({ config: v ? JSON.parse(v) : null }, 200, h);
  }

  // nightly export for the GitHub Action (bearer token, never sent to browsers)
  if (url.pathname === '/export' && req.method === 'GET') {
    const auth = req.headers.get('authorization') ?? '';
    // secrets set through a shell pipe may carry a trailing newline – compare trimmed values
    if (!safeEqual(auth.trim(), `Bearer ${(env.EXPORT_TOKEN ?? '').trim()}`)) return json({ error: 'UNAUTHORIZED' }, 401, {});
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
  const code = (req.headers.get('x-review-code') ?? '').trim();
  if (!safeEqual(code, (env.ACCESS_CODE ?? '').trim())) return json({ error: 'Mã truy cập không đúng' }, 401, h);

  if (url.pathname === '/login' && req.method === 'POST') return json({ ok: true, collectEnabled: !!env.GITHUB_TOKEN }, 200, h);
  if (url.pathname === '/collect' && req.method === 'POST') return collect(req, env, f, h);
  if (url.pathname === '/collect/status' && req.method === 'GET') return collectStatus(env, f, h);
  if (url.pathname === '/img' && req.method === 'GET') return imageProxy(url, f, h);
  const pr = await profileRoutes(req, url, env, h);
  if (pr) return pr;
  // hourly automatic collection on/off for ONE profile
  if (url.pathname === '/auto' && req.method === 'POST') {
    let b: { enabled?: unknown; reviewer?: unknown; profile?: unknown };
    try {
      b = (await req.json()) as typeof b;
    } catch {
      return json({ error: 'INVALID_JSON' }, 400, h);
    }
    if (typeof b.enabled !== 'boolean') return json({ error: 'enabled phải là true/false' }, 400, h);
    const list = await getProfiles(env);
    const i = list.findIndex((p) => p.id === String(b.profile ?? DEFAULT_PROFILE));
    if (i < 0) return json({ error: 'Không tìm thấy cấu hình' }, 404, h);
    list[i] = { ...list[i]!, autoCollect: b.enabled, autoBy: String(b.reviewer ?? '').trim().slice(0, 40) || 'web', autoAt: new Date().toISOString() };
    await saveProfiles(env, list);
    return json({ ok: true, profile: list[i] }, 200, h);
  }

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
