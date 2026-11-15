import * as cheerio from 'cheerio';
import type { Settings, Source, SourceRunStats } from '../domain/schemas.js';
import { looksLikeArticleUrl, normalizeUrl, sameSite } from '../domain/url.js';
import { extractArticle } from './extract.js';
import type { HttpClient } from './http.js';
import { discoverSource, Ledger } from './run.js';

/** "Dò cấu trúc tự động": hypotheses only – never silently treated as verified. */
export async function detectStructure(baseUrl: string, http: HttpClient) {
  const out = { baseUrl, name: '', rss: [] as string[], sitemaps: [] as string[], sections: [] as string[], sampleArticles: [] as string[], errors: [] as string[] };
  const home = await http.get(baseUrl);
  if (home.status !== 200) {
    out.errors.push(`Trang chủ: ${home.errorCode ?? home.status}`);
    return out;
  }
  const $ = cheerio.load(home.body);
  out.name = ($('meta[property="og:site_name"]').attr('content') || $('title').text() || '').trim().slice(0, 80);
  $('link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"], a[href$=".rss"], a[href*="/rss/"]').each((_, el) => {
    const u = normalizeUrl($(el).attr('href') ?? '', home.finalUrl);
    if (u && sameSite(u, baseUrl) && !out.rss.includes(u) && out.rss.length < 15) out.rss.push(u);
  });
  const robots = await http.get(new URL('/robots.txt', home.finalUrl).toString());
  if (robots.status === 200) {
    for (const m of robots.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)) {
      const u = normalizeUrl(m[1]!, home.finalUrl);
      if (u && !out.sitemaps.includes(u)) out.sitemaps.push(u);
    }
  } else out.errors.push(`robots.txt: ${robots.errorCode ?? robots.status}`);
  $('nav a[href], header a[href], .menu a[href], .main-nav a[href]').each((_, el) => {
    const u = normalizeUrl($(el).attr('href') ?? '', home.finalUrl);
    if (u && sameSite(u, baseUrl) && !looksLikeArticleUrl(u) && u !== normalizeUrl(baseUrl) && !out.sections.includes(u) && out.sections.length < 40) out.sections.push(u);
  });
  $('a[href]').each((_, el) => {
    const u = normalizeUrl($(el).attr('href') ?? '', home.finalUrl);
    if (u && sameSite(u, baseUrl) && looksLikeArticleUrl(u) && out.sampleArticles.length < 10 && !out.sampleArticles.includes(u)) out.sampleArticles.push(u);
  });
  return out;
}

/** "Thử thu thập": run discovery on the (unsaved) source and extract a few samples. */
export async function probeSource(src: Source, settings: Settings, http: HttpClient, sampleCount = 3) {
  const ledger = new Ledger('run_probe');
  const stats: SourceRunStats = {
    sourceId: src.id, sourceName: src.name, status: 'running', routes: [], listingPagesVisited: 0,
    listingPageLimit: Math.min(src.crawlLimits.maxListingPages, 5), limitReached: false, candidates: 0,
  };
  const limited: Source = { ...src, crawlLimits: { ...src.crawlLimits, maxListingPages: Math.min(src.crawlLimits.maxListingPages, 5), maxDepth: Math.min(src.crawlLimits.maxDepth, 1) } };
  const window = { from: new Date(Date.now() - 36 * 3600_000).toISOString(), to: new Date().toISOString() };
  await discoverSource({ runId: 'run_probe', window, trigger: 'manual', settings, sources: [limited], stores: null as never, http }, limited, ledger, stats);
  const cands = ledger.all();
  stats.candidates = cands.length;
  const samples = [];
  for (const c of cands.filter((x) => looksLikeArticleUrl(x.url, src.articleUrlPattern, src.excludeUrlPattern)).slice(0, sampleCount)) {
    const r = await http.get(c.url);
    if (r.status !== 200) {
      samples.push({ url: c.url, error: r.errorCode ?? `HTTP ${r.status}` });
      continue;
    }
    const ex = extractArticle(r.body, r.finalUrl, settings.quality);
    samples.push({
      url: c.url, title: ex.title, publishedAt: ex.publishedAt, dateConfidence: ex.dateConfidence, completeness: ex.completeness,
      paragraphs: ex.sections.filter((s) => s.type === 'paragraph').length, tables: ex.sections.filter((s) => s.type === 'table').length,
      images: ex.images.length, warnings: ex.warnings, container: ex.containerSelector,
    });
  }
  return {
    stats,
    candidates: cands.slice(0, 50).map((c) => ({ url: c.url, via: c.discoveredVia.map((d) => d.method), feedDate: c.discoveredVia.find((d) => d.feedPublishedAt)?.feedPublishedAt ?? null })),
    samples,
  };
}
