import { lookup } from 'node:dns/promises';
import { checkPublicUrl, isPrivateAddress } from '../domain/url.js';

export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  status: number; // 0 = network error
  body: string;
  contentType: string;
  errorCode: string | null; // FETCH_403, FETCH_429, TIMEOUT, SSRF_BLOCKED, REDIRECT_LOOP, NETWORK, CANCELLED
  error: string | null;
  attempts: number;
  fromCache?: boolean;
}

/** Low-level transport: returns status/headers/body for ONE request, no redirects followed. */
export type Transport = (
  url: string,
  init: { timeoutMs: number; userAgent: string; signal?: AbortSignal; etag?: string; lastModified?: string },
) => Promise<{ status: number; headers: Record<string, string>; body: string }>;

export const nodeTransport: Transport = async (url, init) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(new Error('TIMEOUT')), init.timeoutMs);
  const onAbort = () => ctl.abort(new Error('CANCELLED'));
  init.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const headers: Record<string, string> = {
      'User-Agent': init.userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.5',
      'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.5',
    };
    if (init.etag) headers['If-None-Match'] = init.etag;
    if (init.lastModified) headers['If-Modified-Since'] = init.lastModified;
    const res = await fetch(url, { redirect: 'manual', signal: ctl.signal, headers });
    const h: Record<string, string> = {};
    res.headers.forEach((v, k) => (h[k.toLowerCase()] = v));
    const buf = await res.arrayBuffer();
    const body = buf.byteLength > 8_000_000 ? '' : new TextDecoder('utf-8').decode(buf);
    return { status: res.status, headers: h, body };
  } finally {
    clearTimeout(t);
    init.signal?.removeEventListener('abort', onAbort);
  }
};

export type Resolver = (host: string) => Promise<string[]>;
export const dnsResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

class Semaphore {
  private q: Array<() => void> = [];
  constructor(private n: number) {}
  async acquire() {
    if (this.n > 0) {
      this.n--;
      return;
    }
    await new Promise<void>((r) => this.q.push(r));
  }
  release() {
    const next = this.q.shift();
    if (next) next();
    else this.n++;
  }
}

export interface HttpClientOptions {
  transport?: Transport;
  resolver?: Resolver;
  maxConcurrent: number;
  perHost: number;
  timeoutMs: number;
  maxRetries: number;
  backoffBaseMs: number;
  userAgent: string;
  hostOverrides?: Record<string, { concurrency?: number; pauseMs?: number }>;
  sleep?: (ms: number) => Promise<void>;
  cacheMinutes?: number;
}

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class HttpClient {
  private global: Semaphore;
  private hosts = new Map<string, Semaphore>();
  private lastAt = new Map<string, number>();
  private cache = new Map<string, { at: number; res: FetchResult }>();
  readonly transport: Transport;
  readonly resolver: Resolver;
  requestCount = 0;

  constructor(private o: HttpClientOptions) {
    this.global = new Semaphore(o.maxConcurrent);
    this.transport = o.transport ?? nodeTransport;
    this.resolver = o.resolver ?? dnsResolver;
  }

  private hostSem(host: string) {
    let s = this.hosts.get(host);
    if (!s) {
      s = new Semaphore(this.o.hostOverrides?.[host]?.concurrency ?? this.o.perHost);
      this.hosts.set(host, s);
    }
    return s;
  }

  /** SSRF guard: scheme, literal IP, DNS resolution to private ranges. Applied to every redirect hop. */
  async assertPublic(url: string): Promise<string | null> {
    const c = checkPublicUrl(url);
    if (!c.ok) return c.reason;
    try {
      const addrs = await this.resolver(c.url.hostname);
      if (!addrs.length) return 'DNS_NO_ADDRESS';
      if (addrs.some(isPrivateAddress)) return 'PRIVATE_ADDRESS';
    } catch {
      return 'DNS_FAILED';
    }
    return null;
  }

  async get(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const cached = this.cache.get(url);
    if (cached && this.o.cacheMinutes && Date.now() - cached.at < this.o.cacheMinutes * 60_000) {
      return { ...cached.res, fromCache: true };
    }
    let attempts = 0;
    let last: FetchResult | null = null;
    const sleep = this.o.sleep ?? sleepReal;
    for (let i = 0; i <= this.o.maxRetries; i++) {
      if (signal?.aborted) return this.fail(url, url, 0, 'CANCELLED', 'Đã hủy', attempts);
      attempts++;
      last = await this.once(url, signal, attempts);
      const retryable = last.errorCode === 'TIMEOUT' || last.errorCode === 'NETWORK' || last.status === 429 || last.status >= 500;
      if (!retryable) break;
      if (i < this.o.maxRetries) {
        const ra = (last as FetchResult & { retryAfterMs?: number }).retryAfterMs;
        const backoff = ra ?? this.o.backoffBaseMs * 2 ** i + Math.floor(Math.random() * this.o.backoffBaseMs);
        await sleep(Math.min(backoff, 60_000));
      }
    }
    if (last && last.status >= 200 && last.status < 300) this.cache.set(url, { at: Date.now(), res: last });
    return last!;
  }

  private fail(req: string, fin: string, status: number, code: string, msg: string, attempts: number): FetchResult {
    return { requestedUrl: req, finalUrl: fin, status, body: '', contentType: '', errorCode: code, error: msg, attempts };
  }

  private async once(url: string, signal: AbortSignal | undefined, attempts: number): Promise<FetchResult> {
    let current = url;
    const seen = new Set<string>();
    for (let hop = 0; hop < 6; hop++) {
      if (seen.has(current)) return this.fail(url, current, 0, 'REDIRECT_LOOP', 'Vòng lặp chuyển hướng', attempts);
      seen.add(current);
      const blocked = await this.assertPublic(current);
      if (blocked) return this.fail(url, current, 0, 'SSRF_BLOCKED', `Địa chỉ bị chặn (${blocked})`, attempts);
      const host = new URL(current).hostname.replace(/^www\./, '');
      const hs = this.hostSem(host);
      await this.global.acquire();
      await hs.acquire();
      let res: Awaited<ReturnType<Transport>>;
      try {
        const pause = this.o.hostOverrides?.[host]?.pauseMs ?? 0;
        const gap = pause - (Date.now() - (this.lastAt.get(host) ?? 0));
        if (gap > 0) await (this.o.sleep ?? sleepReal)(gap);
        this.lastAt.set(host, Date.now());
        this.requestCount++;
        res = await this.transport(current, { timeoutMs: this.o.timeoutMs, userAgent: this.o.userAgent, signal });
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        const cause = (e as { cause?: Error }).cause?.message ?? '';
        const code = /CANCELLED/.test(msg + cause) ? 'CANCELLED' : /TIMEOUT|aborted/i.test(msg + cause) ? 'TIMEOUT' : 'NETWORK';
        return this.fail(url, current, 0, code, `${msg} ${cause}`.trim().slice(0, 200), attempts);
      } finally {
        hs.release();
        this.global.release();
      }
      if (res.status >= 300 && res.status < 400 && res.headers['location']) {
        current = new URL(res.headers['location'], current).toString();
        continue;
      }
      const out: FetchResult & { retryAfterMs?: number } = {
        requestedUrl: url,
        finalUrl: current,
        status: res.status,
        body: res.status >= 200 && res.status < 300 ? res.body : '',
        contentType: res.headers['content-type'] ?? '',
        errorCode: res.status >= 400 ? `FETCH_${res.status}` : null,
        error: res.status >= 400 ? `HTTP ${res.status}` : null,
        attempts,
      };
      const ra = res.headers['retry-after'];
      if (ra) {
        const secs = Number(ra);
        out.retryAfterMs = Number.isFinite(secs) ? secs * 1000 : Math.max(0, new Date(ra).getTime() - Date.now());
      }
      return out;
    }
    return this.fail(url, current, 0, 'REDIRECT_LOOP', 'Quá nhiều lần chuyển hướng', attempts);
  }
}
