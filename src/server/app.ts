import { createHash, randomBytes } from 'node:crypto';
import { buildFromTemplate, imageSize, TemplateMismatchError, type TemplateImage } from '../reports/templatePptx.js';
import { EventEmitter } from 'node:events';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { HttpClient, type Resolver, type Transport } from '../collector/http.js';
import { detectStructure, probeSource } from '../collector/probe.js';
import { reconcile, runCollection } from '../collector/run.js';
import { parseWebsitesTxt } from '../domain/defaults.js';
import { judgeRelevance } from '../domain/relevance.js';
import { evaluateRule, validateRule } from '../domain/rules.js';
import { RuleNodeSchema, SourceSchema, type Settings, type Source } from '../domain/schemas.js';
import { lastCompletedWindow, validateWindow, vnDate, type ReportWindow } from '../domain/timeWindow.js';
import { checkPublicUrl } from '../domain/url.js';
import { assembleStories } from '../reports/assemble.js';
import { buildReportPptx, checkFit } from '../reports/pptx.js';
import { safeJoin, writeFileAtomic, writeJsonAtomic } from '../storage/files.js';
import { makePaths, Stores } from '../storage/stores.js';

export interface AppOptions {
  root: string;
  seedWebsitesTxt: string;
  transport?: Transport;
  resolver?: Resolver;
  webDist?: string;
  token?: string;
  allowedPorts?: number[];
}

const WindowSchema = z.object({ from: z.string(), to: z.string() });

export async function createApp(o: AppOptions): Promise<{ app: FastifyInstance; stores: Stores; token: string }> {
  const paths = makePaths(o.root);
  const stores = new Stores(paths, o.seedWebsitesTxt);
  const token = o.token ?? randomBytes(24).toString('hex');
  const app = Fastify({ logger: false, bodyLimit: 30 * 1024 * 1024 });
  const active = new Map<string, { ctl: AbortController; events: EventEmitter; done: Promise<unknown> }>();
  const allowedHosts = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

  const makeHttp = (s: Settings, sources: Source[] = []) =>
    new HttpClient({
      transport: o.transport,
      resolver: o.resolver,
      maxConcurrent: s.collection.maxConcurrentRequests,
      perHost: s.collection.maxRequestsPerHost,
      timeoutMs: s.collection.timeoutMs,
      maxRetries: s.collection.maxRetries,
      backoffBaseMs: s.collection.backoffBaseMs,
      userAgent: s.collection.userAgent,
      cacheMinutes: s.performance.httpCacheMinutes,
      hostOverrides: Object.fromEntries(
        sources.map((x) => [new URL(x.baseUrl).hostname.replace(/^www\./, ''), { concurrency: Math.min(x.maxConcurrency, s.collection.maxRequestsPerHost), pauseMs: x.pauseMs }]),
      ),
    });

  /* ---------- security: DNS-rebinding guard, origin + token on mutations ---------- */
  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host ?? '';
    if (!allowedHosts.test(host)) return reply.code(403).send({ error: 'HOST_NOT_ALLOWED' });
    if (!req.url.startsWith('/api/')) return;
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(origin)) {
      return reply.code(403).send({ error: 'ORIGIN_NOT_ALLOWED' });
    }
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (mutating && req.headers['x-hcm-token'] !== token) return reply.code(401).send({ error: 'TOKEN_REQUIRED' });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: 'VALIDATION', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const msg = (err as Error).message;
    const code = /PATH_TRAVERSAL|INVALID_/.test(msg) ? 400 : (err as { statusCode?: number }).statusCode ?? 500;
    return reply.code(code).send({ error: msg });
  });

  /* ---------- session / health ---------- */
  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString(), version: '0.1.0' }));
  app.get('/api/session', async (req, reply) => {
    // Only same-origin browser contexts receive the token (Sec-Fetch-Site is set by modern browsers).
    const sfs = req.headers['sec-fetch-site'];
    if (sfs && sfs !== 'same-origin' && sfs !== 'none') return reply.code(403).send({ error: 'CROSS_SITE' });
    return { token };
  });

  /* ---------- settings ---------- */
  app.get('/api/settings', async () => stores.getSettings());
  app.put('/api/settings', async (req) => {
    const body = req.body as { settings: unknown; summary?: string };
    return stores.saveSettings(body.settings, body.summary);
  });
  app.get('/api/settings/history', async () => stores.listHistory());
  app.post('/api/settings/rollback', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.body);
    await stores.rollback(id);
    return { ok: true, settings: await stores.getSettings(), sources: await stores.getSources() };
  });
  app.get('/api/backup', async () => stores.exportBackup());
  app.post('/api/backup/restore', async (req) => {
    const b = z.object({ confirm: z.literal(true), backup: z.object({ kind: z.literal('hcm-news-reporter-backup'), settings: z.unknown(), sources: z.unknown() }) }).parse(req.body);
    await stores.saveSettings(b.backup.settings, 'Khôi phục từ bản sao lưu');
    await stores.saveSources(b.backup.sources, 'Khôi phục từ bản sao lưu');
    return { ok: true };
  });

  /* ---------- sources ---------- */
  app.get('/api/sources', async () => stores.getSources());
  app.put('/api/sources', async (req) => {
    const body = req.body as { sources: unknown; summary?: string };
    const list = z.array(SourceSchema).parse(body.sources);
    for (const s of list) {
      for (const u of [s.baseUrl, ...s.rssUrls, ...s.sitemapUrls, ...s.sectionUrls, ...s.searchUrls]) {
        const c = checkPublicUrl(u);
        if (!c.ok) throw Object.assign(new Error(`URL bị từ chối (${c.reason}): ${u}`), { statusCode: 400 });
      }
    }
    return stores.saveSources(list, body.summary);
  });
  app.post('/api/sources/import-skill', async (req) => {
    const { text } = z.object({ text: z.string().max(200_000) }).parse(req.body);
    return parseWebsitesTxt(text); // draft only – UI asks for confirmation before saving
  });
  app.post('/api/sources/detect', async (req) => {
    const { url } = z.object({ url: z.string().url() }).parse(req.body);
    const c = checkPublicUrl(url);
    if (!c.ok) throw Object.assign(new Error(`URL bị từ chối (${c.reason})`), { statusCode: 400 });
    return detectStructure(url, makeHttp(await stores.getSettings()));
  });
  app.post('/api/sources/test', async (req) => {
    const src = SourceSchema.parse((req.body as { source: unknown }).source);
    const s = await stores.getSettings();
    return probeSource(src, s, makeHttp(s, [src]));
  });

  /* ---------- rules preview ---------- */
  app.post('/api/rules/preview', async (req) => {
    const b = z
      .object({ root: RuleNodeSchema, runId: z.string().optional(), sample: z.object({ title: z.string(), body: z.string() }).optional(), settings: z.unknown().optional() })
      .parse(req.body);
    const settings = (b.settings as Settings | undefined) ?? (await stores.getSettings());
    const errors = validateRule(b.root);
    const results: Array<{ id: string; title: string; matched: boolean; lines: string[]; location?: string; verdict?: string }> = [];
    if (b.sample) {
      const r = evaluateRule(b.root, b.sample, settings.keywords.synonyms);
      results.push({ id: 'sample', title: b.sample.title, matched: r.matched, lines: r.lines });
    }
    const runs = b.runId ? [b.runId] : (await stores.listRuns()).slice(0, 1).map((r) => r.runId);
    for (const runId of runs) {
      for (const a of (await stores.getArticles(runId)).slice(0, 200)) {
        const r = evaluateRule(b.root, { title: a.title, body: `${a.sapo}\n${a.bodyText}` }, settings.keywords.synonyms);
        const v = judgeRelevance(a.title, `${a.sapo}\n${a.bodyText}`, a.sourceId, { ...settings, rules: { ...settings.rules, presets: [] } });
        results.push({ id: a.id, title: a.title, matched: r.matched, lines: r.lines, location: v.location.status });
      }
    }
    return { errors, results };
  });

  /* ---------- runs ---------- */
  app.get('/api/runs', async () => stores.listRuns());
  app.get('/api/window/default', async () => {
    const s = await stores.getSettings();
    return lastCompletedWindow(new Date(), s.reportWindow.startClock, s.reportWindow.endClock);
  });

  const startRun = async (window: ReportWindow, trigger: 'manual' | 'auto' | 'retry', extra: { runId?: string; onlySourceIds?: string[]; retryCandidateIds?: string[]; extraLookbackHours?: number } = {}) => {
    const err = validateWindow(window);
    if (err) throw Object.assign(new Error(err), { statusCode: 400 });
    const runId = extra.runId ?? `run_${vnDate(new Date(window.to)).replace(/-/g, '')}_${Date.now().toString(36)}`;
    if (active.has(runId)) throw Object.assign(new Error('Lượt chạy đang hoạt động'), { statusCode: 409 });
    const settings = await stores.getSettings();
    const sources = await stores.getSources();
    const ctl = new AbortController();
    const events = new EventEmitter();
    events.setMaxListeners(50);
    const done = runCollection({ runId, window, trigger, settings, sources, stores, http: makeHttp(settings, sources), signal: ctl.signal, events, ...extra })
      .catch(async (e) => {
        const m = await stores.getManifest(runId);
        if (m) await stores.saveManifest({ ...m, status: 'failed', notes: [...m.notes, String((e as Error).message)] });
      })
      .finally(() => {
        active.delete(runId);
        events.emit('event', { type: 'done', runId });
      });
    active.set(runId, { ctl, events, done });
    // return once the manifest exists on disk, so an immediate GET /api/runs/:id never 404s
    await new Promise<void>((res) => {
      const t = setTimeout(res, 3000);
      events.once('event', () => (clearTimeout(t), res()));
    });
    return { runId };
  };

  app.post('/api/runs', async (req) => {
    const b = z.object({ window: WindowSchema, trigger: z.enum(['manual', 'auto']).default('manual') }).parse(req.body);
    if (b.trigger === 'auto') {
      const s = await stores.getSettings();
      if (!s.startup.autoCollectLastCompletedWindow) return { skipped: 'AUTO_DISABLED' };
      const runs = await stores.listRuns();
      if (s.startup.oncePerWindow && runs.some((r) => r.window.from === b.window.from && r.window.to === b.window.to)) return { skipped: 'ALREADY_COLLECTED' };
    }
    return startRun(b.window, b.trigger);
  });
  app.get('/api/runs/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    const m = await stores.getManifest(id);
    if (!m) throw Object.assign(new Error('RUN_NOT_FOUND'), { statusCode: 404 });
    return { ...m, active: active.has(id), reconciliation: reconcile(await stores.getCandidates(id)) };
  });
  app.get('/api/runs/:id/events', (req, reply) => {
    const id = (req.params as { id: string }).id;
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    // never write after the stream ended (the run emits 'done' twice: collector + finally) – that crashed the process
    const send = (e: unknown) => {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    const a = active.get(id);
    if (!a) {
      send({ type: 'done', runId: id });
      reply.raw.end();
      return;
    }
    const on = (e: { type: string }) => {
      send(e);
      if (e.type === 'done') {
        a.events.off('event', on);
        if (!reply.raw.writableEnded) reply.raw.end();
      }
    };
    a.events.on('event', on);
    req.raw.on('close', () => a.events.off('event', on));
  });
  app.post('/api/runs/:id/cancel', async (req) => {
    const a = active.get((req.params as { id: string }).id);
    a?.ctl.abort();
    return { ok: !!a };
  });
  app.post('/api/runs/:id/retry', async (req) => {
    const id = (req.params as { id: string }).id;
    const b = z
      .object({ mode: z.enum(['failed', 'source', 'expand', 'candidates']), sourceId: z.string().optional(), candidateIds: z.array(z.string()).optional(), extraLookbackHours: z.number().min(0).max(72).optional() })
      .parse(req.body);
    const m = await stores.getManifest(id);
    if (!m) throw Object.assign(new Error('RUN_NOT_FOUND'), { statusCode: 404 });
    const cands = await stores.getCandidates(id);
    if (b.mode === 'failed') {
      const ids = cands.filter((c) => ['fetch_failed', 'retry_pending', 'parse_failed'].includes(c.state)).map((c) => c.id);
      return startRun(m.window, 'retry', { runId: id, retryCandidateIds: ids, onlySourceIds: [...new Set(cands.filter((c) => ids.includes(c.id)).map((c) => c.sourceId))] });
    }
    if (b.mode === 'candidates') return startRun(m.window, 'retry', { runId: id, retryCandidateIds: b.candidateIds ?? [] , onlySourceIds: [...new Set(cands.filter((c) => b.candidateIds?.includes(c.id)).map((c) => c.sourceId))] });
    if (b.mode === 'source') return startRun(m.window, 'retry', { runId: id, onlySourceIds: b.sourceId ? [b.sourceId] : undefined });
    return startRun(m.window, 'retry', { runId: id, onlySourceIds: b.sourceId ? [b.sourceId] : undefined, extraLookbackHours: b.extraLookbackHours ?? 12 });
  });
  app.get('/api/runs/:id/candidates', async (req) => {
    const id = (req.params as { id: string }).id;
    const q = req.query as { state?: string; sourceId?: string; reason?: string };
    return (await stores.getCandidates(id)).filter((c) => (!q.state || c.state === q.state) && (!q.sourceId || c.sourceId === q.sourceId) && (!q.reason || c.reasonCode === q.reason));
  });
  app.get('/api/runs/:id/articles', async (req) => stores.getArticles((req.params as { id: string }).id));
  app.get('/api/runs/:id/review', async (req) => stores.getReview((req.params as { id: string }).id));
  app.patch('/api/runs/:id/reviews/:articleId', async (req) => {
    const p = req.params as { id: string; articleId: string };
    const patch = z
      .object({
        included: z.boolean().optional(), order: z.number().optional(), title: z.string().max(300).optional(), summary: z.string().max(2000).optional(),
        shortLabel: z.string().max(80).optional(), primaryCategory: z.string().nullable().optional(), assessment: z.enum(['needs_attention', 'positive', 'neutral']).nullable().optional(),
        proposal: z.string().max(600).optional(), primaryImageUrl: z.string().nullable().optional(), extractionMarkedComplete: z.boolean().optional(),
        timeVerifiedManually: z.boolean().optional(), groupId: z.string().nullable().optional(),
      })
      .parse(req.body);
    return stores.patchReview(p.id, p.articleId, patch as never);
  });

  /* ---------- export ---------- */
  const findSoffice = (s: Settings): string | null => {
    if (s.report.pdfRenderer === 'none') return null;
    const c = [s.report.libreOfficePath, 'C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe', '/usr/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'].filter(Boolean);
    return c.find((p) => existsSync(p)) ?? null;
  };
  app.get('/api/capabilities', async () => {
    const s = await stores.getSettings();
    const soffice = findSoffice(s);
    return { pdf: !!soffice, soffice, templateFile: s.report.templateFile || null, templateFidelity: false };
  });
  app.post('/api/runs/:id/export', async (req) => {
    const id = (req.params as { id: string }).id;
    const b = z.object({ formats: z.array(z.enum(['pptx', 'pdf'])).min(1), dryRun: z.boolean().default(false) }).parse(req.body);
    const m = await stores.getManifest(id);
    if (!m) throw Object.assign(new Error('RUN_NOT_FOUND'), { statusCode: 404 });
    const settings = await stores.getSettings();
    const sources = await stores.getSources();
    const articles = await stores.getArticles(id);
    const reviews = await stores.getReview(id);
    const asm = assembleStories(articles, reviews, settings);
    const fit = checkFit(asm.stories);
    if (asm.blockers.length || b.dryRun) return { ok: false, dryRun: b.dryRun, blockers: asm.blockers, warnings: [...asm.warnings, ...fit.map((f) => f.message)], stories: asm.stories.length };
    // fetch REAL article images (never generated); failures -> text-only
    const http = makeHttp(settings, sources);
    const imageNotes: string[] = [];
    const images = new Map<string, TemplateImage>();
    const stories = asm.stories.map((s) => ({ ...s, imageKey: null as string | null }));
    let tcFeatureKey: string | null = null;
    if (settings.editorial.photoPolicy !== 'link_only') {
      for (const st of stories) {
        if (!st.imageUrl || st.group === 'neutral') continue;
        const art = articles.find((a) => a.id === st.articleId);
        const cand = art?.imageCandidates.find((i) => i.url === st.imageUrl);
        if (settings.editorial.photoPolicy === 'strict_verified_only' && cand?.rightsStatus !== 'verified') {
          imageNotes.push(`${st.id}: ảnh chưa xác minh quyền – để trống theo chính sách`);
          continue;
        }
        const img = await fetchImage(http, st.imageUrl, settings.editorial.minImageWidth);
        if (img) {
          const credit = cand?.credit ? `${cand.credit}/${st.sources[0]?.name}` : st.sources[0]?.name;
          images.set(st.imageUrl, { ...img, credit, sourceUrl: st.sources[0]?.url ?? st.imageUrl });
          st.imageKey = st.imageUrl;
          st.image = { data: `data:image/${img.ext};base64,${Buffer.from(img.bytes).toString('base64')}`, caption: cand?.caption, credit };
        } else imageNotes.push(`${st.id}: không tải được ảnh gốc hợp lệ (jpeg/png, đủ kích thước) – dùng bố cục chữ`);
        // TC feature photo: a SECOND real photo from the same positive article (never a stock/AI image)
        if (st.group === 'positive' && !tcFeatureKey && art) {
          const second = art.imageCandidates.find((i) => i.url !== st.imageUrl && i.origin === 'body' && i.rightsStatus !== 'not_usable');
          if (second) {
            const f = await fetchImage(http, second.url, settings.editorial.minImageWidth);
            if (f) {
              images.set(second.url, { ...f, credit: second.credit ? `${second.credit}/${st.sources[0]?.name}` : st.sources[0]?.name, sourceUrl: st.sources[0]?.url ?? second.url });
              tcFeatureKey = second.url;
            }
          }
        }
      }
    }
    const date = vnDate(new Date(m.window.to));
    const hhmm = (iso: string) => iso.slice(11, 16).replace(':', '');
    const base = settings.report.filenamePattern
      .replace('{date}', date)
      .replace('{from}', hhmm(m.window.from))
      .replace('{to}', hhmm(m.window.to))
      .replace(/[^\w.-]+/g, '_');
    const stamp = Date.now().toString(36);
    const dir = safeJoin(paths.exports, date);
    const [y, mo, d] = date.split('-');
    let pptx: Uint8Array;
    let templateUsed = 'DEMO (pptxgenjs) – chưa có mẫu PPTX gốc';
    const tplFile = settings.report.templateFile ? safeJoin(paths.templates, settings.report.templateFile) : null;
    if (tplFile && existsSync(tplFile)) {
      const tplBytes = await fs.readFile(tplFile);
      try {
        const coverImageKey = stories.find((s) => s.group === 'needs_attention' && s.imageKey)?.imageKey ?? stories.find((s) => s.imageKey)?.imageKey ?? null;
        const r = await buildFromTemplate(tplBytes, {
          organization: settings.report.organization, reportDate: date, stories, images, coverImageKey, tcFeatureKey,
          contactEmail: settings.report.contactEmail,
        });
        pptx = r.bytes;
        imageNotes.push(...r.notes);
        templateUsed = `${settings.report.templateFile} (sha256 ${createHash('sha256').update(tplBytes).digest('hex').slice(0, 16)})`;
      } catch (e) {
        if (!(e instanceof TemplateMismatchError)) throw e;
        throw Object.assign(new Error(`BLOCKED – mẫu PPTX không khớp cấu trúc đã khảo sát: ${e.message}`), { statusCode: 422 });
      }
    } else {
      imageNotes.push('Chưa có mẫu PPTX gốc (Cài đặt › Báo cáo & mẫu) – đã xuất bằng bố cục DEMO.');
      pptx = await buildReportPptx({
        organization: settings.report.organization, window: m.window, reportDateLabel: `${d}/${mo}/${y}`, stories,
        storiesPerPage: settings.report.storiesPerPage, contactEmail: settings.report.contactEmail, isDemoTemplate: true,
      });
    }
    const pptxName = `${base}_${stamp}.pptx`;
    await writeFileAtomic(path.join(dir, pptxName), pptx);
    const files = [pptxName];
    let pdfStatus = 'not_requested';
    if (b.formats.includes('pdf')) {
      const soffice = findSoffice(settings);
      if (!soffice) pdfStatus = 'unavailable: chưa cài LibreOffice (cài LibreOffice rồi chọn đường dẫn trong Cài đặt › Báo cáo)';
      else {
        pdfStatus = await new Promise<string>((res) =>
          execFile(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', dir, path.join(dir, pptxName)], { timeout: 120_000 }, (err) =>
            res(err ? `failed: ${err.message}` : 'ok'),
          ),
        );
        if (pdfStatus === 'ok') files.push(pptxName.replace(/\.pptx$/, '.pdf'));
      }
    }
    const manifest = {
      exportId: `${date}/${pptxName}`, runId: id, window: m.window, createdAt: new Date().toISOString(), template: templateUsed,
      stories: stories.map((s) => ({ id: s.id, articleId: s.articleId, group: s.group, title: s.title, sources: s.sources, image: s.imageUrl, imageEmbedded: !!s.imageKey })),
      warnings: [...asm.warnings, ...fit.map((f) => f.message), ...imageNotes], pdfStatus, files,
    };
    await writeJsonAtomic(path.join(dir, `${base}_${stamp}_manifest.json`), manifest);
    files.push(`${base}_${stamp}_manifest.json`);
    return { ok: true, files: files.map((f) => `${date}/${f}`), pdfStatus, warnings: manifest.warnings };
  });
  app.post('/api/templates', async (req) => {
    const b = z.object({ name: z.string().regex(/^[\p{L}\p{N} ._()-]+\.pptx$/u, 'Chỉ nhận tệp .pptx'), base64: z.string().max(40_000_000) }).parse(req.body);
    const buf = Buffer.from(b.base64, 'base64');
    if (buf.subarray(0, 2).toString() !== 'PK') throw Object.assign(new Error('Tệp không phải PPTX hợp lệ'), { statusCode: 400 });
    const safe = `${Date.now()}_${b.name.replace(/[^\w.-]+/g, '_')}`;
    await writeFileAtomic(safeJoin(paths.templates, safe), buf); // original kept untouched; copies only
    const s = await stores.getSettings();
    await stores.saveSettings({ ...s, report: { ...s.report, templateFile: safe } }, `Tải mẫu PPTX ${b.name}`);
    return { templateFile: safe };
  });
  app.get('/api/exports/*', async (req, reply) => {
    const rel = (req.params as { '*': string })['*'];
    if (!/^\d{4}-\d{2}-\d{2}\/[\w.-]+\.(pptx|pdf|json)$/.test(rel)) return reply.code(400).send({ error: 'INVALID_EXPORT_PATH' });
    const [d, f] = rel.split('/') as [string, string];
    const full = safeJoin(paths.exports, d, f);
    const buf = await fs.readFile(full);
    const type = f.endsWith('.pptx') ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : f.endsWith('.pdf') ? 'application/pdf' : 'application/json';
    return reply.header('Content-Type', type).header('Content-Disposition', `attachment; filename="${f}"`).send(buf);
  });

  /* ---------- static SPA ---------- */
  if (o.webDist && existsSync(o.webDist)) {
    await app.register(fastifyStatic, { root: o.webDist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'NOT_FOUND' }) : reply.sendFile('index.html')));
  }

  return { app, stores, token };
}

/** Download a REAL article photo (jpeg/png only), SSRF-checked, validated by magic bytes and dimensions. */
async function fetchImage(http: HttpClient, url: string, minWidth: number): Promise<{ bytes: Uint8Array; ext: 'jpeg' | 'png'; width: number; height: number } | null> {
  const blocked = await http.assertPublic(url);
  if (blocked) return null;
  try {
    const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 HCMNewsReporter/0.1', Accept: 'image/jpeg,image/png;q=0.9' }, signal: AbortSignal.timeout(15000) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      return loc ? fetchImage(http, new URL(loc, url).toString(), minWidth) : null;
    }
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 8_000 || buf.length > 8_000_000) return null; // tracking pixel / oversized
    const size = imageSize(buf);
    if (!size || size.width < minWidth || size.width / size.height > 4 || size.height / size.width > 4) return null;
    return { bytes: buf, ...size };
  } catch {
    return null;
  }
}
