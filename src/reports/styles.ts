import PptxGenJS from 'pptxgenjs';
import type { EditorialAssessment } from '../domain/schemas.js';
import { formatVn } from '../domain/timeWindow.js';
import type { ReportStory } from './pptx.js';

/**
 * Four ORIGINAL report designs of this project (free to use, no third-party template), selectable at export next to the
 * Department's template from the Skill. Same editorial structure as the Skill: cover → TỒN TẠI CẦN KHẮC PHỤC → TIN TÍCH
 * CỰC → TIN TRUNG LẬP → KIẾN NGHỊ.
 *
 * Reworked 16/11/2026 (user: "slides rời rạc, nhiều chỗ trống"): one layout engine, content-aware packing –
 *  - every story block is MEASURED (estimated lines of title / summary / proposal for its width and font) and pages are
 *    filled until full, instead of fixed 1–2 slots per page;
 *  - "Tồn tại" / "Tích cực": feature rows (real photo beside the text, or full-width text), proposal in a tinted box;
 *  - "Trung lập": compact briefs (small photo if any), two columns on 16:9;
 *  - cover with counts + headlines (+ the first real photo), recommendations as a table (story → unit to handle).
 * Only real article photos are used (never generated images); a story without a usable photo gets a text layout.
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
  /** average glyph width / font size – used to estimate line breaks */
  glyph: number;
  ink: string;
  muted: string;
  accent: string;
  paper: string;
  soft: string;
  group: Record<EditorialAssessment, string>;
  tint: Record<EditorialAssessment, string>;
  landscape: boolean;
  cover: 'formal' | 'dark' | 'minimal' | 'photo';
  header: 'rule' | 'band' | 'line';
  /** "Ảnh lớn": stories WITH a photo get a photo-led page */
  photoLed?: boolean;
  size: { title: number; body: number; brief: number; briefTitle: number };
}

const THEMES: Record<StyleId, Theme> = {
  'hanh-chinh': {
    font: 'Times New Roman', headFont: 'Times New Roman', glyph: 0.44, ink: '1A1A1A', muted: '5F5F5F', accent: '7A1F1F', paper: 'FFFFFF', soft: 'F6F1EA',
    group: { needs_attention: '9B1C1C', positive: '1E5631', neutral: '24324D' }, tint: { needs_attention: 'FBEDEC', positive: 'EAF4EC', neutral: 'EEF1F6' },
    landscape: false, cover: 'formal', header: 'rule', size: { title: 13.5, body: 11.5, brief: 10, briefTitle: 11.5 },
  },
  'ban-tin': {
    font: 'Segoe UI', headFont: 'Segoe UI Semibold', glyph: 0.48, ink: '0F172A', muted: '64748B', accent: '0F766E', paper: 'F8FAFC', soft: 'E2E8F0',
    group: { needs_attention: 'DC2626', positive: '059669', neutral: '475569' }, tint: { needs_attention: 'FEF2F2', positive: 'ECFDF5', neutral: 'F1F5F9' },
    landscape: true, cover: 'dark', header: 'band', size: { title: 15, body: 12, brief: 10.5, briefTitle: 12 },
  },
  'toi-gian': {
    font: 'Arial', headFont: 'Arial', glyph: 0.48, ink: '111111', muted: '6B6B6B', accent: '111111', paper: 'FFFFFF', soft: 'F2F2F2',
    group: { needs_attention: 'C0392B', positive: '2E7D32', neutral: '555555' }, tint: { needs_attention: 'FCEFED', positive: 'EDF5EE', neutral: 'F4F4F4' },
    landscape: false, cover: 'minimal', header: 'line', size: { title: 13, body: 10.5, brief: 9.5, briefTitle: 11 },
  },
  'anh-lon': {
    font: 'Calibri', headFont: 'Calibri', glyph: 0.45, ink: '0F172A', muted: '475569', accent: 'B45309', paper: 'FFFFFF', soft: 'F1F5F9',
    group: { needs_attention: 'B91C1C', positive: '15803D', neutral: '334155' }, tint: { needs_attention: 'FEF2F2', positive: 'F0FDF4', neutral: 'F1F5F9' },
    landscape: true, cover: 'photo', header: 'band', photoLed: true, size: { title: 18, body: 13, brief: 11, briefTitle: 12.5 },
  },
};

const GROUP_TITLE: Record<EditorialAssessment, string> = { needs_attention: 'TỒN TẠI CẦN KHẮC PHỤC', positive: 'TIN TÍCH CỰC', neutral: 'TIN TRUNG LẬP' };
const GROUP_SHORT: Record<EditorialAssessment, string> = { needs_attention: 'Tồn tại cần khắc phục', positive: 'Tích cực', neutral: 'Trung lập' };
const GROUPS: EditorialAssessment[] = ['needs_attention', 'positive', 'neutral'];
const A4 = { w: 7556500 / 914400, h: 10693400 / 914400 };
const WIDE = { w: 13.333, h: 7.5 };

type Slide = PptxGenJS.Slide;
type Runs = PptxGenJS.TextProps[];

interface Ctx {
  pptx: PptxGenJS;
  t: Theme;
  W: number;
  H: number;
  M: number;
  input: StyledReportInput;
  by: (g: EditorialAssessment) => ReportStory[];
  page: number;
}

/* ------------------------------------------------------------------ text measuring */
/** estimated number of lines of `text` in a box `w` inches wide at `pt` points */
function lines(c: Ctx, text: string, w: number, pt: number, bold = false): number {
  // bold glyphs are ~13 % wider; words never break mid-line, so a little slack per line
  const perLine = Math.max(8, Math.floor((w * 72 - pt * 1.5) / (pt * c.t.glyph * (bold ? 1.13 : 1))));
  return text.split('\n').reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
}
const lh = (pt: number) => (pt * 1.2) / 72; // line height in inches
const textH = (c: Ctx, text: string, w: number, pt: number, bold = false) => lines(c, text, w, pt, bold) * lh(pt) + 0.06;

const proposalText = (p?: string) => (p || 'Đề xuất: đầu mối đề xuất, chờ rà soát.').replace(/^Đề xuất\s*:?\s*/i, '');
const cap = (s: string) => (s ? s.charAt(0).toLocaleUpperCase('vi') + s.slice(1) : s);
const credit = (st: ReportStory) => (st.image ? `${st.image.credit ? `Ảnh: ${st.image.credit}` : ''}`.trim().slice(0, 80) : '');
function sourceRuns(st: ReportStory, c: Ctx): Runs {
  return [
    { text: 'Nguồn: ', options: { bold: true, color: c.t.muted } },
    ...st.sources.flatMap((src, k): Runs => [
      ...(k ? [{ text: '  ·  ', options: { color: c.t.muted } }] : []),
      { text: `${src.name} (${formatVn(src.publishedAt)})`, options: { hyperlink: { url: src.url }, color: '1D4ED8' } },
    ]),
  ];
}
const sourcesLen = (st: ReportStory) => st.sources.reduce((n, s) => n + s.name.length + 22, 7);

/* ------------------------------------------------------------------ page furniture */
function header(c: Ctx, s: Slide, title: string, color: string, sub = ''): number {
  const { t, W, M } = c;
  s.background = { color: t.paper };
  if (t.header === 'band') {
    s.addShape('rect', { x: 0, y: 0, w: W, h: 0.75, fill: { color }, line: { color } });
    s.addText(title, { x: M, y: 0.1, w: W - 2 * M - 3, h: 0.55, fontFace: t.headFont, fontSize: 20, bold: true, color: 'FFFFFF', valign: 'middle' });
    s.addText(sub, { x: W - M - 3.2, y: 0.1, w: 3.2, h: 0.55, fontFace: t.font, fontSize: 10, color: 'FFFFFF', align: 'right', valign: 'middle' });
    return 1.0;
  }
  if (t.header === 'rule') {
    s.addText(c.input.organization.toUpperCase(), { x: M, y: 0.3, w: W - 2 * M, h: 0.3, fontFace: t.font, fontSize: 8.5, color: t.muted, align: 'center' });
    s.addText(title, { x: M, y: 0.55, w: W - 2 * M, h: 0.45, fontFace: t.headFont, fontSize: 17, bold: true, color, align: 'center' });
    s.addShape('line', { x: M, y: 1.05, w: W - 2 * M, h: 0, line: { color, width: 2 } });
    s.addShape('line', { x: M, y: 1.1, w: W - 2 * M, h: 0, line: { color, width: 0.5 } });
    if (sub) s.addText(sub, { x: M, y: 1.13, w: W - 2 * M, h: 0.25, fontFace: t.font, fontSize: 8.5, italic: true, color: t.muted, align: 'right' });
    return 1.45;
  }
  // line (minimal)
  s.addShape('rect', { x: M, y: 0.45, w: 0.12, h: 0.42, fill: { color }, line: { color } });
  s.addText(title, { x: M + 0.22, y: 0.4, w: W - 2 * M - 2.4, h: 0.5, fontFace: t.headFont, fontSize: 17, bold: true, color: t.ink, valign: 'middle' });
  s.addText(sub, { x: W - M - 2.2, y: 0.4, w: 2.2, h: 0.5, fontFace: t.font, fontSize: 9, color: t.muted, align: 'right', valign: 'middle' });
  s.addShape('line', { x: M, y: 1.0, w: W - 2 * M, h: 0, line: { color: 'DDDDDD', width: 0.75 } });
  return 1.2;
}
function footer(c: Ctx, s: Slide) {
  const { t, W, H, M } = c;
  s.addShape('line', { x: M, y: H - 0.5, w: W - 2 * M, h: 0, line: { color: 'D4D4D4', width: 0.5 } });
  s.addText(`${c.input.organization} · Điểm tin báo chí ngày ${c.input.reportDateLabel}`, { x: M, y: H - 0.47, w: W - 2 * M - 0.8, h: 0.3, fontFace: t.font, fontSize: 8, color: t.muted });
  s.addText(String(c.page++), { x: W - M - 0.8, y: H - 0.47, w: 0.8, h: 0.3, fontFace: t.font, fontSize: 9, bold: true, color: t.ink, align: 'right' });
}
const contentBottom = (c: Ctx) => c.H - 0.6;

/* ------------------------------------------------------------------ cover */
function cover(c: Ctx) {
  const { pptx, t, W, H, M } = c;
  const s = pptx.addSlide();
  const total = c.input.stories.length;
  const region = c.input.regionName ? ` ${c.input.regionName}` : '';
  const feature = [...c.by('needs_attention'), ...c.by('positive'), ...c.by('neutral')].find((x) => x.image?.data);
  const head = [...c.by('needs_attention').slice(0, 4), ...c.by('positive').slice(0, 3)];
  const window = `Khung giờ ${formatVn(c.input.window.from)} – ${formatVn(c.input.window.to)}`;

  const tiles = (x: number, y: number, w: number, h: number, dark: boolean) => {
    const tw = (w - 0.3) / 3;
    GROUPS.forEach((g, i) => {
      const tx = x + i * (tw + 0.15);
      s.addShape('rect', { x: tx, y, w: tw, h, fill: { color: dark ? '1E293B' : t.tint[g] }, line: { color: t.group[g], width: dark ? 1 : 0 } });
      s.addShape('rect', { x: tx, y, w: 0.08, h, fill: { color: t.group[g] }, line: { color: t.group[g] } });
      s.addText(String(c.by(g).length), { x: tx + 0.2, y: y + 0.05, w: tw - 0.3, h: h * 0.6, fontFace: t.headFont, fontSize: 30, bold: true, color: dark ? 'FFFFFF' : t.group[g], valign: 'middle' });
      s.addText(GROUP_SHORT[g], { x: tx + 0.2, y: y + h * 0.6, w: tw - 0.3, h: h * 0.35, fontFace: t.font, fontSize: 10, color: dark ? 'CBD5E1' : t.ink, valign: 'top' });
    });
  };
  const headlines = (x: number, y: number, w: number, h: number, dark: boolean) => {
    if (!head.length) return;
    s.addText('TIÊU ĐIỂM', { x, y, w, h: 0.3, fontFace: t.headFont, fontSize: 11, bold: true, color: dark ? '94A3B8' : t.muted, charSpacing: 2 });
    const runs: Runs = head.flatMap((st, i): Runs => [
      { text: '■ ', options: { color: t.group[st.group], fontSize: 9 } },
      { text: st.title, options: { color: dark ? 'F1F5F9' : t.ink, breakLine: i < head.length - 1 } },
    ]);
    s.addText(runs, { x, y: y + 0.32, w, h: h - 0.32, fontFace: t.font, fontSize: t.landscape ? 12 : 11.5, valign: 'top', paraSpaceAfter: 5 });
  };

  if (t.cover === 'formal') {
    s.background = { color: t.paper };
    s.addText(c.input.organization.toUpperCase(), { x: M, y: 0.55, w: W - 2 * M, h: 0.35, fontFace: t.font, fontSize: 11, bold: true, color: t.ink, align: 'center' });
    s.addShape('line', { x: W / 2 - 1.2, y: 0.95, w: 2.4, h: 0, line: { color: t.ink, width: 0.75 } });
    s.addText('ĐIỂM TIN BÁO CHÍ', { x: M, y: 1.3, w: W - 2 * M, h: 0.7, fontFace: t.headFont, fontSize: 30, bold: true, color: t.accent, align: 'center' });
    s.addText(`Phản ánh về ngành xây dựng${region}`, { x: M, y: 2.0, w: W - 2 * M, h: 0.4, fontFace: t.font, fontSize: 15, italic: true, color: t.ink, align: 'center' });
    s.addText(`NGÀY ${c.input.reportDateLabel}`, { x: M, y: 2.4, w: W - 2 * M, h: 0.45, fontFace: t.headFont, fontSize: 18, bold: true, color: t.ink, align: 'center' });
    s.addText(window, { x: M, y: 2.85, w: W - 2 * M, h: 0.3, fontFace: t.font, fontSize: 9, italic: true, color: t.muted, align: 'center' });
    s.addShape('line', { x: M, y: 3.3, w: W - 2 * M, h: 0, line: { color: t.accent, width: 2 } });
    s.addShape('line', { x: M, y: 3.36, w: W - 2 * M, h: 0, line: { color: t.accent, width: 0.5 } });
    tiles(M, 3.6, W - 2 * M, 1.05, false);
    let y = 4.95;
    if (feature) {
      const iw = W - 2 * M;
      const ih = 2.4;
      s.addImage({ data: feature.image!.data, x: M, y, w: iw, h: ih, sizing: { type: 'cover', w: iw, h: ih } });
      s.addText(credit(feature), { x: M, y: y + ih, w: iw, h: 0.25, fontFace: t.font, fontSize: 7.5, italic: true, color: t.muted, align: 'right' });
      y += ih + 0.4;
    }
    headlines(M, y, W - 2 * M, contentBottom(c) - y, false);
    s.addText(`Tổng số: ${total} tin`, { x: M, y: H - 0.47, w: W - 2 * M, h: 0.3, fontFace: t.font, fontSize: 9, color: t.muted, align: 'center' });
    return;
  }
  if (t.cover === 'minimal') {
    s.background = { color: t.paper };
    s.addText(c.input.organization, { x: M, y: 0.6, w: W - 2 * M, h: 0.3, fontFace: t.font, fontSize: 10, color: t.muted });
    s.addText('Điểm tin\nbáo chí', { x: M, y: 1.1, w: W - 2 * M, h: 1.6, fontFace: t.headFont, fontSize: 40, bold: true, color: t.ink, valign: 'top' });
    s.addShape('rect', { x: M, y: 2.85, w: 1.2, h: 0.08, fill: { color: t.group.needs_attention }, line: { color: t.group.needs_attention } });
    s.addText(`Ngành xây dựng${region} · ngày ${c.input.reportDateLabel}`, { x: M, y: 3.05, w: W - 2 * M, h: 0.35, fontFace: t.font, fontSize: 14, color: t.ink });
    s.addText(window, { x: M, y: 3.4, w: W - 2 * M, h: 0.3, fontFace: t.font, fontSize: 9, color: t.muted });
    tiles(M, 4.0, W - 2 * M, 1.0, false);
    let y = 5.3;
    if (feature) {
      const iw = 2.6;
      const ih = 1.8;
      s.addImage({ data: feature.image!.data, x: W - M - iw, y, w: iw, h: ih, sizing: { type: 'cover', w: iw, h: ih } });
      s.addText(credit(feature), { x: W - M - iw, y: y + ih, w: iw, h: 0.25, fontFace: t.font, fontSize: 7, color: t.muted, align: 'right' });
      headlines(M, y, W - 2 * M - iw - 0.3, contentBottom(c) - y, false);
    } else headlines(M, y, W - 2 * M, contentBottom(c) - y, false);
    return;
  }
  // dark / photo (16:9)
  s.background = { color: '0F172A' };
  const leftW = t.cover === 'photo' && feature ? W * 0.5 : W * 0.55;
  if (t.cover === 'photo' && feature) {
    s.addImage({ data: feature.image!.data, x: W - (W - leftW), y: 0, w: W - leftW, h: H, sizing: { type: 'cover', w: W - leftW, h: H } });
    s.addText(credit(feature), { x: leftW + 0.2, y: H - 0.4, w: W - leftW - 0.4, h: 0.3, fontFace: t.font, fontSize: 8, color: 'FFFFFF', align: 'right' });
  }
  s.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: t.accent }, line: { color: t.accent } });
  s.addText(c.input.organization.toUpperCase(), { x: 0.6, y: 0.5, w: leftW - 0.9, h: 0.35, fontFace: t.font, fontSize: 10, color: '94A3B8' });
  s.addText('ĐIỂM TIN BÁO CHÍ', { x: 0.6, y: 0.95, w: leftW - 0.9, h: 0.9, fontFace: t.headFont, fontSize: 38, bold: true, color: 'FFFFFF' });
  s.addText(`Ngành xây dựng${region} · ngày ${c.input.reportDateLabel}`, { x: 0.6, y: 1.85, w: leftW - 0.9, h: 0.4, fontFace: t.font, fontSize: 15, color: t.cover === 'photo' ? 'FCD34D' : '5EEAD4' });
  s.addText(window, { x: 0.6, y: 2.25, w: leftW - 0.9, h: 0.3, fontFace: t.font, fontSize: 9.5, color: '94A3B8' });
  tiles(0.6, 2.8, leftW - 0.9, 1.15, true);
  if (t.cover === 'photo' && feature) headlines(0.6, 4.25, leftW - 0.9, H - 4.6, true);
  else {
    headlines(leftW + 0.2, 0.95, W - leftW - 0.8, H - 1.6, true);
    if (feature) {
      const iw = leftW - 0.9;
      s.addImage({ data: feature.image!.data, x: 0.6, y: 4.25, w: iw, h: H - 4.85, sizing: { type: 'cover', w: iw, h: H - 4.85 } });
      s.addText(credit(feature), { x: 0.6, y: H - 0.55, w: iw, h: 0.25, fontFace: t.font, fontSize: 7.5, color: '94A3B8', align: 'right' });
    }
  }
}

/* ------------------------------------------------------------------ feature stories (Tồn tại / Tích cực) */
interface Block { h: number; draw: (s: Slide, x: number, y: number, w: number) => void; group?: EditorialAssessment; heading?: boolean }

/** inline group heading (keeps with the next block) */
function headingBlock(c: Ctx, g: EditorialAssessment, count: number): Block {
  const { t } = c;
  return {
    h: 0.5, group: g, heading: true,
    draw: (s, x, y, w) => {
      s.addShape('rect', { x, y: y + 0.04, w, h: 0.36, fill: { color: t.tint[g] }, line: { color: t.tint[g] } });
      s.addShape('rect', { x, y: y + 0.04, w: 0.1, h: 0.36, fill: { color: t.group[g] }, line: { color: t.group[g] } });
      s.addText(`${GROUP_TITLE[g]}  ·  ${count} tin`, { x: x + 0.2, y: y + 0.04, w: w - 0.3, h: 0.36, fontFace: t.headFont, fontSize: 12, bold: true, color: t.group[g], valign: 'middle', charSpacing: 1 });
    },
  };
}

function featureBlock(c: Ctx, st: ReportStory, n: number, w: number): Block {
  const { t } = c;
  const g = st.group;
  const img = !!st.image?.data;
  const iw = img ? Math.min(t.landscape ? 3.6 : 2.5, w * 0.36) : 0;
  const ih = img ? iw * 0.66 : 0;
  const tw = w - (img ? iw + 0.25 : 0) - 0.2;
  const titlePt = t.size.title;
  const bodyPt = t.size.body;
  const kick = 0.24;
  const tH = textH(c, `${n}. ${st.title}`, tw, titlePt, true);
  const sH = textH(c, st.summary, tw, bodyPt);
  const srcH = textH(c, 'x'.repeat(sourcesLen(st)), tw, 8.5);
  const prop = g === 'needs_attention' ? `Đề xuất: ${cap(proposalText(st.proposal))}` : '';
  const pH = prop ? textH(c, prop, w - 0.5, bodyPt - 1) + 0.16 : 0;
  const textBlock = kick + tH + sH + srcH;
  const h = Math.max(textBlock, ih + (img ? 0.25 : 0)) + (pH ? pH + 0.08 : 0) + 0.12;
  return {
    h, group: g,
    draw: (s, x, y) => {
      s.addShape('rect', { x, y: y + 0.03, w: 0.06, h: h - 0.15, fill: { color: t.group[g] }, line: { color: t.group[g] } });
      let tx = x + 0.2;
      if (img) {
        s.addImage({ data: st.image!.data, x: x + 0.2, y: y + 0.05, w: iw, h: ih, sizing: { type: 'cover', w: iw, h: ih } });
        s.addText(credit(st), { x: x + 0.2, y: y + 0.05 + ih, w: iw, h: 0.22, fontFace: t.font, fontSize: 7, italic: true, color: t.muted, align: 'right' });
        tx = x + 0.2 + iw + 0.25;
      }
      let ty = y;
      s.addText(`${st.sector.toUpperCase()}`, { x: tx, y: ty, w: tw, h: kick, fontFace: t.font, fontSize: 8.5, bold: true, color: t.group[g], charSpacing: 1 });
      ty += kick;
      s.addText(`${n}. ${st.title}`, { x: tx, y: ty, w: tw, h: tH, fontFace: t.headFont, fontSize: titlePt, bold: true, color: t.ink, valign: 'top' });
      ty += tH;
      s.addText(st.summary, { x: tx, y: ty, w: tw, h: sH, fontFace: t.font, fontSize: bodyPt, color: t.ink, valign: 'top', align: 'justify' });
      ty += sH;
      s.addText(sourceRuns(st, c), { x: tx, y: ty, w: tw, h: srcH, fontFace: t.font, fontSize: 8.5, valign: 'top' });
      if (prop) {
        const py = y + Math.max(textBlock, ih + (img ? 0.25 : 0)) + 0.06;
        s.addShape('rect', { x: x + 0.2, y: py, w: w - 0.2, h: pH, fill: { color: t.tint[g] }, line: { color: t.tint[g] } });
        s.addText([{ text: 'Đề xuất: ', options: { bold: true, color: t.group[g] } }, { text: cap(proposalText(st.proposal)), options: { color: t.ink } }], {
          x: x + 0.3, y: py + 0.03, w: w - 0.4, h: pH - 0.06, fontFace: t.font, fontSize: bodyPt - 1, valign: 'middle',
        });
      }
    },
  };
}

/** photo-led page ("Ảnh lớn"): the real photo fills the left half */
function photoPage(c: Ctx, st: ReportStory, n: number, total: number) {
  const { pptx, t, W, H } = c;
  const s = pptx.addSlide();
  s.background = { color: t.paper };
  const pw = W * 0.5;
  s.addImage({ data: st.image!.data, x: 0, y: 0, w: pw, h: H, sizing: { type: 'cover', w: pw, h: H } });
  s.addShape('rect', { x: 0, y: H - 0.45, w: pw, h: 0.45, fill: { color: '000000', transparency: 45 }, line: { color: '000000', transparency: 100 } });
  s.addText(credit(st), { x: 0.3, y: H - 0.42, w: pw - 0.6, h: 0.38, fontFace: t.font, fontSize: 8.5, color: 'FFFFFF', valign: 'middle' });
  const g = st.group;
  const x = pw + 0.55;
  const w = W - x - 0.55;
  s.addShape('rect', { x, y: 0.55, w: 0.12, h: 0.32, fill: { color: t.group[g] }, line: { color: t.group[g] } });
  s.addText(`${GROUP_TITLE[g]} · ${n}/${total}`, { x: x + 0.22, y: 0.5, w: w - 0.22, h: 0.42, fontFace: t.font, fontSize: 11, bold: true, color: t.group[g], valign: 'middle', charSpacing: 1 });
  let y = 1.05;
  const tH = textH(c, st.title, w, 22, true);
  s.addText(st.title, { x, y, w, h: tH, fontFace: t.headFont, fontSize: 22, bold: true, color: t.ink, valign: 'top' });
  y += tH + 0.1;
  s.addText(st.sector, { x, y, w, h: 0.3, fontFace: t.font, fontSize: 11, italic: true, color: t.muted });
  y += 0.4;
  const sH = textH(c, st.summary, w, 14);
  s.addText(st.summary, { x, y, w, h: sH, fontFace: t.font, fontSize: 14, color: t.ink, valign: 'top', align: 'justify' });
  y += sH + 0.15;
  s.addText(sourceRuns(st, c), { x, y, w, h: 0.5, fontFace: t.font, fontSize: 10, valign: 'top' });
  if (g === 'needs_attention') {
    const prop = cap(proposalText(st.proposal));
    const pH = textH(c, `Đề xuất: ${prop}`, w - 0.3, 12) + 0.2;
    const py = Math.min(H - 0.75 - pH, Math.max(y + 0.7, H - 0.75 - pH));
    s.addShape('rect', { x, y: py, w, h: pH, fill: { color: t.tint[g] }, line: { color: t.group[g], width: 0.75 } });
    s.addText([{ text: 'Đề xuất: ', options: { bold: true, color: t.group[g] } }, { text: prop, options: { color: t.ink } }], { x: x + 0.15, y: py + 0.05, w: w - 0.3, h: pH - 0.1, fontFace: t.font, fontSize: 12, valign: 'middle' });
  }
  s.addText(`${c.input.reportDateLabel} · ${c.page++}`, { x, y: H - 0.45, w, h: 0.3, fontFace: t.font, fontSize: 9, color: t.muted, align: 'right' });
}

/** fill pages column by column with measured blocks; group headings stay with their first story; last page balanced */
function packFlow(c: Ctx, blocks: Block[], cols: number, title: string) {
  const { pptx, t, W, M } = c;
  const gap = cols > 1 ? 0.35 : 0;
  const colW = (W - 2 * M - gap * (cols - 1)) / cols;
  const sep = 0.16;
  const top = t.header === 'band' ? 1.0 : t.header === 'rule' ? 1.45 : 1.2;
  const avail = contentBottom(c) - top;
  const colsOf = (list: Block[], limit: number) => {
    const out: Block[][] = [];
    let col: Block[] = [];
    let used = 0;
    list.forEach((b, i) => {
      const next = b.heading ? list[i + 1] : undefined;
      const need = (col.length ? sep : 0) + b.h + (next ? sep + next.h : 0);
      if (col.length && used + need > limit) {
        out.push(col);
        col = [];
        used = 0;
      }
      used += (col.length ? sep : 0) + b.h;
      col.push(b);
    });
    if (col.length) out.push(col);
    return out;
  };
  const allCols = colsOf(blocks, avail);
  const pages: Block[][][] = [];
  for (let i = 0; i < allCols.length; i += cols) pages.push(allCols.slice(i, i + cols));
  // last page of a multi-column layout: spread its blocks evenly over the columns
  const last = pages[pages.length - 1];
  if (last && cols > 1) {
    const flat = last.flat();
    const total = flat.reduce((n, b) => n + b.h + sep, 0);
    const re = colsOf(flat, Math.min(avail, total / cols + 0.6));
    if (re.length <= cols) pages[pages.length - 1] = re;
  }
  pages.forEach((pg) => {
    const s = pptx.addSlide();
    const first = pg[0]?.[0];
    const g = first?.group ?? 'neutral';
    header(c, s, first?.heading || !first ? title : `${GROUP_TITLE[g]} (tiếp)`, first?.heading ? t.header === 'line' ? t.ink : t.accent : t.group[g], `Điểm tin ngày ${c.input.reportDateLabel}`);
    pg.forEach((colBlocks, ci) => {
      let y = top;
      const x = M + ci * (colW + gap);
      colBlocks.forEach((b, bi) => {
        b.draw(s, x, y, colW);
        y += b.h;
        if (bi < colBlocks.length - 1) {
          if (!b.heading && !colBlocks[bi + 1]!.heading) s.addShape('line', { x: x + 0.2, y: y + sep / 2, w: colW - 0.2, h: 0, line: { color: 'E2E2E2', width: 0.5 } });
          y += sep;
        }
      });
    });
    footer(c, s);
  });
}

/* ------------------------------------------------------------------ briefs (Trung lập) */
function briefBlock(c: Ctx, st: ReportStory, n: number, w: number): Block {
  const { t } = c;
  const img = !!st.image?.data;
  const iw = img ? (t.landscape ? 1.5 : 1.25) : 0;
  const ih = iw * 0.66;
  const tw = w - (img ? iw + 0.18 : 0) - 0.05;
  const tH = textH(c, `${n}. ${st.title}`, tw, t.size.briefTitle, true);
  const sH = textH(c, st.summary, tw, t.size.brief);
  const srcH = textH(c, 'x'.repeat(sourcesLen(st)), tw, 8);
  const h = Math.max(tH + sH + srcH, ih + 0.05) + 0.04;
  return {
    h, group: 'neutral',
    draw: (s, x, y) => {
      let tx = x;
      if (img) {
        s.addImage({ data: st.image!.data, x, y: y + 0.04, w: iw, h: ih, sizing: { type: 'cover', w: iw, h: ih } });
        tx = x + iw + 0.18;
      }
      s.addText([{ text: `${n}. `, options: { color: t.group.neutral } }, { text: st.title, options: { color: t.ink } }], { x: tx, y, w: tw, h: tH, fontFace: t.headFont, fontSize: t.size.briefTitle, bold: true, valign: 'top' });
      s.addText(st.summary, { x: tx, y: y + tH, w: tw, h: sH, fontFace: t.font, fontSize: t.size.brief, color: t.ink, valign: 'top', align: 'justify' });
      s.addText(sourceRuns(st, c), { x: tx, y: y + tH + sH, w: tw, h: srcH, fontFace: t.font, fontSize: 8, valign: 'top' });
    },
  };
}

/* ------------------------------------------------------------------ recommendations */
function recommendations(c: Ctx) {
  const { pptx, t, W, M } = c;
  const s = pptx.addSlide();
  const top = header(c, s, 'KIẾN NGHỊ VÀ ĐẦU MỐI XỬ LÝ', t.header === 'line' ? t.ink : t.accent, c.input.reportDateLabel);
  const tt = c.by('needs_attention');
  const w = W - 2 * M;
  let y = top + 0.05;
  const intro = 'Các nội dung có mức độ tiêu cực, đề nghị các phòng, đơn vị liên quan gửi phúc đáp phản hồi về Văn phòng Sở trong ngày, để tổng hợp, chuyển Trung tâm Báo chí Thành phố xử lý thông tin.';
  const iH = textH(c, intro, w - 0.4, t.size.body) + 0.2;
  s.addShape('rect', { x: M, y, w, h: iH, fill: { color: t.tint.needs_attention }, line: { color: t.group.needs_attention, width: 0.75 } });
  s.addText(intro, { x: M + 0.2, y: y + 0.05, w: w - 0.4, h: iH - 0.1, fontFace: t.font, fontSize: t.size.body, color: t.ink, valign: 'middle' });
  y += iH + 0.25;
  if (tt.length) {
    const fs = t.landscape ? 11 : 10;
    const rows: PptxGenJS.TableRow[] = [
      [
        { text: 'STT', options: { bold: true, color: 'FFFFFF', fill: { color: t.group.needs_attention }, align: 'center' } },
        { text: 'Tin tồn tại cần khắc phục', options: { bold: true, color: 'FFFFFF', fill: { color: t.group.needs_attention } } },
        { text: 'Đề xuất giao', options: { bold: true, color: 'FFFFFF', fill: { color: t.group.needs_attention } } },
      ],
      ...tt.map((st, i): PptxGenJS.TableRow => [
        { text: String(i + 1), options: { align: 'center', fill: { color: i % 2 ? t.soft : 'FFFFFF' } } },
        { text: st.title, options: { bold: true, fill: { color: i % 2 ? t.soft : 'FFFFFF' } } },
        { text: cap(proposalText(st.proposal)), options: { fill: { color: i % 2 ? t.soft : 'FFFFFF' } } },
      ]),
    ];
    const colW = [0.55, (w - 0.55) * 0.45, (w - 0.55) * 0.55];
    s.addTable(rows, { x: M, y, w, colW, fontFace: t.font, fontSize: fs, color: t.ink, border: { type: 'solid', pt: 0.5, color: 'D4D4D4' }, valign: 'middle', margin: 0.06, autoPage: false });
    y += tt.reduce((n, st) => n + Math.max(textH(c, st.title, colW[1]! - 0.15, fs, true), textH(c, proposalText(st.proposal), colW[2]! - 0.15, fs)) + 0.12, 0.4) + 0.2;
  } else {
    s.addText('Không có tin thuộc nhóm Tồn tại cần khắc phục trong khung giờ này.', { x: M, y, w, h: 0.4, fontFace: t.font, fontSize: t.size.body, italic: true, color: t.muted });
    y += 0.6;
  }
  const by = Math.min(y, contentBottom(c) - 0.9);
  s.addText(
    [
      { text: 'Phúc đáp trong ngày: ', options: { bold: true, color: t.ink } },
      ...(c.input.contactEmail ? [{ text: c.input.contactEmail, options: { hyperlink: { url: `mailto:${c.input.contactEmail}` }, color: '1D4ED8' } }] : [{ text: 'Văn phòng Sở', options: { color: t.ink } }]),
      { text: '\nCác đề xuất đầu mối là DỰ THẢO, cần lãnh đạo rà soát trước khi gửi.', options: { italic: true, color: t.muted, fontSize: 9 } },
    ],
    { x: M, y: by, w, h: 0.75, fontFace: t.font, fontSize: 11, valign: 'top' },
  );
  // totals of the report at the bottom of the page (when there is room)
  const ty = Math.min(by + 1.0, contentBottom(c) - 1.05);
  if (ty > by + 0.85) {
    const tw = (w - 0.3) / 3;
    GROUPS.forEach((g, i) => {
      const tx = M + i * (tw + 0.15);
      s.addShape('rect', { x: tx, y: ty, w: tw, h: 0.9, fill: { color: t.tint[g] }, line: { color: t.tint[g] } });
      s.addShape('rect', { x: tx, y: ty, w: 0.08, h: 0.9, fill: { color: t.group[g] }, line: { color: t.group[g] } });
      s.addText([{ text: `${c.by(g).length}`, options: { fontSize: 24, bold: true, color: t.group[g] } }, { text: `  ${GROUP_SHORT[g]}`, options: { fontSize: 11, color: t.ink } }], {
        x: tx + 0.2, y: ty, w: tw - 0.3, h: 0.9, fontFace: t.headFont, valign: 'middle',
      });
    });
  }
  footer(c, s);
}

/* ------------------------------------------------------------------ entry */
export async function buildStyledPptx(style: StyleId, input: StyledReportInput): Promise<Uint8Array> {
  const t = THEMES[style];
  const pptx = new PptxGenJS();
  const size = t.landscape ? WIDE : A4;
  pptx.defineLayout({ name: 'NR', width: size.w, height: size.h });
  pptx.layout = 'NR';
  pptx.title = `Điểm tin ${input.reportDateLabel}`;
  pptx.company = input.organization;
  const by = (g: EditorialAssessment) => input.stories.filter((s) => s.group === g);
  const c: Ctx = { pptx, t, W: size.w, H: size.h, M: t.landscape ? 0.55 : 0.6, input, by, page: 1 };

  cover(c);
  c.page++;
  const cols = t.landscape ? 2 : 1;
  const colW = (c.W - 2 * c.M - (cols - 1) * 0.35) / cols;
  const flow: Block[] = [];
  for (const g of GROUPS) {
    const list = by(g);
    if (!list.length) continue;
    // "Ảnh lớn": stories with a real photo get a photo-led page each; the rest flows with the others (no empty panels)
    const items = list.map((st, i) => ({ st, n: i + 1 })).filter((x) => !(t.photoLed && g !== 'neutral' && x.st.image?.data));
    if (t.photoLed && g !== 'neutral') list.forEach((st, i) => st.image?.data && photoPage(c, st, i + 1, list.length));
    if (!items.length) continue;
    flow.push(headingBlock(c, g, list.length));
    for (const x of items) flow.push(g === 'neutral' ? briefBlock(c, x.st, x.n, colW) : featureBlock(c, x.st, x.n, colW));
  }
  if (flow.length) packFlow(c, flow, cols, 'ĐIỂM TIN BÁO CHÍ');
  recommendations(c);
  return (await pptx.write({ outputType: 'uint8array' })) as Uint8Array;
}
