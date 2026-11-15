/** Writes web/public/live/ from SYNTHETIC fixture publishers (same shape as scripts/cloud-collect.ts) for live-mode E2E tests. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HttpClient } from '../src/collector/http.js';
import { reconcile, runCollection } from '../src/collector/run.js';
import { defaultSettings } from '../src/domain/defaults.js';
import { SourceSchema } from '../src/domain/schemas.js';
import { toVnIso } from '../src/domain/timeWindow.js';
import { makePaths, Stores } from '../src/storage/stores.js';
import { A, D, WINDOW, fixtureTransport, publicResolver } from '../tests/fixtures/siteA.js';
import { toPublicArticle } from './cloud-collect.js';

const stores = new Stores(makePaths(mkdtempSync(path.join(tmpdir(), 'hcm-livefx-'))), '');
const sources = [
  SourceSchema.parse({ id: 'fixture-a', name: 'Báo mẫu thử A', baseUrl: A, rssUrls: [`${A}/rss/thoi-su.rss`], sitemapUrls: [`${A}/sitemap-news.xml`], sectionUrls: [`${A}/thoi-su.htm`] }),
  SourceSchema.parse({ id: 'fixture-d', name: 'Báo mẫu thử D', baseUrl: D, rssUrls: [`${D}/rss/do-thi.rss`], discoveryMethods: ['rss'] }),
];
const http = new HttpClient({ transport: fixtureTransport(), resolver: publicResolver, maxConcurrent: 4, perHost: 2, timeoutMs: 5000, maxRetries: 0, backoffBaseMs: 1, userAgent: 't', sleep: async () => {} });
const runId = 'run_live_20261109';
const m = await runCollection({ runId, window: WINDOW, trigger: 'auto', settings: defaultSettings(), sources, stores, http, profileId: 'hcm' });
const cands = await stores.getCandidates(runId);
const arts = await stores.getArticles(runId);
const keep = new Set(cands.filter((c) => c.articleId && c.state !== 'outside_window').map((c) => c.articleId));
const now = toVnIso(new Date());
// one dataset per profile (live/<profileId>/) + the profile list, exactly like scripts/cloud-collect.ts
rmSync('web/public/live', { recursive: true, force: true });
const out = 'web/public/live/hcm';
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, '2026-11-09.json'), JSON.stringify({ kind: 'hcm-live-day', reportDate: '2026-11-09', provisional: false, generatedAt: now, manifest: { ...m, reconciliation: reconcile(cands) }, candidates: cands.map(({ history: _h, ...c }) => c), articles: arts.filter((a) => keep.has(a.id)).map(toPublicArticle) }));
writeFileSync(path.join(out, 'index.json'), JSON.stringify({ kind: 'hcm-live-index', generatedAt: now, schedule: 'fixture', days: [{ reportDate: '2026-11-09', window: m.window, provisional: false, generatedAt: now, counts: m.counts, completeness: m.completeness }] }));
writeFileSync('web/public/live/profiles.json', JSON.stringify({ kind: 'hcm-live-profiles', generatedAt: now, profiles: [
  { id: 'hcm', name: 'TP.HCM', description: 'Cấu hình mặc định', autoCollect: true, regionName: 'TP.HCM', periods: 1 },
] }));
console.log(`live fixture: ${cands.length} candidates`);
