import { describe, expect, it } from 'vitest';
import { handle, reviewerId, type Env, type KVLike } from '../cloud/review-worker/src/handler.js';

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
  it('reviewer ids are ascii slugs', () => {
    expect(reviewerId('  Lê Đình Ánh ')).toBe('le-dinh-anh');
  });
});
