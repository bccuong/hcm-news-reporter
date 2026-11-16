import type { EventEmitter } from 'node:events';
import { clusterArticles } from '../domain/cluster.js';
import { assessHealth, measureHealth } from './health.js';
import { annotateArticle } from '../domain/relevance.js';
import type { Article, Candidate, CandidateState, DiscoveryEvidence, DiscoveryMethod, RunManifest, Settings, Source, SourceRunStats } from '../domain/schemas.js';
import { hash32 } from '../domain/text.js';
import { inWindow, toVnIso, type ReportWindow } from '../domain/timeWindow.js';
import { looksLikeArticleUrl, normalizeUrl, sameSite, urlDateHint } from '../domain/url.js';
import type { Stores } from '../storage/stores.js';
import { parseFeed, parseListing, parseSitemap } from './discover.js';
import { EXTRACTOR_VERSION, extractArticle } from './extract.js';
import type { HttpClient } from './http.js';

export interface RunEvent {
  type: 'source' | 'progress' | 'done' | 'log';
  runId: string;
  sourceId?: string;
  message?: string;
  counts?: Record<string, number>;
}

export interface RunContext {
  runId: string;
  window: ReportWindow;
  trigger: RunManifest['trigger'];
  settings: Settings;
  sources: Source[];
  stores: Stores;
  http: HttpClient;
  signal?: AbortSignal;
  events?: EventEmitter;
  /** Restrict to these source IDs (retry/rescan). */
  onlySourceIds?: string[];
  /** Additional lookback (hours) for "Mở rộng quét" */
  extraLookbackHours?: number;
  /** Retry only these candidate ids (retry failed) */
  retryCandidateIds?: string[];
  /** profile (cấu hình) whose settings/sources are used; recorded in the manifest */
  profileId?: string;
}

export const now = () => toVnIso(new Date());

export function candidateId(url: string) {
  return `c_${hash32(url)}${hash32(url.split('').reverse().join(''))}`;
}

export class Ledger {
  readonly byId = new Map<string, Candidate>();
  constructor(readonly runId: string, initial: Candidate[] = []) {
    for (const c of initial) this.byId.set(c.id, c);
  }
  discover(sourceId: string, url: string, ev: DiscoveryEvidence): { cand: Candidate; isNew: boolean } {
    const id = candidateId(url);
    const ex = this.byId.get(id);
    if (ex) {
      if (!ex.discoveredVia.some((d) => d.method === ev.method && d.listingUrl === ev.listingUrl)) ex.discoveredVia.push(ev);
      return { cand: ex, isNew: false };
    }
    const c: Candidate = {
      id, runId: this.runId, sourceId, url, canonicalUrl: null, discoveredVia: [ev], discoveredAt: ev.at,
      state: 'discovered', reasonCode: null, reasonDetail: null, httpStatus: null, attempts: 0, attemptedAt: null,
      parserVersion: null, articleId: null, history: [{ at: ev.at, state: 'discovered' }],
    };
    this.byId.set(id, c);
    return { cand: c, isNew: true };
  }
  set(c: Candidate, state: CandidateState, reasonCode: string | null = null, reasonDetail: string | null = null) {
    c.state = state;
    c.reasonCode = reasonCode;
    c.reasonDetail = reasonDetail;
    c.history.push({ at: now(), state, reason: reasonCode });
    if (c.history.length > 30) c.history.splice(1, c.history.length - 30);
  }
  all() {
    return [...this.byId.values()];
  }
}

export function countStates(list: Candidate[]): Record<string, number> {
  const out: Record<string, number> = { total: list.length };
  for (const c of list) out[c.state] = (out[c.state] ?? 0) + 1;
  return out;
}

/** Invariant: every discovered candidate is in exactly one state; nothing left in transient states after finish. */
export function reconcile(list: Candidate[]) {
  const counts = countStates(list);
  const transient = (['discovered', 'fetch_queued', 'fetched'] as const).reduce((s, k) => s + (counts[k] ?? 0), 0);
  const sum = Object.entries(counts).filter(([k]) => k !== 'total').reduce((s, [, v]) => s + v, 0);
  return { total: list.length, accounted: sum, transient, balanced: sum === list.length };
}

export async function discoverSource(ctx: RunContext, src: Source, ledger: Ledger, stats: SourceRunStats) {
  const methods = new Set<DiscoveryMethod>(src.discoveryMethods.filter((m) => ctx.settings.discovery.enabledMethods.includes(m)));
  const at = now();
  const lookbackMs = (ctx.settings.reportWindow.lookbackMarginHours + (ctx.extraLookbackHours ?? 0)) * 3600_000;
  const winFromMs = new Date(ctx.window.from).getTime() - lookbackMs;
  const add = (url: string, ev: DiscoveryEvidence) => {
    const n = normalizeUrl(url);
    if (!n || !sameSite(n, src.baseUrl)) return false;
    const { isNew } = ledger.discover(src.id, n, ev);
    return isNew;
  };

  // RSS / Atom
  if (methods.has('rss')) {
    for (const feed of src.rssUrls) {
      if (ctx.signal?.aborted) return;
      const r = await ctx.http.get(feed, ctx.signal);
      if (r.status !== 200) {
        stats.routes.push({ method: 'rss', url: feed, status: 'error', httpStatus: r.status, found: 0, error: r.errorCode ?? r.error ?? 'ERROR' });
        continue;
      }
      try {
        const items = parseFeed(r.body, feed);
        for (const it of items) add(it.url, { method: 'rss', listingUrl: feed, at, feedPublishedAt: it.publishedAt, feedTitle: it.title });
        stats.routes.push({ method: 'rss', url: feed, status: 'ok', httpStatus: 200, found: items.length });
      } catch (e) {
        stats.routes.push({ method: 'rss', url: feed, status: 'error', httpStatus: 200, found: 0, error: (e as Error).message });
      }
    }
  }

  // Sitemaps (index -> children, bounded)
  if (methods.has('sitemap')) {
    const queue = [...src.sitemapUrls];
    const seen = new Set<string>();
    let budget = src.crawlLimits.maxListingPages;
    while (queue.length && budget > 0) {
      if (ctx.signal?.aborted) return;
      const sm = queue.shift()!;
      if (seen.has(sm)) continue;
      seen.add(sm);
      budget--;
      stats.listingPagesVisited++;
      const r = await ctx.http.get(sm, ctx.signal);
      if (r.status !== 200) {
        stats.routes.push({ method: 'sitemap', url: sm, status: 'error', httpStatus: r.status, found: 0, error: r.errorCode ?? 'ERROR' });
        continue;
      }
      try {
        const res = parseSitemap(r.body, sm);
        queue.push(...res.childSitemaps);
        let found = 0;
        for (const u of res.urls) {
          const ts = u.newsPublishedAt ?? (u.lastmod ? new Date(u.lastmod).toISOString() : null);
          // lastmod older than window-lookback can't be a new publication: still recorded, marked later
          add(u.url, { method: 'sitemap', listingUrl: sm, at, feedPublishedAt: u.newsPublishedAt, feedTitle: u.title || undefined });
          found++;
          void ts;
        }
        stats.routes.push({ method: 'sitemap', url: sm, status: 'ok', httpStatus: 200, found });
      } catch (e) {
        stats.routes.push({ method: 'sitemap', url: sm, status: 'error', httpStatus: 200, found: 0, error: (e as Error).message });
      }
    }
    if (queue.length) {
      stats.limitReached = true;
      stats.routes.push({ method: 'sitemap', url: queue[0]!, status: 'limit', found: 0, error: `PAGINATION_LIMIT: còn ${queue.length} sitemap chưa đọc` });
    }
  }

  // Section/listing pages + pagination (BFS, bounded by depth and page budget)
  if (methods.has('section')) {
    const seen = new Set<string>();
    const queue: Array<{ url: string; depth: number; root: string }> = src.sectionUrls.map((u) => ({ url: u, depth: 0, root: u }));
    let budget = src.crawlLimits.maxListingPages;
    while (queue.length && budget > 0) {
      if (ctx.signal?.aborted) return;
      const item = queue.shift()!;
      const key = normalizeUrl(item.url) ?? item.url;
      if (seen.has(key)) continue;
      seen.add(key);
      budget--;
      stats.listingPagesVisited++;
      const r = await ctx.http.get(item.url, ctx.signal);
      if (r.status !== 200) {
        stats.routes.push({ method: 'section', url: item.url, status: 'error', httpStatus: r.status, found: 0, error: r.errorCode ?? 'ERROR' });
        continue;
      }
      const res = parseListing(r.body, r.finalUrl, src);
      let found = 0;
      for (const l of res.articleLinks) if (add(l, { method: 'section', listingUrl: item.url, at })) found++;
      stats.routes.push({ method: 'section', url: item.url, status: 'ok', httpStatus: 200, found: res.articleLinks.length });
      if (src.crawlLimits.followPagination && item.depth < src.crawlLimits.maxDepth) {
        for (const nx of res.nextPages) queue.push({ url: nx, depth: item.depth + 1, root: item.root });
      }
      void found;
      void winFromMs;
    }
    const pending = queue.filter((q) => !seen.has(normalizeUrl(q.url) ?? q.url));
    if (pending.length) {
      stats.limitReached = true;
      stats.routes.push({ method: 'section', url: pending[0]!.url, status: 'limit', found: 0, error: `PAGINATION_LIMIT: còn ${pending.length} trang chuyên mục chưa duyệt (giới hạn ${src.crawlLimits.maxListingPages})` });
    }
  }
}

/**
 * Pre-fetch triage that never discards: candidates whose FEED/SITEMAP date is clearly before the
 * window minus lookback are marked outside_window with the feed evidence; everything else is fetched.
 */
function triage(c: Candidate, ctx: RunContext, src: Source): 'fetch' | 'skip' {
  if (!looksLikeArticleUrl(c.url, src.articleUrlPattern, src.excludeUrlPattern)) {
    return 'skip';
  }
  return 'fetch';
}

/** Ledger state of an extracted article: date gate first ([from, to) on verified time only), then relevance, then completeness. */
export function stateFor(
  article: Pick<Article, 'publishedAt' | 'dateConfidence' | 'extractionCompleteness' | 'extractionWarnings'>,
  verdict: { status: 'relevant' | 'review' | 'irrelevant'; reasonCode: string | null; evidence: string[] },
  window: { from: string; to: string },
): [CandidateState, string | null, string | null] {
  if (!article.publishedAt || article.dateConfidence === 'unknown') return ['date_unverified', 'MISSING_PUBLISHED_AT', 'Không xác minh được giờ đăng – cần kiểm tra'];
  if (!inWindow(article.publishedAt, window)) return ['outside_window', 'OUTSIDE_DATE_WINDOW', `Giờ đăng ${article.publishedAt} ngoài [${window.from}, ${window.to})`];
  if (article.dateConfidence === 'inferred') return ['date_unverified', 'PUBLISHED_AT_INFERRED', 'Giờ đăng chỉ suy ra từ văn bản hiển thị/xung đột – cần kiểm tra'];
  if (verdict.status === 'irrelevant') return ['irrelevant_with_evidence', verdict.reasonCode ?? 'IRRELEVANT', verdict.evidence.slice(0, 3).join('; ')];
  if (article.extractionCompleteness === 'partial') return ['parsed_partial', 'EXTRACTION_PARTIAL', article.extractionWarnings.join('; ')];
  return ['ready_for_review', verdict.status === 'review' ? verdict.reasonCode : null, verdict.status === 'review' ? 'Cần kiểm tra mức liên quan' : null];
}

export async function runCollection(ctx: RunContext): Promise<RunManifest> {
  const { settings, stores } = ctx;
  const prev = await stores.getManifest(ctx.runId).catch(() => null);
  const prevCands = prev ? await stores.getCandidates(ctx.runId) : [];
  const ledger = new Ledger(ctx.runId, prevCands);
  const manifest: RunManifest = prev ?? {
    runId: ctx.runId,
    createdAt: now(),
    finishedAt: null,
    window: ctx.window,
    trigger: ctx.trigger,
    status: 'running',
    sources: [],
    counts: {},
    completeness: 'unknown',
    settingsHash: hash32(JSON.stringify(settings)),
    notes: [],
    ...(ctx.profileId ? { profileId: ctx.profileId } : {}),
  };
  manifest.status = 'running';
  manifest.finishedAt = null;
  const emit = (e: Omit<RunEvent, 'runId'>) => ctx.events?.emit('event', { ...e, runId: ctx.runId });
  const checkpoint = async () => {
    manifest.counts = countStates(ledger.all());
    await stores.saveCandidates(ctx.runId, ledger.all());
    await stores.saveManifest(manifest);
    emit({ type: 'progress', counts: manifest.counts });
  };
  await checkpoint();

  const targets = ctx.sources.filter((s) => !ctx.onlySourceIds || ctx.onlySourceIds.includes(s.id));
  const excludeSections = settings.keywords.excludeUrlSections.filter(Boolean);
  const excludeRe = excludeSections.length ? new RegExp(`/(${excludeSections.map((s) => s.replace(/[^a-z0-9-]/gi, '')).join('|')})[/-]`, 'i') : null;
  const existingArticles = new Map((await stores.getArticles(ctx.runId)).map((a) => [a.id, a]));
  const canonicalSeen = new Map<string, string>(); // canonical -> candidate id
  for (const c of ledger.all()) if (c.canonicalUrl && !['duplicate'].includes(c.state)) canonicalSeen.set(c.canonicalUrl, c.id);

  for (const src of targets) {
    let stats = manifest.sources.find((s) => s.sourceId === src.id);
    if (!stats) {
      stats = { sourceId: src.id, sourceName: src.name, status: 'pending', routes: [], listingPagesVisited: 0, listingPageLimit: src.crawlLimits.maxListingPages, limitReached: false, candidates: 0 };
      manifest.sources.push(stats);
    }
    if (!src.enabled) {
      stats.status = 'skipped_disabled';
      continue;
    }
    if (src.fetchMode === 'manual_only') {
      stats.status = 'manual_only';
      stats.error = 'Báo chặn thu thập tự động – thêm link thủ công';
      continue;
    }
    stats.status = 'running';
    stats.routes = [];
    stats.listingPagesVisited = 0;
    stats.limitReached = false;
    emit({ type: 'source', sourceId: src.id, message: 'Đang dò link' });
    const before = new Set(ledger.all().map((c) => c.id));
    try {
      if (!ctx.retryCandidateIds) await discoverSource(ctx, src, ledger, stats);
    } catch (e) {
      stats.error = (e as Error).message;
    }
    const mine = ledger.all().filter((c) => c.sourceId === src.id);
    stats.candidates = mine.length;
    (stats as SourceRunStats & { newSinceLast?: number }).newSinceLast = mine.filter((c) => !before.has(c.id)).length;
    await checkpoint();

    // Triage + fetch
    let fetches = 0;
    // per-publisher limit: the source's own value when set (Sửa nguồn), else the shared one (Cài đặt › Hiệu năng); never above the technical cap
    const cap = Math.min(src.crawlLimits.maxArticleFetches, src.crawlLimits.perRunArticles ?? settings.collection.maxArticlesPerSource);
    const winFrom = new Date(ctx.window.from).getTime();
    const winTo = new Date(ctx.window.to).getTime();
    /** fetch order under a limit: dated inside the window (newest first) → undated → dated outside */
    const rank = (c: Candidate): [number, number] => {
      const fd = c.discoveredVia.map((d) => d.feedPublishedAt).find(Boolean);
      const hint = fd ? null : urlDateHint(c.url);
      const t = fd ? new Date(fd).getTime() : hint ? new Date(`${hint}T12:00:00+07:00`).getTime() : NaN;
      // no date: newest publisher id first (ids in article URLs grow over time) – the limit goes to recent links, not deep listing pages
      if (Number.isNaN(t)) return [1, -(Number(/(\d{6,})(?:\.\w+)?(?:[?#].*)?$/.exec(c.url)?.[1] ?? 0))];
      return [t >= winFrom && t < winTo ? 0 : 2, -t];
    };
    const todo = mine
      .filter((c) => {
        if (ctx.retryCandidateIds) return ctx.retryCandidateIds.includes(c.id);
        return ['discovered', 'fetch_queued', 'fetched', 'retry_pending', 'fetch_failed'].includes(c.state);
      })
      .map((c) => ({ c, r: rank(c) }))
      .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1])
      .map((x) => x.c);
    for (const c of todo) {
      if (ctx.signal?.aborted) break;
      if (excludeRe && excludeRe.test(new URL(c.url).pathname)) {
        ledger.set(c, 'irrelevant_with_evidence', 'EXCLUDED_URL_SECTION', `URL thuộc chuyên mục loại trừ: ${excludeRe.exec(new URL(c.url).pathname)?.[1]}`);
        continue;
      }
      if (triage(c, ctx, src) === 'skip') {
        ledger.set(c, 'irrelevant_with_evidence', 'INVALID_ARTICLE_URL', 'URL không giống trang bài viết');
        continue;
      }
      // feed date clearly outside the window (with lookback) -> recorded, not fetched
      const feedDate = c.discoveredVia.map((d) => d.feedPublishedAt).find(Boolean);
      if (feedDate && !ctx.retryCandidateIds) {
        const t = new Date(feedDate).getTime();
        const lb = (settings.reportWindow.lookbackMarginHours + (ctx.extraLookbackHours ?? 0)) * 3600_000;
        if (t < new Date(ctx.window.from).getTime() - lb || t >= new Date(ctx.window.to).getTime() + lb) {
          ledger.set(c, 'outside_window', 'OUTSIDE_DATE_WINDOW', `Ngày trong RSS/sitemap: ${feedDate}`);
          continue;
        }
      }
      // URL-embedded creation date (publisher id) clearly ≥2 days outside the window -> recorded, not fetched
      const hint = !feedDate && !ctx.retryCandidateIds ? urlDateHint(c.url) : null;
      if (hint) {
        const day = 86400_000;
        const h = new Date(`${hint}T12:00:00+07:00`).getTime();
        if (h < new Date(ctx.window.from).getTime() - 2 * day || h > new Date(ctx.window.to).getTime() + 2 * day) {
          ledger.set(c, 'outside_window', 'URL_DATE_HINT', `Mã bài trong URL cho thấy ngày tạo ${hint} – cách xa khung giờ (bấm "Thử lại" để tải xác minh)`);
          continue;
        }
      }
      // this URL is already the canonical page of a story extracted from another link (e.g. a feed link redirecting to it):
      // recorded as a duplicate of that story instead of a pending gap, and no fetch is spent on it ("Thử lại" still fetches)
      const sameAs = !ctx.retryCandidateIds ? canonicalSeen.get(normalizeUrl(c.url) ?? c.url) : undefined;
      if (sameAs && sameAs !== c.id && ledger.byId.get(sameAs)?.articleId) {
        const primary = ledger.byId.get(sameAs)!;
        primary.discoveredVia.push(...c.discoveredVia);
        ledger.set(c, 'duplicate', 'DUPLICATE_CANONICAL', `Đã có bài từ link khác trỏ tới cùng trang: ${primary.url}`);
        continue;
      }
      if (fetches >= cap) {
        ledger.set(c, 'retry_pending', 'FETCH_LIMIT', `Vượt giới hạn ${cap} bài/báo mỗi lượt (Cài đặt › Hiệu năng) – tăng giới hạn hoặc bấm "Thử lại" để tải tiếp`);
        stats.limitReached = true;
        continue;
      }
      fetches++;
      ledger.set(c, 'fetch_queued');
      c.attempts++;
      c.attemptedAt = now();
      const r = await ctx.http.get(c.url, ctx.signal);
      c.httpStatus = r.status;
      if (r.errorCode === 'CANCELLED') {
        ledger.set(c, 'retry_pending', 'CANCELLED', 'Lượt chạy bị hủy trước khi tải xong');
        break;
      }
      if (r.status !== 200) {
        const blocked = r.status === 403 || r.status === 451 || r.errorCode === 'SSRF_BLOCKED';
        ledger.set(c, blocked ? 'blocked' : 'fetch_failed', r.errorCode ?? `FETCH_${r.status}`, r.error);
        continue;
      }
      ledger.set(c, 'fetched');
      let ex;
      try {
        ex = extractArticle(r.body, r.finalUrl, settings.quality);
      } catch (e) {
        ledger.set(c, 'parse_failed', 'PARSE_EXCEPTION', (e as Error).message);
        continue;
      }
      c.parserVersion = EXTRACTOR_VERSION;
      c.canonicalUrl = ex.canonicalUrl ?? normalizeUrl(r.finalUrl);
      const canon = c.canonicalUrl ?? c.url;
      const dupOf = canonicalSeen.get(canon);
      if (dupOf && dupOf !== c.id) {
        const primary = ledger.byId.get(dupOf);
        primary?.discoveredVia.push(...c.discoveredVia);
        ledger.set(c, 'duplicate', 'DUPLICATE_CANONICAL', `Trùng canonical với ${primary?.url ?? dupOf}`);
        continue;
      }
      canonicalSeen.set(canon, c.id);
      if (ex.completeness === 'failed') {
        ledger.set(c, 'parse_failed', ex.warnings.find((w) => /^(ARTICLE_BODY_MISSING|MISSING_TITLE)/.test(w))?.split(':')[0] ?? 'PARSE_FAILED', ex.warnings.join('; '));
        continue;
      }
      const base: Article = {
        id: `a_${c.id.slice(2)}`,
        runId: ctx.runId,
        sourceId: src.id,
        sourceName: src.name,
        originType: 'website',
        originalUrl: c.url,
        canonicalUrl: c.canonicalUrl,
        title: ex.title,
        sapo: ex.sapo,
        bodyText: ex.bodyText,
        contentSections: ex.sections,
        articleLinks: ex.links,
        author: ex.author,
        publishedAt: ex.publishedAt,
        modifiedAt: ex.modifiedAt,
        collectedAt: now(),
        dateConfidence: ex.dateConfidence,
        dateEvidence: ex.dateEvidence,
        extractionAdapterVersion: EXTRACTOR_VERSION,
        extractionContainer: ex.containerSelector,
        extractionCompleteness: ex.completeness,
        extractionWarnings: ex.warnings,
        continuation: ex.continuation,
        location: { status: 'unknown', evidence: [] },
        relevance: { status: 'review', score: 0, evidence: [] },
        primaryCategory: null,
        secondaryCategories: [],
        classificationEvidence: [],
        suggestedAssessment: null,
        assessmentEvidence: [],
        imageCandidates: ex.images.slice(0, Math.max(settings.editorial.maxImagesPerArticle, 1) + 1),
        duplicateGroupId: null,
        warnings: [],
      };
      const { _verdict, ...article } = annotateArticle(base, settings);
      c.articleId = article.id;
      existingArticles.set(article.id, article);
      await stores.appendArticles(ctx.runId, [article]);

      ledger.set(c, ...stateFor(article, _verdict, ctx.window));
      if (fetches % 10 === 0) await checkpoint();
    }
    const failed = mine.filter((c) => ['fetch_failed', 'blocked'].includes(c.state)).length;
    const routeErrors = stats.routes.filter((r) => r.status === 'error').length;
    stats.status = ctx.signal?.aborted
      ? 'cancelled'
      : stats.routes.length && routeErrors === stats.routes.length
        ? 'failed'
        : failed || routeErrors || stats.limitReached
          ? 'partial'
          : 'ok';
    emit({ type: 'source', sourceId: src.id, message: stats.status });
    await checkpoint();
  }

  // DIS-08: adapter health vs. previous healthy runs; degraded → no automatic "complete", review queue
  const history = (await stores.listRuns()).filter((r) => r.runId !== ctx.runId && r.status === 'completed');
  const degradedArticles: Article[] = [];
  for (const stats of manifest.sources) {
    if (!['ok', 'partial', 'failed'].includes(stats.status)) continue;
    const prev = history.map((r) => r.sources.find((s) => s.sourceId === stats.sourceId)?.adapter).filter((h): h is NonNullable<typeof h> => !!h);
    stats.adapter = assessHealth(measureHealth(stats.sourceId, ledger.all(), [...existingArticles.values()]), prev);
    if (stats.adapter.status !== 'degraded') continue;
    if (stats.status === 'ok') stats.status = 'partial';
    const why = stats.adapter.reasons.join('; ');
    for (const c of ledger.all().filter((x) => x.sourceId === stats.sourceId && x.articleId)) {
      const a = existingArticles.get(c.articleId!);
      if (a && a.extractionCompleteness === 'auto_checks_passed') {
        a.extractionCompleteness = 'partial';
        a.extractionWarnings = [...a.extractionWarnings.filter((w) => !w.startsWith('ADAPTER_DEGRADED')), `ADAPTER_DEGRADED: ${why}`];
        degradedArticles.push(a);
      }
      if (c.state === 'ready_for_review' && !c.reasonCode) ledger.set(c, 'ready_for_review', 'ADAPTER_DEGRADED', `Bộ bóc tách nguồn này suy giảm – kiểm tra với bài gốc: ${why}`);
    }
    manifest.notes.push(`${stats.sourceName}: bộ bóc tách suy giảm – ${why}`);
  }
  if (degradedArticles.length) await stores.appendArticles(ctx.runId, degradedArticles);

  // Same-event clustering (near-duplicates) for reviewer – never auto-merged
  // deterministic order: concurrent fetches finish in any order, the grouping must not depend on it
  const arts = [...existingArticles.values()].sort((a, b) => a.id.localeCompare(b.id));
  const beforeGroups = new Map(arts.map((a) => [a.id, a.duplicateGroupId]));
  clusterArticles(arts);
  const regrouped = arts.filter((a) => a.duplicateGroupId !== beforeGroups.get(a.id));
  if (regrouped.length) await stores.appendArticles(ctx.runId, regrouped);
  const all = ledger.all();
  for (const c of all) {
    if (['discovered', 'fetch_queued', 'fetched'].includes(c.state)) {
      ledger.set(c, 'retry_pending', ctx.signal?.aborted ? 'CANCELLED' : 'NOT_PROCESSED', 'Chưa xử lý xong trong lượt này');
    }
  }
  manifest.status = ctx.signal?.aborted ? 'cancelled' : 'completed';
  manifest.finishedAt = now();
  const anyLimit = manifest.sources.some((s) => s.limitReached || s.status === 'failed' || s.status === 'partial' || s.adapter?.status === 'degraded');
  manifest.completeness = anyLimit || all.some((c) => c.state === 'retry_pending') ? 'incomplete' : 'complete_within_enumerated_scope';
  await checkpoint();
  emit({ type: 'done', counts: manifest.counts });
  return manifest;
}

export { clusterArticles } from '../domain/cluster.js';
