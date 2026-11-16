import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { A, D, WINDOW, fixtureTransport, publicResolver, U, UD } from './fixtures/siteA.js';

const H = { host: '127.0.0.1:5178' };
async function boot(root: string) {
  const r = await createApp({ root, seedWebsitesTxt: 'https://thanhnien.vn\nweb: https://dantri.com.vn', transport: fixtureTransport(), resolver: publicResolver, token: 'tok' });
  return r.app;
}
const auth = { ...H, 'x-hcm-token': 'tok', 'content-type': 'application/json' };

describe('local API', () => {
  it('rejects foreign Host (DNS rebinding) and cross-origin, requires token for mutations', async () => {
    const app = await boot(mkdtempSync(path.join(tmpdir(), 'hcm-s-')));
    expect((await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.example:5178' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: { ...H, origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: { ...H, 'content-type': 'application/json' }, payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/session', headers: { ...H, 'sec-fetch-site': 'cross-site' } })).statusCode).toBe(403);
  });

  it('profiles: legacy config becomes TP.HCM, new region / clone, independent settings, runs record their profile', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hcm-p-'));
    // an install from before profiles
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(path.join(root, 'config'), { recursive: true });
    const { defaultSettings } = await import('../src/domain/defaults.js');
    writeFileSync(path.join(root, 'config', 'settings.json'), JSON.stringify({ ...defaultSettings(), collection: { ...defaultSettings().collection, maxRetries: 5 } }));
    const app = await boot(root);
    const idx = (await app.inject({ method: 'GET', url: '/api/profiles', headers: H })).json();
    expect(idx.activeId).toBe('hcm');
    expect(idx.profiles).toEqual([expect.objectContaining({ id: 'hcm', name: 'TP.HCM', autoCollect: true })]);
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: H })).json().collection.maxRetries).toBe(5); // migrated, not reset

    // a new region starts from the defaults, knows only its own area, TP.HCM becomes "other province"
    const hn = (await app.inject({ method: 'POST', url: '/api/profiles', headers: auth, payload: { name: 'Hà Nội', regionName: 'Hà Nội', regionAliases: ['TP Hà Nội', 'Thủ đô'], activate: true } })).json();
    expect(hn.id).toBe('ha-noi');
    const sHn = (await app.inject({ method: 'GET', url: '/api/settings', headers: H })).json();
    expect(sHn.location.regionName).toBe('Hà Nội');
    expect(sHn.location.areas).toEqual([expect.objectContaining({ name: 'Hà Nội', aliases: ['TP Hà Nội', 'Thủ đô'] })]);
    expect(sHn.location.otherProvinces).toContain('TP.HCM');
    expect(sHn.location.otherProvinces).not.toContain('Hà Nội');
    expect(sHn.collection.maxRetries).toBe(2);
    // a run uses the ACTIVE profile and records it
    const run = (await app.inject({ method: 'POST', url: '/api/runs', headers: auth, payload: { window: WINDOW } })).json();
    expect((await app.inject({ method: 'GET', url: `/api/runs/${run.runId}`, headers: H })).json().profileId).toBe('ha-noi');
    // let the run finish (it must not keep running in the background while the next test starts)
    for (let i = 0; i < 100 && (await app.inject({ method: 'GET', url: `/api/runs/${run.runId}`, headers: H })).json().active; i++) await new Promise((r) => setTimeout(r, 100));

    // clone TP.HCM, edit the clone: the original is untouched
    const clone = (await app.inject({ method: 'POST', url: '/api/profiles', headers: auth, payload: { name: 'TP.HCM – thử', cloneFrom: 'hcm' } })).json();
    expect(clone).toMatchObject({ id: 'tp-hcm-thu', clonedFrom: 'hcm', autoCollect: false });
    await app.inject({ method: 'POST', url: `/api/profiles/${clone.id}/activate`, headers: auth, payload: {} });
    const sc = (await app.inject({ method: 'GET', url: '/api/settings', headers: H })).json();
    expect(sc.collection.maxRetries).toBe(5);
    sc.collection.maxRetries = 1;
    await app.inject({ method: 'PUT', url: '/api/settings', headers: auth, payload: { settings: sc } });
    await app.inject({ method: 'POST', url: '/api/profiles/hcm/activate', headers: auth, payload: {} });
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: H })).json().collection.maxRetries).toBe(5);

    // rename, delete (never the last one)
    expect((await app.inject({ method: 'PATCH', url: '/api/profiles/ha-noi', headers: auth, payload: { name: 'Thủ đô Hà Nội' } })).json().name).toBe('Thủ đô Hà Nội');
    const after = (await app.inject({ method: 'DELETE', url: '/api/profiles/tp-hcm-thu', headers: auth, payload: {} })).json();
    expect(after.profiles.map((p: { id: string }) => p.id)).toEqual(['hcm', 'ha-noi']);
    expect((await app.inject({ method: 'POST', url: '/api/profiles', headers: auth, payload: { name: 'Trống' } })).statusCode).toBe(400); // no region, no clone
    await app.close();
  });

  it('settings + sources persist across restart, are validated, and keep history for rollback (UI-01/06/07/09)', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hcm-s-'));
    let app = await boot(root);
    const s = (await app.inject({ method: 'GET', url: '/api/settings', headers: H })).json();
    s.collection.maxRetries = 4;
    s.reportWindow.startClock = '18:00';
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: auth, payload: { settings: s, summary: 'test' } })).statusCode).toBe(200);
    // invalid value is rejected with Vietnamese message
    const bad = structuredClone(s);
    bad.reportWindow.endClock = '25:00';
    const rb = await app.inject({ method: 'PUT', url: '/api/settings', headers: auth, payload: { settings: bad } });
    expect(rb.statusCode).toBe(400);
    expect(rb.body).toContain('HH:mm');
    const src = (await app.inject({ method: 'GET', url: '/api/sources', headers: H })).json();
    expect(src.map((x: any) => x.id)).toEqual(['thanhnien-vn', 'dantri-com-vn']);
    src.push({ ...src[0], id: 'bao-moi', name: 'Báo mới', baseUrl: 'https://baomoi.example.vn', rssUrls: ['https://baomoi.example.vn/rss.rss'], sectionUrls: [], verifiedRoutes: [] });
    expect((await app.inject({ method: 'PUT', url: '/api/sources', headers: auth, payload: { sources: src } })).statusCode).toBe(200);
    // SSRF-ish source URL refused
    const evil = [...src, { ...src[0], id: 'evil', baseUrl: 'http://127.0.0.1:8080' }];
    expect((await app.inject({ method: 'PUT', url: '/api/sources', headers: auth, payload: { sources: evil } })).statusCode).toBe(400);
    await app.close();
    app = await boot(root); // restart
    const s2 = (await app.inject({ method: 'GET', url: '/api/settings', headers: H })).json();
    expect(s2.collection.maxRetries).toBe(4);
    expect(s2.reportWindow.startClock).toBe('18:00');
    expect((await app.inject({ method: 'GET', url: '/api/sources', headers: H })).json().some((x: any) => x.id === 'bao-moi')).toBe(true);
    const hist = (await app.inject({ method: 'GET', url: '/api/settings/history', headers: H })).json();
    const settingsSnap = hist.find((h: any) => h.kind === 'settings');
    expect(settingsSnap).toBeDefined();
    await app.inject({ method: 'POST', url: '/api/settings/rollback', headers: auth, payload: { id: settingsSnap.id } });
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: H })).json().collection.maxRetries).toBe(2);
    await app.close();
  });

  it('end-to-end: run -> ledger -> review -> PPTX export, offline re-export (OFF-01)', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hcm-s-'));
    const app = await boot(root);
    const put = await app.inject({
      method: 'PUT', url: '/api/sources', headers: auth,
      payload: {
        sources: [
          { id: 'fixture-a', name: 'Fixture A', baseUrl: A, rssUrls: [`${A}/rss/thoi-su.rss`], sitemapUrls: [`${A}/sitemap-news.xml`], sectionUrls: [`${A}/thoi-su.htm`] },
          { id: 'fixture-d', name: 'Fixture D', baseUrl: D, rssUrls: [`${D}/rss/do-thi.rss`], sectionUrls: [], discoveryMethods: ['rss'] },
        ],
      },
    });
    expect(put.statusCode, put.body).toBe(200);
    const start = await app.inject({ method: 'POST', url: '/api/runs', headers: auth, payload: { window: WINDOW } });
    const { runId } = start.json();
    for (let i = 0; i < 600; i++) { // up to 30 s on a busy machine
      const r = (await app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: H })).json();
      if (r.runId && !r.active && r.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const run = (await app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: H })).json();
    expect(run.reconciliation.balanced).toBe(true);
    // auto-trigger for same window is refused (once per window) when enabled
    const s = (await app.inject({ method: 'GET', url: '/api/settings', headers: H })).json();
    s.startup.autoCollectLastCompletedWindow = true;
    s.report.pdfRenderer = 'none'; // keep the unit test from launching Office/LibreOffice
    await app.inject({ method: 'PUT', url: '/api/settings', headers: auth, payload: { settings: s } });
    expect((await app.inject({ method: 'POST', url: '/api/runs', headers: auth, payload: { window: WINDOW, trigger: 'auto' } })).json().skipped).toBe('ALREADY_COLLECTED');

    const arts = (await app.inject({ method: 'GET', url: `/api/runs/${runId}/articles`, headers: H })).json();
    const flood = arts.find((a: any) => a.originalUrl === U.flood);
    const nodate = arts.find((a: any) => a.originalUrl === U.nodate);
    // nothing selected -> blocker
    expect((await app.inject({ method: 'POST', url: `/api/runs/${runId}/export`, headers: auth, payload: { formats: ['pptx'] } })).json().blockers[0]).toContain('Chưa chọn');
    await app.inject({ method: 'PATCH', url: `/api/runs/${runId}/reviews/${flood.id}`, headers: auth, payload: { included: true, order: 1, assessment: 'needs_attention', summary: 'Mưa lớn khiến đường ở phường Hiệp Bình ngập sâu (tóm tắt biên tập).', primaryImageUrl: null } });
    await app.inject({ method: 'PATCH', url: `/api/runs/${runId}/reviews/${nodate.id}`, headers: auth, payload: { included: true, order: 2 } });
    // unverified publish time blocks export (never silently approved)
    const blocked = (await app.inject({ method: 'POST', url: `/api/runs/${runId}/export`, headers: auth, payload: { formats: ['pptx'] } })).json();
    expect(blocked.blockers.join(' ')).toContain('giờ đăng chưa xác minh');
    await app.inject({ method: 'PATCH', url: `/api/runs/${runId}/reviews/${nodate.id}`, headers: auth, payload: { included: false } });
    // DIS-06: the same flood reported by D is clustered with A's story, merged as a second source
    const floodD = arts.find((a: any) => a.originalUrl === UD.flood);
    expect(floodD.duplicateGroupId).toBeTruthy();
    expect(floodD.duplicateGroupId).toBe(flood.duplicateGroupId);
    await app.inject({ method: 'PATCH', url: `/api/runs/${runId}/reviews/${floodD.id}`, headers: auth, payload: { groupId: flood.id, included: false } });
    const ok = (await app.inject({ method: 'POST', url: `/api/runs/${runId}/export`, headers: auth, payload: { formats: ['pptx', 'pdf'] } })).json();
    expect(ok.ok).toBe(true);
    const manifestFile = ok.files.find((f: string) => f.endsWith('_manifest.json'));
    const manifest = JSON.parse(readFileSync(path.join(root, 'exports', manifestFile), 'utf8'));
    expect(manifest.stories).toHaveLength(1);
    expect(manifest.stories[0].sources.map((s: any) => s.name)).toEqual(['Fixture A', 'Fixture D']);
    expect(manifest.stories[0].mergedArticleIds).toEqual([floodD.id]);
    const pptx = ok.files.find((f: string) => f.endsWith('.pptx'));
    expect(existsSync(path.join(root, 'exports', pptx))).toBe(true);
    const dl = await app.inject({ method: 'GET', url: `/api/exports/${pptx}`, headers: H });
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.subarray(0, 2).toString()).toBe('PK');
    // built-in PDF (no Office): pptx + docx + pdf share one file name
    const s2 = (await app.inject({ method: 'GET', url: '/api/settings', headers: H })).json();
    s2.report.pdfRenderer = 'builtin';
    await app.inject({ method: 'PUT', url: '/api/settings', headers: auth, payload: { settings: s2 } });
    const all = (await app.inject({ method: 'POST', url: `/api/runs/${runId}/export`, headers: auth, payload: { formats: ['pptx', 'docx', 'pdf'] } })).json();
    expect(all.pdfStatus).toBe('ok');
    const stem = (ext: string) => all.files.find((f: string) => f.endsWith(ext))?.slice(0, -ext.length);
    expect(stem('.pptx')).toBeTruthy();
    expect(stem('.docx')).toBe(stem('.pptx'));
    expect(stem('.pdf')).toBe(stem('.pptx'));
    const pdfDl = await app.inject({ method: 'GET', url: `/api/exports/${all.files.find((f: string) => f.endsWith('.pdf'))}`, headers: H });
    expect(pdfDl.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    // path traversal refused
    expect((await app.inject({ method: 'GET', url: '/api/exports/..%2F..%2Fconfig%2Fsettings.json', headers: H })).statusCode).toBe(400);
    // editor relevance labels → filter quality endpoint
    const hanoi = arts.find((a: any) => a.originalUrl === U.hanoi);
    await app.inject({ method: 'PATCH', url: `/api/runs/${runId}/reviews/${hanoi.id}`, headers: auth, payload: { relevanceLabel: 'relevant' } });
    expect((await app.inject({ method: 'PATCH', url: `/api/runs/${runId}/reviews/${hanoi.id}`, headers: auth, payload: { relevanceLabel: 'maybe' } })).statusCode).toBe(400);
    const q = (await app.inject({ method: 'GET', url: '/api/quality/relevance', headers: H })).json();
    expect(q.total.labelled).toBeGreaterThanOrEqual(2); // flood (included) + hanoi (label)
    expect(q.missed.map((m: any) => m.articleId)).toContain(hanoi.id);
    // review persisted for offline reopen
    expect((await app.inject({ method: 'GET', url: `/api/runs/${runId}/review`, headers: H })).json()[flood.id].changes.length).toBeGreaterThan(0);
    // "Lượt đã lưu" › Xoá: token required, the run disappears, exported files stay
    expect((await app.inject({ method: 'DELETE', url: `/api/runs/${runId}`, headers: H, payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/runs/run_nope', headers: auth, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/runs/${runId}`, headers: auth, payload: {} })).json().ok).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/runs', headers: H })).json().some((r: any) => r.runId === runId)).toBe(false);
    expect(existsSync(path.join(root, 'exports', pptx))).toBe(true);
    await app.close();
  });
});
