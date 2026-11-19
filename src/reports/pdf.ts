/**
 * Built-in PDF export (no PowerPoint / LibreOffice needed; runs in Node and in the browser).
 * A4 document in the layout of the Department's Word report: letterhead, title, counts chart, the three groups
 * (Tồn tại / Tích cực / Trung lập) with each story's title, REAL article photo when available, summary,
 * clickable source links and "Đề xuất", then the request for replies. Font: Tinos (SIL OFL, metric-compatible
 * with Times New Roman, full Vietnamese coverage), subset-embedded.
 */
import { PDFArray, PDFDocument, PDFName, PDFString, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { ReportStory } from './pptx.js';
import type { EditorialAssessment } from '../domain/schemas.js';

export interface PdfFonts { regular: Uint8Array; bold: Uint8Array; italic: Uint8Array }
export interface PdfInput {
  organization: string;
  /** yyyy-mm-dd */
  reportDate: string;
  window: { from: string; to: string };
  stories: ReportStory[];
  contactEmail?: string;
  /** e.g. "TP.HCM" → "Thành phố Hồ Chí Minh" in the date line */
  regionName?: string;
}
export const PDF_FONT_FILES = { regular: 'Tinos-Regular.ttf', bold: 'Tinos-Bold.ttf', italic: 'Tinos-Italic.ttf' } as const;

const A4 = { w: 595.28, h: 841.89 };
const M = { l: 62, r: 50, t: 48, b: 56 };
const CW = A4.w - M.l - M.r;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.38, 0.38, 0.38);
const LINK = rgb(0.02, 0.33, 0.7);
const RULE = rgb(0.82, 0.82, 0.82);
const hex = (h: string) => rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
const GROUPS: Array<{ key: EditorialAssessment; title: string; color: RGB; tint: RGB }> = [
  { key: 'needs_attention', title: 'TIN CẦN NGHIÊN CỨU, XỬ LÝ', color: hex('A61B1B'), tint: hex('FBECEC') },
  { key: 'positive', title: 'TÍCH CỰC', color: hex('1E7B34'), tint: hex('EAF5EC') },
  { key: 'neutral', title: 'TIN TRUNG LẬP', color: hex('2B4C7E'), tint: hex('ECF1F8') },
];
const ROMAN = ['I', 'II', 'III'];

/** characters the font can draw: NFC, no control chars / emoji (they would print as empty boxes) */
const clean = (s: string) =>
  (s ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000b-\u001f\u200b-\u200f\ufeff]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = '';
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  for (const word of clean(text).split(' ').filter(Boolean)) {
    const cand = line ? `${line} ${word}` : word;
    if (fits(cand)) {
      line = cand;
      continue;
    }
    if (line) out.push(line);
    line = '';
    // a word longer than the line (URLs): break by characters
    let rest = word;
    while (!fits(rest)) {
      let n = rest.length - 1;
      while (n > 1 && !fits(rest.slice(0, n))) n--;
      out.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line) out.push(line);
  return out;
}

function addLink(page: PDFPage, x: number, y: number, w: number, h: number, url: string) {
  const ctx = page.doc.context;
  const annot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, y, x + w, y + h], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) } }));
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) annots.push(annot);
  else page.node.set(PDFName.of('Annots'), ctx.obj([annot]));
}

function dataUriBytes(uri: string): { bytes: Uint8Array; type: 'png' | 'jpeg' } | null {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(uri);
  if (!m) return null;
  const bin = atob(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type: m[1]!.toLowerCase() === 'png' ? 'png' : 'jpeg' };
}

const vnTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Date(d.getTime() + 7 * 3600_000);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${z(p.getUTCHours())}:${z(p.getUTCMinutes())} ${z(p.getUTCDate())}/${z(p.getUTCMonth() + 1)}/${p.getUTCFullYear()}`;
};

export async function buildReportPdf(input: PdfInput, fonts: PdfFonts): Promise<{ bytes: Uint8Array; notes: string[] }> {
  const notes: string[] = [];
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const R = await doc.embedFont(fonts.regular, { subset: true });
  const B = await doc.embedFont(fonts.bold, { subset: true });
  const I = await doc.embedFont(fonts.italic, { subset: true });
  const [y4, mo, d] = input.reportDate.split('-');
  const dateLabel = `${d}/${mo}/${y4}`;
  doc.setTitle(`Tổng hợp thông tin báo chí ngày ${dateLabel}`);
  doc.setSubject(clean(input.organization));
  doc.setAuthor('News Reporter');
  doc.setCreator('News Reporter');
  doc.setProducer('News Reporter (pdf-lib)');
  doc.setLanguage('vi-VN');
  doc.setCreationDate(new Date());

  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M.t;
  const newPage = () => {
    page = doc.addPage([A4.w, A4.h]);
    y = A4.h - M.t;
  };
  const ensure = (h: number) => {
    if (y - h < M.b) newPage();
  };
  const text = (s: string, x: number, yy: number, font: PDFFont, size: number, color: RGB = INK) => page.drawText(clean(s), { x, y: yy, font, size, color });
  const center = (s: string, cx: number, yy: number, font: PDFFont, size: number, color: RGB = INK) => {
    const w = font.widthOfTextAtSize(clean(s), size);
    text(s, cx - w / 2, yy, font, size, color);
    return w;
  };
  /** wrapped paragraph at (x, current y) within width; returns its height */
  const para = (s: string, x: number, width: number, font: PDFFont, size: number, color: RGB = INK, lead = 1.25) => {
    const lines = wrap(s, font, size, width);
    for (const ln of lines) {
      ensure(size * lead);
      y -= size * lead;
      text(ln, x, y + size * 0.25, font, size, color);
    }
    return lines.length * size * lead;
  };

  /* ---- letterhead (two columns, as in the Department's documents) ---- */
  const [org1, org2] = (() => {
    const parts = clean(input.organization).split(/\s+[–-]\s+/);
    return parts.length > 1 ? [parts.slice(0, -1).join(' – '), parts[parts.length - 1]!] : [parts[0] ?? '', ''];
  })();
  const leftW = 220;
  const lc = M.l + leftW / 2 - 10;
  let ly = y;
  const orgLines = org1.split(/\s(?=THÀNH PHỐ\s|TỈNH\s)/);
  for (const part of orgLines) for (const ln of wrap(part, R, 12, leftW)) center(ln, lc, (ly -= 15), R, 12);
  if (org2) {
    const w = center(org2, lc, (ly -= 15), B, 12);
    page.drawLine({ start: { x: lc - w / 2 + 12, y: ly - 4 }, end: { x: lc + w / 2 - 12, y: ly - 4 }, thickness: 0.6, color: INK });
  }
  const rc = M.l + leftW + (CW - leftW) / 2;
  let ry = y;
  center('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', rc, (ry -= 15), B, 11.5);
  const wq = center('Độc lập - Tự do - Hạnh phúc', rc, (ry -= 15), B, 12.5);
  page.drawLine({ start: { x: rc - wq / 2, y: ry - 4 }, end: { x: rc + wq / 2, y: ry - 4 }, thickness: 0.6, color: INK });
  const region = !input.regionName || /^(tp\.?\s*hcm|tphcm|hcm|thành phố hồ chí minh)$/i.test(input.regionName.trim()) ? 'Thành phố Hồ Chí Minh' : clean(input.regionName);
  center(`${region}, ngày ${d} tháng ${mo} năm ${y4}`, rc, (ry -= 24), I, 12);
  y = Math.min(ly, ry) - 34;

  /* ---- title ---- */
  center('TỔNG HỢP THÔNG TIN BÁO CHÍ PHẢN ÁNH VỀ NGÀNH XÂY DỰNG', A4.w / 2 + (M.l - M.r) / 2, y, B, 14);
  y -= 19;
  center(`NGÀY ${dateLabel}`, A4.w / 2 + (M.l - M.r) / 2, y, B, 14);
  y -= 16;
  const win = `Khung giờ tổng hợp: ${vnTime(input.window.from)} – ${vnTime(input.window.to)}`;
  center(win, A4.w / 2 + (M.l - M.r) / 2, y, I, 10.5, MUTED);
  y -= 22;

  /* ---- counts (vector bar chart of this report's own numbers) ---- */
  const counts = GROUPS.map((g) => ({ g, n: input.stories.filter((s) => s.group === g.key).length }));
  const total = counts.reduce((a, c) => a + c.n, 0);
  const max = Math.max(1, ...counts.map((c) => c.n));
  const boxH = 18 + counts.length * 17 + 8;
  page.drawRectangle({ x: M.l, y: y - boxH, width: CW, height: boxH, borderColor: RULE, borderWidth: 0.6, color: rgb(0.985, 0.985, 0.985) });
  text(`Số tin theo nhóm (tổng ${total} tin)`, M.l + 10, y - 14, B, 10.5, MUTED);
  let by = y - 18;
  const labelW = 150;
  const barMax = CW - labelW - 60;
  for (const c of counts) {
    by -= 17;
    text(c.g.title.charAt(0) + c.g.title.slice(1).toLowerCase(), M.l + 10, by + 3, R, 10.5);
    const bw = c.n ? Math.max(4, (barMax * c.n) / max) : 0;
    if (bw) page.drawRectangle({ x: M.l + labelW, y: by, width: bw, height: 11, color: c.g.color });
    text(String(c.n), M.l + labelW + bw + 6, by + 2, B, 10.5, c.g.color);
  }
  y -= boxH + 18;

  /* ---- groups ---- */
  const images = new Map<string, PDFImage>();
  const imageOf = async (st: ReportStory) => {
    if (!st.image?.data) return null;
    if (images.has(st.id)) return images.get(st.id)!;
    const raw = dataUriBytes(st.image.data);
    if (!raw) {
      notes.push(`${st.id}: ảnh không phải JPEG/PNG – PDF dùng bố cục chữ`);
      return null;
    }
    try {
      const img = raw.type === 'png' ? await doc.embedPng(raw.bytes) : await doc.embedJpg(raw.bytes);
      images.set(st.id, img);
      return img;
    } catch {
      notes.push(`${st.id}: không đọc được ảnh – PDF dùng bố cục chữ`);
      return null;
    }
  };

  const measure = (st: ReportStory, hasImg: boolean, img: PDFImage | null) => {
    const imgW = hasImg ? 150 : 0;
    const tw = CW - imgW - (hasImg ? 12 : 0);
    const titleLines = wrap(st.title, B, 12, CW - 14);
    const sumLines = wrap(st.summary, R, 11.5, tw);
    const srcH = st.sources.reduce((n, s) => n + 13 + wrap(s.url, R, 9.5, tw).length * 12.5, 0);
    const imgH = img ? Math.min(110, (imgW * img.height) / img.width) + 12 : 0;
    const propLines = st.proposal ? wrap(st.proposal, R, 11.5, CW - 16) : [];
    return titleLines.length * 15 + 4 + Math.max(sumLines.length * 14.4 + srcH + 2, imgH) + (propLines.length ? propLines.length * 14.4 + 14 : 0) + 8;
  };
  let gi = 0;
  for (const g of GROUPS) {
    const list = input.stories.filter((s) => s.group === g.key);
    if (!list.length) continue;
    // heading kept with the start of its first story
    const first = list[0]!;
    const firstImg = await imageOf(first);
    ensure(30 + Math.min(measure(first, !!firstImg, firstImg), A4.h - M.t - M.b - 40));
    page.drawRectangle({ x: M.l, y: y - 20, width: CW, height: 20, color: g.tint });
    page.drawRectangle({ x: M.l, y: y - 20, width: 4, height: 20, color: g.color });
    text(`${ROMAN[gi++]}. ${g.title} (${list.length} tin)`, M.l + 12, y - 14.5, B, 12, g.color);
    y -= 30;
    for (let i = 0; i < list.length; i++) {
      const st = list[i]!;
      const img = await imageOf(st);
      const imgW = img ? 150 : 0;
      const gap = img ? 12 : 0;
      const tx = M.l + imgW + gap;
      const tw = CW - imgW - gap;
      // keep a story together on one page when it fits
      const imgH = img ? Math.min(110, (imgW * img.height) / img.width) + 12 : 0;
      const need = measure(st, !!img, img);
      if (need < A4.h - M.t - M.b) ensure(need);
      para(`${i + 1}. ${st.title}`, M.l, CW, B, 12, INK, 1.25);
      y -= 4;
      if (img) ensure(imgH);
      const top = y;
      const imgPage = page;
      if (img) {
        const h = Math.min(110, (imgW * img.height) / img.width);
        page.drawImage(img, { x: M.l, y: y - h, width: imgW, height: h });
        const credit = clean(st.image?.credit ?? '');
        if (credit) text(`Ảnh: ${credit}`.slice(0, 60), M.l, y - h - 9, I, 7.5, MUTED);
      }
      const imgBottom = img ? top - imgH : top;
      para(st.summary, tx, tw, R, 11.5, INK, 1.25);
      y -= 2;
      for (const s of st.sources) {
        const label = `Nguồn: ${clean(s.name)}${s.publishedAt ? ` (${vnTime(s.publishedAt)})` : ''}`;
        para(label, tx, tw, I, 10, MUTED, 1.3);
        for (const ln of wrap(s.url, R, 9.5, tw)) {
          ensure(12.5);
          y -= 12.5;
          text(ln, tx, y + 3, R, 9.5, LINK);
          const w = R.widthOfTextAtSize(ln, 9.5);
          page.drawLine({ start: { x: tx, y: y + 2 }, end: { x: tx + w, y: y + 2 }, thickness: 0.4, color: LINK });
          addLink(page, tx, y + 1, w, 11, s.url);
        }
      }
      if (img && page === imgPage && y > imgBottom) y = imgBottom;
      if (st.proposal) {
        y -= 6;
        const label = 'Đề xuất:';
        const body = clean(st.proposal).replace(/^Đề xuất:\s*/i, '');
        const lw = B.widthOfTextAtSize(label, 11.5);
        const lines = wrap(`${label} ${body}`, R, 11.5, CW - 16);
        const h = lines.length * 14.4 + 8;
        ensure(h);
        page.drawRectangle({ x: M.l, y: y - h, width: CW, height: h, color: g.tint });
        page.drawRectangle({ x: M.l, y: y - h, width: 3, height: h, color: g.color });
        lines.forEach((ln, k) => {
          const yy = y - 4 - (k + 1) * 14.4 + 3.6;
          if (k === 0 && ln.startsWith(label)) {
            text(label, M.l + 10, yy, B, 11.5, g.color);
            page.drawLine({ start: { x: M.l + 10, y: yy - 1.5 }, end: { x: M.l + 10 + lw, y: yy - 1.5 }, thickness: 0.6, color: g.color });
            text(ln.slice(label.length), M.l + 10 + lw + R.widthOfTextAtSize(' ', 11.5), yy, R, 11.5);
          } else text(ln, M.l + 10, yy, R, 11.5);
        });
        y -= h;
      }
      y -= 8;
      if (i < list.length - 1) {
        page.drawLine({ start: { x: M.l, y: y + 2 }, end: { x: M.l + CW, y: y + 2 }, thickness: 0.5, color: RULE });
        y -= 8;
      }
    }
    y -= 10;
  }
  if (!total) {
    para('Không có tin nào được chọn trong khung giờ này.', M.l, CW, I, 12, MUTED);
    y -= 10;
  }

  /* ---- request for replies ---- */
  const tt = counts.find((c) => c.g.key === 'needs_attention')!.n;
  ensure(80);
  y -= 4;
  if (tt)
    para('Các nội dung có mức độ tiêu cực, đề nghị các phòng, đơn vị liên quan gửi phúc đáp phản hồi về Văn phòng Sở trong ngày, để tổng hợp, chuyển Trung tâm Báo chí Thành phố xử lý thông tin.', M.l, CW, I, 11.5, INK, 1.3);
  if (input.contactEmail) {
    ensure(18);
    y -= 18;
    const lab = 'Phúc đáp trong ngày về địa chỉ: ';
    text(lab, M.l, y, B, 11.5);
    const x = M.l + B.widthOfTextAtSize(lab, 11.5);
    const em = clean(input.contactEmail);
    text(em, x, y, R, 11.5, LINK);
    addLink(page, x, y - 2, R.widthOfTextAtSize(em, 11.5), 13, `mailto:${em}`);
  }

  /* ---- footer on every page ---- */
  const pages = doc.getPages();
  pages.forEach((p, k) => {
    p.drawLine({ start: { x: M.l, y: M.b - 18 }, end: { x: A4.w - M.r, y: M.b - 18 }, thickness: 0.5, color: RULE });
    p.drawText(clean(`${input.organization} · Điểm tin ngày ${dateLabel}`).slice(0, 110), { x: M.l, y: M.b - 30, font: R, size: 8, color: MUTED });
    const pn = `Trang ${k + 1}/${pages.length}`;
    p.drawText(pn, { x: A4.w - M.r - R.widthOfTextAtSize(pn, 8), y: M.b - 30, font: R, size: 8, color: MUTED });
  });
  return { bytes: await doc.save(), notes };
}
