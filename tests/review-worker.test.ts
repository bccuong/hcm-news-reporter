import { describe, expect, it } from 'vitest';
import { handle, reviewerId, runKind, scheduledCollect, type Env, type KVLike } from '../cloud/review-worker/src/handler.js';

class MemKV implements KVLike {
  m = new Map<string, { v: string; meta?: unknown }>();
  async get(k: string) { return this.m.get(k)?.v ?? null; }
  async put(k: string, v: string, o?: { metadata?: unknown }) { this.m.set(k, { v, meta: o?.metadata }); }
  async delete(k: string) { this.m.delete(k); }
  async list(o: { prefix: string }) {
    return { keys: [...this.m.entries()].filter(([k]) => k.startsWith(o.prefix)).map(([name, x]) => ({ name, metadata: x.meta })), list_complete: true };
  }
}
const env = (): Env => ({ REVIEWS: new MemKV(), ACCESS_CODE: 'HCM-test-1234', EXPORT_TOKEN: 'export-secret', ALLOWED_ORIGINS: 'https://bccuong.github.io' });
const ORIGIN = 'https://bccuong.github.io';
const post = (e: Env, body: unknown, code = 'HCM-test-1234') =>
  handle(new Request('https://w.example/labels', { method: 'POST', headers: { origin: ORIGIN, 'x-review-code': code, 'content-type': 'application/json' }, body: JSON.stringify(body) }), e);
const label = (p: Record<string, unknown> = {}) => ({ reviewer: 'Nguyễn Văn Đức', reportDate: '2026-11-16', articleId: 'a_1234abcd5678', url: 'https://x.vn/a', title: 'T', sourceId: 'tn', label: 'relevant', ...p });

describe('shared review worker', () => {
  it('rejects a wrong access code; CORS only for the Pages origin', async () => {
    const e = env();
    const r = await post(e, label(), 'wrong');
    expect(r.status).toBe(401);
    const bad = await handle(new Request('https://w.example/health', { headers: { origin: 'https://evil.example' } }), e);
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    const good = await handle(new Request('https://w.example/health', { headers: { origin: ORIGIN } }), e);
    expect(good.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });
  it('stores one vote per reviewer per article, lists all votes of a day', async () => {
    const e = env();
    expect((await post(e, label())).status).toBe(200);
    expect((await post(e, label({ reviewer: 'Trần Thị B', label: 'irrelevant', note: 'tin thể thao' }))).status).toBe(200);
    expect((await post(e, label({ label: 'irrelevant', category: 'FLOOD' }))).status).toBe(200); // same reviewer → overwrite
    const r = await handle(new Request('https://w.example/labels?date=2026-11-16', { headers: { origin: ORIGIN, 'x-review-code': 'HCM-test-1234' } }), e);
    const j = (await r.json()) as { votes: Record<string, Array<{ r: string; l: string; c: string | null }>> };
    const v = j.votes['a_1234abcd5678']!;
    expect(v).toHaveLength(2);
    expect(v.find((x) => x.r === 'Nguyễn Văn Đức')).toMatchObject({ l: 'irrelevant', c: 'FLOOD' });
  });
  it('validates input and clearing a vote deletes it', async () => {
    const e = env();
    expect((await post(e, label({ label: 'maybe' }))).status).toBe(400);
    expect((await post(e, label({ category: 'SPORT' }))).status).toBe(400);
    expect((await post(e, label({ reviewer: '' }))).status).toBe(400);
    expect((await post(e, label({ articleId: '../x' }))).status).toBe(400);
    await post(e, label());
    await post(e, label({ label: null }));
    expect((e.REVIEWS as MemKV).m.size).toBe(0);
  });
  it('export needs the bearer token and returns full records', async () => {
    const e = env();
    await post(e, label());
    expect((await handle(new Request('https://w.example/export'), e)).status).toBe(401);
    const r = await handle(new Request('https://w.example/export', { headers: { authorization: 'Bearer export-secret' } }), e);
    const j = (await r.json()) as { count: number; labels: Array<{ reviewerId: string; title: string }> };
    expect(j.count).toBe(1);
    expect(j.labels[0]!.reviewerId).toBe('nguyen-van-duc');
  });
  it('secrets stored with a trailing newline (shell pipe) still match', async () => {
    const e = { ...env(), ACCESS_CODE: 'HCM-test-1234\r\n', EXPORT_TOKEN: 'export-secret\n' };
    expect((await post(e, label())).status).toBe(200);
    expect((await handle(new Request('https://w.example/export', { headers: { authorization: 'Bearer export-secret' } }), e)).status).toBe(200);
    expect((await post(e, label(), 'HCM-test-12345')).status).toBe(401);
  });
  describe('on-demand collection (dispatch GitHub workflow)', () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const fakeGitHub = (busy = false) => async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (url.includes('/runs?status=')) return new Response(JSON.stringify({ total_count: busy && url.includes('in_progress') ? 1 : 0 }), { status: 200 });
      if (url.endsWith('/dispatches')) return new Response(null, { status: 204 });
      if (url.includes('/runs?per_page')) return new Response(JSON.stringify({ workflow_runs: [{ id: 7, status: 'in_progress', conclusion: null, created_at: 'c', updated_at: 'u', event: 'workflow_dispatch', display_title: 'Thu thập theo yêu cầu', html_url: 'https://github.com/x' }] }), { status: 200 });
      return new Response('{}', { status: 404 });
    };
    const genv = (): Env => ({ ...env(), GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'bccuong/hcm-news-reporter', COLLECT_WORKFLOW: 'pages.yml' });
    const req = (body: unknown, code = 'HCM-test-1234') =>
      new Request('https://w.example/collect', { method: 'POST', headers: { origin: ORIGIN, 'x-review-code': code, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const W = { from: '2026-11-14T17:00+07:00', to: '2026-11-15T08:00+07:00', reviewer: 'A' };

    it('dispatches the workflow with the requested window', async () => {
      calls.length = 0;
      const r = await handle(req(W), genv(), fakeGitHub());
      expect(r.status).toBe(202);
      const d = calls.find((c) => c.url.endsWith('/actions/workflows/pages.yml/dispatches'))!;
      expect(JSON.parse(d.body!)).toEqual({ ref: 'main', inputs: { from: W.from, to: W.to, requested_by: 'A', profile: 'hcm' } });
    });
    it('refuses while another collection runs, bad windows, wrong code, missing token', async () => {
      expect((await handle(req(W), genv(), fakeGitHub(true))).status).toBe(409);
      expect((await handle(req({ ...W, to: W.from }), genv(), fakeGitHub())).status).toBe(400);
      expect((await handle(req({ ...W, from: '2026-11-01T00:00+07:00' }), genv(), fakeGitHub())).status).toBe(400); // > 72 h
      expect((await handle(req({ ...W, from: '2026-11-14 17:00' }), genv(), fakeGitHub())).status).toBe(400);
      expect((await handle(req({ ...W, from: '2099-01-01T00:00+07:00', to: '2099-01-01T05:00+07:00' }), genv(), fakeGitHub())).status).toBe(400);
      expect((await handle(req(W, 'wrong'), genv(), fakeGitHub())).status).toBe(401);
      expect((await handle(req(W), env(), fakeGitHub())).status).toBe(503);
    });
    it('reports recent workflow runs for the progress display', async () => {
      const r = await handle(new Request('https://w.example/collect/status', { headers: { origin: ORIGIN, 'x-review-code': 'HCM-test-1234' } }), genv(), fakeGitHub());
      const j = (await r.json()) as { enabled: boolean; runs: Array<{ id: number; status: string }> };
      expect(j.enabled).toBe(true);
      expect(j.runs[0]).toMatchObject({ id: 7, status: 'in_progress' });
    });
  });
  describe('hourly automatic collection (worker cron) + public server status', () => {
    const calls: string[] = [];
    let running: Array<Record<string, unknown>> = [];
    const gh = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url} ${init?.body ?? ''}`);
      if (url.includes('/runs?status=')) return new Response(JSON.stringify({ total_count: url.includes('in_progress') ? running.length : 0 }), { status: 200 });
      if (url.endsWith('/dispatches')) return new Response(null, { status: 204 });
      if (url.includes('/runs?per_page')) return new Response(JSON.stringify({ workflow_runs: running }), { status: 200 });
      return new Response('{}', { status: 404 });
    };
    const genv = (): Env => ({ ...env(), GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'bccuong/hcm-news-reporter', COLLECT_WORKFLOW: 'pages.yml' });
    const setAuto = (e: Env, enabled: unknown, code = 'HCM-test-1234') =>
      handle(new Request('https://w.example/auto', { method: 'POST', headers: { origin: ORIGIN, 'x-review-code': code, 'content-type': 'application/json' }, body: JSON.stringify({ enabled, reviewer: 'B' }) }), e, gh);

    it('is on by default, dispatches trigger=auto, can be switched off/on by a reviewer', async () => {
      const e = genv();
      running = [];
      calls.length = 0;
      expect(await scheduledCollect(e, gh)).toMatchObject({ result: 'dispatched' });
      expect(calls.find((c) => c.includes('/dispatches'))).toContain('"inputs":{"trigger":"auto"}');
      expect((await setAuto(e, false, 'wrong')).status).toBe(401);
      expect((await setAuto(e, 'no')).status).toBe(400);
      expect((await setAuto(e, false)).status).toBe(200);
      calls.length = 0;
      expect(await scheduledCollect(e, gh)).toMatchObject({ result: 'off' });
      expect(calls.some((c) => c.includes('/dispatches'))).toBe(false);
      const st = (await (await handle(new Request('https://w.example/status', { headers: { origin: ORIGIN } }), e, gh)).json()) as { profiles: Array<{ id: string; autoCollect: boolean; autoBy: string }>; lastAuto: { result: string } };
      expect(st.profiles[0]).toMatchObject({ id: 'hcm', autoCollect: false, autoBy: 'B' });
      expect(st.lastAuto.result).toBe('off');
      await setAuto(e, true);
      expect(await scheduledCollect(e, gh)).toMatchObject({ result: 'dispatched' });
    });
    it('skips while the server is busy; status (no login) names the running run kind', async () => {
      const e = genv();
      running = [{ id: 1, status: 'in_progress', conclusion: null, created_at: 'c', updated_at: 'u', event: 'push', display_title: 'Live data', html_url: 'h' }];
      expect(await scheduledCollect(e, gh)).toMatchObject({ result: 'busy' });
      const st = (await (await handle(new Request('https://w.example/status'), e, gh)).json()) as { running: Array<{ kind: string }> };
      expect(st.running[0]!.kind).toBe('deploy');
      expect(runKind({ event: 'workflow_dispatch', display_title: 'Thu thập tự động hằng giờ' })).toBe('auto');
      expect(runKind({ event: 'workflow_dispatch', display_title: 'Thu thập theo yêu cầu x → y (A)' })).toBe('request');
      expect(await scheduledCollect(env(), gh)).toMatchObject({ result: 'not_configured' });
    });
  });
  describe('shared collector configuration + image proxy', () => {
    const H = { origin: ORIGIN, 'x-review-code': 'HCM-test-1234', 'content-type': 'application/json' };
    const put = (e: Env, settings: unknown, summary: string, code = 'HCM-test-1234') =>
      handle(new Request('https://w.example/config', { method: 'POST', headers: { ...H, 'x-review-code': code }, body: JSON.stringify({ settings, sources: [{ id: 's1' }], summary, reviewer: 'C' }) }), e);
    it('public read, reviewer write, every save kept in history, rollback restores', async () => {
      const e = env();
      expect(await (await handle(new Request('https://w.example/config'), e)).json()).toEqual({ config: null });
      expect((await put(e, { a: 1 }, 'v1', 'wrong')).status).toBe(401);
      expect((await handle(new Request('https://w.example/config', { method: 'POST', headers: H, body: JSON.stringify({ settings: [], sources: 'x' }) }), e)).status).toBe(400);
      expect((await put(e, { a: 1 }, 'v1')).status).toBe(200);
      await new Promise((r) => setTimeout(r, 5));
      expect((await put(e, { a: 2 }, 'v2')).status).toBe(200);
      const cur = (await (await handle(new Request('https://w.example/config'), e)).json()) as { config: { settings: { a: number }; by: string; summary: string } };
      expect(cur.config).toMatchObject({ settings: { a: 2 }, by: 'C', summary: 'v2' });
      const hist = (await (await handle(new Request('https://w.example/config/history', { headers: H }), e)).json()) as { items: Array<{ id: string; summary: string }> };
      expect(hist.items.map((x) => x.summary)).toEqual(['v1']);
      expect((await handle(new Request('https://w.example/config/rollback', { method: 'POST', headers: H, body: JSON.stringify({ id: hist.items[0]!.id }) }), e)).status).toBe(200);
      const back = (await (await handle(new Request('https://w.example/config'), e)).json()) as { config: { settings: { a: number }; summary: string } };
      expect(back.config.settings.a).toBe(1);
      expect(back.config.summary).toMatch(/^Khôi phục/);
    });
    it('image proxy: reviewers only, https public images only', async () => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
      const f = async (url: string) => (url.includes('ok.vn') ? new Response(png, { headers: { 'content-type': 'image/png' } }) : new Response('<html>', { headers: { 'content-type': 'text/html' } }));
      const get = (u: string, code = 'HCM-test-1234') => handle(new Request(`https://w.example/img?url=${encodeURIComponent(u)}`, { headers: { origin: ORIGIN, 'x-review-code': code } }), env(), f);
      const r = await get('https://ok.vn/a.png');
      expect(r.status).toBe(200);
      expect(r.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      expect(new Uint8Array(await r.arrayBuffer())).toEqual(png);
      expect((await get('https://ok.vn/a.png', 'wrong')).status).toBe(401);
      expect((await get('http://ok.vn/a.png')).status).toBe(400);
      expect((await get('https://127.0.0.1/a.png')).status).toBe(400);
      expect((await get('https://page.vn/not-image')).status).toBe(502);
    });
  });
  describe('profiles (cấu hình theo địa bàn)', () => {
    const H = { origin: ORIGIN, 'x-review-code': 'HCM-test-1234', 'content-type': 'application/json' };
    const req = (e: Env, method: string, p: string, body?: unknown, code = 'HCM-test-1234') =>
      handle(new Request(`https://w.example${p}`, { method, headers: { ...H, 'x-review-code': code }, body: body === undefined ? undefined : JSON.stringify(body) }), e);
    it('default TP.HCM (legacy config + switch kept), create / rename / delete, config per profile', async () => {
      const e = env();
      // configuration and hourly switch saved before profiles existed
      await e.REVIEWS.put('cfg:config', JSON.stringify({ settings: { v: 'old' }, sources: [], by: 'X', at: 't', summary: 's' }));
      await e.REVIEWS.put('cfg:auto', JSON.stringify({ enabled: false, by: 'Y', at: 't' }));
      const list = (await (await handle(new Request('https://w.example/profiles'), e)).json()) as { profiles: Array<{ id: string; autoCollect: boolean }> };
      expect(list.profiles).toEqual([expect.objectContaining({ id: 'hcm', autoCollect: false })]);
      expect(((await (await handle(new Request('https://w.example/config?profile=hcm'), e)).json()) as { config: { settings: { v: string } } }).config.settings.v).toBe('old');

      expect((await req(e, 'POST', '/profiles', { name: 'Hà Nội', settings: { v: 'hn' }, sources: [] }, 'wrong')).status).toBe(401);
      expect((await req(e, 'POST', '/profiles', { name: '', settings: {}, sources: [] })).status).toBe(400);
      const hn = (await (await req(e, 'POST', '/profiles', { name: 'Hà Nội', settings: { v: 'hn' }, sources: [], reviewer: 'B' })).json()) as { id: string; autoCollect: boolean };
      expect(hn).toMatchObject({ id: 'ha-noi', autoCollect: false });
      expect(((await (await handle(new Request('https://w.example/config?profile=ha-noi'), e)).json()) as { config: { settings: { v: string } } }).config.settings.v).toBe('hn');
      // config + history are per profile
      expect((await req(e, 'POST', '/config', { profile: 'ha-noi', settings: { v: 'hn2' }, sources: [] })).status).toBe(200);
      const hist = (await (await req(e, 'GET', '/config/history?profile=ha-noi')).json()) as { items: unknown[] };
      expect(hist.items).toHaveLength(1);
      expect(((await (await handle(new Request('https://w.example/config?profile=hcm'), e)).json()) as { config: { settings: { v: string } } }).config.settings.v).toBe('old');
      expect((await req(e, 'POST', '/config', { profile: 'khong-co', settings: {}, sources: [] })).status).toBe(404);
      // hourly switch per profile
      expect((await req(e, 'POST', '/auto', { enabled: true, profile: 'ha-noi', reviewer: 'B' })).status).toBe(200);
      expect(((await (await req(e, 'PATCH', '/profiles/ha-noi', { name: 'Thủ đô' })).json()) as { name: string }).name).toBe('Thủ đô');
      const after = (await (await handle(new Request('https://w.example/profiles'), e)).json()) as { profiles: Array<{ id: string; autoCollect: boolean; name: string }> };
      expect(after.profiles.map((p) => [p.id, p.autoCollect])).toEqual([['hcm', false], ['ha-noi', true]]);
      expect((await req(e, 'DELETE', '/profiles/ha-noi')).status).toBe(200);
      expect((await req(e, 'DELETE', '/profiles/hcm')).status).toBe(400); // never the last one
    });
    it('cron: one run for every profile switched on; off when none; on-demand names the profile', async () => {
      const e = { ...env(), GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'bccuong/hcm-news-reporter', COLLECT_WORKFLOW: 'pages.yml' };
      const calls: string[] = [];
      const f = async (url: string, init?: RequestInit) => {
        calls.push(`${url} ${init?.body ?? ''}`);
        if (url.includes('/runs?status=')) return new Response(JSON.stringify({ total_count: 0 }), { status: 200 });
        return new Response(null, { status: 204 });
      };
      await e.REVIEWS.put('cfg:profiles', JSON.stringify([
        { id: 'hcm', name: 'TP.HCM', description: '', autoCollect: false, clonedFrom: null, createdAt: '', updatedAt: '' },
        { id: 'da-nang', name: 'Đà Nẵng', description: '', autoCollect: true, clonedFrom: null, createdAt: '', updatedAt: '' },
      ]));
      expect(await scheduledCollect(e, f)).toMatchObject({ result: 'dispatched', profiles: ['da-nang'] });
      await e.REVIEWS.put('cfg:profiles', JSON.stringify([{ id: 'hcm', name: 'TP.HCM', description: '', autoCollect: false, clonedFrom: null, createdAt: '', updatedAt: '' }]));
      expect(await scheduledCollect(e, f)).toMatchObject({ result: 'off' });
      const r = await handle(new Request('https://w.example/collect', { method: 'POST', headers: H, body: JSON.stringify({ from: '2026-11-14T17:00+07:00', to: '2026-11-15T08:00+07:00', reviewer: 'A', profile: 'nowhere' }) }), e, f);
      expect(r.status).toBe(400);
    });
  });
  it('reviewer ids are ascii slugs', () => {
    expect(reviewerId('  Lê Đình Ánh ')).toBe('le-dinh-anh');
  });
});
