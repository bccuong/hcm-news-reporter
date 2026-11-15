import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { defaultSettings, defaultSources } from '../domain/defaults.js';
import { SettingsSchema, SourceSchema, type Article, type Candidate, type ReviewDecision, type RunManifest, type Settings, type Source } from '../domain/schemas.js';
import { appendJsonl, readJson, readJsonl, safeJoin, serialized, writeJsonAtomic } from './files.js';

export interface DataPaths {
  root: string;
  config: string;
  data: string;
  exports: string;
  cache: string;
  templates: string;
}

export function makePaths(root: string): DataPaths {
  return {
    root,
    config: path.join(root, 'config'),
    data: path.join(root, 'data'),
    exports: path.join(root, 'exports'),
    cache: path.join(root, 'cache'),
    templates: path.join(root, 'templates', 'user'),
  };
}

const SourcesFile = z.object({ schemaVersion: z.literal(3), sources: z.array(SourceSchema) });

export interface HistoryEntry {
  id: string;
  at: string;
  kind: 'settings' | 'sources';
  summary: string;
}

export class Stores {
  constructor(readonly p: DataPaths, private readonly seedWebsitesTxt: string) {}

  private get settingsFile() {
    return path.join(this.p.config, 'settings.json');
  }
  private get sourcesFile() {
    return path.join(this.p.config, 'sources.json');
  }
  private get historyDir() {
    return path.join(this.p.config, 'history');
  }

  /* ---------------- settings ---------------- */
  async getSettings(): Promise<Settings> {
    const raw = await readJson<unknown>(this.settingsFile);
    if (!raw) {
      const s = defaultSettings();
      await writeJsonAtomic(this.settingsFile, s);
      return s;
    }
    const parsed = SettingsSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    // migration/validation failure: preserve original copy, fall back to defaults merged
    await writeJsonAtomic(path.join(this.historyDir, `settings.invalid.${Date.now()}.json`), raw);
    return defaultSettings();
  }

  async saveSettings(next: unknown, summary = 'Cập nhật cài đặt'): Promise<Settings> {
    const s = SettingsSchema.parse(next);
    return serialized('settings', async () => {
      const prev = await readJson<unknown>(this.settingsFile);
      if (prev) await this.snapshot('settings', prev, summary);
      await writeJsonAtomic(this.settingsFile, s);
      return s;
    });
  }

  /* ---------------- sources ---------------- */
  async getSources(): Promise<Source[]> {
    const raw = await readJson<unknown>(this.sourcesFile);
    if (!raw) {
      const seeded = defaultSources(this.seedWebsitesTxt);
      await writeJsonAtomic(this.sourcesFile, { schemaVersion: 3, sources: seeded });
      return seeded;
    }
    return SourcesFile.parse(raw).sources;
  }

  async saveSources(list: unknown, summary = 'Cập nhật nguồn tin'): Promise<Source[]> {
    const sources = z.array(SourceSchema).parse(list);
    const ids = new Set<string>();
    for (const s of sources) {
      if (ids.has(s.id)) throw new Error(`Trùng mã nguồn: ${s.id}`);
      ids.add(s.id);
    }
    return serialized('sources', async () => {
      const prev = await readJson<unknown>(this.sourcesFile);
      if (prev) await this.snapshot('sources', prev, summary);
      await writeJsonAtomic(this.sourcesFile, { schemaVersion: 3, sources });
      return sources;
    });
  }

  /* ---------------- history / backup ---------------- */
  private async snapshot(kind: 'settings' | 'sources', value: unknown, summary: string) {
    const id = `${Date.now()}-${kind}`;
    await writeJsonAtomic(path.join(this.historyDir, `${id}.json`), { id, at: new Date().toISOString(), kind, summary, value });
  }

  async listHistory(): Promise<HistoryEntry[]> {
    let files: string[] = [];
    try {
      files = (await fs.readdir(this.historyDir)).filter((f) => /^\d+-(settings|sources)\.json$/.test(f));
    } catch {
      return [];
    }
    const out: HistoryEntry[] = [];
    for (const f of files.sort().reverse().slice(0, 100)) {
      const j = await readJson<HistoryEntry & { value: unknown }>(path.join(this.historyDir, f));
      if (j) out.push({ id: j.id, at: j.at, kind: j.kind, summary: j.summary });
    }
    return out;
  }

  async rollback(id: string): Promise<void> {
    if (!/^\d+-(settings|sources)$/.test(id)) throw new Error('INVALID_HISTORY_ID');
    const j = await readJson<{ kind: 'settings' | 'sources'; value: unknown }>(safeJoin(this.historyDir, `${id}.json`));
    if (!j) throw new Error('HISTORY_NOT_FOUND');
    if (j.kind === 'settings') await this.saveSettings(j.value, `Khôi phục phiên bản ${id}`);
    else await this.saveSources((j.value as { sources: unknown }).sources, `Khôi phục phiên bản ${id}`);
  }

  async exportBackup() {
    return { kind: 'hcm-news-reporter-backup', exportedAt: new Date().toISOString(), settings: await this.getSettings(), sources: await this.getSources() };
  }

  /* ---------------- runs ---------------- */
  runDir(runId: string) {
    if (!/^run_[0-9a-z_-]+$/i.test(runId)) throw new Error('INVALID_RUN_ID');
    return safeJoin(path.join(this.p.data, 'runs'), runId);
  }

  async saveManifest(m: RunManifest) {
    await serialized(`manifest:${m.runId}`, () => writeJsonAtomic(path.join(this.runDir(m.runId), 'manifest.json'), m));
  }
  async getManifest(runId: string) {
    return readJson<RunManifest>(path.join(this.runDir(runId), 'manifest.json'));
  }
  async listRuns(): Promise<RunManifest[]> {
    let dirs: string[] = [];
    try {
      dirs = await fs.readdir(path.join(this.p.data, 'runs'));
    } catch {
      return [];
    }
    const out: RunManifest[] = [];
    for (const d of dirs) {
      try {
        const m = await this.getManifest(d);
        if (m) out.push(m);
      } catch {
        /* skip invalid */
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Candidates are rewritten whole per checkpoint (bounded size per run), atomically. */
  async saveCandidates(runId: string, list: Candidate[]) {
    await serialized(`cand:${runId}`, () =>
      writeJsonAtomic(path.join(this.runDir(runId), 'candidates.json'), list),
    );
  }
  async getCandidates(runId: string) {
    return (await readJson<Candidate[]>(path.join(this.runDir(runId), 'candidates.json'))) ?? [];
  }

  async appendArticles(runId: string, list: Article[]) {
    await serialized(`art:${runId}`, () => appendJsonl(path.join(this.runDir(runId), 'articles.jsonl'), list));
  }
  async getArticles(runId: string): Promise<Article[]> {
    const rows = await readJsonl<Article>(path.join(this.runDir(runId), 'articles.jsonl'));
    // last write wins per id (re-extraction appends)
    const map = new Map<string, Article>();
    for (const r of rows) map.set(r.id, r);
    return [...map.values()];
  }

  /* ---------------- reviews ---------------- */
  private reviewFile(runId: string) {
    this.runDir(runId); // validates id
    return path.join(this.p.data, 'reviews', `${runId}.json`);
  }
  async getReview(runId: string): Promise<Record<string, ReviewDecision>> {
    return (await readJson<Record<string, ReviewDecision>>(this.reviewFile(runId))) ?? {};
  }
  async patchReview(runId: string, articleId: string, patch: Partial<ReviewDecision>): Promise<ReviewDecision> {
    return serialized(`review:${runId}`, async () => {
      const all = await this.getReview(runId);
      const now = new Date().toISOString();
      const prev: ReviewDecision = all[articleId] ?? { articleId, included: false, order: Object.keys(all).length, updatedAt: now, changes: [] };
      const changes = [...prev.changes];
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'changes' || k === 'articleId' || k === 'updatedAt') continue;
        const old = (prev as unknown as Record<string, unknown>)[k];
        if (JSON.stringify(old) !== JSON.stringify(v)) changes.push({ at: now, field: k, from: old ?? null, to: v });
      }
      const next: ReviewDecision = { ...prev, ...patch, articleId, updatedAt: now, changes: changes.slice(-200) };
      all[articleId] = next;
      await writeJsonAtomic(this.reviewFile(runId), all);
      return next;
    });
  }
}
