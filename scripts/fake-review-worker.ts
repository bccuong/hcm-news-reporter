/**
 * Local stand-in for the Cloudflare review worker (same handler code, in-memory KV) for E2E tests. Port 5181.
 * GitHub API is faked too: a dispatched "collection" turns into a published custom period in dist/pages/live
 * after a few seconds, exactly what the real workflow does (collect → publish → deploy).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { AUTO_TITLE, handle, scheduledCollect, type KVLike } from '../cloud/review-worker/src/handler.js';
import { A as SITE_A, siteARoutes } from '../tests/fixtures/siteA.js';
const SITE_A_ROUTES = siteARoutes();

class MemKV implements KVLike {
  m = new Map<string, { v: string; meta?: unknown }>();
  async get(k: string) { return this.m.get(k)?.v ?? null; }
  async put(k: string, v: string, o?: { metadata?: unknown }) { this.m.set(k, { v, meta: o?.metadata }); }
  async delete(k: string) { this.m.delete(k); }
  async list(o: { prefix: string }) {
    return { keys: [...this.m.entries()].filter(([k]) => k.startsWith(o.prefix)).map(([name, x]) => ({ name, metadata: x.meta })), list_complete: true };
  }
}
const env = {
  REVIEWS: new MemKV(), ACCESS_CODE: 'HCM-TEST-CODE', EXPORT_TOKEN: 'test-export-token', ALLOWED_ORIGINS: 'https://bccuong.github.io',
  GITHUB_TOKEN: 'fake', GITHUB_REPO: 'bccuong/news-reporter', COLLECT_WORKFLOW: 'pages.yml',
};

const LIVE = path.resolve('dist/pages/live/hcm');
const runs: Array<{ id: number; status: string; conclusion: string | null; created_at: string; updated_at: string; event: string; display_title: string; html_url: string }> = [];
const stamp = (iso: string) => iso.slice(0, 16).replace(/[-:T]/g, '');

function publishCustom(from: string, to: string, by: string) {
  const index = JSON.parse(readFileSync(path.join(LIVE, 'index.json'), 'utf8'));
  const base = JSON.parse(readFileSync(path.join(LIVE, '2026-11-09.json'), 'utf8'));
  const key = `custom-${stamp(from)}-${stamp(to)}`;
  const window = { from: from.replace('+07:00', ':00+07:00'), to: to.replace('+07:00', ':00+07:00') };
  writeFileSync(path.join(LIVE, `${key}.json`), JSON.stringify({ ...base, key, custom: true, requestedBy: by, manifest: { ...base.manifest, window } }));
  index.days.unshift({ ...index.days[0], key, file: `${key}.json`, custom: true, requestedBy: by, window, generatedAt: new Date().toISOString() });
  writeFileSync(path.join(LIVE, 'index.json'), JSON.stringify(index));
}

/** a real PNG (1200×800, solid colour; a text chunk pads it above the 8 KB "tracking pixel" threshold) for fixture photo URLs */
function makePng(w = 1200, h = 800): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([30, 90 + (x % 120), 160], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from(`Comment\0${'fixture photo '.repeat(700)}`, 'latin1')), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}
const PNG = makePng();

const fakeGitHub = async (url: string, init?: RequestInit): Promise<Response> => {
  // publisher photos of the fixture sites (fetched by the worker's /img proxy)
  if (/^https:\/\/fixture-[a-z]\.example\.vn\/img\//.test(url)) return new Response(PNG as Uint8Array<ArrayBuffer>, { status: 200, headers: { 'content-type': 'image/png' } });
  // publisher pages of fixture site A (fetched by the worker's /fetch proxy for "Dò nguồn / Thử nguồn" on the web)
  if (url.startsWith(SITE_A)) {
    if (url === `${SITE_A}/` || url === SITE_A) {
      const home = `<html><head><title>Báo mẫu thử A</title><link rel="alternate" type="application/rss+xml" href="/rss/thoi-su.rss"></head>
<body><nav><a href="/thoi-su.htm">Thời sự</a></nav></body></html>`;
      return new Response(home, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    const r = SITE_A_ROUTES[url];
    return r ? new Response(r.body, { status: r.status, headers: r.headers ?? { 'content-type': 'text/html; charset=utf-8' } }) : new Response('', { status: 404 });
  }
  if (url.includes('/runs?status=')) {
    const st = /status=(\w+)/.exec(url)![1];
    return new Response(JSON.stringify({ total_count: runs.filter((r) => r.status === st).length }), { status: 200 });
  }
  if (url.endsWith('/dispatches')) {
    const { inputs } = JSON.parse(String(init?.body));
    const auto = inputs.trigger === 'auto';
    const title = inputs.trigger === 'schedule' ? `${AUTO_TITLE} ${inputs.slot}: ${inputs.from} → ${inputs.to} [${inputs.profile}]` : auto ? AUTO_TITLE : `Thu thập theo yêu cầu ${inputs.from} → ${inputs.to} (${inputs.requested_by})`;
    const run = { id: runs.length + 1, status: 'in_progress', conclusion: null as string | null, created_at: new Date().toISOString(), updated_at: '', event: 'workflow_dispatch', display_title: title, html_url: 'https://github.com/bccuong/news-reporter/actions' };
    runs.unshift(run);
    setTimeout(() => {
      if (!auto && inputs.trigger !== 'schedule') publishCustom(inputs.from, inputs.to, inputs.requested_by); // scheduled runs only occupy the server here
      run.status = 'completed';
      run.conclusion = 'success';
    }, 3000);
    return new Response(null, { status: 204 });
  }
  if (url.includes('/runs?per_page')) return new Response(JSON.stringify({ workflow_runs: runs.slice(0, 6) }), { status: 200 });
  return new Response('{}', { status: 404 });
};

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  // test hooks: fire the cron as if it were 08:02 today (?at=ISO to choose); simulate a deploy run (push) occupying the server for a few seconds
  if (req.url?.startsWith('/__cron')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    const q = new URL(req.url!, 'http://x').searchParams.get('at');
    const now = q ? new Date(q) : new Date(`${new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)}T08:02:00+07:00`);
    return res.end(JSON.stringify(await scheduledCollect(env, fakeGitHub, now)));
  }
  if (req.url === '/__png') {
    res.writeHead(200, { 'content-type': 'image/png' });
    return res.end(Buffer.from(PNG));
  }
  if (req.url === '/__deploy') {
    const run = { id: runs.length + 1, status: 'in_progress', conclusion: null as string | null, created_at: new Date().toISOString(), updated_at: '', event: 'push', display_title: 'Live data – collection & GitHub Pages deploy', html_url: 'https://github.com/bccuong/news-reporter/actions' };
    runs.unshift(run);
    setTimeout(() => ((run.status = 'completed'), (run.conclusion = 'success')), 6000);
    res.writeHead(200);
    return res.end('ok');
  }
  const r = await handle(
    new Request(`http://127.0.0.1:5181${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body }),
    env,
    fakeGitHub,
  );
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(5181, '127.0.0.1', () => console.log('fake review worker on http://127.0.0.1:5181'));
