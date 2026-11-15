/**
 * Hourly cloud collection for the public read-only dashboard (GitHub Actions → GitHub Pages).
 *
 *  - Collects the IN-PROGRESS window (17:00 → 08:00, when one is running) and the LAST COMPLETED window
 *    (re-collected until 2 h after it ended, then frozen).
 *  - Publishes the dataset to web/public/live/: titles, links, sapo, FULL article text (owner's decision, 15/11/2026,
 *    so the web matches the local app), publication time, classification, candidate ledger, coverage and adapter health.
 *    Photos are published as LINKS only (loaded from the publisher, like the local app), never copied.
 *  - Previous days are carried over from the currently deployed site (and give the adapter-health baseline).
 *  - Config: defaults from the repo (Skill sources/rules), or `deploy/config.json` (a backup exported from
 *    Settings › Sao lưu & lịch sử) when the operator commits one.
 *
 * Usage: npx tsx scripts/cloud-collect.ts [--site https://bccuong.github.io/hcm-news-reporter/] [--out web/public/live]
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HttpClient } from '../src/collector/http.js';
import { reconcile, runCollection } from '../src/collector/run.js';
import { defaultSettings, defaultSources } from '../src/domain/defaults.js';
import { SettingsSchema, SourceSchema, type Article, type Candidate, type ImageCandidate, type RunManifest, type Settings, type Source } from '../src/domain/schemas.js';
import { lastCompletedWindow, toVnIso, vnDate, windowForReportDate } from '../src/domain/timeWindow.js';
import { makePaths, Stores } from '../src/storage/stores.js';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1]! : def;
};
const SITE = arg('--site', 'https://bccuong.github.io/hcm-news-reporter/');
const OUT = arg('--out', 'web/public/live');
const KEEP_DAYS = 14;
const FREEZE_AFTER_H = 2;

export interface PublicArticle {
  id: string; sourceId: string; sourceName: string; url: string; title: string; sapo: string; /** full text (bodyText is rebuilt from these in the browser) */ contentSections: Article['contentSections']; author: string | null; publishedAt: string | null; modifiedAt: string | null;
  dateConfidence: Article['dateConfidence']; extractionCompleteness: Article['extractionCompleteness']; extractionWarnings: string[];
  sections: { paragraphs: number; headings: number; tables: number; figures: number }; location: Article['location']; relevance: Article['relevance'];
  primaryCategory: Article['primaryCategory']; classificationEvidence: string[]; suggestedAssessment: Article['suggestedAssessment']; assessmentEvidence: string[];
  duplicateGroupId: string | null; dateEvidence: Article['dateEvidence'];
  /** photo LINKS only (the browser loads them from the publisher, like the local app); no copies are published */
  images: Array<Pick<ImageCandidate, 'url' | 'caption' | 'credit' | 'origin' | 'rightsStatus'>>;
}
export interface PublicDay {
  kind: 'hcm-live-day'; reportDate: string; provisional: boolean; generatedAt: string;
  /** file stem: "2026-11-16" for daily periods, "custom-202611141700-202611150800" for on-demand windows */
  key?: string; custom?: boolean; requestedBy?: string;
  manifest: RunManifest & { reconciliation: ReturnType<typeof reconcile> }; candidates: Array<Omit<Candidate, 'history'>>; articles: PublicArticle[];
}
export interface PublicIndex {
  kind: 'hcm-live-index'; generatedAt: string; schedule: string;
  days: Array<{ reportDate: string; key?: string; file?: string; custom?: boolean; requestedBy?: string; window: { from: string; to: string }; provisional: boolean; generatedAt: string; counts: Record<string, number>; completeness: RunManifest['completeness'] }>;
}
const KEEP_CUSTOM = 10;
const keyOf = (d: { key?: string; reportDate: string }) => d.key ?? d.reportDate;
const stamp = (iso: string) => iso.slice(0, 16).replace(/[-:T]/g, '');
const VN_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+07:00$/;

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(' ', n - 1) > n / 2 ? s.lastIndexOf(' ', n - 1) : n - 1)}…`);

export function toPublicArticle(a: Article): PublicArticle {
  const count = (t: string) => a.contentSections.filter((s) => s.type === t).length;
  return {
    id: a.id, sourceId: a.sourceId, sourceName: a.sourceName, url: a.canonicalUrl ?? a.originalUrl, title: a.title, sapo: a.sapo, contentSections: a.contentSections, author: a.author,
    publishedAt: a.publishedAt, modifiedAt: a.modifiedAt, dateConfidence: a.dateConfidence, extractionCompleteness: a.extractionCompleteness,
    extractionWarnings: a.extractionWarnings, sections: { paragraphs: count('paragraph'), headings: count('heading'), tables: count('table'), figures: count('figure') },
    location: a.location, relevance: a.relevance, primaryCategory: a.primaryCategory, classificationEvidence: a.classificationEvidence,
    suggestedAssessment: a.suggestedAssessment, assessmentEvidence: a.assessmentEvidence, duplicateGroupId: a.duplicateGroupId, dateEvidence: a.dateEvidence,
    images: a.imageCandidates.filter((i) => /^https:\/\//.test(i.url) && i.rightsStatus !== 'not_usable').slice(0, 3)
      .map((i) => ({ url: i.url, caption: i.caption ? cut(i.caption, 200) : undefined, credit: i.credit, origin: i.origin, rightsStatus: i.rightsStatus })),
  };
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'cache-control': 'no-cache' } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Configuration priority: (1) the shared configuration edited on the web ("Cài đặt", stored by the review worker),
 * (2) deploy/config.json, (3) repo defaults. An invalid web configuration is reported and skipped, never half-applied.
 */
async function loadConfig(): Promise<{ settings: Settings; sources: Source[]; origin: string }> {
  const api = process.env.REVIEW_API_URL?.trim();
  if (api) {
    const j = await getJson<{ config: { settings: unknown; sources: unknown; by: string; at: string } | null }>(`${api.replace(/\/$/, '')}/config`);
    if (j?.config) {
      const s = SettingsSchema.safeParse(j.config.settings);
      const src = SourceSchema.array().safeParse(j.config.sources);
      if (s.success && src.success) return { settings: s.data, sources: src.data, origin: `web config (${j.config.by}, ${j.config.at})` };
      console.warn(`web config ignored (invalid): ${(s.error ?? src.error)?.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
  }
  const f = 'deploy/config.json';
  if (existsSync(f)) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return { settings: SettingsSchema.parse(j.settings), sources: SourceSchema.array().parse(j.sources), origin: f };
  }
  return { settings: defaultSettings(), sources: defaultSources(readFileSync('src/domain/data/skill-websites.txt', 'utf8')), origin: 'repo defaults (Skill)' };
}

async function main() {
  const now = new Date();
  const { settings, sources, origin } = await loadConfig();
  const { startClock, endClock } = settings.reportWindow;
  mkdirSync(OUT, { recursive: true });

  // previously published data (carry-over + adapter-health baseline)
  const prevIndex = await getJson<PublicIndex>(new URL('live/index.json', SITE).toString());
  const prevDays = new Map<string, PublicDay>();
  for (const d of prevIndex?.days ?? []) {
    const day = await getJson<PublicDay>(new URL(`live/${d.file ?? `${d.reportDate}.json`}`, SITE).toString());
    if (day) prevDays.set(keyOf(d), { ...day, key: keyOf(d), custom: d.custom, requestedBy: d.requestedBy });
  }
  console.log(`config: ${origin}; previously published periods: ${prevDays.size}`);

  // windows to collect now: an on-demand window (--from/--to from the web "Thu thập" button) OR the hourly periods
  const reqFrom = arg('--from', '');
  const reqTo = arg('--to', '');
  const requestedBy = arg('--requested-by', '').slice(0, 40);
  const jobs: Array<{ key: string; reportDate: string; window: { from: string; to: string }; provisional: boolean; custom?: boolean }> = [];
  if (reqFrom || reqTo) {
    if (!VN_ISO.test(reqFrom) || !VN_ISO.test(reqTo) || !(Date.parse(reqTo) > Date.parse(reqFrom)) || Date.parse(reqTo) - Date.parse(reqFrom) > 72 * 3600_000) {
      throw new Error(`invalid on-demand window: ${reqFrom} → ${reqTo}`);
    }
    const window = { from: toVnIso(new Date(reqFrom)), to: toVnIso(new Date(reqTo)) };
    jobs.push({ key: `custom-${stamp(window.from)}-${stamp(window.to)}`, reportDate: vnDate(new Date(window.to)), window, provisional: Date.parse(reqTo) > now.getTime(), custom: true });
  } else {
    const last = lastCompletedWindow(now, startClock, endClock);
    const todays = windowForReportDate(vnDate(now), startClock, endClock);
    const tomorrow = windowForReportDate(vnDate(new Date(now.getTime() + 86400_000)), startClock, endClock);
    const inProgress = [todays, tomorrow].find((w) => new Date(w.from) <= now && now < new Date(w.to));
    if (inProgress) jobs.push({ key: vnDate(new Date(inProgress.to)), reportDate: vnDate(new Date(inProgress.to)), window: inProgress, provisional: true });
    const lastFrozen = prevDays.get(last.reportDate) && !prevDays.get(last.reportDate)!.provisional && now.getTime() - new Date(last.to).getTime() > FREEZE_AFTER_H * 3600_000;
    if (!lastFrozen) jobs.push({ key: last.reportDate, reportDate: last.reportDate, window: { from: last.from, to: last.to }, provisional: false });
  }

  const http = new HttpClient({
    maxConcurrent: settings.collection.maxConcurrentRequests, perHost: settings.collection.maxRequestsPerHost, timeoutMs: settings.collection.timeoutMs,
    maxRetries: settings.collection.maxRetries, backoffBaseMs: settings.collection.backoffBaseMs, userAgent: settings.collection.userAgent,
    hostOverrides: Object.fromEntries(sources.map((s) => [new URL(s.baseUrl).hostname.replace(/^www\./, ''), { concurrency: s.maxConcurrency, pauseMs: s.pauseMs }])),
  });

  const published = new Map<string, PublicDay>(prevDays);
  for (const job of jobs) {
    const stores = new Stores(makePaths(mkdtempSync(path.join(tmpdir(), 'hcm-cloud-'))), '');
    // seed history with previously published manifests (adapter-health baseline)
    for (const d of prevDays.values()) if (!d.custom) await stores.saveManifest({ ...d.manifest, runId: `run_hist_${d.reportDate.replace(/-/g, '')}` });
    const runId = `run_live_${job.key.replace(/[^0-9a-z]/gi, '')}`;
    const t0 = Date.now();
    const m = await runCollection({ runId, window: job.window, trigger: 'auto', settings, sources, stores, http });
    const cands = await stores.getCandidates(runId);
    const arts = await stores.getArticles(runId);
    const keep = new Set(cands.filter((c) => c.articleId && !['outside_window'].includes(c.state)).map((c) => c.articleId));
    m.notes.push(`Thu thập trên máy chủ GitHub Actions lúc ${toVnIso(now)} (${((Date.now() - t0) / 1000).toFixed(0)} giây); cấu hình: ${origin}.`);
    if (job.custom) m.notes.push(`Thu thập theo yêu cầu${requestedBy ? ` của ${requestedBy}` : ''} trên web.`);
    if (job.provisional) m.notes.push('Kỳ đang diễn ra – tạm thời');
    published.set(job.key, {
      kind: 'hcm-live-day', reportDate: job.reportDate, key: job.key, custom: job.custom, requestedBy: job.custom ? requestedBy : undefined, provisional: job.provisional, generatedAt: toVnIso(new Date()),
      manifest: { ...m, reconciliation: reconcile(cands) },
      candidates: cands.map(({ history: _h, ...c }) => c),
      articles: arts.filter((a) => keep.has(a.id)).map(toPublicArticle),
    });
    console.log(`${job.key}${job.provisional ? ' (đang diễn ra)' : ''}: ${cands.length} link, counts=${JSON.stringify(m.counts)}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    for (const s of m.sources) console.log(`  ${s.sourceName.padEnd(20)} ${s.status.padEnd(16)} ${s.candidates} link  adapter=${s.adapter?.status ?? '-'} ${s.error ?? ''}`);
  }

  const all = [...published.values()];
  const daily = all.filter((d) => !d.custom).sort((a, b) => b.reportDate.localeCompare(a.reportDate)).slice(0, KEEP_DAYS);
  const customs = all.filter((d) => d.custom).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)).slice(0, KEEP_CUSTOM);
  const days = [...customs, ...daily].sort((a, b) => b.manifest.window.to.localeCompare(a.manifest.window.to) || (a.custom ? -1 : 1));
  for (const d of days) writeFileSync(path.join(OUT, `${keyOf(d)}.json`), JSON.stringify(d));
  const index: PublicIndex = {
    kind: 'hcm-live-index', generatedAt: toVnIso(new Date()), schedule: 'Mỗi giờ + theo yêu cầu (nút "Thu thập" trên web)',
    days: days.map((d) => ({
      reportDate: d.reportDate, key: keyOf(d), file: `${keyOf(d)}.json`, custom: d.custom, requestedBy: d.requestedBy, window: d.manifest.window,
      provisional: d.provisional, generatedAt: d.generatedAt, counts: d.manifest.counts, completeness: d.manifest.completeness,
    })),
  };
  writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
  console.log(`published ${days.length} day(s) to ${OUT}`);
}

if (process.argv[1] && /cloud-collect/.test(process.argv[1])) await main();
