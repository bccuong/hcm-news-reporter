/** Local stand-in for the Cloudflare review worker (same handler code, in-memory KV) for E2E tests. Port 5181. */
import { createServer } from 'node:http';
import { handle, type KVLike } from '../cloud/review-worker/src/handler.js';

class MemKV implements KVLike {
  m = new Map<string, { v: string; meta?: unknown }>();
  async get(k: string) { return this.m.get(k)?.v ?? null; }
  async put(k: string, v: string, o?: { metadata?: unknown }) { this.m.set(k, { v, meta: o?.metadata }); }
  async delete(k: string) { this.m.delete(k); }
  async list(o: { prefix: string }) {
    return { keys: [...this.m.entries()].filter(([k]) => k.startsWith(o.prefix)).map(([name, x]) => ({ name, metadata: x.meta })), list_complete: true };
  }
}
const env = { REVIEWS: new MemKV(), ACCESS_CODE: 'HCM-TEST-CODE', EXPORT_TOKEN: 'test-export-token', ALLOWED_ORIGINS: 'https://bccuong.github.io' };

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await handle(
    new Request(`http://127.0.0.1:5181${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body }),
    env,
  );
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(5181, '127.0.0.1', () => console.log('fake review worker on http://127.0.0.1:5181'));
