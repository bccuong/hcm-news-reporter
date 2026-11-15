import PptxGenJS from 'pptxgenjs';
import { ASSESSMENT_LABEL } from '../domain/classify.js';
import type { EditorialAssessment } from '../domain/schemas.js';
import { formatVn } from '../domain/timeWindow.js';

/**
 * DEMO renderer (pptxgenjs). It reproduces the page size (A4 portrait, 7556500 x 10693400 EMU) and the
 * section order audited from the user's reference-report.pptx (cover → TỒN TẠI → TÍCH CỰC → TRUNG LẬP → KIẾN NGHỊ),
 * but it is NOT the original template: shapes, theme and artwork are re-drawn. Fidelity gate RPT-01..03 stays BLOCKED
 * until a template-shape adapter (pptx-automizer or the Skill's build_report.py) is wired in. Every slide is labeled.
 */

export interface ReportStory {
  id: string;
  group: EditorialAssessment;
  sector: string;
  shortLabel: string;
  title: string;
  summary: string;
  sources: Array<{ name: string; url: string; publishedAt: string }>;
  proposal?: string;
  image?: { data: string; caption?: string; credit?: string } | null; // data: base64 data URI of a REAL article photo
}

export interface ReportInput {
  organization: string;
  window: { from: string; to: string };
  reportDateLabel: string;
  stories: ReportStory[];
  storiesPerPage: number;
  contactEmail?: string;
  isDemoTemplate: true;
}

const W = 7556500 / 914400; // 8.264 in
const H = 10693400 / 914400; // 11.694 in
const NAVY = '1F3A68';
const TEAL = '1C8C8C';
const RED = 'B42318';
const GREEN = '15803D';
const GRAY = '5B6472';
const GROUP_COLOR: Record<EditorialAssessment, string> = { needs_attention: RED, positive: GREEN, neutral: GRAY };
const GROUP_TITLE: Record<EditorialAssessment, string> = { needs_attention: 'TỒN TẠI CẦN KHẮC PHỤC', positive: 'TIN TÍCH CỰC', neutral: 'TIN TRUNG LẬP' };
const FONT = 'Arial';

export interface LayoutWarning {
  storyId: string;
  field: string;
  message: string;
}

/** Approximate text-fit check (chars per line × lines), used before export – never silently shrinks fonts. */
export function checkFit(stories: ReportStory[]): LayoutWarning[] {
  const out: LayoutWarning[] = [];
  for (const s of stories) {
    if (s.title.length > 120) out.push({ storyId: s.id, field: 'title', message: `Tiêu đề ${s.title.length}/120 ký tự – có thể tràn khung` });
    const max = s.group === 'neutral' ? 330 : 260;
    if (s.summary.length > max) out.push({ storyId: s.id, field: 'summary', message: `Tóm tắt ${s.summary.length}/${max} ký tự – cần rút gọn` });
    if (s.shortLabel.length > 42) out.push({ storyId: s.id, field: 'shortLabel', message: `Nhãn bìa ${s.shortLabel.length}/42 ký tự` });
    if (!s.sources.length) out.push({ storyId: s.id, field: 'sources', message: 'Thiếu nguồn – không được xuất tin không có nguồn' });
  }
  return out;
}

function demoBadge(slide: PptxGenJS.Slide) {
  slide.addText('BẢN DEMO – chưa dùng mẫu PPTX gốc của Sở', {
    x: 0.3, y: H - 0.42, w: 4.2, h: 0.25, fontFace: FONT, fontSize: 7, color: 'B45309', italic: true,
  });
}

function footer(slide: PptxGenJS.Slide, page: number, dateLabel: string) {
  slide.addShape('line', { x: 0.45, y: H - 0.55, w: W - 0.9, h: 0, line: { color: 'C9D2DE', width: 0.75 } });
  slide.addText(`VĂN PHÒNG SỞ  ${dateLabel}`, { x: 0.45, y: H - 0.5, w: 4, h: 0.3, fontFace: FONT, fontSize: 8, color: GRAY });
  slide.addText(String(page), { x: W - 1.0, y: H - 0.5, w: 0.55, h: 0.3, fontFace: FONT, fontSize: 9, bold: true, color: NAVY, align: 'right' });
  demoBadge(slide);
}

export async function buildReportPptx(input: ReportInput): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'A4P', width: W, height: H });
  pptx.layout = 'A4P';
  pptx.title = `Điểm tin ${input.reportDateLabel}`;
  pptx.company = input.organization;
  let page = 1;
  const groups: EditorialAssessment[] = ['needs_attention', 'positive', 'neutral'];
  const by = (g: EditorialAssessment) => input.stories.filter((s) => s.group === g);

  /* ---- cover ---- */
  const cover = pptx.addSlide();
  cover.background = { color: 'FFFFFF' };
  cover.addShape('rect', { x: 0, y: 0, w: W, h: 0.35, fill: { color: NAVY } });
  cover.addText(input.organization, { x: 0.45, y: 0.6, w: W - 0.9, h: 0.4, fontFace: FONT, fontSize: 11, bold: true, color: NAVY, align: 'center' });
  cover.addText(`TỔNG HỢP THÔNG TIN BÁO CHÍ\nPHẢN ÁNH VỀ NGÀNH XÂY DỰNG\nSÁNG NGÀY ${input.reportDateLabel}`, {
    x: 0.45, y: 1.2, w: W - 0.9, h: 1.5, fontFace: FONT, fontSize: 20, bold: true, color: NAVY, align: 'center', valign: 'middle',
  });
  cover.addText(`Khung giờ: ${formatVn(input.window.from)} – ${formatVn(input.window.to)} (giờ Việt Nam, không gồm thời điểm kết thúc)`, {
    x: 0.45, y: 2.75, w: W - 0.9, h: 0.3, fontFace: FONT, fontSize: 9, color: GRAY, align: 'center', italic: true,
  });
  cover.addText(`TÓM TẮT BÌA – ${input.stories.length} TIN`, { x: 0.45, y: 3.25, w: W - 0.9, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: TEAL });
  let y = 3.75;
  for (const g of groups) {
    const list = by(g);
    cover.addShape('rect', { x: 0.45, y, w: 0.08, h: 1.6, fill: { color: GROUP_COLOR[g] } });
    cover.addText(`${GROUP_TITLE[g]}\n${list.length} tin`, { x: 0.65, y, w: 2.4, h: 0.6, fontFace: FONT, fontSize: 11, bold: true, color: GROUP_COLOR[g] });
    cover.addText(list.length ? list.map((s) => s.shortLabel).join('\n') : '(không có tin)', {
      x: 3.1, y, w: W - 3.55, h: 1.6, fontFace: FONT, fontSize: 10, color: '1F2937', valign: 'top',
    });
    y += 1.85;
  }
  footer(cover, page++, input.reportDateLabel);

  /* ---- group pages ---- */
  for (const g of groups) {
    const list = by(g);
    if (!list.length) continue;
    const per = Math.max(1, input.storiesPerPage);
    const pages = Math.ceil(list.length / per);
    for (let p = 0; p < pages; p++) {
      const s = pptx.addSlide();
      s.addShape('rect', { x: 0, y: 0, w: W, h: 0.9, fill: { color: GROUP_COLOR[g] } });
      s.addText(`${GROUP_TITLE[g]}${pages > 1 ? ` (${p + 1}/${pages})` : ''}`, { x: 0.45, y: 0.15, w: W - 0.9, h: 0.6, fontFace: FONT, fontSize: 18, bold: true, color: 'FFFFFF' });
      const chunk = list.slice(p * per, p * per + per);
      const slotH = (H - 1.2 - 0.8) / per;
      chunk.forEach((st, i) => {
        const top = 1.15 + i * slotH;
        const num = p * per + i + 1;
        s.addShape('ellipse', { x: 0.45, y: top, w: 0.42, h: 0.42, fill: { color: GROUP_COLOR[g] } });
        s.addText(String(num), { x: 0.45, y: top, w: 0.42, h: 0.42, fontFace: FONT, fontSize: 12, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });
        s.addText(st.sector, { x: 1.0, y: top, w: 3, h: 0.25, fontFace: FONT, fontSize: 8, color: TEAL, bold: true });
        s.addText(st.title, { x: 1.0, y: top + 0.25, w: W - 1.45, h: 0.75, fontFace: FONT, fontSize: 13, bold: true, color: NAVY, valign: 'top', fit: 'none' });
        const imgW = 2.6;
        const hasImg = !!st.image?.data;
        if (hasImg) {
          s.addImage({ data: st.image!.data, x: 1.0, y: top + 1.05, w: imgW, h: 1.75, sizing: { type: 'cover', w: imgW, h: 1.75 } });
          if (st.image!.caption || st.image!.credit) {
            s.addText(`${st.image!.caption ?? ''}${st.image!.credit ? ` (Ảnh: ${st.image!.credit})` : ''}`.slice(0, 140), {
              x: 1.0, y: top + 2.82, w: imgW, h: 0.4, fontFace: FONT, fontSize: 6.5, italic: true, color: GRAY, valign: 'top',
            });
          }
        }
        const tx = hasImg ? 1.0 + imgW + 0.2 : 1.0;
        s.addText(st.summary, { x: tx, y: top + 1.05, w: W - tx - 0.45, h: 1.75, fontFace: FONT, fontSize: 10.5, color: '1F2937', valign: 'top', paraSpaceAfter: 2 });
        s.addText(
          [
            { text: 'Nguồn: ', options: { bold: true } },
            ...st.sources.flatMap((src, k) => [
              ...(k ? [{ text: '  |  ' }] : []),
              { text: `${src.name} (${formatVn(src.publishedAt)})`, options: { hyperlink: { url: src.url }, color: '1D4ED8' } },
            ]),
          ],
          { x: 1.0, y: top + 3.25, w: W - 1.45, h: 0.3, fontFace: FONT, fontSize: 8, color: GRAY },
        );
        if (g === 'needs_attention' && st.proposal) {
          s.addText(st.proposal, { x: 1.0, y: top + 3.55, w: W - 1.45, h: 0.45, fontFace: FONT, fontSize: 8.5, italic: true, color: RED, valign: 'top' });
        }
      });
      footer(s, page++, input.reportDateLabel);
    }
  }

  /* ---- recommendations ---- */
  const r = pptx.addSlide();
  r.addShape('rect', { x: 0, y: 0, w: W, h: 0.9, fill: { color: NAVY } });
  r.addText('KIẾN NGHỊ VÀ ĐẦU MỐI XỬ LÝ', { x: 0.45, y: 0.15, w: W - 0.9, h: 0.6, fontFace: FONT, fontSize: 18, bold: true, color: 'FFFFFF' });
  const tt = by('needs_attention');
  r.addText(
    tt.length
      ? tt.map((s) => `• ${s.shortLabel}: ${s.proposal || 'Đầu mối đề xuất, chờ rà soát.'}`).join('\n')
      : 'Không có tin thuộc nhóm Tồn tại cần khắc phục trong khung giờ này.',
    { x: 0.45, y: 1.15, w: W - 0.9, h: 4.2, fontFace: FONT, fontSize: 10.5, color: '1F2937', valign: 'top' },
  );
  r.addText('Các đề xuất đầu mối là DỰ THẢO, cần lãnh đạo rà soát trước khi gửi.', { x: 0.45, y: 5.5, w: W - 0.9, h: 0.3, fontFace: FONT, fontSize: 9, italic: true, color: 'B45309' });
  let yy = 6.0;
  for (const g of groups) {
    r.addText(`${ASSESSMENT_LABEL[g].toUpperCase()}: ${by(g).length} tin`, { x: 0.45, y: yy, w: W - 0.9, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: GROUP_COLOR[g] });
    yy += 0.35;
  }
  if (input.contactEmail) r.addText(input.contactEmail, { x: 0.45, y: yy + 0.2, w: W - 0.9, h: 0.3, fontFace: FONT, fontSize: 9, color: NAVY });
  footer(r, page++, input.reportDateLabel);

  const out = (await pptx.write({ outputType: 'uint8array' })) as Uint8Array;
  return out;
}
