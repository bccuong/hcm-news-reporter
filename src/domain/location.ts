import type { Settings } from './schemas.js';
import { findWord, normText, snippet, blankPhrases } from './text.js';

export interface LocationResult {
  status: 'hcm' | 'connected' | 'other_province' | 'unknown';
  evidence: string[];
  score: number;
  /** an HCM area/alias appears in the title or sapo (the lead) */
  leadHit?: boolean;
  /** number of distinct HCM areas matched anywhere */
  distinct?: number;
  /** another province / region named in the TITLE (not only in the sapo) */
  othersInTitle?: string[];
  /** a connected area (Vành đai 3, sân bay Long Thành…) is named in the title or sapo */
  connectedLead?: boolean;
}

/**
 * Geographic relevance using configured areas + aliases. A literal "TP.HCM" is not required:
 * ward/commune names (prefixed where ambiguous), landmarks and legacy district names count as evidence.
 * Absence of evidence yields "unknown" (review queue), never a silent exclusion.
 */
export function detectLocation(title: string, body: string, loc: Settings['location'], lead = ''): LocationResult {
  const r = detectLocationInner(title, body, loc, lead);
  return r;
}

/** "Hà NộiCầu Trần Hưng Đạo…" (a dateline glued to the sapo) → "Hà Nội Cầu …"; then place look-alikes are blanked out */
function prep(s: string, loc: Settings['location']): string {
  return blankPhrases(s.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2'), loc.excludePhrases ?? []);
}

function detectLocationInner(rawTitle: string, rawBody: string, loc: Settings['location'], rawLead: string): LocationResult {
  const title = prep(rawTitle, loc);
  const body = prep(rawBody, loc);
  const lead = prep(rawLead, loc);
  const text = `${title}\n${body}`;
  const leadText = `${title}\n${lead}`;
  const evidence: string[] = [];
  let score = 0;
  let connected = false;
  let leadHit = false;
  let cityLead = false;
  let cityInTitle = false;
  let connectedLead = false;
  let distinct = 0;
  // ward names repeat across provinces since the 2025 mergers: "phường Xuân Hòa (tỉnh Phú Thọ)" is not the city's
  const othersNorm = loc.otherProvinces.filter(Boolean).map((p) => normText(p));
  const ntext = normText(text);
  const belongsElsewhere = (at: number, len: number) => {
    const after = ntext.slice(at + len, at + len + 40).replace(/^[\s,(–-]+/, '').replace(/^(tỉnh|thành phố|tp\.?)\s+/, '');
    return othersNorm.some((p) => after.startsWith(p));
  };

  for (const area of loc.areas) {
    const names = [area.name, ...area.aliases];
    for (const n of names) {
      const forms =
        area.requirePrefix && (area.kind === 'ward' || area.kind === 'commune')
          ? [`${area.kind === 'ward' ? 'phường' : 'xã'} ${n}`]
          : [n];
      for (const f of forms) {
        const idx = findWord(text, f);
        if (idx >= 0 && area.kind !== 'city' && belongsElsewhere(idx, f.length)) continue;
        if (idx >= 0) {
          const weight = area.kind === 'city' ? 3 : area.kind === 'connected_area' ? 1 : 2;
          if (area.kind === 'connected_area') {
            connected = true;
            if (findWord(leadText, f) >= 0) connectedLead = true;
          } else {
            distinct++;
            if (findWord(leadText, f) >= 0) {
              leadHit = true;
              if (area.kind === 'city') cityLead = true;
              if (area.kind === 'city' && findWord(title, f) >= 0) cityInTitle = true;
            }
          }
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
  const othersInTitle: string[] = [];
  for (const p of loc.otherProvinces) {
    if (!p) continue;
    if (findWord(title, p) >= 0) othersInTitle.push(p);
    if (findWord(title, p) >= 0 || findWord(lead, p) >= 0) others.push(p);
  }

  const extra = { leadHit, distinct, othersInTitle, connectedLead };
  // the TITLE names another province and the city itself is not in the title/sapo: a ward/landmark of the same name
  // in the lead does not make it the city's story ("Phú Thọ: Khởi công … tại phường Xuân Hòa")
  if (othersInTitle.length && !cityLead) {
    return { status: 'other_province', evidence: [...evidence, `Tiêu đề nêu địa phương khác: ${othersInTitle.join(', ')} – tên ${loc.regionName ?? 'TP.HCM'} không có ở tiêu đề/sapo`], score, ...extra, leadHit: false };
  }
  // the title is about another province, the city is only named in the sapo (often a comparison: "như tại Hà Nội, TP.HCM hay
  // Đà Lạt" in a Huế story, 18/11/2026) → another area; leadHit keeps it in "Cần kiểm tra" for the editor
  if (othersInTitle.length && !cityInTitle) {
    return { status: 'other_province', evidence: [...evidence, `Tiêu đề nêu địa phương khác: ${othersInTitle.join(', ')} – ${loc.regionName ?? 'TP.HCM'} chỉ có ở sapo`], score, ...extra, leadHit: true };
  }
  // the title is about another province/region and the city is not in the title/sapo → another area, even if the body mentions the city
  if (others.length && !leadHit) {
    return { status: 'other_province', evidence: [...evidence, `Tiêu đề/sapo nêu địa phương khác: ${others.join(', ')} – ${loc.regionName ?? 'TP.HCM'} không có ở tiêu đề/sapo`], score, ...extra };
  }
  if (score >= 2 && !(others.length && score < 3)) {
    return { status: connected && score <= 1 ? 'connected' : 'hcm', evidence, score, ...extra };
  }
  if (connected) return { status: 'connected', evidence, score, ...extra };
  if (others.length) {
    return { status: 'other_province', evidence: [...evidence, `Tiêu đề nêu địa phương khác: ${others.join(', ')}`], score, ...extra };
  }
  if (score > 0) return { status: 'unknown', evidence: [...evidence, 'Bằng chứng địa bàn yếu – cần kiểm tra'], score, ...extra };
  return { status: 'unknown', evidence: [`Không tìm thấy bằng chứng địa bàn ${loc.regionName ?? 'TP.HCM'} nào (kể cả phường, xã, địa danh)`], score, ...extra };
}

export function normalizeAreaName(s: string): string {
  return normText(s);
}
