import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { defaultSettings, defaultSources, settingsForNewRegion } from '../domain/defaults.js';
import { DEFAULT_PROFILE_ID, NewProfileSchema, ProfileIdSchema, ProfileMetaSchema, SettingsSchema, SourceSchema, type ProfileMeta, type Article, type Candidate, type ReviewDecision, type RunManifest, type Settings, type Source } from '../domain/schemas.js';
import { slugify } from '../domain/text.js';
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
const ProfilesFile = z.object({ schemaVersion: z.literal(1), activeId: ProfileIdSchema, profiles: z.array(ProfileMetaSchema).min(1) });
type ProfilesIndex = z.infer<typeof ProfilesFile>;

export interface HistoryEntry {
  id: string;
  at: string;
  kind: 'settings' | 'sources';
  summary: string;
}

/**
 * Configuration is stored per PROFILE (cấu hình theo địa bàn): config/profiles/<id>/{settings,sources}.json + history/.
 * config/profiles.json lists the profiles and the active one. Every settings/sources call without a profile id works on
 * the ACTIVE profile, so the collector, rules and report code need no profile awareness.
 * Installs from before profiles: config/settings.json + sources.json + history/ are COPIED into the default "TP.HCM"
 * profile on first use (originals left in place).
 */
export class Stores {
  constructor(readonly p: DataPaths, private readonly seedWebsitesTxt: string) {}

  private get profilesFile() {
    return path.join(this.p.config, 'profiles.json');
  }
  private profileDir(id: string) {
    ProfileIdSchema.parse(id);
    return safeJoin(path.join(this.p.config, 'profiles'), id);
  }
  private settingsFile(id: string) {
    return path.join(this.profileDir(id), 'settings.json');
  }
  private sourcesFile(id: string) {
    return path.join(this.profileDir(id), 'sources.json');
  }
  private historyDir(id: string) {
    return path.join(this.profileDir(id), 'history');
  }

  /* ---------------- profiles ---------------- */
  async getProfiles(): Promise<ProfilesIndex> {
    return serialized('profiles', async () => {
      const raw = await readJson<unknown>(this.profilesFile);
      if (raw) return ProfilesFile.parse(raw);
      // first use: migrate the single pre-profile configuration into the default profile
      const now = new Date().toISOString();
      const id = DEFAULT_PROFILE_ID;
      const legacyS = await readJson<unknown>(path.join(this.p.config, 'settings.json'));
      const legacySrc = await readJson<unknown>(path.join(this.p.config, 'sources.json'));
      if (legacyS) await writeJsonAtomic(this.settingsFile(id), legacyS);
      if (legacySrc) await writeJsonAtomic(this.sourcesFile(id), legacySrc);
      try {
        for (const f of await fs.readdir(path.join(this.p.config, 'history'))) {
          await fs.mkdir(this.historyDir(id), { recursive: true });
          await fs.copyFile(path.join(this.p.config, 'history', f), path.join(this.historyDir(id), f));
        }
      } catch {
        /* no history yet */
      }
      const idx: ProfilesIndex = {
        schemaVersion: 1, activeId: id,
        profiles: [{ id, name: 'TP.HCM', description: 'Cấu hình mặc định: ngành xây dựng TP.HCM (từ Skill)', autoCollect: true, clonedFrom: null, createdAt: now, updatedAt: now }],
      };
      await writeJsonAtomic(this.profilesFile, idx);
      return idx;
    });
  }
  private async saveProfiles(idx: ProfilesIndex) {
    await writeJsonAtomic(this.profilesFile, ProfilesFile.parse(idx));
  }
  async activeProfileId(): Promise<string> {
    return (await this.getProfiles()).activeId;
  }
  private async pid(id?: string) {
    const idx = await this.getProfiles();
    const want = id ?? idx.activeId;
    if (!idx.profiles.some((p) => p.id === want)) throw Object.assign(new Error(`Không có cấu hình "${want}"`), { statusCode: 404 });
    return want;
  }

  /** new profile: clone an existing one, or start from the defaults for a new region */
  async createProfile(input: unknown): Promise<ProfileMeta> {
    const n = NewProfileSchema.parse(input);
    const idx = await this.getProfiles();
    let settings: Settings;
    let sources: Source[];
    if (n.cloneFrom) {
      settings = await this.getSettings(await this.pid(n.cloneFrom));
      sources = await this.getSources(n.cloneFrom);
    } else {
      if (!n.regionName) throw Object.assign(new Error('Nhập tên địa bàn (ví dụ: Hà Nội) hoặc chọn cấu hình để sao chép'), { statusCode: 400 });
      settings = settingsForNewRegion(n.regionName, n.regionAliases);
      sources = defaultSources(this.seedWebsitesTxt);
    }
    let id = slugify(n.name) || 'cau-hinh';
    for (let k = 2; idx.profiles.some((p) => p.id === id); k++) id = `${slugify(n.name).slice(0, 36) || 'cau-hinh'}-${k}`;
    const now = new Date().toISOString();
    const meta: ProfileMeta = { id, name: n.name, description: n.description, autoCollect: false, clonedFrom: n.cloneFrom, createdAt: now, updatedAt: now };
    await writeJsonAtomic(this.settingsFile(id), settings);
    await writeJsonAtomic(this.sourcesFile(id), { schemaVersion: 3, sources });
    await serialized('profiles', async () => {
      const cur = ProfilesFile.parse(await readJson<unknown>(this.profilesFile));
      cur.profiles.push(meta);
      await this.saveProfiles(cur);
    });
    return meta;
  }
  async updateProfile(id: string, patch: { name?: string; description?: string; autoCollect?: boolean }): Promise<ProfileMeta> {
    await this.pid(id);
    return serialized('profiles', async () => {
      const cur = ProfilesFile.parse(await readJson<unknown>(this.profilesFile));
      const i = cur.profiles.findIndex((p) => p.id === id);
      const next = ProfileMetaSchema.parse({ ...cur.profiles[i], ...patch, updatedAt: new Date().toISOString() });
      cur.profiles[i] = next;
      await this.saveProfiles(cur);
      return next;
    });
  }
  async setActiveProfile(id: string) {
    await this.pid(id);
    await serialized('profiles', async () => {
      const cur = ProfilesFile.parse(await readJson<unknown>(this.profilesFile));
      await this.saveProfiles({ ...cur, activeId: id });
    });
  }
  /** files are kept (moved to config/profiles-deleted/) so a mistaken delete can be recovered by hand */
  async deleteProfile(id: string) {
    await this.pid(id);
    await serialized('profiles', async () => {
      const cur = ProfilesFile.parse(await readJson<unknown>(this.profilesFile));
      if (cur.profiles.length <= 1) throw Object.assign(new Error('Phải còn ít nhất một cấu hình'), { statusCode: 400 });
      const rest = cur.profiles.filter((p) => p.id !== id);
      await this.saveProfiles({ ...cur, profiles: rest, activeId: cur.activeId === id ? rest[0]!.id : cur.activeId });
      const bin = path.join(this.p.config, 'profiles-deleted');
      await fs.mkdir(bin, { recursive: true });
      await fs.rename(this.profileDir(id), path.join(bin, `${id}-${Date.now()}`)).catch(() => undefined);
    });
  }

  /* ---------------- settings (per profile; default = active) ---------------- */
  async getSettings(profileId?: string): Promise<Settings> {
    const id = await this.pid(profileId);
    const raw = await readJson<unknown>(this.settingsFile(id));
    if (!raw) {
      const s = defaultSettings();
      await writeJsonAtomic(this.settingsFile(id), s);
      return s;
    }
    const parsed = SettingsSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    // migration/validation failure: preserve original copy, fall back to defaults merged
    await writeJsonAtomic(path.join(this.historyDir(id), `settings.invalid.${Date.now()}.json`), raw);
    return defaultSettings();
  }

  async saveSettings(next: unknown, summary = 'Cập nhật cài đặt', profileId?: string): Promise<Settings> {
    const s = SettingsSchema.parse(next);
    const id = await this.pid(profileId);
    return serialized(`settings:${id}`, async () => {
      const prev = await readJson<unknown>(this.settingsFile(id));
      if (prev) await this.snapshot(id, 'settings', prev, summary);
      await writeJsonAtomic(this.settingsFile(id), s);
      return s;
    });
  }

  /* ---------------- sources ---------------- */
  async getSources(profileId?: string): Promise<Source[]> {
    const id = await this.pid(profileId);
    const raw = await readJson<unknown>(this.sourcesFile(id));
    if (!raw) {
      const seeded = defaultSources(this.seedWebsitesTxt);
      await writeJsonAtomic(this.sourcesFile(id), { schemaVersion: 3, sources: seeded });
      return seeded;
    }
    return SourcesFile.parse(raw).sources;
  }

  async saveSources(list: unknown, summary = 'Cập nhật nguồn tin', profileId?: string): Promise<Source[]> {
    const sources = z.array(SourceSchema).parse(list);
    const ids = new Set<string>();
    for (const s of sources) {
      if (ids.has(s.id)) throw new Error(`Trùng mã nguồn: ${s.id}`);
      ids.add(s.id);
    }
    const id = await this.pid(profileId);
    return serialized(`sources:${id}`, async () => {
      const prev = await readJson<unknown>(this.sourcesFile(id));
      if (prev) await this.snapshot(id, 'sources', prev, summary);
      await writeJsonAtomic(this.sourcesFile(id), { schemaVersion: 3, sources });
      return sources;
    });
  }

  /* ---------------- history / backup (active profile) ---------------- */
  private async snapshot(profileId: string, kind: 'settings' | 'sources', value: unknown, summary: string) {
    const id = `${Date.now()}-${kind}`;
    await writeJsonAtomic(path.join(this.historyDir(profileId), `${id}.json`), { id, at: new Date().toISOString(), kind, summary, value });
  }

  async listHistory(): Promise<HistoryEntry[]> {
    const dir = this.historyDir(await this.pid());
    let files: string[] = [];
    try {
      files = (await fs.readdir(dir)).filter((f) => /^\d+-(settings|sources)\.json$/.test(f));
    } catch {
      return [];
    }
    const out: HistoryEntry[] = [];
    for (const f of files.sort().reverse().slice(0, 100)) {
      const j = await readJson<HistoryEntry & { value: unknown }>(path.join(dir, f));
      if (j) out.push({ id: j.id, at: j.at, kind: j.kind, summary: j.summary });
    }
    return out;
  }

  async rollback(id: string): Promise<void> {
    if (!/^\d+-(settings|sources)$/.test(id)) throw new Error('INVALID_HISTORY_ID');
    const j = await readJson<{ kind: 'settings' | 'sources'; value: unknown }>(safeJoin(this.historyDir(await this.pid()), `${id}.json`));
    if (!j) throw new Error('HISTORY_NOT_FOUND');
    if (j.kind === 'settings') await this.saveSettings(j.value, `Khôi phục phiên bản ${id}`);
    else await this.saveSources((j.value as { sources: unknown }).sources, `Khôi phục phiên bản ${id}`);
  }

  async exportBackup() {
    const idx = await this.getProfiles();
    const profile = idx.profiles.find((p) => p.id === idx.activeId);
    return { kind: 'hcm-news-reporter-backup', exportedAt: new Date().toISOString(), profile, settings: await this.getSettings(), sources: await this.getSources() };
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
  /** delete a saved run (ledger, articles, review); exported files in exports/ are kept */
  async deleteRun(runId: string) {
    await fs.rm(this.runDir(runId), { recursive: true, force: true });
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
