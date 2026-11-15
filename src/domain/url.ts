/** URL normalization and SSRF-safe target checks (pure; DNS resolution is done in the collector). */

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|zarsrc$|gidzl$|_gl$|ref$|refer$|source$)/i;

export function normalizeUrl(raw: string, base?: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
  const keep = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (!TRACKING_PARAMS.test(k)) keep.append(k, v);
  u.search = keep.toString() ? `?${keep.toString()}` : '';
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

/** Host without leading www., used to compare publisher identity */
export function siteKey(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function sameSite(a: string, b: string): boolean {
  const ka = siteKey(a);
  const kb = siteKey(b);
  return !!ka && (ka === kb || ka.endsWith(`.${kb}`) || kb.endsWith(`.${ka}`));
}

/** Heuristic: does this look like an article detail page rather than a section/listing/asset? */
export function looksLikeArticleUrl(url: string, pattern = '', exclude = ''): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const p = u.pathname;
  if (exclude && safeRegex(exclude)?.test(url)) return false;
  if (pattern) return !!safeRegex(pattern)?.test(url);
  if (/\.(jpg|jpeg|png|gif|webp|svg|css|js|pdf|xml|rss|mp4|mp3|zip)$/i.test(p)) return false;
  if (/\/(tag|tags|topic|chu-de|su-kien|tac-gia|author|video|podcast|search|tim-kiem|login|dang-nhap|rss|timeline)(\/|$)/i.test(p)) return false;
  // Vietnamese publishers: slug + numeric id (thanhnien ...-185251104.htm, vnexpress ...-4960000.html, sggp ...-post123.html)
  // A numeric id is required; topic/section pages like "phong-su--dieu-tra.htm" or "...-e587.htm" are listings.
  // For sites with other URL shapes, set "Mẫu URL bài" on the source.
  return /-\d{6,}\.html?$/i.test(p) || /-post\d{4,}\.html?$/i.test(p) || /\/\d{6,}\.html?$/i.test(p);
}

/**
 * Creation-date hint embedded in some publishers' article ids (from the Skill's url_date):
 * Thanh Niên/Tuổi Trẻ/Báo XD "-185|100|192 yymmdd ...", Dân trí "-yyyymmddhhmmss". Used ONLY to skip fetching
 * articles clearly older than the window (recorded as outside_window with reason URL_DATE_HINT); never as publish time.
 */
export function urlDateHint(url: string): string | null {
  let m = /-(20\d{2})(\d{2})(\d{2})\d{6,}\.htm/.exec(url);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /-(?:185|100|192)(\d{2})(\d{2})(\d{2})\d{6,}\.htm/.exec(url);
  if (m && +m[2]! >= 1 && +m[2]! <= 12 && +m[3]! >= 1 && +m[3]! <= 31) return `20${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export function safeRegex(src: string): RegExp | null {
  if (!src || src.length > 300) return null;
  // reject obviously catastrophic constructs (nested quantifiers)
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(src)) return null;
  try {
    return new RegExp(src, 'i');
  } catch {
    return null;
  }
}

/** IPv4/IPv6 literal private/loopback/link-local/reserved test. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (v === 'localhost' || v.endsWith('.localhost')) return true;
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v.replace(/^::ffff:/, ''));
  if (m4) {
    const [a, b] = [Number(m4[1]), Number(m4[2])];
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v.includes(':')) {
    return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
  }
  return false;
}

/** Synchronous pre-check of a user-supplied URL (scheme, credentials, literal private hosts). */
export function checkPublicUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: 'INVALID_URL' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'SCHEME_NOT_ALLOWED' };
  if (u.username || u.password) return { ok: false, reason: 'CREDENTIALS_IN_URL' };
  if (isPrivateAddress(u.hostname)) return { ok: false, reason: 'PRIVATE_ADDRESS' };
  if (/^\d+$/.test(u.hostname)) return { ok: false, reason: 'NUMERIC_HOST' };
  return { ok: true, url: u };
}
