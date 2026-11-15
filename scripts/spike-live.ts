/** M0 live spike: probe real configured sources (discovery + 2 sample extractions each). Read-only, polite limits. */
import { readFileSync } from 'node:fs';
import { HttpClient } from '../src/collector/http.js';
import { probeSource } from '../src/collector/probe.js';
import { defaultSettings, defaultSources } from '../src/domain/defaults.js';

const settings = defaultSettings();
const sources = defaultSources(readFileSync('src/domain/data/skill-websites.txt', 'utf8'));
const only = process.argv.slice(2);
const http = new HttpClient({
  maxConcurrent: 3, perHost: 1, timeoutMs: 20000, maxRetries: 1, backoffBaseMs: 1000, userAgent: settings.collection.userAgent,
  hostOverrides: Object.fromEntries(sources.map((s) => [new URL(s.baseUrl).hostname.replace(/^www\./, ''), { pauseMs: Math.max(500, s.pauseMs) }])),
});
for (const s of sources) {
  if (only.length && !only.includes(s.id)) continue;
  if (s.fetchMode === 'manual_only') {
    console.log(`\n## ${s.name}: manual_only (Skill: báo chặn thu thập tự động) – bỏ qua`);
    continue;
  }
  const t0 = Date.now();
  const r = await probeSource({ ...s, sectionUrls: s.sectionUrls.slice(0, 2), rssUrls: s.rssUrls.slice(0, 2) }, settings, http, 2);
  console.log(`\n## ${s.name} (${((Date.now() - t0) / 1000).toFixed(1)}s) candidates=${r.stats.candidates}`);
  for (const rt of r.stats.routes) console.log(`  route ${rt.method} ${rt.status} http=${rt.httpStatus ?? '-'} found=${rt.found} ${rt.url} ${rt.error ?? ''}`);
  for (const sm of r.samples) console.log('  sample', JSON.stringify(sm));
}
