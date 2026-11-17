/** Vietnamese-aware text helpers. Matching is case-insensitive and NFC-normalized; diacritics are significant
 * ("đê" ≠ "đêm"; "cầu" ≠ "yêu cầu" is still a known ambiguity — evidence is shown to reviewers). */

export function normText(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word / whole-phrase match using Unicode letter boundaries. */
export function findWord(haystack: string, needle: string): number {
  const n = normText(needle);
  if (!n) return -1;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'u');
  const m = re.exec(normText(haystack));
  return m ? m.index : -1;
}

/**
 * Like findWord, but an occurrence whose later words are capitalised while the phrase's are not is a proper name, not
 * the phrase: the exclusion "cầu thủ" (football) must not drop "Khởi công cầu Thủ Thiêm 4" or "cầu Thủ Đức".
 */
export function findPhraseNotName(haystack: string, needle: string): number {
  const n = needle.normalize('NFC').trim();
  if (!n) return -1;
  const nw = n.split(/\s+/);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
  for (const m of haystack.normalize('NFC').matchAll(re)) {
    const ws = m[0].split(/\s+/);
    const name = ws.some((w, i) => i > 0 && /^\p{Lu}/u.test(w) && !/^\p{Lu}/u.test(nw[i] ?? ''));
    if (!name) return m.index ?? 0;
  }
  return -1;
}

/** Blanks out every whole-phrase occurrence of `phrases` (same matching as findWord); returns normalised text. */
export function blankPhrases(haystack: string, phrases: string[]): string {
  let t = normText(haystack);
  for (const p of phrases) {
    const n = normText(p);
    if (!n) continue;
    t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'gu'), (m) => ' '.repeat(m.length));
  }
  return t;
}

export function findSubstring(haystack: string, needle: string): number {
  const n = normText(needle);
  return n ? normText(haystack).indexOf(n) : -1;
}

/** Short context snippet around a match for explanation badges. */
export function snippet(text: string, index: number, len: number, pad = 40): string {
  const t = normText(text);
  const a = Math.max(0, index - pad);
  const b = Math.min(t.length, index + len + pad);
  return `${a > 0 ? '…' : ''}${t.slice(a, b)}${b < t.length ? '…' : ''}`;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/** Small deterministic hash (FNV-1a 32-bit, hex) usable in browser + Node. */
export function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
