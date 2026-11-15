/** E2E server: real app + built UI, fresh temp data dir, synthetic fixture publishers (no real network). */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server/app.js';
import type { Transport } from '../src/collector/http.js';
import { A, B, D, fixtureTransport, publicResolver, redesignedRoutes } from '../tests/fixtures/siteA.js';

const root = mkdtempSync(path.join(tmpdir(), 'hcm-e2e-'));
mkdirSync(path.join(root, 'config'), { recursive: true });
writeFileSync(
  path.join(root, 'config', 'sources.json'),
  JSON.stringify({
    schemaVersion: 3,
    sources: [
      { id: 'fixture-a', name: 'Báo mẫu thử A', baseUrl: A, rssUrls: [`${A}/rss/thoi-su.rss`], sitemapUrls: [`${A}/sitemap-news.xml`], sectionUrls: [`${A}/thoi-su.htm`] },
      { id: 'fixture-b', name: 'Báo mẫu thử B', baseUrl: B, rssUrls: [`${B}/rss/home.rss`], sectionUrls: [], discoveryMethods: ['rss'] },
      { id: 'fixture-d', name: 'Báo mẫu thử D', baseUrl: D, rssUrls: [`${D}/rss/do-thi.rss`], sectionUrls: [], discoveryMethods: ['rss'] },
    ].map((s) => ({ enabled: true, priority: 10, fetchMode: 'direct', discoveryMethods: ['rss', 'sitemap', 'section'], searchUrls: [], verifiedRoutes: [], crawlLimits: { maxListingPages: 10, maxDepth: 2, maxArticleFetches: 50, followPagination: true }, maxConcurrency: 2, pauseMs: 0, articleUrlPattern: '', excludeUrlPattern: '', notes: '', origin: 'user', ...s })),
  }),
);
// TEST-ONLY switch (exists only in this e2e script, never in the real app): simulate a publisher redesign
let redesign: 'none' | 'new_container' = 'none';
const normal = fixtureTransport();
const changed = fixtureTransport(redesignedRoutes('new_container'));
const transport: Transport = (u, i) => (redesign === 'none' ? normal(u, i) : changed(u, i));
const { app } = await createApp({ root, seedWebsitesTxt: '', transport, resolver: publicResolver, webDist: path.resolve('dist/web') });
app.post('/__e2e/redesign', async (req) => {
  redesign = (req.body as { mode?: 'none' | 'new_container' })?.mode ?? 'new_container';
  return { redesign };
});
await app.listen({ host: '127.0.0.1', port: 5179 });
console.log(`e2e server on http://127.0.0.1:5179 data=${root}`);
