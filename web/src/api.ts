import { defaultSettings, defaultSources, parseWebsitesTxt, settingsForNewRegion } from '../../src/domain/defaults';
import type { FilterSuggestion } from '../../src/domain/suggest';
import type { LearnedModel } from '../../src/domain/learn';
import type { ScheduleSlot, ScheduleState, ScheduleTimes } from '../../src/domain/schedule';
import { evaluateRule, validateRule } from '../../src/domain/rules';
import { judgeRelevance } from '../../src/domain/relevance';
import { computeRelevanceQuality, type RelevanceQuality } from '../../src/domain/quality';
import type { Article, Candidate, ReviewDecision, RuleNode, RunManifest, Settings, Source } from '../../src/domain/schemas';
import { SettingsSchema, SourceSchema } from '../../src/domain/schemas';
import { lastCompletedWindow, vnDate, type ReportWindow } from '../../src/domain/timeWindow';
import { templateById, TEMPLATES, UPLOAD_TEMPLATE_ID } from '../../src/reports/templates';
import skillWebsites from '../../src/domain/data/skill-websites.txt?raw';
import { z } from 'zod';

export type RunInfo = RunManifest & { active?: boolean; /** web: put away in "Lưu trữ" (listed there, collapsed) */ archived?: boolean; reconciliation?: { total: number; accounted: number; transient: number; balanced: boolean } };
export type { RelevanceQuality };
export interface PreviewResult { errors: string[]; results: Array<{ id: string; title: string; matched: boolean; lines: string[]; location?: string }> }
export interface ExportResult { ok: boolean; dryRun?: boolean; blockers?: string[]; warnings?: string[]; files?: string[]; pdfStatus?: string; stories?: number }
export interface HistoryEntry { id: string; at: string; kind: string; summary: string }

/** profiles (cấu hình theo địa bàn); web: the active one is chosen per browser */
export interface ProfileInfo { id: string; name: string; description: string; autoCollect: boolean; clonedFrom: string | null; createdAt: string; updatedAt: string; autoBy?: string; autoAt?: string; schedule?: ScheduleState; /** times changed in Settings (unset = 08:00 / 16:30) */ scheduleTimes?: ScheduleTimes; /** web: slot ids already collected today (from the review worker) */ scheduleDone?: string[] }
export interface ProfilesState { activeId: string; profiles: ProfileInfo[] }
export interface TemplateOption { id: string; name: string; description: string; kind: 'original-pptx' | 'style' | 'upload'; orientation: 'portrait' | 'landscape'; available?: boolean }
export interface NewProfileInput { name: string; description?: string; cloneFrom?: string | null; regionName?: string; regionAliases?: string[] }

export interface Api {
  mode: 'local' | 'demo' | 'live';
  profiles(): Promise<ProfilesState>;
  createProfile(p: NewProfileInput): Promise<ProfileInfo>;
  updateProfile(id: string, patch: { name?: string; description?: string }): Promise<ProfileInfo>;
  /** switch the active profile (local: for the whole app; web: for this browser) */
  activateProfile(id: string): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  meta?(): Promise<{ generatedAt: string; schedule: string } | null>;
  refresh?(): void;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings, summary: string): Promise<Settings>;
  getSources(): Promise<Source[]>;
  saveSources(list: Source[], summary: string): Promise<Source[]>;
  importSkill(text: string): Promise<{ sources: Source[]; comments: string[]; errors: string[] }>;
  detect(url: string): Promise<{ name: string; rss: string[]; sitemaps: string[]; sections: string[]; sampleArticles: string[]; errors: string[] }>;
  /** quick: one listing page and one sample article (the "kiểm tra nhanh" button on a source tile) */
  testSource(src: Source, opts?: { quick?: boolean }): Promise<any>;
  previewRule(root: RuleNode, settings: Settings, sample?: { title: string; body: string }, runId?: string): Promise<PreviewResult>;
  history(): Promise<HistoryEntry[]>;
  rollback(id: string): Promise<void>;
  backup(): Promise<unknown>;
  restore(b: unknown): Promise<void>;
  listRuns(): Promise<RunInfo[]>;
  /** daily filter suggestions learned from the team's review (web: published nightly; local: computed on this computer) */
  suggestions?(): Promise<SuggestionsState>;
  /** "Bỏ qua": never proposed again (web: for the whole team, needs a reviewer session) */
  dismissSuggestion?(id: string): Promise<void>;
  /** the judged stories ("bộ bài chuẩn") for the impact preview of a settings change */
  golden?(): Promise<GoldenSet>;
  /** web: the self-learned model of the active profile (null before the first nightly training) */
  learnedModel?(): Promise<LearnedModel | null>;
  /** "Lượt đã lưu" › Xoá – local: deletes the saved run; web: hides it for the whole team (reviewer login, can be restored) */
  deleteRun?(id: string): Promise<void>;
  /** web only: runs removed by a reviewer, newest removal first, to restore them */
  hiddenRuns?(): Promise<Array<{ run: RunInfo; by: string; at: string }>>;
  restoreRun?(id: string): Promise<void>;
  /** web: put a run away in "Lưu trữ" for the team, or bring it back */
  archiveRun?(id: string, archived: boolean): Promise<void>;
  /** local: starts a run; live: asks the server (GitHub Actions) to collect → { remote: true } */
  startRun(window: ReportWindow, trigger: 'manual' | 'auto'): Promise<{ runId?: string; skipped?: string; remote?: boolean }>;
  getRun(id: string): Promise<RunInfo>;
  cancel(id: string): Promise<void>;
  retry(id: string, body: { mode: 'failed' | 'source' | 'expand' | 'candidates'; sourceId?: string; candidateIds?: string[]; extraLookbackHours?: number }): Promise<{ runId: string }>;
  candidates(id: string): Promise<Candidate[]>;
  articles(id: string): Promise<Article[]>;
  /** web: the full text of excluded stories arrives after the first paint (filled into the same articles) */
  bodies?(id: string): Promise<void>;
  review(id: string): Promise<Record<string, ReviewDecision>>;
  patchReview(id: string, articleId: string, patch: Partial<ReviewDecision>): Promise<ReviewDecision>;
  capabilities(): Promise<{ pdf: boolean; soffice: string | null; templateFile: string | null; templateFidelity: boolean }>;
  /** report templates selectable at export + the default one (Cài đặt › Báo cáo & mẫu) */
  templates(): Promise<{ defaultId: string; templates: TemplateOption[] }>;
  exportRun(id: string, formats: ExportFormat[], dryRun: boolean, templateId?: string): Promise<ExportResult>;
  exportUrl(file: string): string;
  uploadTemplate(name: string, base64: string): Promise<{ templateFile: string }>;
  subscribe(runId: string, cb: (e: { type: string; counts?: Record<string, number> }) => void): () => void;
  relevanceQuality(): Promise<RelevanceQuality>;
  /** shared review (GitHub Pages + Cloudflare Worker); undefined when not configured */
  shared?: SharedReview;
}

/** fields of the team's shared decision (web); relevanceLabel / reviewNote are personal votes */
export const SHARED_REVIEW_FIELDS = ['included', 'order', 'promotedToReady', 'excludedByEditor', 'excludeReason', 'timeVerifiedManually', 'extractionMarkedComplete', 'groupId', 'primaryImageUrl', 'primaryCategory', 'assessment', 'title', 'summary', 'shortLabel', 'proposal'] as const;
function pickShared(p: Partial<ReviewDecision>): Partial<ReviewDecision> {
  const out: Record<string, unknown> = {};
  for (const k of SHARED_REVIEW_FIELDS) if (k in p && (p as Record<string, unknown>)[k] !== undefined) out[k] = (p as Record<string, unknown>)[k];
  return out as Partial<ReviewDecision>;
}

type HiddenRunRef = { runId: string; by: string; at: string; archived?: boolean };
export interface GoldenSet { articles: Array<Pick<Article, 'id' | 'sourceId' | 'sourceName' | 'title' | 'sapo' | 'bodyText'>>; judged: Record<string, boolean> }
export interface SuggestionsState { generatedAt: string | null; basis: { stories: number; votes: number; decisions: number } | null; items: FilterSuggestion[] }
export type ExportFormat = 'pptx' | 'docx' | 'pdf';

export interface Vote { r: string; l: 'relevant' | 'irrelevant' | null; c: string | null; a: string | null; n: string; t: string }
export interface CollectRun { id: number; status: string; conclusion: string | null; createdAt: string; updatedAt: string; event: string; kind?: 'auto' | 'request' | 'deploy'; title: string; url: string }
export interface ServerStatus {
  collectEnabled: boolean;
  /** every profile with its fixed collection times (schedule, autoBy, autoAt) */
  profiles: ProfileInfo[];
  lastAuto: { at: string; result: 'dispatched' | 'off' | 'busy' | 'error' | 'not_configured'; detail?: string; profiles?: string[]; slot?: string } | null;
  /** queued / running collection workflow runs */
  running: CollectRun[];
  /** collection token: expiry (ISO, null = never / unknown); rejected = expired or revoked */
  token?: { expiresAt: string | null; rejected: boolean };
}
export type UserRole = 'admin' | 'reviewer';
export interface UserInfo { u: string; name: string; role: UserRole; at: string; by: string }
export interface TokenInfo { configured: boolean; ok?: boolean; status?: number; source?: 'web' | 'server'; last4?: string; by?: string | null; at?: string | null; expiresAt?: string | null; repo?: string }
export interface SharedReview {
  /** public: automatic collection times + what the collection server is doing now */
  serverStatus(): Promise<ServerStatus>;
  /** tick / untick a fixed collection time (08:00, 16:30) of the ACTIVE profile (needs a reviewer session) */
  setSchedule(slot: ScheduleSlot['id'], enabled: boolean): Promise<ProfileInfo>;
  /** change the times of the automatic slots of the ACTIVE profile ({} = defaults; needs a reviewer session) */
  setScheduleTimes(times: ScheduleTimes): Promise<ProfileInfo>;
  /** which collection token the server uses (never the token itself) */
  tokenInfo(): Promise<TokenInfo>;
  /** replace the collection token (checked by the server before it is saved) */
  setToken(token: string): Promise<TokenInfo>;
  /** id of the active profile (the one Settings edits) */
  profileId(): string;
  session(): { name: string } | null;
  /** account login (user name + password); the session token is then sent where the shared code used to go */
  login(username: string, password: string): Promise<{ name: string; role: UserRole }>;
  logout(): void;
  /** role of the signed-in account (sessions opened with the old shared code count as admin) */
  role(): UserRole | null;
  users(): Promise<UserInfo[]>;
  saveUser(u: { u: string; name: string; password?: string; role: UserRole }): Promise<UserInfo[]>;
  deleteUser(u: string): Promise<UserInfo[]>;
  changePassword(password: string): Promise<void>;
  votes(runId: string): Promise<Record<string, Vote[]>>;
  /** recent runs of the GitHub collection workflow (progress of an on-demand collection) */
  collectStatus(): Promise<{ enabled: boolean; runs: CollectRun[] }>;
}

class ApiError extends Error {
  constructor(msg: string, readonly issues?: Array<{ path: string; message: string }>) {
    super(msg);
  }
}

/* ----------------------------- Local (Fastify) ----------------------------- */
class LocalApi implements Api {
  mode = 'local' as const;
  private token: string | null = null;
  private async tok() {
    if (!this.token) this.token = ((await (await fetch('/api/session')).json()) as { token: string }).token;
    return this.token;
  }
  private async req<T>(method: string, url: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (method !== 'GET') {
      headers['x-hcm-token'] = await this.tok();
      if (body !== undefined) headers['content-type'] = 'application/json';
    }
    const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as any;
    if (!r.ok) {
      const issues = j.issues as Array<{ path: string; message: string }> | undefined;
      throw new ApiError(issues?.length ? issues.map((i) => `${i.path}: ${i.message}`).join('; ') : j.error ?? `HTTP ${r.status}`, issues);
    }
    return j as T;
  }
  profiles = () => this.req<ProfilesState>('GET', '/api/profiles');
  createProfile = (p: NewProfileInput) => this.req<ProfileInfo>('POST', '/api/profiles', p);
  updateProfile = (id: string, patch: { name?: string; description?: string }) => this.req<ProfileInfo>('PATCH', `/api/profiles/${id}`, patch);
  activateProfile = async (id: string) => void (await this.req('POST', `/api/profiles/${id}/activate`, {}));
  deleteProfile = async (id: string) => void (await this.req('DELETE', `/api/profiles/${id}`, {}));
  getSettings = () => this.req<Settings>('GET', '/api/settings');
  saveSettings = (s: Settings, summary: string) => this.req<Settings>('PUT', '/api/settings', { settings: s, summary });
  getSources = () => this.req<Source[]>('GET', '/api/sources');
  saveSources = (sources: Source[], summary: string) => this.req<Source[]>('PUT', '/api/sources', { sources, summary });
  importSkill = (text: string) => this.req<any>('POST', '/api/sources/import-skill', { text });
  detect = (url: string) => this.req<any>('POST', '/api/sources/detect', { url });
  testSource = (source: Source, opts?: { quick?: boolean }) => this.req<any>('POST', '/api/sources/test', { source, quick: !!opts?.quick });
  previewRule = (root: RuleNode, settings: Settings, sample?: { title: string; body: string }, runId?: string) =>
    this.req<PreviewResult>('POST', '/api/rules/preview', { root, settings, sample, runId });
  history = () => this.req<HistoryEntry[]>('GET', '/api/settings/history');
  rollback = async (id: string) => void (await this.req('POST', '/api/settings/rollback', { id }));
  backup = () => this.req<unknown>('GET', '/api/backup');
  restore = async (backup: unknown) => void (await this.req('POST', '/api/backup/restore', { confirm: true, backup }));
  /** runs of the ACTIVE profile only (runs from before profiles existed belong to TP.HCM) */
  listRuns = async () => {
    const [rs, p] = await Promise.all([this.req<RunInfo[]>('GET', '/api/runs'), this.profiles()]);
    return rs.filter((r) => (r.profileId ?? 'hcm') === p.activeId);
  };
  deleteRun = async (id: string) => void (await this.req('DELETE', `/api/runs/${id}`, {}));
  suggestions = () => this.req<SuggestionsState>('GET', '/api/suggestions');
  dismissSuggestion = async (id: string) => void (await this.req('POST', '/api/suggestions/dismiss', { id }));
  golden = () => this.req<GoldenSet>('GET', '/api/golden');
  startRun = (window: ReportWindow, trigger: 'manual' | 'auto') => this.req<{ runId?: string; skipped?: string }>('POST', '/api/runs', { window, trigger });
  getRun = (id: string) => this.req<RunInfo>('GET', `/api/runs/${id}`);
  cancel = async (id: string) => void (await this.req('POST', `/api/runs/${id}/cancel`, {}));
  retry = (id: string, body: any) => this.req<{ runId: string }>('POST', `/api/runs/${id}/retry`, body);
  candidates = (id: string) => this.req<Candidate[]>('GET', `/api/runs/${id}/candidates`);
  articles = (id: string) => this.req<Article[]>('GET', `/api/runs/${id}/articles`);
  review = (id: string) => this.req<Record<string, ReviewDecision>>('GET', `/api/runs/${id}/review`);
  patchReview = (id: string, articleId: string, patch: Partial<ReviewDecision>) => this.req<ReviewDecision>('PATCH', `/api/runs/${id}/reviews/${articleId}`, patch);
  capabilities = () => this.req<any>('GET', '/api/capabilities');
  templates = () => this.req<{ defaultId: string; templates: TemplateOption[] }>('GET', '/api/templates');
  exportRun = (id: string, formats: ExportFormat[], dryRun: boolean, templateId?: string) => this.req<ExportResult>('POST', `/api/runs/${id}/export`, { formats, dryRun, templateId });
  exportUrl = (file: string) => `/api/exports/${file}`;
  uploadTemplate = (name: string, base64: string) => this.req<{ templateFile: string }>('POST', '/api/templates', { name, base64 });
  relevanceQuality = () => this.req<RelevanceQuality>('GET', '/api/quality/relevance');
  subscribe(runId: string, cb: (e: any) => void) {
    const es = new EventSource(`/api/runs/${runId}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      cb(e);
      if (e.type === 'done') es.close();
    };
    es.onerror = () => es.close();
    return () => es.close();
  }
}

/* ----------------------------- Demo (GitHub Pages) ----------------------------- */
const LS = {
  get<T>(k: string): T | null {
    try {
      const v = localStorage.getItem(`hcm-demo:${k}`);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(`hcm-demo:${k}`, JSON.stringify(v));
    } catch {
      /* storage unavailable: demo still works for this session */
    }
  },
};
const mem = new Map<string, unknown>();
const store = {
  get: <T,>(k: string) => (mem.get(k) as T | undefined) ?? LS.get<T>(k),
  set: (k: string, v: unknown) => {
    mem.set(k, v);
    LS.set(k, v);
  },
};

/* small IndexedDB store for files that must stay in this browser (the department's PPTX template) */
function idbOpen(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('hcm-news-reporter', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(key: string, value: unknown) {
  const db = await idbOpen();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await idbOpen();
    return await new Promise<T | undefined>((res, rej) => {
      const r = db.transaction('files').objectStore('files').get(key);
      r.onsuccess = () => res(r.result as T | undefined);
      r.onerror = () => rej(r.error);
    });
  } catch {
    return undefined;
  }
}
function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

interface DemoBundle { manifest: RunManifest; candidates: Candidate[]; articles: Article[] }
const NO_NET = 'Chức năng này cần truy cập mạng trực tiếp từ máy (dò/thử nguồn, quét lại từng nguồn) nên chỉ có ở bản local trên Windows (npm start). Trên web: chọn khung giờ và bấm Thu thập để máy chủ quét lại toàn bộ.';

/** Published article (scripts/cloud-collect.ts) → Article shape used by the UI. Periods published before 15/11/2026 have no full text. */
function fromPublic(p: any, runId: string, generatedAt: string): Article {
  const sections: Article['contentSections'] = p.contentSections ?? [];
  return {
    id: p.id, runId, sourceId: p.sourceId, sourceName: p.sourceName, originType: 'website', originalUrl: p.url, canonicalUrl: p.url, title: p.title, sapo: p.sapo,
    // same rule as the extractor (src/collector/extract.ts): every non-figure section, one per line
    bodyText: sections.filter((s) => s.type !== 'figure').map((s) => s.text).join('\n'), contentSections: sections, articleLinks: [], author: p.author ?? null, publishedAt: p.publishedAt, modifiedAt: p.modifiedAt, collectedAt: generatedAt,
    dateConfidence: p.dateConfidence, dateEvidence: p.dateEvidence ?? [], extractionAdapterVersion: 'cloud', extractionCompleteness: p.extractionCompleteness,
    extractionWarnings: p.extractionWarnings ?? [], continuation: { detected: false, urls: [] }, location: p.location, relevance: p.relevance,
    primaryCategory: p.primaryCategory, secondaryCategories: [], classificationEvidence: p.classificationEvidence ?? [], suggestedAssessment: p.suggestedAssessment,
    assessmentEvidence: p.assessmentEvidence ?? [],
    // photo links (loaded from the publisher, exactly like the local app)
    imageCandidates: (p.images ?? []).map((i: any) => ({ ...i, sourceArticleUrl: p.url })),
    duplicateGroupId: p.duplicateGroupId, warnings: [],
    publicSections: sections.length ? undefined : p.sections,
  } as Article & { publicSections: unknown };
}

class DemoApi implements Api {
  mode: 'demo' | 'live' = import.meta.env.VITE_LIVE ? 'live' : 'demo';
  private bundles = new Map<string, Promise<DemoBundle>>();
  private index: Promise<any> | null = null;
  constructor() {
    // F5 on a phone: start downloading the newest period right away, in parallel with the settings / profiles /
    // review requests the page makes first (it was fetched last, after all of them: ~5 s on 4G, 18/11/2026)
    if (this.mode === 'live') void this.warmUp();
  }
  private async warmUp() {
    const i = await this.liveIndex();
    const days: any[] = i?.days ?? [];
    const newest = days.reduce<any>((m, d) => (!m || String(d.window?.to ?? '') > String(m.window?.to ?? '') ? d : m), null);
    if (!newest) return;
    const runId = `run_live_${String(newest.key ?? newest.reportDate).replace(/[^0-9a-z]/gi, '')}`;
    this.runMeta.set(runId, { file: newest.file ?? `${newest.reportDate}.json`, lite: newest.lite, reportDate: newest.reportDate, v: newest.generatedAt });
    this.load(runId).catch(() => this.bundles.delete(runId));
    // the team's review of that period too (the list waits for it)
    if (this.teamReview) {
      const p = this.fetchTeamReview(runId);
      p.catch(() => undefined); // not used → no unhandled rejection
      this.reviewPrefetch = { id: runId, at: Date.now(), p };
    }
  }
  private reviewPrefetch: { id: string; at: number; p: Promise<Record<string, any>> } | null = null;
  private fetchTeamReview(id: string): Promise<Record<string, any>> {
    return fetch(`${this.reviewApi}/review?profile=${encodeURIComponent(this.pid)}&period=${encodeURIComponent(id)}`, { cache: 'no-cache' }).then(async (r) => {
      if (!r.ok) throw new Error(String(r.status));
      return ((await r.json()) as { reviews: Record<string, any> }).reviews;
    });
  }
  /* ---- profiles: the active one is chosen per browser; each has its own published data live/<id>/ ---- */
  private get pid() {
    return store.get<string>('profile') ?? 'hcm';
  }
  private get liveDir() {
    return `${import.meta.env.BASE_URL}live/${this.pid}/`;
  }
  async profiles(): Promise<ProfilesState> {
    let list: ProfileInfo[] = [];
    if (this.sharedCfg) {
      const r = await fetch(`${this.reviewApi}/profiles`, { cache: 'no-cache' }).catch(() => null);
      if (r?.ok) list = ((await r.json()) as { profiles: ProfileInfo[] }).profiles;
    }
    if (!list.length && this.mode === 'live') {
      const r = await fetch(`${import.meta.env.BASE_URL}live/profiles.json`, { cache: 'no-cache' }).catch(() => null);
      if (r?.ok) list = ((await r.json()) as { profiles: ProfileInfo[] }).profiles.map((x) => ({ ...x, clonedFrom: x.clonedFrom ?? null, createdAt: x.createdAt ?? '', updatedAt: x.updatedAt ?? '' }));
    }
    if (!list.length) list = [{ id: 'hcm', name: 'TP.HCM', description: '', autoCollect: true, clonedFrom: null, createdAt: '', updatedAt: '' }];
    return { activeId: list.some((x) => x.id === this.pid) ? this.pid : list[0]!.id, profiles: list };
  }
  private who(action: string) {
    const s = store.get<{ name: string; code: string }>('reviewer');
    if (!this.sharedCfg) throw new ApiError(`Bản demo không ${action} được – dùng bản local hoặc bản web có máy chủ duyệt tin.`);
    if (!s) throw new ApiError(`Hãy đăng nhập người duyệt để ${action}`);
    return s;
  }
  /** new profile: the browser builds its configuration (new region from the defaults, or a copy) and the worker stores it */
  async createProfile(p: NewProfileInput): Promise<ProfileInfo> {
    const s = this.who('tạo cấu hình');
    let settings: Settings;
    let sources: Source[];
    if (p.cloneFrom) {
      const j = (await (await fetch(`${this.reviewApi}/config?profile=${encodeURIComponent(p.cloneFrom)}`, { cache: 'no-cache' })).json()) as { config: { settings: unknown; sources: unknown } | null };
      settings = j.config ? SettingsSchema.parse(j.config.settings) : defaultSettings();
      sources = j.config ? z.array(SourceSchema).parse(j.config.sources) : defaultSources(skillWebsites);
    } else {
      if (!p.regionName?.trim()) throw new ApiError('Nhập tên địa bàn (ví dụ: Hà Nội) hoặc chọn cấu hình để sao chép');
      settings = settingsForNewRegion(p.regionName, p.regionAliases ?? []);
      sources = defaultSources(skillWebsites);
    }
    const r = await fetch(`${this.reviewApi}/profiles`, {
      method: 'POST', headers: { 'x-review-code': s.code, 'content-type': 'application/json' },
      body: JSON.stringify({ name: p.name, description: p.description ?? '', clonedFrom: p.cloneFrom ?? null, settings: DemoApi.stripTemplate(settings), sources, reviewer: s.name }),
    });
    if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Không tạo được cấu hình (HTTP ${r.status})`);
    return (await r.json()) as ProfileInfo;
  }
  async updateProfile(id: string, patch: { name?: string; description?: string }): Promise<ProfileInfo> {
    const s = this.who('đổi tên cấu hình');
    const r = await fetch(`${this.reviewApi}/profiles/${id}`, { method: 'PATCH', headers: { 'x-review-code': s.code, 'content-type': 'application/json' }, body: JSON.stringify(patch) });
    if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Không lưu được');
    return (await r.json()) as ProfileInfo;
  }
  async deleteProfile(id: string) {
    const s = this.who('xóa cấu hình');
    const r = await fetch(`${this.reviewApi}/profiles/${id}`, { method: 'DELETE', headers: { 'x-review-code': s.code } });
    if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Không xóa được');
    if (this.pid === id) store.set('profile', null);
  }
  async activateProfile(id: string) {
    store.set('profile', id);
    this.serverCfg = null;
    this.refresh();
  }
  private liveIndex() {
    // a profile without published data yet (new profile) → no periods; a static host may answer with an HTML page
    this.index ??= fetch(`${this.liveDir}index.json?t=${Date.now()}`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    return this.index;
  }
  private latestId = '';
  /** runId → published file + report date (daily periods and on-demand "custom" windows) */
  private runMeta = new Map<string, { file: string; reportDate: string; v?: string; lite?: string }>();
  private reportDateOf(runId: string) {
    return this.runMeta.get(runId)?.reportDate ?? runId.replace(/^run_live_(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  }
  private load(id?: string): Promise<DemoBundle> {
    if (this.mode === 'demo') {
      if (!this.bundles.has('demo')) this.bundles.set('demo', fetch(`${import.meta.env.BASE_URL}demo/run.json`).then((r) => r.json() as Promise<DemoBundle>));
      return this.bundles.get('demo')!;
    }
    const runId = id || this.latestId;
    if (!this.bundles.has(runId)) {
      const meta = this.runMeta.get(runId);
      const file = meta?.lite ?? meta?.file ?? `${runId.replace(/^run_live_(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')}.json`;
      this.bundles.set(
        runId,
        fetch(`${this.liveDir}${file}?v=${encodeURIComponent(this.runMeta.get(runId)?.v ?? '')}`, { cache: 'no-cache' })
          .then((r) => r.json())
          .then((d: any) => ({ manifest: d.manifest, candidates: d.candidates.map((c: Candidate) => ({ ...c, history: [] })), articles: d.articles.map((a: any) => Object.assign(fromPublic(a, runId, d.generatedAt), a.bodyDeferred ? { bodyDeferred: true } : {})) })),
      );
    }
    return this.bundles.get(runId)!;
  }
  private bodyLoads = new Map<string, Promise<void>>();
  /** fills the full text of the stories the light copy left out (same article objects); no light copy → nothing to do */
  bodies(id: string): Promise<void> {
    const runId = id || this.latestId;
    const meta = this.runMeta.get(runId);
    if (this.mode !== 'live' || !meta?.lite) return Promise.resolve();
    if (!this.bodyLoads.has(runId)) {
      const p = Promise.all([this.load(runId), fetch(`${this.liveDir}${meta.file}?v=${encodeURIComponent(meta.v ?? '')}`, { cache: 'no-cache' }).then((r) => r.json())]).then(([b, full]: [DemoBundle, any]) => {
        const byId = new Map<string, any>((full.articles ?? []).map((x: any) => [x.id, x]));
        for (const a of b.articles as Array<Article & { bodyDeferred?: boolean }>) {
          if (!a.bodyDeferred) continue;
          const f = fromPublic(byId.get(a.id) ?? {}, runId, '');
          a.contentSections = f.contentSections;
          a.bodyText = f.bodyText;
          delete a.bodyDeferred;
        }
      });
      p.catch(() => this.bodyLoads.delete(runId));
      this.bodyLoads.set(runId, p);
    }
    return this.bodyLoads.get(runId)!;
  }
  refresh() {
    this.index = null;
    this.bundles.clear();
    this.bodyLoads.clear();
  }
  async meta() {
    if (this.mode !== 'live') return null;
    const i = await this.liveIndex();
    return i ? { generatedAt: i.generatedAt as string, schedule: i.schedule as string } : null;
  }
  private hist(kind: string, summary: string, value: unknown) {
    const h = store.get<Array<HistoryEntry & { value: unknown }>>('history') ?? [];
    h.unshift({ id: `${Date.now()}-${kind}`, at: new Date().toISOString(), kind, summary, value });
    store.set('history', h.slice(0, 50));
  }
  /* ---- configuration. Web with the review worker: ONE shared configuration, used by the server collector too ---- */
  private serverCfg: Promise<{ settings: Settings; sources: Source[] } | null> | null = null;
  private loadServerCfg() {
    this.serverCfg ??= fetch(`${this.reviewApi}/config?profile=${encodeURIComponent(this.pid)}`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : { config: null }))
      .then((j: any) => {
        if (!j?.config) return null;
        const s = SettingsSchema.safeParse(j.config.settings);
        const src = z.array(SourceSchema).safeParse(j.config.sources);
        return s.success && src.success ? { settings: s.data, sources: src.data } : null;
      })
      .catch(() => null);
    return this.serverCfg;
  }
  /** the PPTX template lives in THIS browser only (never uploaded): overlay its name on the shared settings */
  private withLocalTemplate(s: Settings): Settings {
    return { ...s, report: { ...s.report, templateFile: store.get<string>('tplName') ?? '' } };
  }
  private static stripTemplate(s: Settings): Settings {
    return { ...s, report: { ...s.report, templateFile: '' } };
  }
  private async pushServerCfg(settings: Settings, sources: Source[], summary: string) {
    const who = store.get<{ name: string; code: string }>('reviewer');
    if (!who) throw new ApiError('Hãy đăng nhập người duyệt để lưu cài đặt – cài đặt trên web dùng chung cho máy chủ thu thập');
    const body = { profile: this.pid, settings: DemoApi.stripTemplate(settings), sources, summary, reviewer: who.name };
    const r = await fetch(`${this.reviewApi}/config`, { method: 'POST', headers: { 'x-review-code': who.code, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Không lưu được cài đặt (HTTP ${r.status})`);
    this.serverCfg = Promise.resolve({ settings: body.settings, sources });
  }
  private get sharedCfg() {
    return !!this.reviewApi && this.mode === 'live';
  }
  async getSettings() {
    if (this.sharedCfg) return this.withLocalTemplate((await this.loadServerCfg())?.settings ?? defaultSettings());
    const s = store.get<Settings>('settings');
    return s ? SettingsSchema.parse(s) : defaultSettings();
  }
  async saveSettings(s: Settings, summary: string) {
    const v = SettingsSchema.parse(s);
    if (this.sharedCfg) {
      // only the browser-local template changed → nothing to share
      const cur = await this.getSettings();
      if (JSON.stringify(DemoApi.stripTemplate(cur)) !== JSON.stringify(DemoApi.stripTemplate(v))) await this.pushServerCfg(v, await this.getSources(), summary);
      return this.withLocalTemplate(v);
    }
    this.hist('settings', summary, await this.getSettings());
    store.set('settings', v);
    return v;
  }
  async getSources() {
    if (this.sharedCfg) return (await this.loadServerCfg())?.sources ?? defaultSources(skillWebsites);
    return store.get<Source[]>('sources') ?? defaultSources(skillWebsites);
  }
  async saveSources(list: Source[], summary: string) {
    const v = z.array(SourceSchema).parse(list);
    if (this.sharedCfg) {
      await this.pushServerCfg(await this.getSettings(), v, summary);
      return v;
    }
    this.hist('sources', summary, await this.getSources());
    store.set('sources', v);
    return v;
  }
  async importSkill(text: string) {
    return parseWebsitesTxt(text);
  }
  /**
   * "Dò nguồn" / "Thử nguồn" on the web: the collector's own discovery + extraction run in this browser; publisher
   * pages are fetched through the review worker (publishers do not allow cross-origin reads) – reviewers only.
   */
  private proxyHttp() {
    const s = store.get<{ name: string; code: string }>('reviewer');
    if (!this.shared || !s) throw new ApiError('Hãy đăng nhập người duyệt để dò / thử nguồn trên web (trang báo được tải qua máy chủ duyệt tin)');
    const get = async (url: string) => {
      try {
        const r = await fetch(`${this.reviewApi}/fetch?url=${encodeURIComponent(url)}`, { headers: { 'x-review-code': s.code } });
        if (!r.ok) {
          const err = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`;
          return { requestedUrl: url, finalUrl: url, status: 0, body: '', contentType: '', errorCode: r.status === 400 ? 'SSRF_BLOCKED' : 'NETWORK', error: err, attempts: 1 };
        }
        return { ...((await r.json()) as { requestedUrl: string; finalUrl: string; status: number; body: string; contentType: string; errorCode: string | null; error: string | null }), attempts: 1 };
      } catch (e) {
        return { requestedUrl: url, finalUrl: url, status: 0, body: '', contentType: '', errorCode: 'NETWORK', error: (e as Error).message, attempts: 1 };
      }
    };
    return { get } as unknown as import('../../src/collector/http').HttpClient;
  }
  async detect(url: string) {
    const http = this.proxyHttp();
    const { detectStructure } = await import('../../src/collector/probe');
    return detectStructure(url, http);
  }
  async testSource(src: Source, opts?: { quick?: boolean }) {
    const http = this.proxyHttp();
    const { probeSource } = await import('../../src/collector/probe');
    return opts?.quick ? probeSource(src, await this.getSettings(), http, 1, 1) : probeSource(src, await this.getSettings(), http);
  }
  async previewRule(root: RuleNode, settings: Settings, sample?: { title: string; body: string }) {
    const results: PreviewResult['results'] = [];
    if (sample) {
      const r = evaluateRule(root, sample, settings.keywords.synonyms);
      results.push({ id: 'sample', title: sample.title, matched: r.matched, lines: r.lines });
    }
    for (const a of (await this.load()).articles) {
      const body = `${a.sapo}\n${a.bodyText}`;
      const r = evaluateRule(root, { title: a.title, body }, settings.keywords.synonyms);
      results.push({ id: a.id, title: a.title, matched: r.matched, lines: r.lines, location: judgeRelevance(a.title, body, a.sourceId, settings).location.status });
    }
    return { errors: validateRule(root), results };
  }
  async history() {
    if (this.sharedCfg) {
      const who = store.get<{ name: string; code: string }>('reviewer');
      if (!who) return [];
      const r = await fetch(`${this.reviewApi}/config/history?profile=${encodeURIComponent(this.pid)}`, { headers: { 'x-review-code': who.code }, cache: 'no-cache' });
      if (!r.ok) throw new ApiError('Không tải được lịch sử cấu hình');
      const j = (await r.json()) as { items: Array<{ id: string; at: string; by: string; summary: string }> };
      return j.items.map((x) => ({ id: x.id, at: x.at, kind: 'settings', summary: `${x.summary} – ${x.by}` }));
    }
    return (store.get<HistoryEntry[]>('history') ?? []).map(({ id, at, kind, summary }) => ({ id, at, kind, summary }));
  }
  async rollback(id: string) {
    if (this.sharedCfg) {
      const who = store.get<{ name: string; code: string }>('reviewer');
      if (!who) throw new ApiError('Hãy đăng nhập người duyệt để khôi phục cấu hình');
      const r = await fetch(`${this.reviewApi}/config/rollback`, { method: 'POST', headers: { 'x-review-code': who.code, 'content-type': 'application/json' }, body: JSON.stringify({ id, reviewer: who.name, profile: this.pid }) });
      if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Không khôi phục được');
      this.serverCfg = null;
      return;
    }
    const h = store.get<Array<HistoryEntry & { value: unknown }>>('history') ?? [];
    const e = h.find((x) => x.id === id);
    if (!e) throw new ApiError('Không tìm thấy phiên bản');
    if (e.kind === 'settings') await this.saveSettings(e.value as Settings, `Khôi phục ${id}`);
    else await this.saveSources(e.value as Source[], `Khôi phục ${id}`);
  }
  async backup() {
    return { kind: 'hcm-news-reporter-backup', exportedAt: new Date().toISOString(), settings: await this.getSettings(), sources: await this.getSources() };
  }
  async restore(b: any) {
    if (b?.kind !== 'hcm-news-reporter-backup') throw new ApiError('Tệp sao lưu không hợp lệ');
    await this.saveSettings(b.settings, 'Khôi phục từ bản sao lưu');
    await this.saveSources(b.sources, 'Khôi phục từ bản sao lưu');
  }
  /** runs a reviewer removed from "Lượt đã lưu" (shared by the team through the review worker) */
  private hidden: HiddenRunRef[] = [];
  private allRuns: RunInfo[] = [];
  private async loadHidden() {
    if (!this.reviewApi) return [];
    try {
      const r = await fetch(`${this.reviewApi}/runs/hidden?profile=${encodeURIComponent(this.pid)}`, { cache: 'no-cache' });
      this.hidden = r.ok ? ((await r.json()) as { hidden: HiddenRunRef[] }).hidden : this.hidden;
    } catch {
      /* offline: keep the last list */
    }
    return this.hidden;
  }
  async archiveRun(id: string, archived: boolean) {
    const s = this.who(archived ? 'lưu trữ lượt' : 'bỏ lưu trữ lượt');
    const r = await fetch(`${this.reviewApi}/runs/hide`, { method: 'POST', headers: { 'x-review-code': s.code, 'content-type': 'application/json' }, body: JSON.stringify({ profile: this.pid, runId: id, archived, reviewer: s.name }) });
    if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Không lưu được');
    this.hidden = ((await r.json()) as { hidden: HiddenRunRef[] }).hidden;
  }
  private async setHidden(id: string, hidden: boolean) {
    const s = this.who(hidden ? 'xoá lượt đã lưu' : 'khôi phục lượt đã lưu');
    const r = await fetch(`${this.reviewApi}/runs/hide`, { method: 'POST', headers: { 'x-review-code': s.code, 'content-type': 'application/json' }, body: JSON.stringify({ profile: this.pid, runId: id, hidden, reviewer: s.name }) });
    if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Không lưu được');
    this.hidden = ((await r.json()) as { hidden: HiddenRunRef[] }).hidden;
  }
  async deleteRun(id: string) {
    await this.setHidden(id, true);
  }
  async suggestions(): Promise<SuggestionsState> {
    if (!this.reviewApi || this.mode !== 'live') return { generatedAt: null, basis: null, items: [] };
    const r = await fetch(`${this.reviewApi}/suggestions?profile=${encodeURIComponent(this.pid)}`, { cache: 'no-cache' });
    if (!r.ok) throw new ApiError(`Không tải được gợi ý (HTTP ${r.status})`);
    return (await r.json()) as SuggestionsState;
  }
  private modelP: Promise<LearnedModel | null> | null = null;
  learnedModel(): Promise<LearnedModel | null> {
    if (!this.reviewApi || this.mode !== 'live') return Promise.resolve(null);
    this.modelP ??= fetch(`${this.reviewApi}/model?profile=${encodeURIComponent(this.pid)}`, { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<LearnedModel | null>) : null))
      .catch(() => null);
    return this.modelP;
  }
  async golden(): Promise<GoldenSet> {
    if (!this.reviewApi || this.mode !== 'live') return { articles: [], judged: {} };
    const r = await fetch(`${this.reviewApi}/golden?profile=${encodeURIComponent(this.pid)}`, { cache: 'no-cache' });
    return r.ok ? ((await r.json()) as GoldenSet) : { articles: [], judged: {} };
  }
  async dismissSuggestion(id: string) {
    const s = this.who('bỏ qua gợi ý');
    const r = await fetch(`${this.reviewApi}/suggestions/dismiss`, { method: 'POST', headers: { 'x-review-code': s.code, 'content-type': 'application/json' }, body: JSON.stringify({ profile: this.pid, id, reviewer: s.name }) });
    if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Không lưu được');
  }
  async restoreRun(id: string) {
    await this.setHidden(id, false);
  }
  async hiddenRuns() {
    const hid = await this.loadHidden();
    const byId = new Map(this.allRuns.map((r) => [r.runId, r]));
    return hid.filter((x) => byId.has(x.runId)).map((x) => ({ run: byId.get(x.runId)!, by: x.by, at: x.at })).reverse();
  }
  async listRuns(): Promise<RunInfo[]> {
    if (this.mode === 'demo') return [{ ...(await this.load()).manifest, active: false }];
    const hiddenP = this.loadHidden();
    const i = await this.liveIndex();
    const days: any[] = i?.days ?? [];
    const runs = days.map((d) => {
      const key: string = d.key ?? d.reportDate;
      const runId = `run_live_${key.replace(/[^0-9a-z]/gi, '')}`;
      this.runMeta.set(runId, { file: d.file ?? `${d.reportDate}.json`, lite: d.lite, reportDate: d.reportDate, v: d.generatedAt });
      const notes = [...(d.provisional ? ['Kỳ đang diễn ra – tạm thời'] : []), ...(d.scheduled ? [`Thu thập theo lịch ${d.scheduled}`] : d.custom ? [`Thu thập theo yêu cầu${d.requestedBy ? ` (${d.requestedBy})` : ''}`] : [])];
      return {
        runId, createdAt: d.generatedAt, finishedAt: d.generatedAt, window: d.window, trigger: (d.custom ? 'manual' : 'auto') as 'manual' | 'auto',
        status: 'completed' as const, sources: [], counts: d.counts, completeness: d.completeness, settingsHash: '', notes, active: false,
      };
    });
    this.allRuns = runs;
    const hid = await hiddenP;
    const deleted = new Set(hid.filter((x) => !x.archived).map((x) => x.runId));
    const archived = new Set(hid.filter((x) => x.archived).map((x) => x.runId));
    const shown = runs.filter((r) => !deleted.has(r.runId)).map((r): typeof r & { archived?: boolean } => (archived.has(r.runId) ? { ...r, archived: true } : r));
    this.latestId = shown.find((r) => !r.archived)?.runId ?? shown[0]?.runId ?? '';
    return shown;
  }
  async startRun(window: ReportWindow): Promise<{ remote: true }> {
    const s = store.get<{ name: string; code: string }>('reviewer');
    if (!this.shared || !s) throw new ApiError(NO_NET);
    const r = await fetch(`${this.reviewApi}/collect`, {
      method: 'POST',
      headers: { 'x-review-code': s.code, 'content-type': 'application/json' },
      body: JSON.stringify({ from: window.from.slice(0, 16) + '+07:00', to: window.to.slice(0, 16) + '+07:00', reviewer: s.name, profile: this.pid }),
    });
    if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Không gửi được yêu cầu thu thập (HTTP ${r.status})`);
    return { remote: true };
  }
  async getRun(id: string) {
    const b = await this.load(id);
    const rec = (b.manifest as RunInfo).reconciliation ?? { total: b.candidates.length, accounted: b.candidates.length, transient: 0, balanced: true };
    // the id this period is listed (and its team review stored) under, whatever the published manifest says
    return { ...b.manifest, runId: id, active: false, reconciliation: rec };
  }
  async cancel() {}
  async retry(): Promise<never> {
    throw new ApiError(NO_NET);
  }
  async candidates(id: string) {
    return (await this.load(id)).candidates;
  }
  async articles(id: string) {
    return (await this.load(id)).articles;
  }
  /**
   * Web: ONE review per period for the whole team (worker /review): selection, order, Sẵn sàng/Loại, edits, merges…
   * Personal votes (✓/✗ relevance, note) stay per reviewer (labels store). Offline → the last copy in this browser.
   */
  private get teamReview() {
    return !!this.reviewApi && this.mode === 'live';
  }
  async review(id: string) {
    const local = store.get<Record<string, ReviewDecision>>(`review:${id}`) ?? {};
    if (!this.teamReview) return local;
    let team: Record<string, Partial<ReviewDecision> & { by?: string; at?: string }>;
    try {
      // the copy fetched at page start is used once, within 15 s (later reads fetch again: other reviewers' changes)
      const pre = this.reviewPrefetch;
      this.reviewPrefetch = null;
      team = pre && pre.id === id && Date.now() - pre.at < 15_000 ? await pre.p : await this.fetchTeamReview(id);
    } catch {
      return local; // offline: last copy seen in this browser
    }
    team = await this.migrateLocalReview(id, local, team);
    const out: Record<string, ReviewDecision> = {};
    for (const aid of new Set([...Object.keys(local), ...Object.keys(team)])) {
      const l = local[aid];
      const t = team[aid];
      const { by, at, ...shared } = t ?? {};
      out[aid] = {
        articleId: aid, included: false, order: 0, updatedAt: at ?? l?.updatedAt ?? '', changes: l?.changes ?? [],
        // personal votes from this browser, the team's decision from the worker
        ...(l?.relevanceLabel !== undefined ? { relevanceLabel: l.relevanceLabel } : {}), ...(l?.reviewNote !== undefined ? { reviewNote: l.reviewNote } : {}),
        ...shared, ...(by ? { sharedBy: by, sharedAt: at } : {}),
      } as ReviewDecision;
    }
    store.set(`review:${id}`, out);
    return out;
  }
  /** first visit of a period with a reviewer session: decisions made in this browser before the team review existed are shared once (never over the team's) */
  private async migrateLocalReview(id: string, local: Record<string, ReviewDecision>, team: Record<string, any>) {
    const s = store.get<{ name: string; code: string }>('reviewer');
    const flag = `rvmig:${this.pid}:${id}`;
    if (!s || store.get<boolean>(flag)) return team;
    const next = { ...team };
    for (const [aid, d] of Object.entries(local)) {
      if (team[aid]) continue;
      const patch = pickShared(d);
      const meaningful = patch.included || patch.promotedToReady || patch.excludedByEditor || patch.groupId || patch.title || patch.summary || patch.shortLabel || patch.proposal || patch.timeVerifiedManually || patch.primaryImageUrl;
      if (!meaningful) continue;
      try {
        next[aid] = await this.postTeamReview(id, aid, patch, s);
      } catch {
        return team; // try again next time
      }
    }
    store.set(flag, true);
    return next;
  }
  private async postTeamReview(id: string, articleId: string, patch: Partial<ReviewDecision>, s: { name: string; code: string }) {
    const r = await fetch(`${this.reviewApi}/review`, {
      method: 'POST', headers: { 'x-review-code': s.code, 'content-type': 'application/json' },
      body: JSON.stringify({ profile: this.pid, period: id, articleId, patch, reviewer: s.name }),
    });
    if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Không lưu được kết quả duyệt chung (HTTP ${r.status})`);
    return ((await r.json()) as { review: Partial<ReviewDecision> & { by?: string; at?: string } }).review;
  }
  /**
   * Team decisions are sent in batches: every change made in the same moment ("Chọn tất cả", quick clicks) goes in ONE
   * request (one KV read + write on the worker, ~0.3–1 s from Vietnam) instead of one request per story in a row;
   * one batch at a time per period, so two saves from this browser never overwrite each other.
   */
  private teamQueue = new Map<string, { items: Map<string, Partial<ReviewDecision>>; waiters: Array<{ articleId: string; ok: (d: any) => void; fail: (e: unknown) => void }>; busy: boolean }>();
  private queueTeamReview(id: string, articleId: string, patch: Partial<ReviewDecision>, s: { name: string; code: string }) {
    let q = this.teamQueue.get(id);
    if (!q) this.teamQueue.set(id, (q = { items: new Map(), waiters: [], busy: false }));
    q.items.set(articleId, { ...q.items.get(articleId), ...patch });
    const p = new Promise<Partial<ReviewDecision> & { by?: string; at?: string }>((ok, fail) => q!.waiters.push({ articleId, ok, fail }));
    if (!q.busy) setTimeout(() => void this.flushTeam(id, s), 0);
    return p;
  }
  private async flushTeam(id: string, s: { name: string; code: string }) {
    const q = this.teamQueue.get(id);
    if (!q || q.busy) return;
    q.busy = true;
    try {
      while (q.items.size) {
        const items = [...q.items].map(([articleId, patch]) => ({ articleId, patch }));
        const waiters = q.waiters;
        q.items = new Map();
        q.waiters = [];
        try {
          const r = await fetch(`${this.reviewApi}/review`, {
            method: 'POST', headers: { 'x-review-code': s.code, 'content-type': 'application/json' },
            body: JSON.stringify({ profile: this.pid, period: id, items, reviewer: s.name }),
          });
          if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Không lưu được kết quả duyệt chung (HTTP ${r.status})`);
          const out = ((await r.json()) as { reviews: Record<string, Partial<ReviewDecision> & { by?: string; at?: string }> }).reviews;
          for (const w of waiters) w.ok(out[w.articleId] ?? {});
        } catch (e) {
          for (const w of waiters) w.fail(e);
        }
      }
    } finally {
      q.busy = false;
    }
  }
  async patchReview(id: string, articleId: string, patch: Partial<ReviewDecision>) {
    // the team's decision is saved on the worker first (needs a reviewer session); the browser keeps a copy
    const shared = pickShared(patch);
    let team: (Partial<ReviewDecision> & { by?: string; at?: string }) | null = null;
    if (this.teamReview && Object.keys(shared).length) {
      const s = store.get<{ name: string; code: string }>('reviewer');
      if (!s) throw new ApiError('Hãy đăng nhập người duyệt để lưu kết quả duyệt chung cho cả nhóm');
      team = await this.queueTeamReview(id, articleId, shared, s);
    }
    const all = store.get<Record<string, ReviewDecision>>(`review:${id}`) ?? {};
    const now = new Date().toISOString();
    const prev: ReviewDecision = all[articleId] ?? { articleId, included: false, order: Object.keys(all).length, updatedAt: now, changes: [] };
    const changes = [...prev.changes];
    for (const [k, v] of Object.entries(patch)) changes.push({ at: now, field: k, from: (prev as any)[k] ?? null, to: v });
    const next = { ...prev, ...patch, articleId, updatedAt: now, changes };
    // shared review: relevance / sector / assessment / note go to the team's store (Cloudflare Worker)
    if (this.shared && ['relevanceLabel', 'primaryCategory', 'assessment', 'reviewNote'].some((k) => k in patch)) {
      const a = (await this.load(id)).articles.find((x) => x.id === articleId);
      await this.sharedPost({
        reportDate: this.reportDateOf(id), articleId, url: a?.originalUrl ?? '', title: a?.title ?? '', sourceId: a?.sourceId ?? '',
        label: next.relevanceLabel ?? null, category: next.primaryCategory ?? null, assessment: next.assessment ?? null, note: next.reviewNote ?? '',
      });
    }
    if (team) {
      const { by, at, ...rest } = team;
      Object.assign(next, rest, { sharedBy: by, sharedAt: at });
    }
    // re-read: other saves of this period may have finished while this one waited for the network
    const latest = store.get<Record<string, ReviewDecision>>(`review:${id}`) ?? {};
    latest[articleId] = next;
    store.set(`review:${id}`, latest);
    return next;
  }

  /* ---------------- shared review (Cloudflare Worker) ---------------- */
  private readonly reviewApi = (import.meta.env.VITE_REVIEW_API as string | undefined) || '';
  shared: SharedReview | undefined = this.reviewApi && this.mode === 'live' ? this.makeShared() : undefined;
  /** Cài đặt › Tài khoản calls (session of the signed-in account) */
  private async userCall(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const s = store.get<{ code: string }>('reviewer');
    if (!s) throw new ApiError('Hãy đăng nhập');
    const r = await fetch(`${this.reviewApi}${path}`, { method, headers: { 'x-review-code': s.code, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-cache' });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) throw new ApiError(j.error ?? `Lỗi ${r.status}`);
    return j;
  }
  private makeShared(): SharedReview {
    return {
      serverStatus: async () => {
        const r = await fetch(`${this.reviewApi}/status`, { cache: 'no-cache' });
        if (!r.ok) throw new ApiError('Không xem được trạng thái máy chủ thu thập');
        return (await r.json()) as ServerStatus;
      },
      setSchedule: async (slot, enabled) => {
        const s = store.get<{ name: string; code: string }>('reviewer');
        if (!s) throw new ApiError('Hãy đăng nhập người duyệt để đổi chế độ tự động');
        const r = await fetch(`${this.reviewApi}/auto`, { method: 'POST', headers: { 'x-review-code': s.code, 'content-type': 'application/json' }, body: JSON.stringify({ slot, enabled, reviewer: s.name, profile: this.pid }) });
        if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Không đổi được chế độ tự động (HTTP ${r.status})`);
        return ((await r.json()) as { profile: ProfileInfo }).profile;
      },
      setScheduleTimes: async (times) => {
        const s = store.get<{ name: string; code: string }>('reviewer');
        if (!s) throw new ApiError('Hãy đăng nhập người duyệt để đổi giờ lịch tự động');
        const r = await fetch(`${this.reviewApi}/auto/times`, { method: 'POST', headers: { 'x-review-code': s.code, 'content-type': 'application/json' }, body: JSON.stringify({ times, reviewer: s.name, profile: this.pid }) });
        if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Không lưu được giờ lịch (HTTP ${r.status})`);
        return ((await r.json()) as { profile: ProfileInfo }).profile;
      },
      tokenInfo: async () => {
        const s = store.get<{ name: string; code: string }>('reviewer');
        if (!s) throw new ApiError('Hãy đăng nhập người duyệt để xem khóa thu thập');
        const r = await fetch(`${this.reviewApi}/token`, { headers: { 'x-review-code': s.code }, cache: 'no-cache' });
        if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Không xem được khóa thu thập (HTTP ${r.status})`);
        return (await r.json()) as TokenInfo;
      },
      setToken: async (token) => {
        const s = store.get<{ name: string; code: string }>('reviewer');
        if (!s) throw new ApiError('Hãy đăng nhập người duyệt để đổi khóa thu thập');
        const r = await fetch(`${this.reviewApi}/token`, { method: 'POST', headers: { 'x-review-code': s.code, 'content-type': 'application/json' }, body: JSON.stringify({ token, reviewer: s.name }) });
        const j = (await r.json().catch(() => ({}))) as { error?: string; token?: TokenInfo };
        if (!r.ok) throw new ApiError(j.error ?? `Không lưu được khóa (HTTP ${r.status})`);
        return { configured: true, ok: true, ...j.token };
      },
      profileId: () => this.pid,
      session: () => store.get<{ name: string; code: string }>('reviewer') ?? null,
      login: async (username, password) => {
        const r = await fetch(`${this.reviewApi}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: username.trim(), password }) });
        const j = (await r.json().catch(() => ({}))) as { error?: string; token?: string; name?: string; role?: UserRole; user?: string };
        if (!r.ok || !j.token) throw new ApiError(j.error ?? 'Không đăng nhập được');
        store.set('reviewer', { name: (j.name || j.user || username).slice(0, 40), code: j.token, user: j.user, role: j.role });
        return { name: j.name || username, role: j.role ?? 'reviewer' };
      },
      logout: () => {
        const s = store.get<{ code: string }>('reviewer');
        if (s?.code.startsWith('sess_')) void fetch(`${this.reviewApi}/logout`, { method: 'POST', headers: { 'x-review-code': s.code } }).catch(() => undefined);
        store.set('reviewer', null);
      },
      role: () => {
        const s = store.get<{ code: string; role?: UserRole }>('reviewer');
        return s ? (s.role ?? (s.code.startsWith('sess_') ? 'reviewer' : 'admin')) : null;
      },
      users: async () => ((await this.userCall('GET', '/users')) as { users: UserInfo[] }).users,
      saveUser: async (u) => ((await this.userCall('POST', '/users', u)) as { users: UserInfo[] }).users,
      deleteUser: async (u) => ((await this.userCall('POST', '/users/delete', { u })) as { users: UserInfo[] }).users,
      changePassword: async (password) => void (await this.userCall('POST', '/users/password', { password })),
      votes: async (runId) => {
        const s = store.get<{ name: string; code: string }>('reviewer');
        if (!s) return {};
        const date = this.reportDateOf(runId);
        const r = await fetch(`${this.reviewApi}/labels?date=${date}`, { headers: { 'x-review-code': s.code }, cache: 'no-cache' });
        if (!r.ok) throw new ApiError('Không tải được kết quả duyệt chung');
        return ((await r.json()) as { votes: Record<string, Vote[]> }).votes;
      },
      collectStatus: async () => {
        const s = store.get<{ name: string; code: string }>('reviewer');
        if (!s) return { enabled: false, runs: [] };
        const r = await fetch(`${this.reviewApi}/collect/status`, { headers: { 'x-review-code': s.code }, cache: 'no-cache' });
        if (!r.ok) throw new ApiError('Không xem được tiến độ thu thập');
        return (await r.json()) as { enabled: boolean; runs: CollectRun[] };
      },
    };
  }
  /** votes are sent one after another (the worker keeps one value per day: two saves at once could overwrite each other) */
  private labelChain: Promise<unknown> = Promise.resolve();
  private sharedPost(body: Record<string, unknown>) {
    const next = this.labelChain.catch(() => undefined).then(() => this.sharedPostNow(body));
    this.labelChain = next;
    return next;
  }
  private async sharedPostNow(body: Record<string, unknown>) {
    const s = store.get<{ name: string; code: string }>('reviewer');
    if (!s) throw new ApiError('Hãy đăng nhập người duyệt (tên + mã truy cập) để lưu đánh giá cho cả nhóm');
    const r = await fetch(`${this.reviewApi}/labels`, { method: 'POST', headers: { 'x-review-code': s.code, 'content-type': 'application/json' }, body: JSON.stringify({ ...body, reviewer: s.name }) });
    if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Không lưu được đánh giá (HTTP ${r.status})`);
  }
  async capabilities() {
    const tpl = store.get<string>('tplName') ?? null;
    return { pdf: true, soffice: null, templateFile: tpl, templateFidelity: !!tpl };
  }
  /** article photo for the report, through the review worker (publishers do not allow cross-origin reads) */
  private async fetchImage(url: string, minWidth: number) {
    const { imageSize } = await import('../../src/reports/templatePptx');
    const who = store.get<{ name: string; code: string }>('reviewer');
    if (!who || !this.reviewApi) return null;
    try {
      const r = await fetch(`${this.reviewApi}/img?url=${encodeURIComponent(url)}`, { headers: { 'x-review-code': who.code } });
      if (!r.ok) return null;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length < 8_000 || buf.length > 8_000_000) return null; // tracking pixel / oversized (same rule as the local app)
      const size = imageSize(buf);
      if (!size || size.width < minWidth || size.width / size.height > 4 || size.height / size.width > 4) return null;
      return { bytes: buf, ...size };
    } catch {
      return null;
    }
  }
  /** Same report as the local app: the department's ORIGINAL template (chosen from this computer) with real article photos. */
  async templates() {
    const settings = await this.getSettings();
    const up = store.get<string>('tplName');
    return {
      defaultId: settings.report.templateId,
      templates: [
        ...TEMPLATES.map((x) => ({ ...x, available: true })),
        ...(up ? [{ id: UPLOAD_TEMPLATE_ID, name: `Mẫu trong trình duyệt này (${up})`, kind: 'upload' as const, orientation: 'portrait' as const, description: 'Tệp .pptx cùng cấu trúc mẫu Sở, chọn từ máy ở Cài đặt › Báo cáo & mẫu (không tải lên đâu).', available: true }] : []),
      ],
    };
  }
  async exportRun(id: string, formats: ExportFormat[], dryRun: boolean, templateId?: string): Promise<ExportResult> {
    await this.bodies(id).catch(() => undefined);
    const { assembleStories } = await import('../../src/reports/assemble');
    const { checkFit } = await import('../../src/reports/pptx');
    const { buildFromTemplate, TemplateMismatchError } = await import('../../src/reports/templatePptx');
    const b = await this.load(id);
    const settings = await this.getSettings();
    const asm = assembleStories(b.articles, await this.review(id), settings);
    const warn = [...asm.warnings, ...checkFit(asm.stories).map((f) => f.message)];
    if (asm.blockers.length || dryRun) return { ok: false, dryRun, blockers: asm.blockers, warnings: warn, stories: asm.stories.length };
    const articles = b.articles;
    const images = new Map<string, { bytes: Uint8Array; ext: 'jpeg' | 'png'; width: number; height: number; credit?: string; sourceUrl: string }>();
    const stories = asm.stories.map((s) => ({ ...s, imageKey: null as string | null }));
    let tcFeatureKey: string | null = null;
    const wantPptx = formats.includes('pptx');
    // the PDF is built in this browser by the app's own PDF builder (same stories, real photos, clickable links)
    const wantPdf = formats.includes('pdf') && settings.report.pdfRenderer !== 'none';
    if ((wantPptx || wantPdf) && settings.editorial.photoPolicy !== 'link_only') {
      if (!this.shared?.session()) warn.push('Chưa đăng nhập người duyệt – không tải được ảnh báo gốc, các tin dùng bố cục chữ.');
      else
        for (const st of stories) {
          if (!st.imageUrl || st.group === 'neutral') continue;
          const art = articles.find((a) => a.id === st.articleId);
          const owner = [st.articleId, ...st.mergedArticleIds].map((x) => articles.find((a) => a.id === x)).find((a) => a?.imageCandidates.some((i) => i.url === st.imageUrl));
          const cand = owner?.imageCandidates.find((i) => i.url === st.imageUrl);
          if (settings.editorial.photoPolicy === 'strict_verified_only' && cand?.rightsStatus !== 'verified') {
            warn.push(`${st.id}: ảnh chưa xác minh quyền – để trống theo chính sách`);
            continue;
          }
          const img = await this.fetchImage(st.imageUrl, settings.editorial.minImageWidth);
          if (img) {
            const pub = owner?.sourceName ?? st.sources[0]?.name;
            const credit = cand?.credit ? `${cand.credit}/${pub}` : pub;
            images.set(st.imageUrl, { ...img, credit, sourceUrl: owner?.canonicalUrl ?? owner?.originalUrl ?? st.sources[0]?.url ?? st.imageUrl });
            st.imageKey = st.imageUrl;
            st.image = { data: `data:image/${img.ext};base64,${toBase64(img.bytes)}`, caption: cand?.caption, credit };
          } else warn.push(`${st.id}: không tải được ảnh gốc hợp lệ (jpeg/png, đủ kích thước) – dùng bố cục chữ`);
          if (st.group === 'positive' && !tcFeatureKey && art) {
            const second = art.imageCandidates.find((i) => i.url !== st.imageUrl && i.origin === 'body' && i.rightsStatus !== 'not_usable');
            const f2 = second ? await this.fetchImage(second.url, settings.editorial.minImageWidth) : null;
            if (second && f2) {
              images.set(second.url, { ...f2, credit: second.credit ? `${second.credit}/${st.sources[0]?.name}` : st.sources[0]?.name, sourceUrl: st.sources[0]?.url ?? second.url });
              tcFeatureKey = second.url;
            }
          }
        }
    }
    const w = b.manifest.window;
    const date = vnDate(new Date(w.to));
    const [y, mo, d] = date.split('-');
    const hhmm = (iso: string) => iso.slice(11, 16).replace(':', '');
    const base = settings.report.filenamePattern.replace('{date}', date).replace('{from}', hhmm(w.from)).replace('{to}', hhmm(w.to)).replace(/[^\w.-]+/g, '_');
    let bytes: Uint8Array = new Uint8Array();
    let name = `${base}.pptx`;
    // template chosen in the export panel: the Department's template from the Skill (published with the site),
    // one of the app's original designs, or the template kept in this browser
    const chosen = templateId ?? settings.report.templateId;
    const info = chosen === UPLOAD_TEMPLATE_ID ? null : templateById(chosen);
    const fill = async (tplBytes: Uint8Array) => {
      const coverImageKey = stories.find((s) => s.group === 'needs_attention' && s.imageKey)?.imageKey ?? stories.find((s) => s.imageKey)?.imageKey ?? null;
      const r = await buildFromTemplate(tplBytes, { organization: settings.report.organization, reportDate: date, stories, images, coverImageKey, tcFeatureKey, contactEmail: settings.report.contactEmail });
      warn.push(...r.notes);
      return r.bytes;
    };
    try {
      if (!wantPptx) {
        // Word only: the PowerPoint is not built
      } else if (!info) {
        const up = store.get<string>('tplName') ? await idbGet<Uint8Array>('template') : undefined;
        if (!up) return { ok: false, blockers: ['Trình duyệt này chưa có mẫu tải lên (Cài đặt › Báo cáo & mẫu › Tải mẫu .pptx)'], warnings: warn };
        bytes = await fill(up);
        name = `${base}.pptx`;
      } else if (info.kind === 'original-pptx') {
        const r = await fetch(`${import.meta.env.BASE_URL}templates/${info.file}`);
        if (!r.ok) return { ok: false, blockers: [`Không tải được tệp mẫu "${info.name}" (HTTP ${r.status})`], warnings: warn };
        bytes = await fill(new Uint8Array(await r.arrayBuffer()));
        name = `${base}.pptx`;
      } else {
        const { buildStyledPptx } = await import('../../src/reports/styles');
        bytes = await buildStyledPptx(info.style!, {
          organization: settings.report.organization, window: w, reportDateLabel: `${d}/${mo}/${y}`, stories,
          storiesPerPage: settings.report.storiesPerPage, contactEmail: settings.report.contactEmail, regionName: settings.location.regionName,
        });
        name = `${base}.pptx`;
      }
    } catch (e) {
      if (!(e instanceof TemplateMismatchError)) throw e;
      return { ok: false, blockers: [`BLOCKED – mẫu PPTX không khớp cấu trúc đã khảo sát: ${e.message}`], warnings: warn };
    }
    const save = (data: Uint8Array, fileName: string, type: string) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type }));
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    const files: string[] = [];
    if (wantPptx) {
      save(bytes, name, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      files.push(name);
    }
    // Word: the Department's .docx template (published with the site), same stories, built in this browser
    if (formats.includes('docx')) {
      const { buildDocxFromTemplate, DocxTemplateMismatchError } = await import('../../src/reports/templateDocx');
      const { DOCX_TEMPLATE_FILE } = await import('../../src/reports/templates');
      const r = await fetch(`${import.meta.env.BASE_URL}templates/${DOCX_TEMPLATE_FILE}`);
      if (!r.ok) warn.push(`Không tải được mẫu Word (HTTP ${r.status}) – không xuất .docx`);
      else {
        try {
          const out = await buildDocxFromTemplate(new Uint8Array(await r.arrayBuffer()), { reportDate: `${y}-${mo}-${d}`, stories, contactEmail: settings.report.contactEmail });
          warn.push(...out.notes);
          const docxName = `${base}.docx`; // same name as the .pptx / .pdf
          save(out.bytes, docxName, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
          files.push(docxName);
        } catch (e) {
          if (!(e instanceof DocxTemplateMismatchError)) throw e;
          return { ok: false, blockers: [`BLOCKED – mẫu Word không khớp cấu trúc đã khảo sát: ${e.message}`], warnings: warn };
        }
      }
    }
    let pdfStatus = formats.includes('pdf') ? 'unavailable: PDF đang tắt (Cài đặt › Báo cáo & mẫu › Bộ xuất PDF)' : 'not_requested';
    if (wantPdf) {
      const { buildReportPdf, PDF_FONT_FILES } = await import('../../src/reports/pdf');
      const rs = await Promise.all(Object.values(PDF_FONT_FILES).map((f) => fetch(`${import.meta.env.BASE_URL}fonts/${f}`)));
      const bad = rs.find((r) => !r.ok);
      if (bad) pdfStatus = `failed: không tải được phông chữ của PDF (HTTP ${bad.status})`;
      else {
        const [regular, bold, italic] = await Promise.all(rs.map(async (r) => new Uint8Array(await r.arrayBuffer())));
        const out = await buildReportPdf(
          { organization: settings.report.organization, reportDate: `${y}-${mo}-${d}`, window: w, stories, contactEmail: settings.report.contactEmail, regionName: settings.location.regionName },
          { regular: regular!, bold: bold!, italic: italic! },
        );
        warn.push(...out.notes);
        save(out.bytes, `${base}.pdf`, 'application/pdf');
        files.push(`${base}.pdf`);
        pdfStatus = 'ok';
      }
    }
    return { ok: true, files, warnings: warn, pdfStatus };
  }
  exportUrl(f: string) {
    return f;
  }
  /** the template stays in THIS browser (IndexedDB) – never uploaded anywhere */
  async uploadTemplate(name: string, base64: string) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new ApiError('Tệp không phải PPTX hợp lệ');
    await idbPut('template', bytes);
    store.set('tplName', name);
    return { templateFile: name };
  }
  /** labels live in this browser (localStorage); computed over every period listed */
  async relevanceQuality() {
    const runs = await this.listRuns();
    const data = [];
    for (const r of runs) {
      const b = await this.load(this.mode === 'demo' ? undefined : r.runId);
      let reviews = await this.review(r.runId);
      // shared review: the TEAM's majority vote per article is the label (ties → no label)
      if (this.shared?.session()) {
        const votes = await this.shared.votes(r.runId).catch(() => ({} as Record<string, Vote[]>));
        reviews = {};
        for (const [aid, vs] of Object.entries(votes)) {
          const yes = vs.filter((v) => v.l === 'relevant').length;
          const no = vs.filter((v) => v.l === 'irrelevant').length;
          if (yes !== no) reviews[aid] = { articleId: aid, included: false, order: 0, updatedAt: '', changes: [], relevanceLabel: yes > no ? 'relevant' : 'irrelevant' };
        }
      }
      data.push({ manifest: { runId: r.runId, window: r.window }, candidates: b.candidates, articles: b.articles, reviews });
    }
    return computeRelevanceQuality(data);
  }
  subscribe() {
    return () => {};
  }
}

export const api: Api = import.meta.env.VITE_DEMO ? new DemoApi() : new LocalApi();
export { ApiError, lastCompletedWindow };
