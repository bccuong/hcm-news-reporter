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
import { computeRelevanceQuality } from '../domain/quality.js';
import { judgeRelevance } from '../domain/relevance.js';
import { evaluateRule, validateRule } from '../domain/rules.js';
import { DEFAULT_PROFILE_ID, RuleNodeSchema, SourceSchema, type Settings, type Source } from '../domain/schemas.js';
import { lastCompletedWindow, validateWindow, vnDate, type ReportWindow } from '../domain/timeWindow.js';
import { checkPublicUrl } from '../domain/url.js';
import { assembleStories } from '../reports/assemble.js';
import { buildReportPptx, checkFit } from '../reports/pptx.js';
import { buildStyledPptx } from '../reports/styles.js';
import { templateById, TEMPLATES, UPLOAD_TEMPLATE_ID } from '../reports/templates.js';
import { fileURLToPath } from 'node:url';
import { safeJoin, serialized, writeFileAtomic, writeJsonAtomic } from '../storage/files.js';
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
const POWERPOINT_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'pptx-to-pdf-powerpoint.ps1');

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

  /** built-in .pptx templates: the app's web/public/templates (dev) or the built copy next to the SPA */
  const templateDirs = [...(o.webDist ? [path.join(o.webDist, 'templates')] : []), path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'public', 'templates')];
  const templatesFile = (name: string) => templateDirs.map((d2) => path.join(d2, name)).find((f) => existsSync(f)) ?? null;

  /* ---------- profiles (cấu hình theo địa bàn) ---------- */
  /** a deleted profile falls back to the active one (old runs stay readable/exportable) */
  const profileOrActive = async (id?: string) => {
    const idx = await stores.getProfiles();
    return id && idx.profiles.some((p) => p.id === id) ? id : idx.activeId;
  };
  app.get('/api/profiles', async () => stores.getProfiles());
  app.post('/api/profiles', async (req) => {
    const meta = await stores.createProfile(req.body);
    if ((req.body as { activate?: boolean }).activate) await stores.setActiveProfile(meta.id);
    return meta;
  });
  app.patch('/api/profiles/:id', async (req) => {
    const b = z.object({ name: z.string().trim().min(1).max(60).optional(), description: z.string().max(300).optional(), autoCollect: z.boolean().optional() }).parse(req.body);
    return stores.updateProfile((req.params as { id: string }).id, b);
  });
  app.post('/api/profiles/:id/activate', async (req) => {
    await stores.setActiveProfile((req.params as { id: string }).id);
    return stores.getProfiles();
  });
  app.delete('/api/profiles/:id', async (req) => {
    await stores.deleteProfile((req.params as { id: string }).id);
    return stores.getProfiles();
  });

  /* ---------- settings (active profile) ---------- */
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

  const startRun = async (window: ReportWindow, trigger: 'manual' | 'auto' | 'retry', extra: { runId?: string; onlySourceIds?: string[]; retryCandidateIds?: string[]; extraLookbackHours?: number; profileId?: string } = {}) => {
    const err = validateWindow(window);
    if (err) throw Object.assign(new Error(err), { statusCode: 400 });
    const runId = extra.runId ?? `run_${vnDate(new Date(window.to)).replace(/-/g, '')}_${Date.now().toString(36)}`;
    if (active.has(runId)) throw Object.assign(new Error('Lượt chạy đang hoạt động'), { statusCode: 409 });
    // a run always uses ONE profile's configuration: the active one for new runs, the run's own for retries
    const profileId = await profileOrActive(extra.profileId);
    const settings = await stores.getSettings(profileId);
    const sources = await stores.getSources(profileId);
    const ctl = new AbortController();
    const events = new EventEmitter();
    events.setMaxListeners(50);
    const done = runCollection({ runId, window, trigger, settings, sources, stores, http: makeHttp(settings, sources), signal: ctl.signal, events, ...extra, profileId })
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
      const pidNow = await stores.activeProfileId();
      if (s.startup.oncePerWindow && runs.some((r) => (r.profileId ?? DEFAULT_PROFILE_ID) === pidNow && r.window.from === b.window.from && r.window.to === b.window.to)) return { skipped: 'ALREADY_COLLECTED' };
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
      return startRun(m.window, 'retry', { profileId: m.profileId ?? DEFAULT_PROFILE_ID, runId: id, retryCandidateIds: ids, onlySourceIds: [...new Set(cands.filter((c) => ids.includes(c.id)).map((c) => c.sourceId))] });
    }
    if (b.mode === 'candidates') return startRun(m.window, 'retry', { profileId: m.profileId ?? DEFAULT_PROFILE_ID, runId: id, retryCandidateIds: b.candidateIds ?? [] , onlySourceIds: [...new Set(cands.filter((c) => b.candidateIds?.includes(c.id)).map((c) => c.sourceId))] });
    if (b.mode === 'source') return startRun(m.window, 'retry', { profileId: m.profileId ?? DEFAULT_PROFILE_ID, runId: id, onlySourceIds: b.sourceId ? [b.sourceId] : undefined });
    return startRun(m.window, 'retry', { profileId: m.profileId ?? DEFAULT_PROFILE_ID, runId: id, onlySourceIds: b.sourceId ? [b.sourceId] : undefined, extraLookbackHours: b.extraLookbackHours ?? 12 });
  });
  app.get('/api/runs/:id/candidates', async (req) => {
    const id = (req.params as { id: string }).id;
    const q = req.query as { state?: string; sourceId?: string; reason?: string };
    return (await stores.getCandidates(id)).filter((c) => (!q.state || c.state === q.state) && (!q.sourceId || c.sourceId === q.sourceId) && (!q.reason || c.reasonCode === q.reason));
  });
  app.get('/api/runs/:id/articles', async (req) => stores.getArticles((req.params as { id: string }).id));
  /** Filter quality measured on editor labels across stored runs (most recent first, up to ?limit=30). */
  app.get('/api/quality/relevance', async (req) => {
    const limit = Math.min(200, Number((req.query as { limit?: string }).limit ?? 30) || 30);
    const runs = (await stores.listRuns()).filter((r) => r.status === 'completed').slice(0, limit);
    const data = [];
    for (const m of runs) data.push({ manifest: m, candidates: await stores.getCandidates(m.runId), articles: await stores.getArticles(m.runId), reviews: await stores.getReview(m.runId) });
    return computeRelevanceQuality(data);
  });
  app.get('/api/runs/:id/review', async (req) => stores.getReview((req.params as { id: string }).id));
  app.patch('/api/runs/:id/reviews/:articleId', async (req) => {
    const p = req.params as { id: string; articleId: string };
    const patch = z
      .object({
        included: z.boolean().optional(), order: z.number().optional(), title: z.string().max(300).optional(), summary: z.string().max(2000).optional(),
        shortLabel: z.string().max(80).optional(), primaryCategory: z.string().nullable().optional(), assessment: z.enum(['needs_attention', 'positive', 'neutral']).nullable().optional(),
        proposal: z.string().max(600).optional(), primaryImageUrl: z.string().nullable().optional(), extractionMarkedComplete: z.boolean().optional(),
        timeVerifiedManually: z.boolean().optional(), groupId: z.string().nullable().optional(),
        relevanceLabel: z.enum(['relevant', 'irrelevant']).nullable().optional(),
        reviewNote: z.string().max(1000).optional(),
      })
      .parse(req.body);
    return stores.patchReview(p.id, p.articleId, patch as never);
  });

  /* ---------- export ---------- */
  const findSoffice = (s: Settings): string | null => {
    if (s.report.pdfRenderer === 'none' || s.report.pdfRenderer === 'powerpoint') return null;
    const c = [s.report.libreOfficePath, 'C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe', '/usr/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'].filter(Boolean);
    return c.find((p) => existsSync(p)) ?? null;
  };
  const findPowerPoint = (s: Settings): string | null => {
    if (process.platform !== 'win32' || s.report.pdfRenderer === 'none' || s.report.pdfRenderer === 'libreoffice') return null;
    const c = [s.report.powerPointPath, 'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\POWERPNT.EXE', 'C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE'].filter(Boolean);
    return c.find((p) => existsSync(p)) ?? null;
  };
  /** PDF: Microsoft PowerPoint (COM, highest fidelity on Windows) first, then LibreOffice. */
  const convertPdf = async (s: Settings, dir: string, pptxName: string): Promise<{ status: string; renderer: string | null }> => {
    const pdfPath = path.join(dir, pptxName.replace(/\.pptx$/, '.pdf'));
    if (findPowerPoint(s)) {
      const r = await serialized('powerpoint', () =>
        new Promise<string>((res) =>
          execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', POWERPOINT_SCRIPT, '-In', path.join(dir, pptxName), '-Out', pdfPath], { timeout: 180_000, windowsHide: true }, (err, stdout) =>
            res(err ? `failed: ${String(stdout || err.message).trim()}` : String(stdout).trim()),
          ),
        ),
      );
      if (r.startsWith('OK') && existsSync(pdfPath)) return { status: 'ok', renderer: `Microsoft PowerPoint (${r})` };
      if (s.report.pdfRenderer === 'powerpoint') return { status: `failed: PowerPoint – ${r}`, renderer: null };
    }
    const soffice = findSoffice(s);
    if (!soffice) return { status: 'unavailable: chưa có Microsoft PowerPoint hoặc LibreOffice (chọn đường dẫn trong Cài đặt › Báo cáo)', renderer: null };
    const r = await new Promise<string>((res) =>
      execFile(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', dir, path.join(dir, pptxName)], { timeout: 120_000 }, (err) => res(err ? `failed: ${err.message}` : 'ok')),
    );
    return { status: r, renderer: r === 'ok' ? 'LibreOffice' : null };
  };
  app.get('/api/capabilities', async () => {
    const s = await stores.getSettings();
    const soffice = findSoffice(s);
    const powerpoint = findPowerPoint(s);
    return { pdf: !!(soffice || powerpoint), soffice, powerpoint, templateFile: s.report.templateFile || null, templateFidelity: !!s.report.templateFile, templateId: s.report.templateId };
  });
  /** built-in templates (Department template from the Skill + 4 original designs) and the uploaded one, if any */
  app.get('/api/templates', async () => {
    const s = await stores.getSettings();
    return {
      defaultId: s.report.templateId,
      templates: [
        ...TEMPLATES.map((t) => ({ ...t, available: t.kind !== 'original-pptx' || !!templatesFile(t.file!) })),
        ...(s.report.templateFile ? [{ id: UPLOAD_TEMPLATE_ID, name: `Mẫu đã tải lên (${s.report.templateFile.replace(/^\d+_/, '')})`, kind: 'upload', orientation: 'portrait', description: 'Tệp .pptx cùng cấu trúc mẫu Sở, tải lên ở Cài đặt › Báo cáo & mẫu.', available: true }] : []),
      ],
    };
  });
  app.post('/api/runs/:id/export', async (req) => {
    const id = (req.params as { id: string }).id;
    const b = z.object({ formats: z.array(z.enum(['pptx', 'pdf'])).min(1), dryRun: z.boolean().default(false), templateId: z.string().max(60).optional() }).parse(req.body);
    const m = await stores.getManifest(id);
    if (!m) throw Object.assign(new Error('RUN_NOT_FOUND'), { statusCode: 404 });
    // report settings (organization, template…) of the profile the run was collected with
    const runProfile = await profileOrActive(m.profileId ?? DEFAULT_PROFILE_ID);
    const settings = await stores.getSettings(runProfile);
    const sources = await stores.getSources(runProfile);
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
        // the photo may come from a merged article: credit THAT publisher, link THAT article
        const owner = [st.articleId, ...st.mergedArticleIds].map((id) => articles.find((a) => a.id === id)).find((a) => a?.imageCandidates.some((i) => i.url === st.imageUrl));
        const cand = owner?.imageCandidates.find((i) => i.url === st.imageUrl);
        if (settings.editorial.photoPolicy === 'strict_verified_only' && cand?.rightsStatus !== 'verified') {
          imageNotes.push(`${st.id}: ảnh chưa xác minh quyền – để trống theo chính sách`);
          continue;
        }
        const img = await fetchImage(http, st.imageUrl, settings.editorial.minImageWidth);
        if (img) {
          const pub = owner?.sourceName ?? st.sources[0]?.name;
          const credit = cand?.credit ? `${cand.credit}/${pub}` : pub;
          images.set(st.imageUrl, { ...img, credit, sourceUrl: owner?.canonicalUrl ?? owner?.originalUrl ?? st.sources[0]?.url ?? st.imageUrl });
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
    // template chosen in the export panel (default: Cài đặt › Báo cáo & mẫu), see src/reports/templates.ts
    const wanted = b.templateId ?? (settings.report.templateFile && !settings.report.templateId ? UPLOAD_TEMPLATE_ID : settings.report.templateId);
    const tpl = wanted === UPLOAD_TEMPLATE_ID ? null : templateById(wanted);
    let templateUsed = '';
    const fillTemplate = async (tplBytes: Uint8Array, label: string) => {
      try {
        const coverImageKey = stories.find((s) => s.group === 'needs_attention' && s.imageKey)?.imageKey ?? stories.find((s) => s.imageKey)?.imageKey ?? null;
        const r = await buildFromTemplate(tplBytes, {
          organization: settings.report.organization, reportDate: date, stories, images, coverImageKey, tcFeatureKey,
          contactEmail: settings.report.contactEmail,
        });
        imageNotes.push(...r.notes);
        templateUsed = `${label} (sha256 ${createHash('sha256').update(tplBytes).digest('hex').slice(0, 16)})`;
        return r.bytes;
      } catch (e) {
        if (!(e instanceof TemplateMismatchError)) throw e;
        throw Object.assign(new Error(`BLOCKED – mẫu PPTX không khớp cấu trúc đã khảo sát: ${e.message}`), { statusCode: 422 });
      }
    };
    if (!tpl) {
      const up = settings.report.templateFile ? safeJoin(paths.templates, settings.report.templateFile) : null;
      if (!up || !existsSync(up)) throw Object.assign(new Error('Chưa tải mẫu PPTX lên (Cài đặt › Báo cáo & mẫu)'), { statusCode: 400 });
      pptx = await fillTemplate(await fs.readFile(up), settings.report.templateFile);
    } else if (tpl.kind === 'original-pptx' && templatesFile(tpl.file!)) {
      pptx = await fillTemplate(await fs.readFile(templatesFile(tpl.file!)!), tpl.name);
    } else if (tpl.kind === 'style') {
      pptx = await buildStyledPptx(tpl.style!, {
        organization: settings.report.organization, window: m.window, reportDateLabel: `${d}/${mo}/${y}`, stories,
        storiesPerPage: settings.report.storiesPerPage, contactEmail: settings.report.contactEmail, regionName: settings.location.regionName,
      });
      templateUsed = `${tpl.name} (mẫu gốc của ứng dụng)`;
    } else {
      imageNotes.push(`Không tìm thấy tệp mẫu "${tpl.name}" – đã xuất bằng bố cục DEMO.`);
      templateUsed = 'DEMO (pptxgenjs)';
      pptx = await buildReportPptx({
        organization: settings.report.organization, window: m.window, reportDateLabel: `${d}/${mo}/${y}`, stories,
        storiesPerPage: settings.report.storiesPerPage, contactEmail: settings.report.contactEmail, isDemoTemplate: true,
      });
    }    const pptxName = `${base}_${stamp}.pptx`;
    await writeFileAtomic(path.join(dir, pptxName), pptx);
    const files = [pptxName];
    let pdfStatus = 'not_requested';
    let pdfRenderer: string | null = null;
    if (b.formats.includes('pdf')) {
      const r = await convertPdf(settings, dir, pptxName);
      pdfStatus = r.status;
      pdfRenderer = r.renderer;
      if (pdfStatus === 'ok') files.push(pptxName.replace(/\.pptx$/, '.pdf'));
    }
    const manifest = {
      exportId: `${date}/${pptxName}`, runId: id, window: m.window, createdAt: new Date().toISOString(), template: templateUsed,
      stories: stories.map((s) => ({ id: s.id, articleId: s.articleId, mergedArticleIds: s.mergedArticleIds, group: s.group, title: s.title, sources: s.sources, image: s.imageUrl, imageEmbedded: !!s.imageKey })),
      warnings: [...asm.warnings, ...fit.map((f) => f.message), ...imageNotes], pdfStatus, pdfRenderer, files,
    };
    await writeJsonAtomic(path.join(dir, `${base}_${stamp}_manifest.json`), manifest);
    files.push(`${base}_${stamp}_manifest.json`);
    return { ok: true, files: files.map((f) => `${date}/${f}`), pdfStatus, pdfRenderer, warnings: manifest.warnings };
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
