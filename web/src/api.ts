import { defaultSettings, defaultSources, parseWebsitesTxt } from '../../src/domain/defaults';
import { evaluateRule, validateRule } from '../../src/domain/rules';
import { judgeRelevance } from '../../src/domain/relevance';
import type { Article, Candidate, ReviewDecision, RuleNode, RunManifest, Settings, Source } from '../../src/domain/schemas';
import { SettingsSchema, SourceSchema } from '../../src/domain/schemas';
import { lastCompletedWindow, type ReportWindow } from '../../src/domain/timeWindow';
import skillWebsites from '../../src/domain/data/skill-websites.txt?raw';
import { z } from 'zod';

export type RunInfo = RunManifest & { active?: boolean; reconciliation?: { total: number; accounted: number; transient: number; balanced: boolean } };
export interface PreviewResult { errors: string[]; results: Array<{ id: string; title: string; matched: boolean; lines: string[]; location?: string }> }
export interface ExportResult { ok: boolean; dryRun?: boolean; blockers?: string[]; warnings?: string[]; files?: string[]; pdfStatus?: string; stories?: number }
export interface HistoryEntry { id: string; at: string; kind: string; summary: string }

export interface Api {
  mode: 'local' | 'demo';
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings, summary: string): Promise<Settings>;
  getSources(): Promise<Source[]>;
  saveSources(list: Source[], summary: string): Promise<Source[]>;
  importSkill(text: string): Promise<{ sources: Source[]; comments: string[]; errors: string[] }>;
  detect(url: string): Promise<{ name: string; rss: string[]; sitemaps: string[]; sections: string[]; sampleArticles: string[]; errors: string[] }>;
  testSource(src: Source): Promise<any>;
  previewRule(root: RuleNode, settings: Settings, sample?: { title: string; body: string }, runId?: string): Promise<PreviewResult>;
  history(): Promise<HistoryEntry[]>;
  rollback(id: string): Promise<void>;
  backup(): Promise<unknown>;
  restore(b: unknown): Promise<void>;
  listRuns(): Promise<RunInfo[]>;
  startRun(window: ReportWindow, trigger: 'manual' | 'auto'): Promise<{ runId?: string; skipped?: string }>;
  getRun(id: string): Promise<RunInfo>;
  cancel(id: string): Promise<void>;
  retry(id: string, body: { mode: 'failed' | 'source' | 'expand' | 'candidates'; sourceId?: string; candidateIds?: string[]; extraLookbackHours?: number }): Promise<{ runId: string }>;
  candidates(id: string): Promise<Candidate[]>;
  articles(id: string): Promise<Article[]>;
  review(id: string): Promise<Record<string, ReviewDecision>>;
  patchReview(id: string, articleId: string, patch: Partial<ReviewDecision>): Promise<ReviewDecision>;
  capabilities(): Promise<{ pdf: boolean; soffice: string | null; templateFile: string | null; templateFidelity: boolean }>;
  exportRun(id: string, formats: Array<'pptx' | 'pdf'>, dryRun: boolean): Promise<ExportResult>;
  exportUrl(file: string): string;
  uploadTemplate(name: string, base64: string): Promise<{ templateFile: string }>;
  subscribe(runId: string, cb: (e: { type: string; counts?: Record<string, number> }) => void): () => void;
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
  getSettings = () => this.req<Settings>('GET', '/api/settings');
  saveSettings = (s: Settings, summary: string) => this.req<Settings>('PUT', '/api/settings', { settings: s, summary });
  getSources = () => this.req<Source[]>('GET', '/api/sources');
  saveSources = (sources: Source[], summary: string) => this.req<Source[]>('PUT', '/api/sources', { sources, summary });
  importSkill = (text: string) => this.req<any>('POST', '/api/sources/import-skill', { text });
  detect = (url: string) => this.req<any>('POST', '/api/sources/detect', { url });
  testSource = (source: Source) => this.req<any>('POST', '/api/sources/test', { source });
  previewRule = (root: RuleNode, settings: Settings, sample?: { title: string; body: string }, runId?: string) =>
    this.req<PreviewResult>('POST', '/api/rules/preview', { root, settings, sample, runId });
  history = () => this.req<HistoryEntry[]>('GET', '/api/settings/history');
  rollback = async (id: string) => void (await this.req('POST', '/api/settings/rollback', { id }));
  backup = () => this.req<unknown>('GET', '/api/backup');
  restore = async (backup: unknown) => void (await this.req('POST', '/api/backup/restore', { confirm: true, backup }));
  listRuns = () => this.req<RunInfo[]>('GET', '/api/runs');
  startRun = (window: ReportWindow, trigger: 'manual' | 'auto') => this.req<{ runId?: string; skipped?: string }>('POST', '/api/runs', { window, trigger });
  getRun = (id: string) => this.req<RunInfo>('GET', `/api/runs/${id}`);
  cancel = async (id: string) => void (await this.req('POST', `/api/runs/${id}/cancel`, {}));
  retry = (id: string, body: any) => this.req<{ runId: string }>('POST', `/api/runs/${id}/retry`, body);
  candidates = (id: string) => this.req<Candidate[]>('GET', `/api/runs/${id}/candidates`);
  articles = (id: string) => this.req<Article[]>('GET', `/api/runs/${id}/articles`);
  review = (id: string) => this.req<Record<string, ReviewDecision>>('GET', `/api/runs/${id}/review`);
  patchReview = (id: string, articleId: string, patch: Partial<ReviewDecision>) => this.req<ReviewDecision>('PATCH', `/api/runs/${id}/reviews/${articleId}`, patch);
  capabilities = () => this.req<any>('GET', '/api/capabilities');
  exportRun = (id: string, formats: Array<'pptx' | 'pdf'>, dryRun: boolean) => this.req<ExportResult>('POST', `/api/runs/${id}/export`, { formats, dryRun });
  exportUrl = (file: string) => `/api/exports/${file}`;
  uploadTemplate = (name: string, base64: string) => this.req<{ templateFile: string }>('POST', '/api/templates', { name, base64 });
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

interface DemoBundle { manifest: RunManifest; candidates: Candidate[]; articles: Article[] }
const NO_NET = 'Bản demo trên GitHub Pages không truy cập trực tiếp được website báo (trình duyệt chặn CORS). Hãy chạy bản local trên Windows (npm start) để thu thập thật.';

class DemoApi implements Api {
  mode = 'demo' as const;
  private bundle: Promise<DemoBundle> | null = null;
  private load() {
    this.bundle ??= fetch(`${import.meta.env.BASE_URL}demo/run.json`).then((r) => r.json() as Promise<DemoBundle>);
    return this.bundle;
  }
  private hist(kind: string, summary: string, value: unknown) {
    const h = store.get<Array<HistoryEntry & { value: unknown }>>('history') ?? [];
    h.unshift({ id: `${Date.now()}-${kind}`, at: new Date().toISOString(), kind, summary, value });
    store.set('history', h.slice(0, 50));
  }
  async getSettings() {
    const s = store.get<Settings>('settings');
    return s ? SettingsSchema.parse(s) : defaultSettings();
  }
  async saveSettings(s: Settings, summary: string) {
    const v = SettingsSchema.parse(s);
    this.hist('settings', summary, await this.getSettings());
    store.set('settings', v);
    return v;
  }
  async getSources() {
    return store.get<Source[]>('sources') ?? defaultSources(skillWebsites);
  }
  async saveSources(list: Source[], summary: string) {
    const v = z.array(SourceSchema).parse(list);
    this.hist('sources', summary, await this.getSources());
    store.set('sources', v);
    return v;
  }
  async importSkill(text: string) {
    return parseWebsitesTxt(text);
  }
  async detect(): Promise<never> {
    throw new ApiError(NO_NET);
  }
  async testSource(): Promise<never> {
    throw new ApiError(NO_NET);
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
    return (store.get<HistoryEntry[]>('history') ?? []).map(({ id, at, kind, summary }) => ({ id, at, kind, summary }));
  }
  async rollback(id: string) {
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
  async listRuns() {
    return [{ ...(await this.load()).manifest, active: false }];
  }
  async startRun(): Promise<never> {
    throw new ApiError(NO_NET);
  }
  async getRun() {
    const b = await this.load();
    return { ...b.manifest, active: false, reconciliation: { total: b.candidates.length, accounted: b.candidates.length, transient: 0, balanced: true } };
  }
  async cancel() {}
  async retry(): Promise<never> {
    throw new ApiError(NO_NET);
  }
  async candidates() {
    return (await this.load()).candidates;
  }
  async articles() {
    return (await this.load()).articles;
  }
  async review(id: string) {
    return store.get<Record<string, ReviewDecision>>(`review:${id}`) ?? {};
  }
  async patchReview(id: string, articleId: string, patch: Partial<ReviewDecision>) {
    const all = await this.review(id);
    const now = new Date().toISOString();
    const prev: ReviewDecision = all[articleId] ?? { articleId, included: false, order: Object.keys(all).length, updatedAt: now, changes: [] };
    const changes = [...prev.changes];
    for (const [k, v] of Object.entries(patch)) changes.push({ at: now, field: k, from: (prev as any)[k] ?? null, to: v });
    const next = { ...prev, ...patch, articleId, updatedAt: now, changes };
    all[articleId] = next;
    store.set(`review:${id}`, all);
    return next;
  }
  async capabilities() {
    return { pdf: false, soffice: null, templateFile: null, templateFidelity: false };
  }
  async exportRun(id: string, formats: Array<'pptx' | 'pdf'>, dryRun: boolean): Promise<ExportResult> {
    const { assembleStories } = await import('../../src/reports/assemble');
    const { buildReportPptx, checkFit } = await import('../../src/reports/pptx');
    const b = await this.load();
    const settings = await this.getSettings();
    const asm = assembleStories(b.articles, await this.review(id), settings);
    const warn = [...asm.warnings, ...checkFit(asm.stories).map((f) => f.message), 'Bản demo: không nhúng ảnh (fixture không có ảnh thật).'];
    if (asm.blockers.length || dryRun) return { ok: false, dryRun, blockers: asm.blockers, warnings: warn, stories: asm.stories.length };
    const w = b.manifest.window;
    const d = w.to.slice(0, 10).split('-');
    const bytes = await buildReportPptx({
      organization: settings.report.organization, window: w, reportDateLabel: `${d[2]}/${d[1]}/${d[0]}`, stories: asm.stories,
      storiesPerPage: settings.report.storiesPerPage, contactEmail: settings.report.contactEmail, isDemoTemplate: true,
    });
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `HCM_Diem_tin_DEMO_${w.to.slice(0, 10)}.pptx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return { ok: true, files: [a.download], pdfStatus: formats.includes('pdf') ? 'unavailable: bản web không chuyển PDF (cần LibreOffice ở bản local)' : 'not_requested', warnings: warn };
  }
  exportUrl(f: string) {
    return f;
  }
  async uploadTemplate(): Promise<never> {
    throw new ApiError('Bản demo không lưu được tệp mẫu PPTX – dùng bản local.');
  }
  subscribe() {
    return () => {};
  }
}

export const api: Api = import.meta.env.VITE_DEMO ? new DemoApi() : new LocalApi();
export { ApiError, lastCompletedWindow };
