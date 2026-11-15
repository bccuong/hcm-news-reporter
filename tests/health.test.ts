import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assessHealth } from '../src/collector/health.js';
import { HttpClient } from '../src/collector/http.js';
import { runCollection } from '../src/collector/run.js';
import { defaultSettings } from '../src/domain/defaults.js';
import { SourceSchema } from '../src/domain/schemas.js';
import { makePaths, Stores } from '../src/storage/stores.js';
import { A, U, WINDOW, fixtureTransport, publicResolver, redesignedRoutes as redesigned } from './fixtures/siteA.js';

const src = SourceSchema.parse({ id: 'fixture-a', name: 'Fixture A', baseUrl: A, rssUrls: [`${A}/rss/thoi-su.rss`], sitemapUrls: [`${A}/sitemap-news.xml`], sectionUrls: [`${A}/thoi-su.htm`] });
const http = (extra = {}) => new HttpClient({ transport: fixtureTransport(extra), resolver: publicResolver, maxConcurrent: 4, perHost: 2, timeoutMs: 5000, maxRetries: 0, backoffBaseMs: 1, userAgent: 't', sleep: async () => {} });

describe('DIS-08 adapter degraded detection', () => {
  it('baseline → container change → broken markup → recovery', async () => {
    const stores = new Stores(makePaths(mkdtempSync(path.join(tmpdir(), 'hcm-h-'))), '');
    const settings = defaultSettings();
    const run = (id: string, extra = {}) => runCollection({ runId: id, window: WINDOW, trigger: 'fixture', settings, sources: [src], stores, http: http(extra) });

    const m1 = await run('run_h1');
    expect(m1.sources[0]!.adapter!.status).toBe('ok');
    expect(m1.sources[0]!.adapter!.mainContainer).toBe('.detail-content');

    // 1) publisher moves the body into <article>: extraction still works, but the container changed
    const m2 = await run('run_h2', redesigned('new_container'));
    const h2 = m2.sources[0]!.adapter!;
    expect(h2.status).toBe('degraded');
    expect(h2.reasons.join(' ')).toContain('Khung nội dung bài đổi từ ".detail-content"');
    expect(m2.completeness).toBe('incomplete');
    const c2 = await stores.getCandidates('run_h2');
    const flood = c2.find((c) => c.url === U.flood)!;
    expect(flood.state).toBe('ready_for_review');
    expect(flood.reasonCode).toBe('ADAPTER_DEGRADED'); // → review queue, not "ready"
    const a2 = (await stores.getArticles('run_h2')).find((a) => a.originalUrl === U.flood)!;
    expect(a2.extractionCompleteness).toBe('partial'); // automatic "complete" disabled
    expect(a2.extractionWarnings.join(' ')).toContain('ADAPTER_DEGRADED');

    // 2) broken markup: most pages fail to parse → degraded by failure rate (vs healthy baseline only)
    const m3 = await run('run_h3', redesigned('broken'));
    const h3 = m3.sources[0]!.adapter!;
    expect(h3.status).toBe('degraded');
    expect(h3.reasons.join(' ')).toMatch(/Tỉ lệ bài lỗi\/thiếu\/không rõ giờ tăng từ \d+% \(1 lượt trước\)/);
    expect(h3.baseline.runs).toBe(1); // degraded runs never become the baseline

    // 3) site back to normal → healthy again
    const m4 = await run('run_h4');
    expect(m4.sources[0]!.adapter!.status).toBe('ok');
  });

  it('rules: small samples are "unknown"; no history → only an extreme failure rate degrades', () => {
    const base = { fetched: 10, parseFailed: 0, partial: 1, dateUnknown: 0, failRate: 0.1, mainContainer: 'article', containerShare: 1, containers: { article: 10 } };
    expect(assessHealth({ ...base, fetched: 3 }, []).status).toBe('unknown');
    expect(assessHealth(base, []).status).toBe('ok');
    expect(assessHealth({ ...base, parseFailed: 6, failRate: 0.7 }, []).status).toBe('degraded');
    const hist = [{ ...base, status: 'ok' as const, reasons: [], baseline: { runs: 0, failRate: null, mainContainer: null } }];
    expect(assessHealth({ ...base, failRate: 0.3 }, hist).status).toBe('ok'); // +0.2 is within tolerance
    expect(assessHealth({ ...base, failRate: 0.4 }, hist).status).toBe('degraded');
  });
});
