import type { Settings } from './schemas.js';
import { findWord, normText, snippet } from './text.js';

export interface LocationResult {
  status: 'hcm' | 'connected' | 'other_province' | 'unknown';
  evidence: string[];
  score: number;
}

/**
 * Geographic relevance using configured areas + aliases. A literal "TP.HCM" is not required:
 * ward/commune names (prefixed where ambiguous), landmarks and legacy district names count as evidence.
 * Absence of evidence yields "unknown" (review queue), never a silent exclusion.
 */
export function detectLocation(title: string, body: string, loc: Settings['location']): LocationResult {
  const text = `${title}\n${body}`;
  const evidence: string[] = [];
  let score = 0;
  let connected = false;

  for (const area of loc.areas) {
    const names = [area.name, ...area.aliases];
    for (const n of names) {
      const forms =
        area.requirePrefix && (area.kind === 'ward' || area.kind === 'commune')
          ? [`${area.kind === 'ward' ? 'phường' : 'xã'} ${n}`]
          : [n];
      for (const f of forms) {
        const idx = findWord(text, f);
        if (idx >= 0) {
          const weight = area.kind === 'city' ? 3 : area.kind === 'connected_area' ? 1 : 2;
          if (area.kind === 'connected_area') connected = true;
          score += weight;
          const inTitle = findWord(title, f) >= 0;
          evidence.push(`${area.kind === 'connected_area' ? 'Liên vùng' : 'Địa bàn'}: "${f}"${inTitle ? ' (tiêu đề)' : ''} – ${snippet(text, idx, f.length, 30)}`);
          break;
        }
      }
      if (evidence.length > 12) break;
    }
  }

  const others: string[] = [];
  for (const p of loc.otherProvinces) {
    if (findWord(title, p) >= 0) others.push(p);
  }

  if (score >= 2 && !(others.length && score < 3)) {
    return { status: connected && score <= 1 ? 'connected' : 'hcm', evidence, score };
  }
  if (connected) return { status: 'connected', evidence, score };
  if (others.length) {
    return { status: 'other_province', evidence: [...evidence, `Tiêu đề nêu địa phương khác: ${others.join(', ')}`], score };
  }
  if (score > 0) return { status: 'unknown', evidence: [...evidence, 'Bằng chứng địa bàn yếu – cần kiểm tra'], score };
  return { status: 'unknown', evidence: ['Không tìm thấy bằng chứng địa bàn TP.HCM – cần kiểm tra'], score };
}

export function normalizeAreaName(s: string): string {
  return normText(s);
}
