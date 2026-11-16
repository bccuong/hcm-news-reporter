import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractArticle } from '../src/collector/extract.js';
import { HttpClient } from '../src/collector/http.js';
import { reconcile, runCollection } from '../src/collector/run.js';
import { defaultSettings, sourceFromUrl } from '../src/domain/defaults.js';
import { SourceSchema, type Source } from '../src/domain/schemas.js';
import { makePaths, Stores } from '../src/storage/stores.js';
import { A, B, C, EXPECTED, GROUND_TRUTH, U, WINDOW, fixtureTransport, publicResolver, siteARoutes } from './fixtures/siteA.js';

function fixtureSources(): Source[] {
  const a = SourceSchema.parse({
    id: 'fixture-a', name: 'Fixture A', baseUrl: A, rssUrls: [`${A}/rss/thoi-su.rss`], sitemapUrls: [`${A}/sitemap-news.xml`], sectionUrls: [`${A}/thoi-su.htm`],
    crawlLimits: { maxListingPages: 10, maxDepth: 2, maxArticleFetches: 50 },
  });
  const b = SourceSchema.parse({ id: 'fixture-b', name: 'Fixture B (lỗi)', baseUrl: B, rssUrls: [`${B}/rss/home.rss`], sectionUrls: [], discoveryMethods: ['rss'] });
  const c = SourceSchema.parse({ id: 'fixture-c', name: 'Fixture C (tắt)', baseUrl: C, enabled: false, rssUrls: [`${C}/rss.rss`] });
  return [a, b, c];
}

function setup(log: string[] = []) {
  const root = mkdtempSync(path.join(tmpdir(), 'hcm-'));
  const stores = new Stores(makePaths(root), 'https://example.org');
  const settings = defaultSettings();
  const http = new HttpClient({ transport: fixtureTransport({}, log), resolver: publicResolver, maxConcurrent: 4, perHost: 2, timeoutMs: 5000, maxRetries: 1, backoffBaseMs: 1, userAgent: 't', sleep: async () => {} });
  return { root, stores, settings, http };
}

describe('full-content extraction (EXT-01/02/03/05)', () => {
  const routes = siteARoutes();
  const s = defaultSettings();
  it('keeps title, sapo, all paragraphs in order, subheads, table and figure caption/credit', () => {
    const ex = extractArticle(routes[U.flood]!.body, U.flood, s.quality);
    const count = (t: string) => ex.sections.filter((x) => x.type === t).length;
    expect(ex.title).toContain('phường Hiệp Bình');
    expect(ex.sapo).toContain('Mưa lớn kéo dài');
    expect(count('paragraph')).toBe(GROUND_TRUTH.flood.paragraphs);
    expect(count('heading')).toBe(GROUND_TRUTH.flood.headings);
    expect(count('table')).toBe(GROUND_TRUTH.flood.tables);
    expect(count('figure')).toBe(GROUND_TRUTH.flood.figures);
    const table = ex.sections.find((x) => x.type === 'table')!;
    expect(table.rows).toEqual([['Trạm', 'Lượng mưa (mm)'], ['Hiệp Bình', '98,5'], ['Tân Sơn Hòa', '76,2']]);
    expect(table.caption).toBe('Lượng mưa theo trạm');
    const paras = ex.sections.filter((x) => x.type === 'paragraph').map((x) => x.text);
    expect(paras[0]).toMatch(/^Đoạn 1 về diễn biến mưa/);
    expect(paras.join(' ')).not.toContain('Tin liên quan'); // related box removed
    const img = ex.images.find((i) => i.origin === 'body')!;
    expect(img.credit).toBe('Phóng viên Mẫu Thử');
    expect(img.rightsStatus).toBe('review');
    expect(ex.completeness).toBe('auto_checks_passed');
    expect(ex.dateConfidence).toBe('verified');
  });
  it('uses published (not modified) time (EXT-05)', () => {
    const ex = extractArticle(routes[U.metro]!.body, U.metro, s.quality);
    expect(ex.publishedAt).toBe('2026-11-08T21:00:00+07:00');
    expect(ex.modifiedAt).toBe('2026-11-09T10:15:00+07:00');
  });
  it('flags extractor disagreement with JSON-LD (EXT-06) and continuation (EXT-04)', () => {
    expect(extractArticle(routes[U.disagree]!.body, U.disagree, s.quality).warnings.join(' ')).toContain('EXTRACTOR_DISAGREEMENT');
    const late = extractArticle(routes[U.late]!.body, U.late, s.quality);
    expect(late.continuation.detected).toBe(true);
    expect(late.completeness).toBe('partial');
  });
});

describe('collection run with candidate ledger (DIS-01..07, LED-01/02, UI-03)', () => {
  it('accounts for 100% of discovered candidates with explicit states and reasons', async () => {
    const log: string[] = [];
    const { stores, settings, http } = setup(log);
    const m = await runCollection({ runId: 'run_test1', window: WINDOW, trigger: 'fixture', settings, sources: fixtureSources(), stores, http });
    const cands = await stores.getCandidates('run_test1');
    const mineA = cands.filter((c) => c.sourceId === 'fixture-a');
    expect(mineA.length).toBe(EXPECTED.uniqueCandidatesA);
    for (const [url, state] of Object.entries(EXPECTED.states)) {
      const c = mineA.find((x) => x.url === url);
      expect(c, url).toBeDefined();
      expect(c!.state, url).toBe(state);
      if (state !== 'ready_for_review') expect(c!.reasonCode, url).toBeTruthy();
    }
    // reconciliation invariant
    const rec = reconcile(cands);
    expect(rec.balanced).toBe(true);
    expect(rec.transient).toBe(0);
    // DIS-01: RSS + sitemap overlap recorded both routes
    const metro = mineA.find((c) => c.url === U.metro)!;
    expect([...new Set(metro.discoveredVia.map((d) => d.method))].sort()).toEqual(['rss', 'sitemap']);
    // duplicate's evidence is merged into the primary (nothing lost)
    expect(metro.discoveredVia.some((d) => d.listingUrl.endsWith('sitemap-news.xml'))).toBe(true);
    // RSS link with utm param merged with section link
    expect(mineA.find((c) => c.url === U.flood)!.discoveredVia.map((d) => d.method).sort()).toEqual(['rss', 'section']);
    // DIS-02/03: article only on page 2 of section found
    expect(mineA.find((c) => c.url === U.late)!.discoveredVia[0]!.listingUrl).toBe(`${A}/thoi-su/trang-2.htm`);
    // DIS-07: old feed item not fetched, still recorded
    expect(log).not.toContain(U.old);
    // UI-03: disabled source never fetched; failing source does not block
    expect(log.some((u) => u.startsWith(C))).toBe(false);
    expect(m.sources.find((s) => s.sourceId === 'fixture-c')!.status).toBe('skipped_disabled');
    expect(m.sources.find((s) => s.sourceId === 'fixture-b')!.status).toBe('failed');
    expect(m.sources.find((s) => s.sourceId === 'fixture-a')!.status).toBe('partial'); // 403 present
    expect(m.completeness).toBe('incomplete');
    // articles persisted with provenance
    const arts = await stores.getArticles('run_test1');
    const flood = arts.find((a) => a.originalUrl === U.flood)!;
    expect(flood.primaryCategory).toBe('FLOOD');
    expect(flood.suggestedAssessment).toBe('needs_attention');
    expect(flood.location.status).toBe('hcm');
  });

  it('respects listing page limit and surfaces PAGINATION_LIMIT (UI-07, DIS-02 limit)', async () => {
    const { stores, settings, http } = setup();
    const src = fixtureSources();
    src[0]!.crawlLimits.maxListingPages = 1;
    src[0]!.discoveryMethods = ['section'];
    const m = await runCollection({ runId: 'run_limit', window: WINDOW, trigger: 'fixture', settings, sources: [src[0]!], stores, http });
    const st = m.sources[0]!;
    expect(st.limitReached).toBe(true);
    expect(st.routes.some((r) => r.status === 'limit' && /PAGINATION_LIMIT/.test(r.error ?? ''))).toBe(true);
    expect((await stores.getCandidates('run_limit')).some((c) => c.url === U.late)).toBe(false);
  });

  it('global per-publisher article limit (Cài đặt): FETCH_LIMIT recorded, in-window articles fetched first', async () => {
    const { stores, settings, http } = setup();
    settings.collection.maxArticlesPerSource = 1;
    const m = await runCollection({ runId: 'run_cap', window: WINDOW, trigger: 'fixture', settings, sources: [fixtureSources()[0]!], stores, http });
    const cands = await stores.getCandidates('run_cap');
    const fetched = cands.filter((c) => c.attempts > 0);
    expect(fetched).toHaveLength(1);
    expect(cands.some((c) => c.reasonCode === 'FETCH_LIMIT')).toBe(true);
    expect(m.sources[0]!.limitReached).toBe(true);
    // the one fetch went to an article dated inside the window (by its feed date)
    const fd = fetched[0]!.discoveredVia.map((d) => d.feedPublishedAt).find(Boolean);
    if (fd) expect(Date.parse(fd) >= Date.parse(WINDOW.from) && Date.parse(fd) < Date.parse(WINDOW.to)).toBe(true);
  });

  it('recovers after interruption and retry delta is visible (LED-01, LED-03)', async () => {
    const { stores, settings, http } = setup();
    const ctl = new AbortController();
    const sources = fixtureSources();
    let n = 0;
    const abortingHttp = new HttpClient({
      transport: async (u, i) => {
        if (++n === 6) ctl.abort();
        return fixtureTransport()(u, i);
      },
      resolver: publicResolver, maxConcurrent: 1, perHost: 1, timeoutMs: 5000, maxRetries: 0, backoffBaseMs: 1, userAgent: 't', sleep: async () => {},
    });
    const m1 = await runCollection({ runId: 'run_int', window: WINDOW, trigger: 'fixture', settings, sources, stores, http: abortingHttp, signal: ctl.signal });
    expect(m1.status).toBe('cancelled');
    const after1 = await stores.getCandidates('run_int');
    expect(reconcile(after1).balanced).toBe(true);
    expect(after1.filter((c) => c.state === 'retry_pending').length).toBeGreaterThan(0);
    const m2 = await runCollection({ runId: 'run_int', window: WINDOW, trigger: 'retry', settings, sources, stores, http });
    expect(m2.status).toBe('completed');
    const after2 = await stores.getCandidates('run_int');
    expect(after2.filter((c) => c.sourceId === 'fixture-a').length).toBe(EXPECTED.uniqueCandidatesA);
    expect(after2.filter((c) => ['discovered', 'fetch_queued', 'fetched'].includes(c.state)).length).toBe(0);
    expect(after2.find((c) => c.url === U.flood)!.state).toBe('ready_for_review');
  });

  it('SSRF: redirect to private address is refused (SEC-01)', async () => {
    const http = new HttpClient({
      transport: async () => ({ status: 302, headers: { location: 'http://127.0.0.1:8080/secret' }, body: '' }),
      resolver: async (h) => (h === '127.0.0.1' ? ['127.0.0.1'] : ['203.0.113.10']),
      maxConcurrent: 1, perHost: 1, timeoutMs: 1000, maxRetries: 0, backoffBaseMs: 1, userAgent: 't',
    });
    const r = await http.get(`${A}/redirect`);
    expect(r.errorCode).toBe('SSRF_BLOCKED');
  });

  it('seeded Skill sources carry the Skill-verified RSS + section routes', () => {
    const s = sourceFromUrl('https://vnexpress.net');
    expect(s.rssUrls).toContain('https://vnexpress.net/rss/thoi-su.rss');
    expect(s.sectionUrls).toContain('https://vnexpress.net/thoi-su');
  });
});

describe('hourly cloud runs continue the published period (no story drops out between hours)', () => {
  it('carries extracted stories over (same ids) and spends the per-publisher limit on links not fetched yet', async () => {
    const { seedFromPublished, toPublicArticle } = await import('../scripts/cloud-collect.js');
    const src = [fixtureSources()[0]!];
    // hour 1: limit 2 → one story extracted (the other link is a 403), the rest FETCH_LIMIT
    const h1 = setup();
    h1.settings.collection.maxArticlesPerSource = 2;
    const m1 = await runCollection({ runId: 'run_live_x', window: WINDOW, trigger: 'auto', settings: h1.settings, sources: src, stores: h1.stores, http: h1.http });
    const c1 = await h1.stores.getCandidates('run_live_x');
    const a1 = await h1.stores.getArticles('run_live_x');
    const keep = new Set(c1.filter((c) => c.articleId && c.state !== 'outside_window').map((c) => c.articleId));
    const day = {
      kind: 'hcm-live-day' as const, reportDate: '2026-11-09', provisional: true, generatedAt: m1.finishedAt!,
      manifest: { ...m1, reconciliation: reconcile(c1) }, candidates: c1.map(({ history: _h, ...c }) => c), articles: a1.filter((a) => keep.has(a.id)).map(toPublicArticle),
    };
    const first = c1.find((c) => c.attempts > 0 && c.articleId)!;
    expect(first.articleId).toBeTruthy();

    // hour 2: fresh machine (empty store) seeded from the publication
    const log: string[] = [];
    const h2 = setup(log);
    h2.settings = structuredClone(h1.settings); // the stored config (rule ids are per-process counters)
    expect(await seedFromPublished(h2.stores, 'run_live_x', day, WINDOW, h2.settings)).toBe(day.articles.length);
    await runCollection({ runId: 'run_live_x', window: WINDOW, trigger: 'auto', settings: h2.settings, sources: src, stores: h2.stores, http: h2.http });
    const c2 = await h2.stores.getCandidates('run_live_x');
    const a2 = await h2.stores.getArticles('run_live_x');
    // the hour-1 story is still there with the same ids, and was not downloaded again
    expect(c2.find((c) => c.id === first.id)!.articleId).toBe(first.articleId);
    if (keep.has(first.articleId)) expect(a2.some((a) => a.id === first.articleId)).toBe(true);
    expect(log.some((u) => u.includes(first.url))).toBe(false);
    // the limit went to another link → coverage grows hour by hour
    expect(c2.filter((c) => c.attempts > 0).length).toBe(c1.filter((c) => c.attempts > 0).length + 2);

    // changed settings or window → fresh run (classification must follow the new rules)
    const changed = { ...h2.settings, collection: { ...h2.settings.collection, maxArticlesPerSource: 3 } };
    expect(await seedFromPublished(setup().stores, 'run_live_y', day, WINDOW, changed)).toBeNull();
    expect(await seedFromPublished(setup().stores, 'run_live_y', day, { ...WINDOW, to: '2026-11-10T09:00:00+07:00' }, h2.settings)).toBeNull();
  });
});

describe('a link that is already the canonical page of an extracted story', () => {
  it('is recorded as duplicate without spending a fetch (no false "retry_pending" gap)', async () => {
    const rss = siteARoutes()[`${A}/rss/thoi-su.rss`]!.body.replace(
      '</channel>',
      `<item><title>Bản sao</title><link>${U.dupAlias}</link><pubDate>Sun, 08 Nov 2026 23:00:00 +0700</pubDate></item></channel>`,
    );
    const log: string[] = [];
    const root = mkdtempSync(path.join(tmpdir(), 'hcm-'));
    const stores = new Stores(makePaths(root), 'https://example.org');
    const settings = defaultSettings();
    const http = new HttpClient({ transport: fixtureTransport({ [`${A}/rss/thoi-su.rss`]: { status: 200, body: rss } }, log), resolver: publicResolver, maxConcurrent: 4, perHost: 2, timeoutMs: 5000, maxRetries: 1, backoffBaseMs: 1, userAgent: 't', sleep: async () => {} });
    await runCollection({ runId: 'run_canon', window: WINDOW, trigger: 'fixture', settings, sources: [fixtureSources()[0]!], stores, http });
    const cands = await stores.getCandidates('run_canon');
    const alias = cands.find((c) => c.url === U.dupAlias)!;
    const metro = cands.find((c) => c.url === U.metro)!;
    expect(alias.articleId).toBeTruthy(); // fetched first (newest feed date); its canonical is the metro page
    expect(metro.state).toBe('duplicate');
    expect(metro.reasonCode).toBe('DUPLICATE_CANONICAL');
    expect(metro.attempts).toBe(0);
    expect(log.filter((u) => u === U.metro)).toHaveLength(0);
    // the metro link's discovery evidence is kept on the story (nothing lost)
    expect(alias.discoveredVia.some((d) => d.method === 'rss' && d.feedTitle?.includes('Khánh thành'))).toBe(true);
  });
});

describe('carried-over articles are not evidence of adapter drift', () => {
  it('unknown container stays absent when republished; a stale ADAPTER_DEGRADED downgrade is undone', async () => {
    const { fromPublicArticle, toPublicArticle } = await import('../scripts/cloud-collect.js');
    const pub = {
      id: 'a_1', sourceId: 's', sourceName: 'S', url: 'https://x.vn/a.htm', title: 't', sapo: '', contentSections: [], author: null, publishedAt: null, modifiedAt: null,
      dateConfidence: 'verified' as const, extractionCompleteness: 'partial' as const, extractionWarnings: ['ADAPTER_DEGRADED: Khung nội dung bài đổi'],
      sections: { paragraphs: 0, headings: 0, tables: 0, figures: 0 }, location: { status: 'hcm' as const, evidence: [] }, relevance: { status: 'relevant' as const, score: 1, evidence: [] },
      primaryCategory: null, classificationEvidence: [], suggestedAssessment: null, assessmentEvidence: [], duplicateGroupId: null, dateEvidence: [], extractionContainer: null, images: [],
    };
    const a = fromPublicArticle(pub, 'run', '2026-11-16T09:00:00+07:00');
    expect(a.extractionContainer).toBeUndefined();
    expect(a.extractionCompleteness).toBe('auto_checks_passed');
    expect(a.extractionWarnings).toEqual([]);
    expect('extractionContainer' in JSON.parse(JSON.stringify(toPublicArticle(a)))).toBe(false);
  });
});
