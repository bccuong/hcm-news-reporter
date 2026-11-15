import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { parsePublisherDate } from '../domain/timeWindow.js';
import { looksLikeArticleUrl, normalizeUrl, sameSite } from '../domain/url.js';
import type { Source } from '../domain/schemas.js';

export interface FeedItem {
  url: string;
  title: string;
  publishedAt: string | null;
  rawDate: string | null;
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', cdataPropName: false as unknown as string });

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)['#text']).trim();
  return '';
};

/** RSS 2.0 / Atom. Throws on non-XML so the caller can record a route error. */
export function parseFeed(body: string, feedUrl: string): FeedItem[] {
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(body)) throw new Error('NOT_A_FEED');
  const doc = xml.parse(body) as Record<string, any>;
  const items: FeedItem[] = [];
  const rssItems = asArray(doc.rss?.channel?.item ?? doc['rdf:RDF']?.item);
  for (const it of rssItems) {
    const link = text(it.link) || text(it.guid);
    const url = normalizeUrl(link, feedUrl);
    if (!url) continue;
    const raw = text(it.pubDate) || text(it['dc:date']) || null;
    items.push({ url, title: text(it.title), publishedAt: parsePublisherDate(raw), rawDate: raw });
  }
  for (const e of asArray(doc.feed?.entry)) {
    const links = asArray(e.link);
    const alt = links.find((l: any) => !l['@_rel'] || l['@_rel'] === 'alternate') ?? links[0];
    const url = normalizeUrl(alt?.['@_href'] ?? text(alt), feedUrl);
    if (!url) continue;
    const raw = text(e.published) || text(e.updated) || null;
    items.push({ url, title: text(e.title), publishedAt: parsePublisherDate(raw), rawDate: raw });
  }
  return items;
}

export interface SitemapResult {
  urls: Array<{ url: string; lastmod: string | null; newsPublishedAt: string | null; title: string }>;
  childSitemaps: string[];
}

export function parseSitemap(body: string, base: string): SitemapResult {
  if (!/<(urlset|sitemapindex)[\s>]/i.test(body)) throw new Error('NOT_A_SITEMAP');
  const doc = xml.parse(body) as Record<string, any>;
  const out: SitemapResult = { urls: [], childSitemaps: [] };
  for (const s of asArray(doc.sitemapindex?.sitemap)) {
    const u = normalizeUrl(text(s.loc), base);
    if (u) out.childSitemaps.push(u);
  }
  for (const u of asArray(doc.urlset?.url)) {
    const url = normalizeUrl(text(u.loc), base);
    if (!url) continue;
    const news = u['news:news'];
    out.urls.push({
      url,
      lastmod: text(u.lastmod) || null,
      newsPublishedAt: parsePublisherDate(text(news?.['news:publication_date']) || null),
      title: text(news?.['news:title']),
    });
  }
  return out;
}

export interface ListingResult {
  articleLinks: string[];
  nextPages: string[];
  totalLinks: number;
}

/** Category/section page: article links on the same site + pagination links. */
export function parseListing(body: string, pageUrl: string, source: Pick<Source, 'baseUrl' | 'articleUrlPattern' | 'excludeUrlPattern'>): ListingResult {
  const $ = cheerio.load(body);
  const links = new Set<string>();
  let total = 0;
  $('a[href]').each((_, a) => {
    total++;
    const u = normalizeUrl($(a).attr('href') ?? '', pageUrl);
    if (!u || !sameSite(u, source.baseUrl)) return;
    if (looksLikeArticleUrl(u, source.articleUrlPattern, source.excludeUrlPattern)) links.add(u);
  });
  const next = new Set<string>();
  const add = (h?: string) => {
    const u = h ? normalizeUrl(h, pageUrl) : null;
    if (u && u !== normalizeUrl(pageUrl) && sameSite(u, source.baseUrl)) next.add(u);
  };
  $('link[rel="next"], a[rel="next"]').each((_, el) => add($(el).attr('href')));
  $('a').each((_, el) => {
    const t = $(el).text().trim().toLowerCase();
    const cls = ($(el).attr('class') ?? '').toLowerCase();
    if (/^(trang sau|xem thêm|tiếp|next|›|»|>)$/.test(t) || /\bnext\b/.test(cls)) add($(el).attr('href'));
  });
  return { articleLinks: [...links], nextPages: [...next], totalLinks: total };
}
