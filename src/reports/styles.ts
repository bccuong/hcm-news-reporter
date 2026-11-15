import PptxGenJS from 'pptxgenjs';
import type { EditorialAssessment } from '../domain/schemas.js';
import { formatVn } from '../domain/timeWindow.js';
import type { ReportStory } from './pptx.js';

/**
 * Four ORIGINAL report designs of this project (free to use), selectable at export next to the Department's template
 * from the Skill. All follow the same editorial structure as the Skill: cover summary → TỒN TẠI CẦN KHẮC PHỤC →
 * TIN TÍCH CỰC → TIN TRUNG LẬP → KIẾN NGHỊ. Only real article photos are used (never generated images); a story
 * without a usable photo gets a text layout.
 */
export type StyleId = 'hanh-chinh' | 'ban-tin' | 'toi-gian' | 'anh-lon';

export interface StyledReportInput {
  organization: string;
  window: { from: string; to: string };
  reportDateLabel: string;
  stories: ReportStory[];
  storiesPerPage: number;
  contactEmail?: string;
  /** region of the active profile, e.g. "TP.HCM" */
  regionName?: string;
}

interface Theme {
  font: string;
  headFont: string;
  ink: string;
  muted: string;
  accent: string;
  paper: string;
  group: Record<EditorialAssessment, string>;
  landscape: boolean;
}

const THEMES: Record<StyleId, Theme> = {
  'hanh-chinh': {
    font: 'Times New Roman', headFont: 'Times New Roman', ink: '1A1A1A', muted: '555555', accent: '8B1A1A', paper: 'FFFFFF',
    group: { needs_attention: '8B1A1A', positive: '1E4D2B', neutral: '2F3B52' }, landscape: false,
  },
  'ban-tin': {
    font: 'Segoe UI', headFont: 'Segoe UI Semibold', ink: '1E293B', muted: '64748B', accent: '0F766E', paper: 'F8FAFC',
    group: { needs_attention: 'DC2626', positive: '059669', neutral: '475569' }, landscape: true,
  },
  'toi-gian': {
    font: 'Arial', headFont: 'Arial', ink: '111111', muted: '6B6B6B', accent: '111111', paper: 'FFFFFF',
    group: { needs_attention: 'C0392B', positive: '2E7D32', neutral: '6B6B6B' }, landscape: false,
  },
  'anh-lon': {
    font: 'Calibri', headFont: 'Calibri', ink: '0F172A', muted: '475569', accent: 'B45309', paper: 'FFFFFF',
    group: { needs_attention: 'B91C1C', positive: '15803D', neutral: '334155' }, landscape: true,
  },
};

const GROUP_TITLE: Record<EditorialAssessment, string> = { needs_attention: 'TỒN TẠI CẦN KHẮC PHỤC', positive: 'TIN TÍCH CỰC', neutral: 'TIN TRUNG LẬP' };
const GROUPS: EditorialAssessment[] = ['needs_attention', 'positive', 'neutral'];
const A4 = { w: 7556500 / 914400, h: 10693400 / 914400 };
const WIDE = { w: 13.333, h: 7.5 };

type Slide = PptxGenJS.Slide;
type Runs = PptxGenJS.TextProps[];

function sourceRuns(st: ReportStory, t: Theme): Runs {
  return [
    { text: 'Nguồn: ', options: { bold: true, color: t.muted } },
    ...st.sources.flatMap((src, k): Runs => [
      ...(k ? [{ text: '  ·  ', options: { color: t.muted } }] : []),
      { text: `${src.name} (${formatVn(src.publishedAt)})`, options: { hyperlink: { url: src.url }, color: '1D4ED8' } },
    ]),
  ];
}
const credit = (st: ReportStory) => (st.image ? `${st.image.caption ?? ''}${st.image.credit ? ` (Ảnh: ${st.image.credit})` : ''}`.trim().slice(0, 150) : '');

export async function buildStyledPptx(style: StyleId, input: StyledReportInput): Promise<Uint8Array> {
  const t = THEMES[style];
  const pptx = new PptxGenJS();
  const size = t.landscape ? WIDE : A4;
  pptx.defineLayout({ name: 'NR', width: size.w, height: size.h });
  pptx.layout = 'NR';
  pptx.title = `Điểm tin ${input.reportDateLabel}`;
  pptx.company = input.organization;
  const by = (g: EditorialAssessment) => input.stories.filter((s) => s.group === g);
  const ctx = { pptx, t, size, input, by, page: 1 };
  const render = { 'hanh-chinh': formal, 'ban-tin': newsletter, 'toi-gian': minimal, 'anh-lon': photo }[style];
  render(ctx);
  return (await pptx.write({ outputType: 'uint8array' })) as Uint8Array;
}

interface Ctx {
  pptx: PptxGenJS;
  t: Theme;
  size: { w: number; h: number };
  input: StyledReportInput;
  by: (g: EditorialAssessment) => ReportStory[];
  page: number;
}

function recommendations(c: Ctx): string {
  const tt = c.by('needs_attention');
  return tt.length
    ? tt.map((s) => `• ${s.shortLabel}: ${s.proposal || 'Đầu mối đề xuất, chờ rà soát.'}`).join('\n')
    : 'Không có tin thuộc nhóm Tồn tại cần khắc phục trong khung giờ này.';
}
const DRAFT_NOTE = 'Các đề xuất đầu mối là DỰ THẢO, cần lãnh đạo rà soát trước khi gửi.';
const windowLine = (c: Ctx) => `Khung giờ ${formatVn(c.input.window.from)} – ${formatVn(c.input.window.to)} (giờ Việt Nam)`;

/* ------------------------------------------------------------------ 1. Hành chính trang trọng (A4 dọc) */
function formal(c: Ctx) {
  const { pptx, t, size } = c;
  const W = size.w;
  const H = size.h;
  const M = 0.6;
  const rules = (s: Slide, y: number) => {
    s.addShape('line', { x: M, y, w: W - 2 * M, h: 0, line: { color: t.accent, width: 2 } });
    s.addShape('line', { x: M, y: y + 0.06, w: W - 2 * M, h: 0, line: { color: t.accent, width: 0.5 } });
  };
  const foot = (s: Slide) => {
    s.addShape('line', { x: M, y: H - 0.6, w: W - 2 * M, h: 0, line: { color: 'BBBBBB', width: 0.5 } });
    s.addText(`${c.input.organization} · Điểm tin sáng ${c.input.reportDateLabel}`, { x: M, y: H - 0.55, w: W - 2 * M - 0.6, h: 0.3, fontFace: t.font, fontSize: 8, italic: true, color: t.muted });
    s.addText(String(c.page++), { x: W - M - 0.5, y: H - 0.55, w: 0.5, h: 0.3, fontFace: t.font, fontSize: 9, color: t.ink, align: 'right' });
  };

  const cover = pptx.addSlide();
  cover.addText(c.input.organization.toUpperCase(), { x: M, y: 0.6, w: W - 2 * M, h: 0.5, fontFace: t.headFont, fontSize: 12, bold: true, color: t.ink, align: 'center' });
  rules(cover, 1.2);
  cover.addText('ĐIỂM TIN BÁO CHÍ', { x: M, y: 1.6, w: W - 2 * M, h: 0.6, fontFace: t.headFont, fontSize: 26, bold: true, color: t.accent, align: 'center' });
  cover.addText(`Phản ánh về ngành xây dựng${c.input.regionName ? ` ${c.input.regionName}` : ''}\nSáng ngày ${c.input.reportDateLabel}`, {
    x: M, y: 2.25, w: W - 2 * M, h: 0.9, fontFace: t.font, fontSize: 15, italic: true, color: t.ink, align: 'center',
  });
  cover.addText(windowLine(c), { x: M, y: 3.15, w: W - 2 * M, h: 0.3, fontFace: t.font, fontSize: 9, color: t.muted, align: 'center' });
  let y = 3.8;
  for (const g of GROUPS) {
    const list = c.by(g);
    cover.addText(`${GROUP_TITLE[g]} (${list.length})`, { x: M, y, w: W - 2 * M, h: 0.35, fontFace: t.headFont, fontSize: 12, bold: true, color: t.group[g] });
    cover.addShape('line', { x: M, y: y + 0.36, w: 2.2, h: 0, line: { color: t.group[g], width: 1 } });
    cover.addText(list.length ? list.map((s, i) => `${i + 1}. ${s.shortLabel}`).join('\n') : '(không có tin)', {
      x: M + 0.15, y: y + 0.45, w: W - 2 * M - 0.15, h: 1.35, fontFace: t.font, fontSize: 11, color: t.ink, valign: 'top',
    });
    y += 1.95;
  }
  foot(cover);

  for (const g of GROUPS) {
    const list = c.by(g);
    if (!list.length) continue;
    const per = Math.max(1, Math.min(3, c.input.storiesPerPage));
    for (let p = 0; p < Math.ceil(list.length / per); p++) {
      const s = pptx.addSlide();
      s.addText(GROUP_TITLE[g], { x: M, y: 0.45, w: W - 2 * M, h: 0.55, fontFace: t.headFont, fontSize: 18, bold: true, color: t.group[g], align: 'center' });
      rules(s, 1.05);
      const slotH = (H - 1.4 - 0.8) / per;
      list.slice(p * per, p * per + per).forEach((st, i) => {
        const top = 1.35 + i * slotH;
        const n = p * per + i + 1;
        s.addText(`${n}. ${st.title}`, { x: M, y: top, w: W - 2 * M, h: 0.7, fontFace: t.headFont, fontSize: 13, bold: true, color: t.ink, valign: 'top' });
        s.addText(st.sector, { x: M, y: top + 0.7, w: W - 2 * M, h: 0.25, fontFace: t.font, fontSize: 9, italic: true, color: t.group[g] });
        const img = !!st.image?.data;
        const imgW = 2.4;
        const imgH = 1.7;
        if (img) {
          s.addImage({ data: st.image!.data, x: W - M - imgW, y: top + 1.0, w: imgW, h: imgH, sizing: { type: 'cover', w: imgW, h: imgH } });
          s.addShape('rect', { x: W - M - imgW, y: top + 1.0, w: imgW, h: imgH, line: { color: t.ink, width: 0.5 } });
          s.addText(credit(st), { x: W - M - imgW, y: top + 1.0 + imgH + 0.02, w: imgW, h: 0.35, fontFace: t.font, fontSize: 6.5, italic: true, color: t.muted, valign: 'top' });
        }
        s.addText(st.summary, { x: M, y: top + 1.0, w: W - 2 * M - (img ? imgW + 0.2 : 0), h: 1.9, fontFace: t.font, fontSize: 11.5, color: t.ink, valign: 'top', align: 'justify' });
        s.addText(sourceRuns(st, t), { x: M, y: top + slotH - 0.75, w: W - 2 * M, h: 0.3, fontFace: t.font, fontSize: 8 });
        if (g === 'needs_attention' && st.proposal) {
          s.addText(st.proposal, { x: M, y: top + slotH - 0.45, w: W - 2 * M, h: 0.3, fontFace: t.font, fontSize: 8.5, italic: true, color: t.accent });
        }
        if (i < per - 1) s.addShape('line', { x: M + 1.5, y: top + slotH - 0.1, w: W - 2 * M - 3, h: 0, line: { color: 'CCCCCC', width: 0.5, dashType: 'dash' } });
      });
      foot(s);
    }
  }

  const r = pptx.addSlide();
  r.addText('KIẾN NGHỊ VÀ ĐẦU MỐI XỬ LÝ', { x: M, y: 0.45, w: W - 2 * M, h: 0.55, fontFace: t.headFont, fontSize: 18, bold: true, color: t.accent, align: 'center' });
  rules(r, 1.05);
  r.addText(recommendations(c), { x: M, y: 1.4, w: W - 2 * M, h: 5.5, fontFace: t.font, fontSize: 12, color: t.ink, valign: 'top', paraSpaceAfter: 6 });
  r.addText(DRAFT_NOTE, { x: M, y: 7.1, w: W - 2 * M, h: 0.3, fontFace: t.font, fontSize: 9, italic: true, color: t.accent });
  if (c.input.contactEmail) r.addText(`Phúc đáp: ${c.input.contactEmail}`, { x: M, y: 7.5, w: W - 2 * M, h: 0.3, fontFace: t.font, fontSize: 10, color: t.ink });
  foot(r);
}

/* ------------------------------------------------------------------ 2. Bản tin hiện đại (16:9) */
function newsletter(c: Ctx) {
  const { pptx, t, size } = c;
  const W = size.w;
  const H = size.h;
  const M = 0.5;
  const bar = (s: Slide, title: string, color: string) => {
    s.background = { color: t.paper };
    s.addShape('rect', { x: 0, y: 0, w: W, h: 0.85, fill: { color } });
    s.addText(title, { x: M, y: 0.12, w: W - 3.5, h: 0.6, fontFace: t.headFont, fontSize: 22, bold: true, color: 'FFFFFF' });
    s.addText(`Điểm tin ${c.input.reportDateLabel}`, { x: W - 3.3, y: 0.12, w: 2.8, h: 0.6, fontFace: t.font, fontSize: 11, color: 'FFFFFF', align: 'right' });
  };
  const foot = (s: Slide) => s.addText(`${c.input.organization}   ·   ${c.page++}`, { x: M, y: H - 0.42, w: W - 2 * M, h: 0.3, fontFace: t.font, fontSize: 8, color: t.muted, align: 'right' });

  const cover = pptx.addSlide();
  cover.background = { color: '0F172A' };
  cover.addShape('rect', { x: 0, y: 0, w: 0.25, h: H, fill: { color: t.accent } });
  cover.addText(c.input.organization, { x: 0.8, y: 0.6, w: W - 1.6, h: 0.4, fontFace: t.font, fontSize: 13, color: '94A3B8' });
  cover.addText('ĐIỂM TIN BÁO CHÍ', { x: 0.8, y: 1.1, w: W - 1.6, h: 0.9, fontFace: t.headFont, fontSize: 40, bold: true, color: 'FFFFFF' });
  cover.addText(`Ngành xây dựng${c.input.regionName ? ` ${c.input.regionName}` : ''} · sáng ${c.input.reportDateLabel}`, { x: 0.8, y: 2.0, w: W - 1.6, h: 0.5, fontFace: t.font, fontSize: 18, color: '5EEAD4' });
  cover.addText(windowLine(c), { x: 0.8, y: 2.5, w: W - 1.6, h: 0.35, fontFace: t.font, fontSize: 11, color: '94A3B8' });
  const cw = (W - 1.6 - 2 * 0.3) / 3;
  GROUPS.forEach((g, i) => {
    const x = 0.8 + i * (cw + 0.3);
    const list = c.by(g);
    cover.addShape('roundRect', { x, y: 3.3, w: cw, h: 3.5, fill: { color: '1E293B' }, rectRadius: 0.12, line: { color: t.group[g], width: 1.5 } });
    cover.addText(String(list.length), { x: x + 0.25, y: 3.45, w: 1.4, h: 0.9, fontFace: t.headFont, fontSize: 44, bold: true, color: t.group[g] });
    cover.addText(GROUP_TITLE[g], { x: x + 1.5, y: 3.6, w: cw - 1.7, h: 0.6, fontFace: t.headFont, fontSize: 12, bold: true, color: 'FFFFFF', valign: 'middle' });
    cover.addText(list.length ? list.slice(0, 6).map((s) => `• ${s.shortLabel}`).join('\n') : 'Không có tin', {
      x: x + 0.25, y: 4.45, w: cw - 0.5, h: 2.2, fontFace: t.font, fontSize: 11, color: 'CBD5E1', valign: 'top', paraSpaceAfter: 3,
    });
  });
  c.page++; // the cover counts as page 1

  for (const g of GROUPS) {
    const list = c.by(g);
    if (!list.length) continue;
    const per = 2;
    for (let p = 0; p < Math.ceil(list.length / per); p++) {
      const s = pptx.addSlide();
      bar(s, GROUP_TITLE[g], t.group[g]);
      const cardW = (W - 2 * M - 0.3) / 2;
      list.slice(p * per, p * per + per).forEach((st, i) => {
        const x = M + i * (cardW + 0.3);
        const y = 1.1;
        const h = H - 1.1 - 0.6;
        s.addShape('roundRect', { x, y, w: cardW, h, fill: { color: 'FFFFFF' }, rectRadius: 0.08, line: { color: 'E2E8F0', width: 1 }, shadow: { type: 'outer', blur: 4, offset: 1, angle: 90, opacity: 0.15, color: '000000' } });
        let yy = y + 0.2;
        if (st.image?.data) {
          s.addImage({ data: st.image.data, x: x + 0.2, y: yy, w: cardW - 0.4, h: 2.1, sizing: { type: 'cover', w: cardW - 0.4, h: 2.1 } });
          s.addText(credit(st), { x: x + 0.2, y: yy + 2.1, w: cardW - 0.4, h: 0.25, fontFace: t.font, fontSize: 7, italic: true, color: t.muted });
          yy += 2.4;
        }
        s.addText(`${p * per + i + 1}  ·  ${st.sector.toUpperCase()}`, { x: x + 0.2, y: yy, w: cardW - 0.4, h: 0.25, fontFace: t.font, fontSize: 9, bold: true, color: t.group[g] });
        s.addText(st.title, { x: x + 0.2, y: yy + 0.28, w: cardW - 0.4, h: 0.8, fontFace: t.headFont, fontSize: 14, bold: true, color: t.ink, valign: 'top' });
        s.addText(st.summary, { x: x + 0.2, y: yy + 1.1, w: cardW - 0.4, h: y + h - (yy + 1.1) - 0.75, fontFace: t.font, fontSize: 10.5, color: t.ink, valign: 'top' });
        s.addText(sourceRuns(st, t), { x: x + 0.2, y: y + h - 0.7, w: cardW - 0.4, h: 0.3, fontFace: t.font, fontSize: 8 });
        if (g === 'needs_attention' && st.proposal) s.addText(st.proposal, { x: x + 0.2, y: y + h - 0.4, w: cardW - 0.4, h: 0.3, fontFace: t.font, fontSize: 8.5, italic: true, color: t.group[g] });
      });
      foot(s);
    }
  }

  const r = pptx.addSlide();
  bar(r, 'KIẾN NGHỊ VÀ ĐẦU MỐI XỬ LÝ', t.accent);
  r.addText(recommendations(c), { x: M, y: 1.2, w: W - 2 * M - 4, h: 5, fontFace: t.font, fontSize: 13, color: t.ink, valign: 'top', paraSpaceAfter: 6 });
  GROUPS.forEach((g, i) => {
    r.addShape('roundRect', { x: W - M - 3.6, y: 1.2 + i * 1.3, w: 3.6, h: 1.1, fill: { color: 'FFFFFF' }, rectRadius: 0.08, line: { color: t.group[g], width: 1.5 } });
    r.addText([{ text: `${c.by(g).length}  `, options: { fontSize: 28, bold: true, color: t.group[g] } }, { text: GROUP_TITLE[g], options: { fontSize: 11, color: t.ink } }], { x: W - M - 3.4, y: 1.25 + i * 1.3, w: 3.3, h: 1.0, fontFace: t.headFont, valign: 'middle' });
  });
  r.addText(DRAFT_NOTE + (c.input.contactEmail ? `   Phúc đáp: ${c.input.contactEmail}` : ''), { x: M, y: H - 1.0, w: W - 2 * M, h: 0.35, fontFace: t.font, fontSize: 10, italic: true, color: t.muted });
  foot(r);
}

/* ------------------------------------------------------------------ 3. Tối giản (A4 dọc) */
function minimal(c: Ctx) {
  const { pptx, t, size } = c;
  const W = size.w;
  const H = size.h;
  const M = 0.75;
  const foot = (s: Slide) => {
    s.addText(String(c.page++), { x: W - M - 0.5, y: H - 0.6, w: 0.5, h: 0.3, fontFace: t.font, fontSize: 9, color: t.muted, align: 'right' });
    s.addText(c.input.reportDateLabel, { x: M, y: H - 0.6, w: 3, h: 0.3, fontFace: t.font, fontSize: 9, color: t.muted });
  };

  const cover = pptx.addSlide();
  cover.addText(c.input.organization, { x: M, y: 0.8, w: W - 2 * M, h: 0.4, fontFace: t.font, fontSize: 10, color: t.muted, charSpacing: 1 });
  cover.addText('Điểm tin\nbáo chí', { x: M, y: 1.6, w: W - 2 * M, h: 1.8, fontFace: t.headFont, fontSize: 44, bold: true, color: t.ink, valign: 'top' });
  cover.addText(`${c.input.regionName ? `${c.input.regionName} · ` : ''}sáng ${c.input.reportDateLabel}`, { x: M, y: 3.45, w: W - 2 * M, h: 0.4, fontFace: t.font, fontSize: 16, color: t.ink });
  cover.addText(windowLine(c), { x: M, y: 3.85, w: W - 2 * M, h: 0.3, fontFace: t.font, fontSize: 9, color: t.muted });
  cover.addShape('line', { x: M, y: 4.5, w: 1.2, h: 0, line: { color: t.ink, width: 2 } });
  let y = 4.9;
  for (const g of GROUPS) {
    const list = c.by(g);
    cover.addShape('ellipse', { x: M, y: y + 0.09, w: 0.12, h: 0.12, fill: { color: t.group[g] }, line: { color: t.group[g] } });
    cover.addText(`${GROUP_TITLE[g]} — ${list.length}`, { x: M + 0.25, y, w: W - 2 * M, h: 0.3, fontFace: t.font, fontSize: 11, bold: true, color: t.ink });
    cover.addText(list.map((s) => s.shortLabel).join('\n') || '—', { x: M + 0.25, y: y + 0.32, w: W - 2 * M - 0.25, h: 1.3, fontFace: t.font, fontSize: 10, color: t.muted, valign: 'top' });
    y += 1.75;
  }
  foot(cover);

  for (const g of GROUPS) {
    const list = c.by(g);
    if (!list.length) continue;
    const per = Math.max(1, Math.min(3, c.input.storiesPerPage));
    for (let p = 0; p < Math.ceil(list.length / per); p++) {
      const s = pptx.addSlide();
      s.addShape('ellipse', { x: M, y: 0.72, w: 0.14, h: 0.14, fill: { color: t.group[g] }, line: { color: t.group[g] } });
      s.addText(GROUP_TITLE[g], { x: M + 0.3, y: 0.6, w: W - 2 * M, h: 0.4, fontFace: t.font, fontSize: 12, bold: true, color: t.ink, charSpacing: 1 });
      const slotH = (H - 1.3 - 0.8) / per;
      list.slice(p * per, p * per + per).forEach((st, i) => {
        const top = 1.3 + i * slotH;
        s.addShape('line', { x: M, y: top, w: W - 2 * M, h: 0, line: { color: 'DDDDDD', width: 0.75 } });
        s.addText(`${String(p * per + i + 1).padStart(2, '0')}`, { x: M, y: top + 0.15, w: 0.6, h: 0.4, fontFace: t.headFont, fontSize: 18, bold: true, color: t.group[g] });
        s.addText(st.title, { x: M + 0.7, y: top + 0.15, w: W - 2 * M - 0.7, h: 0.75, fontFace: t.headFont, fontSize: 14, bold: true, color: t.ink, valign: 'top' });
        s.addText(st.sector, { x: M + 0.7, y: top + 0.9, w: 3, h: 0.25, fontFace: t.font, fontSize: 8.5, color: t.muted });
        const img = !!st.image?.data;
        const imgW = 2.2;
        if (img) {
          s.addImage({ data: st.image!.data, x: M + 0.7, y: top + 1.25, w: imgW, h: 1.5, sizing: { type: 'cover', w: imgW, h: 1.5 } });
          s.addText(credit(st), { x: M + 0.7, y: top + 2.77, w: imgW, h: 0.3, fontFace: t.font, fontSize: 6.5, color: t.muted, valign: 'top' });
        }
        const tx = M + 0.7 + (img ? imgW + 0.25 : 0);
        s.addText(st.summary, { x: tx, y: top + 1.2, w: W - M - tx, h: 1.8, fontFace: t.font, fontSize: 10.5, color: t.ink, valign: 'top', lineSpacingMultiple: 1.15 });
        s.addText(sourceRuns(st, t), { x: M + 0.7, y: top + slotH - 0.6, w: W - 2 * M - 0.7, h: 0.28, fontFace: t.font, fontSize: 8 });
        if (g === 'needs_attention' && st.proposal) s.addText(st.proposal, { x: M + 0.7, y: top + slotH - 0.32, w: W - 2 * M - 0.7, h: 0.28, fontFace: t.font, fontSize: 8.5, italic: true, color: t.group[g] });
      });
      foot(s);
    }
  }

  const r = pptx.addSlide();
  r.addText('Kiến nghị và đầu mối xử lý', { x: M, y: 0.6, w: W - 2 * M, h: 0.6, fontFace: t.headFont, fontSize: 24, bold: true, color: t.ink });
  r.addShape('line', { x: M, y: 1.3, w: 1.2, h: 0, line: { color: t.ink, width: 2 } });
  r.addText(recommendations(c), { x: M, y: 1.6, w: W - 2 * M, h: 5.5, fontFace: t.font, fontSize: 11.5, color: t.ink, valign: 'top', paraSpaceAfter: 8 });
  r.addText(DRAFT_NOTE, { x: M, y: 7.3, w: W - 2 * M, h: 0.3, fontFace: t.font, fontSize: 9, italic: true, color: t.muted });
  if (c.input.contactEmail) r.addText(c.input.contactEmail, { x: M, y: 7.65, w: W - 2 * M, h: 0.3, fontFace: t.font, fontSize: 10, color: t.ink });
  foot(r);
}

/* ------------------------------------------------------------------ 4. Ảnh lớn (16:9, một tin mỗi trang) */
function photo(c: Ctx) {
  const { pptx, t, size } = c;
  const W = size.w;
  const H = size.h;
  const foot = (s: Slide, dark = false) => s.addText(`${c.input.reportDateLabel}   ${c.page++}`, { x: W - 3.2, y: H - 0.45, w: 2.9, h: 0.3, fontFace: t.font, fontSize: 9, color: dark ? 'CBD5E1' : t.muted, align: 'right' });

  const cover = pptx.addSlide();
  const lead = GROUPS.flatMap((g) => c.by(g)).find((s) => s.image?.data);
  cover.background = { color: '111827' };
  if (lead?.image?.data) {
    cover.addImage({ data: lead.image.data, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H }, transparency: 55 });
    cover.addText(credit(lead), { x: W - 6.6, y: H - 0.45, w: 6.3, h: 0.3, fontFace: t.font, fontSize: 9, italic: true, color: 'FFFFFF', align: 'right' });
  }
  cover.addShape('rect', { x: 0, y: 0, w: 6.2, h: H, fill: { color: '111827', transparency: 15 } });
  cover.addText(c.input.organization, { x: 0.6, y: 0.7, w: 5.3, h: 0.6, fontFace: t.font, fontSize: 12, color: 'CBD5E1' });
  cover.addText('ĐIỂM TIN\nBÁO CHÍ', { x: 0.6, y: 1.4, w: 5.3, h: 1.9, fontFace: t.headFont, fontSize: 44, bold: true, color: 'FFFFFF', valign: 'top' });
  cover.addText(`Ngành xây dựng${c.input.regionName ? ` ${c.input.regionName}` : ''}\nSáng ${c.input.reportDateLabel}`, { x: 0.6, y: 3.35, w: 5.3, h: 0.9, fontFace: t.font, fontSize: 16, color: 'FBBF24' });
  cover.addText(GROUPS.map((g) => `${GROUP_TITLE[g]}: ${c.by(g).length}`).join('\n'), { x: 0.6, y: 4.6, w: 5.3, h: 1.2, fontFace: t.font, fontSize: 12, color: 'FFFFFF', paraSpaceAfter: 4 });
  cover.addText(windowLine(c), { x: 0.6, y: 6.1, w: 5.3, h: 0.4, fontFace: t.font, fontSize: 9, color: '94A3B8' });
  c.page++; // the cover counts as page 1

  for (const g of GROUPS) {
    c.by(g).forEach((st, i) => {
      const s = pptx.addSlide();
      const img = !!st.image?.data;
      const half = W / 2;
      if (img) {
        s.addImage({ data: st.image!.data, x: 0, y: 0, w: half, h: H, sizing: { type: 'cover', w: half, h: H } });
        s.addShape('rect', { x: 0, y: H - 0.55, w: half, h: 0.55, fill: { color: '000000', transparency: 45 } });
        s.addText(credit(st), { x: 0.3, y: H - 0.5, w: half - 0.6, h: 0.45, fontFace: t.font, fontSize: 8, italic: true, color: 'FFFFFF', valign: 'middle' });
      } else {
        s.addShape('rect', { x: 0, y: 0, w: half, h: H, fill: { color: t.group[g] } });
        s.addText(st.sector.toUpperCase(), { x: 0.6, y: H / 2 - 0.6, w: half - 1.2, h: 1.2, fontFace: t.headFont, fontSize: 28, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });
      }
      const x = half + 0.5;
      const w = W - x - 0.5;
      s.addShape('rect', { x, y: 0.55, w: 0.12, h: 0.45, fill: { color: t.group[g] } });
      s.addText(`${GROUP_TITLE[g]}  ·  ${i + 1}/${c.by(g).length}`, { x: x + 0.25, y: 0.55, w: w - 0.25, h: 0.45, fontFace: t.font, fontSize: 11, bold: true, color: t.group[g], valign: 'middle' });
      s.addText(st.title, { x, y: 1.2, w, h: 1.5, fontFace: t.headFont, fontSize: 22, bold: true, color: t.ink, valign: 'top' });
      s.addText(st.sector, { x, y: 2.75, w, h: 0.3, fontFace: t.font, fontSize: 10, color: t.muted });
      s.addText(st.summary, { x, y: 3.15, w, h: 2.6, fontFace: t.font, fontSize: 13, color: t.ink, valign: 'top', lineSpacingMultiple: 1.1 });
      s.addText(sourceRuns(st, t), { x, y: 5.85, w, h: 0.4, fontFace: t.font, fontSize: 9 });
      if (g === 'needs_attention' && st.proposal) s.addText(st.proposal, { x, y: 6.3, w, h: 0.5, fontFace: t.font, fontSize: 10, italic: true, color: t.group[g], valign: 'top' });
      foot(s);
    });
  }

  const r = pptx.addSlide();
  r.addShape('rect', { x: 0, y: 0, w: 0.35, h: H, fill: { color: t.accent } });
  r.addText('KIẾN NGHỊ VÀ ĐẦU MỐI XỬ LÝ', { x: 0.9, y: 0.6, w: W - 1.8, h: 0.7, fontFace: t.headFont, fontSize: 28, bold: true, color: t.ink });
  r.addText(recommendations(c), { x: 0.9, y: 1.5, w: W - 1.8, h: 4.6, fontFace: t.font, fontSize: 15, color: t.ink, valign: 'top', paraSpaceAfter: 8 });
  r.addText(DRAFT_NOTE + (c.input.contactEmail ? `   Phúc đáp: ${c.input.contactEmail}` : ''), { x: 0.9, y: H - 1.0, w: W - 1.8, h: 0.4, fontFace: t.font, fontSize: 10, italic: true, color: t.accent });
  foot(r);
}
