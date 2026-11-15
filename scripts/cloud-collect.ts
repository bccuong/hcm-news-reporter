/**
 * Hourly cloud collection for the public read-only dashboard (GitHub Actions → GitHub Pages).
 *
 *  - Collects the IN-PROGRESS window (17:00 → 08:00, when one is running) and the LAST COMPLETED window
 *    (re-collected until 2 h after it ended, then frozen).
 *  - Publishes a REDACTED dataset to web/public/live/: titles, links, short sapo (≤ 300 chars), publication time,
 *    classification, candidate ledger, coverage and adapter health. Full article text and publisher photos are
 *    NOT published (copyright); the public page links to the original articles.
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
import { SettingsSchema, SourceSchema, type Article, type Candidate, type RunManifest, type Settings, type Source } from '../src/domain/schemas.js';
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
  id: string; sourceId: string; sourceName: string; url: string; title: string; sapo: string; publishedAt: string | null; modifiedAt: string | null;
  dateConfidence: Article['dateConfidence']; extractionCompleteness: Article['extractionCompleteness']; extractionWarnings: string[];
  sections: { paragraphs: number; headings: number; tables: number; figures: number }; location: Article['location']; relevance: Article['relevance'];
  primaryCategory: Article['primaryCategory']; classificationEvidence: string[]; suggestedAssessment: Article['suggestedAssessment']; assessmentEvidence: string[];
  duplicateGroupId: string | null; dateEvidence: Article['dateEvidence'];
}
export interface PublicDay {
  kind: 'hcm-live-day'; reportDate: string; provisional: boolean; generatedAt: string;
  manifest: RunManifest & { reconciliation: ReturnType<typeof reconcile> }; candidates: Array<Omit<Candidate, 'history'>>; articles: PublicArticle[];
}
export interface PublicIndex {
  kind: 'hcm-live-index'; generatedAt: string; schedule: string; days: Array<{ reportDate: string; window: { from: string; to: string }; provisional: boolean; generatedAt: string; counts: Record<string, number>; completeness: RunManifest['completeness'] }>;
}

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(' ', n - 1) > n / 2 ? s.lastIndexOf(' ', n - 1) : n - 1)}…`);

export function toPublicArticle(a: Article): PublicArticle {
  const count = (t: string) => a.contentSections.filter((s) => s.type === t).length;
  return {
    id: a.id, sourceId: a.sourceId, sourceName: a.sourceName, url: a.canonicalUrl ?? a.originalUrl, title: a.title, sapo: cut(a.sapo, 300),
    publishedAt: a.publishedAt, modifiedAt: a.modifiedAt, dateConfidence: a.dateConfidence, extractionCompleteness: a.extractionCompleteness,
    extractionWarnings: a.extractionWarnings, sections: { paragraphs: count('paragraph'), headings: count('heading'), tables: count('table'), figures: count('figure') },
    location: a.location, relevance: a.relevance, primaryCategory: a.primaryCategory, classificationEvidence: a.classificationEvidence,
    suggestedAssessment: a.suggestedAssessment, assessmentEvidence: a.assessmentEvidence, duplicateGroupId: a.duplicateGroupId, dateEvidence: a.dateEvidence,
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

function loadConfig(): { settings: Settings; sources: Source[]; origin: string } {
  const f = 'deploy/config.json';
  if (existsSync(f)) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return { settings: SettingsSchema.parse(j.settings), sources: SourceSchema.array().parse(j.sources), origin: f };
  }
  return { settings: defaultSettings(), sources: defaultSources(readFileSync('src/domain/data/skill-websites.txt', 'utf8')), origin: 'repo defaults (Skill)' };
}

async function main() {
  const now = new Date();
  const { settings, sources, origin } = loadConfig();
  const { startClock, endClock } = settings.reportWindow;
  mkdirSync(OUT, { recursive: true });

  // previously published data (carry-over + adapter-health baseline)
  const prevIndex = await getJson<PublicIndex>(new URL('live/index.json', SITE).toString());
  const prevDays = new Map<string, PublicDay>();
  for (const d of prevIndex?.days ?? []) {
    const day = await getJson<PublicDay>(new URL(`live/${d.reportDate}.json`, SITE).toString());
    if (day) prevDays.set(d.reportDate, day);
  }
  console.log(`config: ${origin}; previously published days: ${prevDays.size}`);

  // windows to collect now
  const last = lastCompletedWindow(now, startClock, endClock);
  const todays = windowForReportDate(vnDate(now), startClock, endClock);
  const tomorrow = windowForReportDate(vnDate(new Date(now.getTime() + 86400_000)), startClock, endClock);
  const inProgress = [todays, tomorrow].find((w) => new Date(w.from) <= now && now < new Date(w.to));
  const jobs: Array<{ reportDate: string; window: { from: string; to: string }; provisional: boolean }> = [];
  if (inProgress) jobs.push({ reportDate: vnDate(new Date(inProgress.to)), window: inProgress, provisional: true });
  const lastFrozen = prevDays.get(last.reportDate) && !prevDays.get(last.reportDate)!.provisional && now.getTime() - new Date(last.to).getTime() > FREEZE_AFTER_H * 3600_000;
  if (!lastFrozen) jobs.push({ reportDate: last.reportDate, window: { from: last.from, to: last.to }, provisional: false });

  const http = new HttpClient({
    maxConcurrent: settings.collection.maxConcurrentRequests, perHost: settings.collection.maxRequestsPerHost, timeoutMs: settings.collection.timeoutMs,
    maxRetries: settings.collection.maxRetries, backoffBaseMs: settings.collection.backoffBaseMs, userAgent: settings.collection.userAgent,
    hostOverrides: Object.fromEntries(sources.map((s) => [new URL(s.baseUrl).hostname.replace(/^www\./, ''), { concurrency: s.maxConcurrency, pauseMs: s.pauseMs }])),
  });

  const published = new Map<string, PublicDay>(prevDays);
  for (const job of jobs) {
    const stores = new Stores(makePaths(mkdtempSync(path.join(tmpdir(), 'hcm-cloud-'))), '');
    // seed history with previously published manifests (adapter-health baseline)
    for (const d of prevDays.values()) await stores.saveManifest({ ...d.manifest, runId: `run_hist_${d.reportDate.replace(/-/g, '')}` });
    const runId = `run_live_${job.reportDate.replace(/-/g, '')}`;
    const t0 = Date.now();
    const m = await runCollection({ runId, window: job.window, trigger: 'auto', settings, sources, stores, http });
    const cands = await stores.getCandidates(runId);
    const arts = await stores.getArticles(runId);
    const keep = new Set(cands.filter((c) => c.articleId && !['outside_window'].includes(c.state)).map((c) => c.articleId));
    m.notes.push(`Thu thập trên máy chủ GitHub Actions lúc ${toVnIso(now)} (${((Date.now() - t0) / 1000).toFixed(0)} giây); cấu hình: ${origin}.`);
    published.set(job.reportDate, {
      kind: 'hcm-live-day', reportDate: job.reportDate, provisional: job.provisional, generatedAt: toVnIso(new Date()),
      manifest: { ...m, reconciliation: reconcile(cands) },
      candidates: cands.map(({ history: _h, ...c }) => c),
      articles: arts.filter((a) => keep.has(a.id)).map(toPublicArticle),
    });
    console.log(`${job.reportDate}${job.provisional ? ' (đang diễn ra)' : ''}: ${cands.length} link, counts=${JSON.stringify(m.counts)}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    for (const s of m.sources) console.log(`  ${s.sourceName.padEnd(20)} ${s.status.padEnd(16)} ${s.candidates} link  adapter=${s.adapter?.status ?? '-'} ${s.error ?? ''}`);
  }

  const days = [...published.values()].sort((a, b) => b.reportDate.localeCompare(a.reportDate)).slice(0, KEEP_DAYS);
  for (const d of days) writeFileSync(path.join(OUT, `${d.reportDate}.json`), JSON.stringify(d));
  const index: PublicIndex = {
    kind: 'hcm-live-index', generatedAt: toVnIso(new Date()), schedule: 'Mỗi giờ (GitHub Actions, giờ chạy có thể trễ vài phút)',
    days: days.map((d) => ({ reportDate: d.reportDate, window: d.manifest.window, provisional: d.provisional, generatedAt: d.generatedAt, counts: d.manifest.counts, completeness: d.manifest.completeness })),
  };
  writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
  console.log(`published ${days.length} day(s) to ${OUT}`);
}

if (process.argv[1] && /cloud-collect/.test(process.argv[1])) await main();
