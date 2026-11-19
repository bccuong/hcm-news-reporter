import JSZip from 'jszip';
import type { EditorialAssessment } from '../domain/schemas.js';
import type { ReportStory } from './pptx.js';

/**
 * Template-faithful renderer for the Department's reference PPTX (A4 portrait, 6 slides).
 * Works directly on OOXML: clones the template's own slides per story group, rewrites text inside the
 * existing shapes while keeping each paragraph's pPr/rPr (font, size, colour, alignment), swaps photos
 * in the existing picture frames (cover-crop via srcRect, never stretched), removes unused story slots,
 * and drops every sample story, photo, hyperlink and speaker note from the template.
 *
 * Shape ids come from `scripts/template-audit.ts` on reference-report.pptx (see docs/TEMPLATE_INTEGRATION.md).
 * If a different template is uploaded and the ids/labels do not match, a TemplateMismatchError is thrown
 * (the caller then reports BLOCKED instead of producing a wrong document).
 */

export class TemplateMismatchError extends Error {}
/** the group heading as written in the Department's template (old wording) or in a template already updated */
const TT_TEMPLATE_HEADINGS = ['TỒN TẠI CẦN KHẮC PHỤC', 'TIN CẦN NGHIÊN CỨU, XỬ LÝ'] as const;
/** group name in the reports since 19/11/2026 (was "TỒN TẠI CẦN KHẮC PHỤC") */
export const TT_HEADING = 'TIN CẦN NGHIÊN CỨU, XỬ LÝ';

interface Slot { card: number; badge: number; num: number; title: number; summary: number; source: number; propBg?: number; prop?: number; pic?: number }
export const TEMPLATE_MAP = {
  cover: { slide: 1, org: 2, title: 3, pic: 4098, summaryHeader: 7, tt: { count: 10, list: 11 }, tc: { count: 14, list: 15 }, tl: { count: 18, list: 19 }, date: 20, check: [3, 'TỔNG HỢP THÔNG TIN BÁO CHÍ'] },
  ttFirst: {
    slide: 2, label: 3, heading: 4, sub: 5, pageNum: 25, check: [4, TT_TEMPLATE_HEADINGS],
    slots: [
      { card: 8, badge: 9, num: 10, title: 11, summary: 12, source: 13, propBg: 14, prop: 15, pic: 1026 },
      { card: 16, badge: 17, num: 18, title: 19, summary: 20, source: 21, propBg: 22, prop: 23, pic: 1028 },
    ] as Slot[],
  },
  ttNext: {
    slide: 3, label: 3, heading: 4, sub: 5, pageNum: 25, check: [4, TT_TEMPLATE_HEADINGS],
    slots: [
      { card: 6, badge: 7, num: 8, title: 9, summary: 10, source: 11, propBg: 12, prop: 13, pic: 2050 },
      { card: 14, badge: 15, num: 16, title: 17, summary: 18, source: 19, propBg: 20, prop: 21, pic: 2052 },
    ] as Slot[],
  },
  tc: {
    slide: 4, label: 3, heading: 4, sub: 5, pageNum: 25, feature: 18, featureCaption: 19, check: [3, 'TIN TÍCH CỰC'],
    slots: [
      { card: 6, badge: 7, num: 8, title: 9, summary: 10, source: 11, pic: 3082 },
      { card: 12, badge: 13, num: 14, title: 15, summary: 16, source: 17, pic: 3084 },
    ] as Slot[],
  },
  tl: {
    slide: 5, label: 3, heading: 4, sub: 5, pageNum: 25, check: [3, 'TIN TRUNG LẬP'],
    slots: [
      { card: 6, badge: 7, num: 8, title: 9, summary: 10, source: 11 },
      { card: 12, badge: 13, num: 14, title: 15, summary: 16, source: 17 },
      { card: 18, badge: 19, num: 20, title: 21, summary: 22, source: 23 },
    ] as Slot[],
  },
  reco: { slide: 6, email: 7, groups: 13, ttTitle: 16, tt: 17, tc: 21, tl: 25, footer: 26, pageNum: 27, check: [2, 'KIẾN NGHỊ VÀ ĐẦU MỐI XỬ LÝ'] },
} as const;

export interface TemplateImage { bytes: Uint8Array; ext: 'jpeg' | 'png'; width: number; height: number; credit?: string; sourceUrl: string }

export interface TemplateReportInput {
  organization: string;
  reportDate: string; // YYYY-MM-DD (VN)
  stories: Array<ReportStory & { imageKey?: string | null }>;
  images: Map<string, TemplateImage>;
  coverImageKey?: string | null;
  tcFeatureKey?: string | null;
  tcHeading?: string;
  tcSubtitle?: string;
  tlSubtitle?: string;
  contactEmail?: string;
}

const EMU = 914400;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------------ XML helpers */
function shapeRange(xml: string, id: number): [number, number] | null {
  const re = /<p:(sp|pic|cxnSp)>[\s\S]*?<\/p:\1>/g;
  for (const m of xml.matchAll(re)) {
    if (new RegExp(`<p:cNvPr id="${id}"[ >/]`).test(m[0].slice(0, 400))) return [m.index!, m.index! + m[0].length];
  }
  return null;
}
function getShape(xml: string, id: number): string | null {
  const r = shapeRange(xml, id);
  return r ? xml.slice(r[0], r[1]) : null;
}
function editShape(xml: string, id: number, fn: (sp: string) => string): string {
  const r = shapeRange(xml, id);
  if (!r) throw new TemplateMismatchError(`Không thấy shape #${id} trong mẫu`);
  return xml.slice(0, r[0]) + fn(xml.slice(r[0], r[1])) + xml.slice(r[1]);
}
function removeShape(xml: string, id: number): string {
  const r = shapeRange(xml, id);
  return r ? xml.slice(0, r[0]) + xml.slice(r[1]) : xml;
}
export function shapeText(sp: string): string {
  return [...sp.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((p) => [...p[1]!.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join('')).join('\n');
}

interface ParaTpl { pPr: string; rPr: string; linkRPr: string | null; end: string }
function paraTemplates(sp: string): ParaTpl[] {
  const out: ParaTpl[] = [];
  for (const m of sp.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
    const p = m[1]!;
    const pPr = /<a:pPr[^>]*\/>|<a:pPr[^>]*>[\s\S]*?<\/a:pPr>/.exec(p)?.[0] ?? '';
    const runs = [...p.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)].map((r) => /<a:rPr[^>]*\/>|<a:rPr[^>]*>[\s\S]*?<\/a:rPr>/.exec(r[1]!)?.[0] ?? '<a:rPr lang="vi-VN"/>');
    const plain = runs.find((r) => !r.includes('hlinkClick')) ?? runs[0] ?? '<a:rPr lang="vi-VN"/>';
    const link = runs.find((r) => r.includes('hlinkClick')) ?? null;
    const end = /<a:endParaRPr[^>]*\/>|<a:endParaRPr[^>]*>[\s\S]*?<\/a:endParaRPr>/.exec(p)?.[0] ?? '';
    out.push({ pPr, rPr: plain, linkRPr: link, end });
  }
  return out;
}

export interface Run { text: string; linkRid?: string; url?: string }
/** Replace paragraphs; line i uses template paragraph pick(i) styling. */
function setParagraphs(sp: string, lines: Run[][], pick: (i: number, n: number) => number = (i, n) => Math.min(i, n - 1)): string {
  const tpls = paraTemplates(sp);
  if (!tpls.length) throw new TemplateMismatchError('Shape không có đoạn văn mẫu');
  const body = lines
    .map((runs, i) => {
      const t = tpls[pick(i, tpls.length)]!;
      const rs = runs
        .map((r) => {
          if (r.linkRid && t.linkRPr) {
            // hlinkClick may carry an extLst with self-closing children: replace the WHOLE element
            const rpr = t.linkRPr.replace(/<a:hlinkClick[^>]*\/>|<a:hlinkClick[^>]*>[\s\S]*?<\/a:hlinkClick>/, `<a:hlinkClick r:id="${r.linkRid}" tooltip="${esc(r.url ?? '')}"/>`);
            return `<a:r>${rpr}<a:t>${esc(r.text)}</a:t></a:r>`;
          }
          return `<a:r>${t.rPr}<a:t>${esc(r.text)}</a:t></a:r>`;
        })
        .join('');
      return `<a:p>${t.pPr}${rs}${t.end}</a:p>`;
    })
    .join('');
  const re = /(<p:txBody>[\s\S]*?(?:<a:lstStyle\/>|<\/a:lstStyle>))[\s\S]*<\/p:txBody>/;
  if (!re.test(sp)) throw new TemplateMismatchError('Shape không có khung chữ chuẩn (lstStyle)');
  return sp.replace(re, (_, head: string) => `${head}${body}</p:txBody>`);
}
const lines = (...l: string[]): Run[][] => l.map((t) => [{ text: t }]);

function setXfrm(sp: string, p: { x?: number; y?: number; cx?: number; cy?: number }): string {
  return sp.replace(/<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/, (_, x, y, cx, cy) =>
    `<a:off x="${p.x ?? x}" y="${p.y ?? y}"/><a:ext cx="${p.cx ?? cx}" cy="${p.cy ?? cy}"/>`,
  );
}
function xfrm(sp: string) {
  const m = /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(sp);
  if (!m) throw new TemplateMismatchError('Shape không có vị trí');
  return { x: +m[1]!, y: +m[2]!, cx: +m[3]!, cy: +m[4]! };
}
function setSlideNum(xml: string, id: number, n: number) {
  return editShape(xml, id, (sp) => sp.replace(/(<a:fld[^>]*type="slidenum"[^>]*>[\s\S]*?<a:t>)[^<]*(<\/a:t>)/, `$1${n}$2`));
}

/** Read width/height from JPEG SOF or PNG IHDR. */
export function imageSize(b: Uint8Array): { width: number; height: number; ext: 'jpeg' | 'png' } | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20), ext: 'png' };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      const len = (b[i + 2]! << 8) | b[i + 3]!;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]!, ext: 'jpeg' };
      }
      i += 2 + len;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ slide builder */
interface Built { xml: string; rels: string[] /* <Relationship> elements without layout */; layoutTarget: string }

class Media {
  n = 0;
  files = new Map<string, Uint8Array>();
}

function relEl(id: string, type: 'image' | 'hyperlink', target: string) {
  const t = type === 'image' ? 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image' : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
  return `<Relationship Id="${id}" Type="${t}" Target="${esc(target)}"${type === 'hyperlink' ? ' TargetMode="External"' : ''}/>`;
}

class SlideCtx {
  rels: string[] = [];
  private k = 100;
  constructor(public xml: string, private media: Media) {}
  link(url: string) {
    const id = `rId${++this.k}`;
    this.rels.push(relEl(id, 'hyperlink', url));
    return id;
  }
  /** Put a real photo in an existing picture frame (cover crop). */
  picture(picId: number, img: TemplateImage | undefined | null): boolean {
    if (!img) {
      this.xml = removeShape(this.xml, picId);
      return false;
    }
    const name = `hcm_photo_${++this.media.n}.${img.ext}`;
    this.media.files.set(`ppt/media/${name}`, img.bytes);
    const id = `rId${++this.k}`;
    this.rels.push(relEl(id, 'image', `../media/${name}`));
    this.xml = editShape(this.xml, picId, (sp) => {
      const f = xfrm(sp);
      const frame = f.cx / f.cy;
      const ratio = img.width / img.height;
      let rect = '<a:srcRect/>';
      if (ratio > frame) {
        const crop = Math.round(((1 - frame / ratio) / 2) * 100000);
        rect = `<a:srcRect l="${crop}" r="${crop}"/>`;
      } else if (ratio < frame) {
        const crop = Math.round(((1 - ratio / frame) / 2) * 100000);
        rect = `<a:srcRect t="${crop}" b="${crop}"/>`;
      }
      return sp
        .replace(/r:embed="[^"]+"/, `r:embed="${id}"`)
        .replace(/<a:srcRect[^>]*\/>|<a:srcRect[^>]*>[\s\S]*?<\/a:srcRect>/, rect)
        .replace(/descr="[^"]*"/, `descr="${esc(`Ảnh: ${img.credit ?? ''} – ${img.sourceUrl}`)}"`);
    });
    return true;
  }
}

function sourceRuns(ctx: SlideCtx, st: ReportStory): Run[][] {
  const runs: Run[] = [{ text: 'Nguồn: ' }];
  st.sources.forEach((s, i) => {
    if (i) runs.push({ text: '  |  ' });
    runs.push({ text: s.name, linkRid: ctx.link(s.url), url: s.url });
  });
  return [runs];
}

/** the TT column header is longer than the template's (19/11/2026): its first line 14 pt → 12 pt so it stays on one line */
function fitHeader(sp: string, g: EditorialAssessment): string {
  if (g !== 'needs_attention') return sp;
  const i = sp.indexOf('<a:p>'), j = sp.indexOf('</a:p>', i);
  if (i < 0 || j < 0) return sp;
  return sp.slice(0, i) + sp.slice(i, j).replace(/ sz="\d+"/g, ' sz="1200"') + sp.slice(j);
}
/** narrow column headers (cover, recommendations): the short form fits on one line like the old "TỒN TẠI CẦN KHẮC PHỤC" */
const GROUP_LABEL: Record<EditorialAssessment, string> = { needs_attention: 'CẦN NGHIÊN CỨU, XỬ LÝ', positive: 'TÍCH CỰC', neutral: 'TIN TRUNG LẬP' };

function fillSlot(ctx: SlideCtx, slot: Slot, st: ReportStory & { imageKey?: string | null }, num: number, images: Map<string, TemplateImage>) {
  ctx.xml = editShape(ctx.xml, slot.num, (sp) => setParagraphs(sp, lines(String(num))));
  ctx.xml = editShape(ctx.xml, slot.title, (sp) => setParagraphs(sp, lines(st.title)));
  ctx.xml = editShape(ctx.xml, slot.summary, (sp) => setParagraphs(sp, lines(st.summary)));
  ctx.xml = editShape(ctx.xml, slot.source, (sp) => setParagraphs(sp, sourceRuns(ctx, st)));
  if (slot.prop) ctx.xml = editShape(ctx.xml, slot.prop, (sp) => setParagraphs(sp, lines(st.proposal || 'Đề xuất: đầu mối đề xuất, chờ rà soát.')));
  if (slot.pic) {
    const img = st.imageKey ? images.get(st.imageKey) : null;
    const used = ctx.picture(slot.pic, img);
    if (!used) {
      // text-only layout: widen the summary to the card's inner width
      const card = xfrm(getShape(ctx.xml, slot.card)!);
      ctx.xml = editShape(ctx.xml, slot.summary, (sp) => {
        const s = xfrm(sp);
        return setXfrm(sp, { cx: card.x + card.cx - s.x - Math.round(0.15 * EMU) });
      });
    }
  }
}

function clearSlot(ctx: SlideCtx, slot: Slot) {
  for (const id of [slot.card, slot.badge, slot.num, slot.title, slot.summary, slot.source, slot.propBg, slot.prop, slot.pic]) if (id) ctx.xml = removeShape(ctx.xml, id);
}

/**
 * Rough text-fit estimate for a list box (14 pt Arial: ~0.5 em average glyph width, 1.2 line height).
 * Used only to WARN – fonts are never shrunk silently.
 */
export function estimateLines(texts: string[], widthIn: number, pt = 14): number {
  const charsPerLine = Math.max(8, Math.floor((widthIn * 72) / (pt * 0.5)));
  return texts.reduce((s, t) => s + Math.max(1, Math.ceil(t.length / charsPerLine)), 0);
}
function boxCapacity(xml: string, id: number, indentIn: number) {
  const f = xfrm(getShape(xml, id)!);
  return { lines: Math.floor(f.cy / EMU / ((14 * 1.2 + 6) / 72)), widthIn: f.cx / EMU - indentIn }; // + paragraph spacing
}
function fitWarn(xml: string, id: number, texts: string[], where: string, notes: string[], indentIn = 0.35) {
  if (!getShape(xml, id)) return;
  const cap = boxCapacity(xml, id, indentIn);
  const need = estimateLines(texts, cap.widthIn);
  if (need > cap.lines) notes.push(`${where}: cần ~${need} dòng, khung chứa ~${cap.lines} dòng – rút gọn "nhãn ngắn" để tránh tràn khung.`);
}
/**
 * Summary list (cover / recommendations) that never overflows its box: shows as many labels as fit and ends with
 * "… và N tin khác". Full stories are always on their own pages; font size is never changed.
 */
function fittedList(xml: string, id: number, stories: ReportStory[], where: string, notes: string[]): Run[][] {
  if (!stories.length) return lines('(không có tin)');
  const cap = boxCapacity(xml, id, 0.35);
  const all = stories.map((s) => s.shortLabel);
  if (estimateLines(all, cap.widthIn) <= cap.lines) return lines(...all);
  const shown: string[] = [];
  for (const l of all) {
    const rest = all.length - shown.length - 1;
    const tail = rest > 0 ? [`… và ${rest} tin khác`] : [];
    if (estimateLines([...shown, l, ...tail], cap.widthIn) > cap.lines) break;
    shown.push(l);
  }
  const hidden = all.length - shown.length;
  notes.push(`${where}: khung chỉ đủ ${shown.length}/${all.length} nhãn – đã ghi "… và ${hidden} tin khác" (rút gọn "nhãn ngắn" để hiện đủ).`);
  return lines(...shown, `… và ${hidden} tin khác`);
}

function listLines(stories: ReportStory[], max = 7): Run[][] {
  if (!stories.length) return lines('(không có tin)');
  const shown = stories.slice(0, max).map((s) => s.shortLabel);
  if (stories.length > max) shown.push(`… và ${stories.length - max} tin khác`);
  return lines(...shown);
}

export async function buildFromTemplate(templateBytes: Uint8Array, input: TemplateReportInput): Promise<{ bytes: Uint8Array; slideCount: number; notes: string[] }> {
  const zip = await JSZip.loadAsync(templateBytes);
  const notes: string[] = [];
  const read = async (p: string) => {
    const f = zip.file(p);
    if (!f) throw new TemplateMismatchError(`Mẫu thiếu ${p}`);
    return f.async('string');
  };
  const src: Record<number, { xml: string; layout: string; rels: string }> = {};
  for (let i = 1; i <= 6; i++) {
    const rels = await read(`ppt/slides/_rels/slide${i}.xml.rels`);
    const layout = /Target="(\.\.\/slideLayouts\/[^"]+)"/.exec(rels)?.[1];
    if (!layout) throw new TemplateMismatchError(`slide${i} không có layout`);
    src[i] = { xml: await read(`ppt/slides/slide${i}.xml`), layout, rels };
  }
  // sanity: template must be the audited one
  for (const role of Object.values(TEMPLATE_MAP)) {
    const [id, want] = role.check as readonly [number, string | readonly string[]];
    const labels = typeof want === 'string' ? [want] : want;
    const label = labels[0]!;
    const sp = getShape(src[role.slide]!.xml, id);
    if (!sp || !labels.some((l) => shapeText(sp).includes(l))) throw new TemplateMismatchError(`Mẫu PPTX khác mẫu đã khảo sát (slide ${role.slide}, shape #${id} không chứa "${label}")`);
  }

  const [y, mo, d] = input.reportDate.split('-');
  const dateLabel = `${d}/${mo}/${y}`;
  const by = (g: EditorialAssessment) => input.stories.filter((s) => s.group === g);
  const media = new Media();
  const out: Built[] = [];
  const mk = (slide: number) => new SlideCtx(src[slide]!.xml, media);
  const push = (ctx: SlideCtx, slide: number) => out.push({ xml: ctx.xml, rels: ctx.rels, layoutTarget: src[slide]!.layout });

  /* ---- cover ---- */
  {
    const m = TEMPLATE_MAP.cover;
    const c = mk(m.slide);
    c.xml = editShape(c.xml, m.org, (sp) => setParagraphs(sp, lines(input.organization)));
    c.xml = editShape(c.xml, m.title, (sp) => setParagraphs(sp, lines('TỔNG HỢP THÔNG TIN BÁO CHÍ', 'PHẢN ÁNH VỀ NGÀNH XÂY DỰNG', `NGÀY ${dateLabel}`)));
    c.xml = editShape(c.xml, m.summaryHeader, (sp) => setParagraphs(sp, lines(`TÓM TẮT BÌA – ${input.stories.length} TIN`)));
    for (const [g, k] of [['needs_attention', 'tt'], ['positive', 'tc'], ['neutral', 'tl']] as const) {
      c.xml = editShape(c.xml, m[k].count, (sp) => fitHeader(setParagraphs(sp, lines(GROUP_LABEL[g], `${by(g).length} tin`)), g));
      const fitted = fittedList(c.xml, m[k].list, by(g), `Bìa – nhóm ${GROUP_LABEL[g]}`, notes);
      c.xml = editShape(c.xml, m[k].list, (sp) => setParagraphs(sp, fitted, () => 0));
    }
    c.xml = editShape(c.xml, m.date, (sp) => setParagraphs(sp, lines(`Thành phố Hồ Chí Minh, ngày ${d} tháng ${mo} năm ${y}`)));
    const coverImg = input.coverImageKey ? input.images.get(input.coverImageKey) : null;
    if (!c.picture(m.pic, coverImg)) notes.push('Bìa: không có ảnh báo gốc phù hợp – bỏ khung ảnh bìa (không dùng ảnh thay thế).');
    push(c, m.slide);
  }

  /* ---- TT pages (2 per page) ---- */
  const tt = by('needs_attention');
  const ttPages = Math.ceil(tt.length / 2);
  for (let p = 0; p < ttPages; p++) {
    const m = p === 0 ? TEMPLATE_MAP.ttFirst : TEMPLATE_MAP.ttNext;
    const c = mk(m.slide);
    c.xml = editShape(c.xml, m.label, (sp) => setParagraphs(sp, lines(`CẦN NGHIÊN CỨU, XỬ LÝ (${p + 1}/${ttPages})`)));
    c.xml = editShape(c.xml, m.heading, (sp) => setParagraphs(sp, lines(TT_HEADING)));
    m.slots.forEach((slot, i) => {
      const st = tt[p * 2 + i];
      if (st) fillSlot(c, slot, st, p * 2 + i + 1, input.images);
      else clearSlot(c, slot);
    });
    push(c, m.slide);
  }

  /* ---- TC pages ---- */
  const tc = by('positive');
  for (let p = 0; p < Math.ceil(tc.length / 2); p++) {
    const m = TEMPLATE_MAP.tc;
    const c = mk(m.slide);
    const chunk = tc.slice(p * 2, p * 2 + 2);
    const heading = input.tcHeading || [...new Set(chunk.map((s) => s.sector.toUpperCase()))].slice(0, 2).join(' VÀ ');
    c.xml = editShape(c.xml, m.heading, (sp) => setParagraphs(sp, lines(heading)));
    c.xml = editShape(c.xml, m.sub, (sp) => setParagraphs(sp, lines(input.tcSubtitle || chunk.map((s) => s.shortLabel).join(' và '))));
    // with a single story, the feature photo moves up into the empty second card's position
    const slot2Top = xfrm(getShape(c.xml, m.slots[1]!.card)!).y;
    m.slots.forEach((slot, i) => {
      const st = chunk[i];
      if (st) fillSlot(c, slot, st, p * 2 + i + 1, input.images);
      else clearSlot(c, slot);
    });
    const feat = p === 0 && input.tcFeatureKey ? input.images.get(input.tcFeatureKey) : null;
    if (chunk.length === 1 && feat) {
      const dy = xfrm(getShape(c.xml, m.feature)!).y - slot2Top;
      for (const id of [m.feature, m.featureCaption]) c.xml = editShape(c.xml, id, (sp) => setXfrm(sp, { y: xfrm(sp).y - dy }));
    }
    if (c.picture(m.feature, feat)) {
      c.xml = editShape(c.xml, m.featureCaption, (sp) => setParagraphs(sp, lines(`Ảnh: ${feat!.credit ?? 'báo gốc'}`)));
    } else {
      c.xml = removeShape(c.xml, m.featureCaption);
    }
    push(c, m.slide);
  }

  /* ---- TL pages (3 per page) ---- */
  const tl = by('neutral');
  for (let p = 0; p < Math.ceil(tl.length / 3); p++) {
    const m = TEMPLATE_MAP.tl;
    const c = mk(m.slide);
    const chunk = tl.slice(p * 3, p * 3 + 3);
    c.xml = editShape(c.xml, m.sub, (sp) => setParagraphs(sp, lines(input.tlSubtitle || chunk.map((s) => s.shortLabel).join(', '))));
    m.slots.forEach((slot, i) => {
      const st = chunk[i];
      if (st) fillSlot(c, slot, st, p * 3 + i + 1, input.images);
      else clearSlot(c, slot);
    });
    push(c, m.slide);
  }

  /* ---- recommendations ---- */
  {
    const m = TEMPLATE_MAP.reco;
    const c = mk(m.slide);
    // keep template icons (image rels) and the office mailto, drop everything else
    const keep = [...src[m.slide]!.rels.matchAll(/<Relationship [^>]*\/>/g)].map((r) => r[0]).filter((r) => /media\/|mailto:/.test(r));
    if (input.contactEmail) {
      c.xml = editShape(c.xml, m.email, (sp) => setParagraphs(sp, [[{ text: input.contactEmail!, linkRid: 'rId4', url: `mailto:${input.contactEmail}` }]]));
      c.rels.push(...keep.filter((r) => !/mailto:/.test(r)), relEl('rId4', 'hyperlink', `mailto:${input.contactEmail}`));
    } else c.rels.push(...keep);
    const groupLines: string[] = [];
    for (const s of tt) {
      const p = (s.proposal || 'Đầu mối đề xuất, chờ rà soát.').replace(/^Đề xuất:\s*/, '');
      groupLines.push(s.shortLabel, p.charAt(0).toLocaleUpperCase('vi') + p.slice(1)); // "Giao Phòng …"
    }
    c.xml = editShape(c.xml, m.groups, (sp) => setParagraphs(sp, groupLines.length ? lines(...groupLines) : lines('Không có tin Cần nghiên cứu, xử lý trong khung giờ này.'), (i) => i % 2));
    c.xml = editShape(c.xml, m.ttTitle, (sp) => fitHeader(setParagraphs(sp, lines(GROUP_LABEL.needs_attention)), 'needs_attention')); // the template's header above the TT list
    for (const [id, list, g] of [[m.tt, tt, 'needs_attention'], [m.tc, tc, 'positive'], [m.tl, tl, 'neutral']] as const) {
      const fitted = fittedList(c.xml, id, list, `Kiến nghị – nhóm ${GROUP_LABEL[g]}`, notes);
      c.xml = editShape(c.xml, id, (sp) => setParagraphs(sp, fitted, () => 0));
    }
    fitWarn(c.xml, m.groups, groupLines, 'Kiến nghị – danh sách đầu mối', notes, 0);
    c.xml = editShape(c.xml, m.footer, (sp) => setParagraphs(sp, lines(`VĂN PHÒNG SỞ  ${dateLabel}`)));
    push(c, m.slide);
    if (tt.length > 4) notes.push('Kiến nghị: nhiều hơn 4 tin Cần nghiên cứu, xử lý – kiểm tra tràn khung trên trang Kiến nghị.');
  }

  /* ---- page numbers ---- */
  out.forEach((s, i) => {
    const id = i === out.length - 1 ? TEMPLATE_MAP.reco.pageNum : 25;
    if (shapeRange(s.xml, id)) s.xml = setSlideNum(s.xml, id, i + 1);
  });

  /* ---- package rewrite ---- */
  for (const f of Object.keys(zip.files)) {
    if (/^ppt\/slides\/(_rels\/)?slide\d+\.xml(\.rels)?$/.test(f) || /^ppt\/notesSlides\//.test(f)) zip.remove(f);
  }
  out.forEach((s, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, s.xml);
    zip.file(
      `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="${s.layoutTarget}"/>${s.rels.join('')}</Relationships>`,
    );
  });
  for (const [p, b] of media.files) zip.file(p, b);

  let ct = await read('[Content_Types].xml');
  ct = ct.replace(/<Override PartName="\/ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml"[^>]*\/>/g, '');
  ct = ct.replace('</Types>', out.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('') + '</Types>');
  zip.file('[Content_Types].xml', ct);

  let prels = await read('ppt/_rels/presentation.xml.rels');
  prels = prels.replace(/<Relationship [^>]*relationships\/slide"[^>]*\/>/g, '');
  prels = prels.replace('</Relationships>', out.map((_, i) => `<Relationship Id="rIdHcmS${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('') + '</Relationships>');
  zip.file('ppt/_rels/presentation.xml.rels', prels);
  let pres = await read('ppt/presentation.xml');
  pres = pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${out.map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdHcmS${i + 1}"/>`).join('')}</p:sldIdLst>`);
  zip.file('ppt/presentation.xml', pres);

  // layouts/master may carry a dated footer ("… SÁNG 05/11/2026"): replace stale dates with the report date
  for (const f of Object.keys(zip.files).filter((x) => /^ppt\/(slideLayouts|slideMasters)\/[^/]+\.xml$/.test(x))) {
    const x = await zip.file(f)!.async('string');
    const y2 = x.replace(/(<a:t>[^<]*?)\b\d{2}\/\d{2}\/20\d{2}\b([^<]*<\/a:t>)/g, `$1${dateLabel}$2`).replace(/(<a:t>[^<]*?)SÁNG\s+(?=(?:NGÀY\s+)?\d{2}\/\d{2}\/20\d{2})/g, '$1');
    if (y2 !== x) zip.file(f, y2);
  }

  const app = zip.file('docProps/app.xml');
  if (app) zip.file('docProps/app.xml', (await app.async('string')).replace(/<Slides>\d+<\/Slides>/, `<Slides>${out.length}</Slides>`).replace(/<Notes>\d+<\/Notes>/, '<Notes>0</Notes>'));

  // remove sample photos no longer referenced by any part (no stale images left in the file)
  const referenced = new Set<string>();
  for (const f of Object.keys(zip.files).filter((x) => x.endsWith('.rels'))) {
    const txt = await zip.file(f)!.async('string');
    for (const m of txt.matchAll(/Target="([^"]*media\/[^"]+)"/g)) referenced.add(m[1]!.replace(/^.*media\//, ''));
  }
  // NOTE: skip directory entries – JSZip.remove('ppt/media/') would delete every image recursively
  for (const f of Object.keys(zip.files).filter((x) => x.startsWith('ppt/media/') && !zip.files[x]!.dir)) {
    if (!referenced.has(f.replace('ppt/media/', ''))) zip.remove(f);
  }

  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { bytes, slideCount: out.length, notes };
}
