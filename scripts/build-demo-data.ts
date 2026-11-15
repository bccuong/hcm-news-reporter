/** Builds web/public/demo/run.json for the static GitHub Pages demo by running the REAL collector on SYNTHETIC fixtures. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HttpClient } from '../src/collector/http.js';
import { runCollection } from '../src/collector/run.js';
import { defaultSettings } from '../src/domain/defaults.js';
import { SourceSchema } from '../src/domain/schemas.js';
import { makePaths, Stores } from '../src/storage/stores.js';
import { A, B, WINDOW, fixtureTransport, publicResolver } from '../tests/fixtures/siteA.js';

const stores = new Stores(makePaths(mkdtempSync(path.join(tmpdir(), 'hcm-demo-'))), '');
const sources = [
  SourceSchema.parse({ id: 'fixture-a', name: 'Báo mẫu thử A (fixture)', baseUrl: A, rssUrls: [`${A}/rss/thoi-su.rss`], sitemapUrls: [`${A}/sitemap-news.xml`], sectionUrls: [`${A}/thoi-su.htm`] }),
  SourceSchema.parse({ id: 'fixture-b', name: 'Báo mẫu thử B (luôn lỗi)', baseUrl: B, rssUrls: [`${B}/rss/home.rss`], discoveryMethods: ['rss'] }),
];
const http = new HttpClient({ transport: fixtureTransport(), resolver: publicResolver, maxConcurrent: 4, perHost: 2, timeoutMs: 5000, maxRetries: 1, backoffBaseMs: 1, userAgent: 'demo', sleep: async () => {} });
const manifest = await runCollection({ runId: 'run_demo_fixture', window: WINDOW, trigger: 'fixture', settings: defaultSettings(), sources, stores, http });
manifest.notes.push('Dữ liệu tổng hợp (fixture) để minh họa – không phải tin thật.');
const out = { manifest, candidates: await stores.getCandidates('run_demo_fixture'), articles: await stores.getArticles('run_demo_fixture') };
mkdirSync('web/public/demo', { recursive: true });
writeFileSync('web/public/demo/run.json', JSON.stringify(out));
console.log(`demo: ${out.candidates.length} candidates, ${out.articles.length} articles, counts=${JSON.stringify(manifest.counts)}`);
