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
      expect(JSON.parse(d.body!)).toEqual({ ref: 'main', inputs: { from: W.from, to: W.to, requested_by: 'A' } });
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
      const st = (await (await handle(new Request('https://w.example/status', { headers: { origin: ORIGIN } }), e, gh)).json()) as { auto: { enabled: boolean; by: string }; lastAuto: { result: string } };
      expect(st.auto).toMatchObject({ enabled: false, by: 'B' });
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
  it('reviewer ids are ascii slugs', () => {
    expect(reviewerId('  Lê Đình Ánh ')).toBe('le-dinh-anh');
  });
});
