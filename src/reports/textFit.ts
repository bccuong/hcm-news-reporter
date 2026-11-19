/**
 * Real text measurement for the PowerPoint template (19/11/2026, replaces the "characters × 0.5 em" estimate that
 * let summaries and the Kiến nghị list overflow). Glyph advance widths of Arimo – the OFL font made metric-compatible
 * with Arial, the template's font – for Latin + Vietnamese (arialWidths.json, 1/1000 em), greedy word wrap like
 * PowerPoint, the shape's own insets, indents, line and paragraph spacing.
 * Works in the browser and in Node (no font file, no canvas).
 */
import W from './arialWidths.json';

const TABLE = W as { regular: Record<string, number>; bold: Record<string, number> };
const EMU_PER_PT = 12700;
/** single line spacing of Arial in PowerPoint ≈ 1.15 em; 1.2 keeps a small safety margin */
const LINE = 1.2;

export function textWidthPt(s: string, pt: number, bold = false): number {
  const t = bold ? TABLE.bold : TABLE.regular;
  let w = 0;
  for (const ch of s.normalize('NFC')) w += t[ch] ?? 556;
  return (w * pt) / 1000;
}

/** wrapped line count of one paragraph in a box `widthPt` wide (words longer than a line are broken) */
export function wrapLines(text: string, widthPt: number, pt: number, bold = false): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const space = textWidthPt(' ', pt, bold);
  let lines = 1;
  let cur = 0;
  for (const word of words) {
    let w = textWidthPt(word, pt, bold);
    if (cur > 0 && cur + space + w <= widthPt) {
      cur += space + w;
      continue;
    }
    if (cur > 0) lines++;
    while (w > widthPt) {
      lines++;
      w -= widthPt;
    }
    cur = w;
  }
  return lines;
}

const attr = (s: string, name: string) => {
  const m = new RegExp(`\\s${name}="(-?\\d+)"`).exec(s);
  return m ? Number(m[1]) : undefined;
};

/** height (pt) the text of a <p:sp> needs, and the height its box offers */
export function measureShape(sp: string): { needPt: number; boxPt: number; widthPt: number } {
  const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(sp);
  const body = /<a:bodyPr[^>]*>/.exec(sp)?.[0] ?? '';
  const l = attr(body, 'lIns') ?? 91440, r = attr(body, 'rIns') ?? 91440, t = attr(body, 'tIns') ?? 45720, b = attr(body, 'bIns') ?? 45720;
  const widthPt = ((ext ? Number(ext[1]) : 0) - l - r) / EMU_PER_PT;
  const boxPt = ((ext ? Number(ext[2]) : 0) - t - b) / EMU_PER_PT;
  let needPt = 0;
  for (const m of sp.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
    const p = m[1]!;
    const pPr = /<a:pPr[^>]*\/>|<a:pPr[^>]*>[\s\S]*?<\/a:pPr>/.exec(p)?.[0] ?? '';
    const rPr = /<a:rPr[^>]*>/.exec(p)?.[0] ?? /<a:endParaRPr[^>]*>/.exec(p)?.[0] ?? '';
    const pt = (attr(rPr, 'sz') ?? 1800) / 100;
    const bold = /\sb="1"/.test(rPr);
    const text = [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => x[1]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')).join('');
    const indent = ((attr(pPr, 'marL') ?? 0) + Math.max(0, attr(pPr, 'indent') ?? 0)) / EMU_PER_PT;
    const lnPct = /<a:lnSpc><a:spcPct val="(\d+)"/.exec(pPr);
    const lnPts = /<a:lnSpc><a:spcPts val="(\d+)"/.exec(pPr);
    const lineH = lnPts ? Number(lnPts[1]) / 100 : pt * LINE * (lnPct ? Number(lnPct[1]) / 100000 : 1);
    const after = /<a:spcAft><a:spcPts val="(\d+)"/.exec(pPr), before = /<a:spcBef><a:spcPts val="(\d+)"/.exec(pPr);
    needPt += wrapLines(text, widthPt - indent, pt, bold) * lineH + (after ? Number(after[1]) / 100 : 0) + (before ? Number(before[1]) / 100 : 0);
  }
  return { needPt, boxPt, widthPt };
}

/** text cut to `maxChars` at a sentence end, else a word end, with "…" */
export function cutText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.max(1, maxChars - 1));
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('; '));
  if (sentence > maxChars * 0.6) return head.slice(0, sentence + 1).trimEnd() + ' …';
  const word = head.lastIndexOf(' ');
  return (word > maxChars * 0.4 ? head.slice(0, word) : head).replace(/[\s,;:.–-]+$/, '') + '…';
}
