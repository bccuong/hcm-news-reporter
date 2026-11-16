import type { StyleId } from './styles.js';

/**
 * Report templates selectable at export (local app and web).
 *  - "skill-so-xay-dung": the Department's ORIGINAL PowerPoint template from the user's Skill
 *    (reference/hcm-news-reporter-skill/assets/reference-report.pptx), published with the app by the owner's decision
 *    of 15/11/2026 → web/public/templates/skill-so-xay-dung.pptx. Filled shape-by-shape (src/reports/templatePptx.ts).
 *  - four original designs of this project (src/reports/styles.ts).
 *  - "upload": a .pptx with the same structure as the Department's template, uploaded by the user (local) or kept in
 *    the browser (web).
 */
export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  kind: 'original-pptx' | 'style' | 'upload';
  orientation: 'portrait' | 'landscape';
  /** original-pptx: file name under web/public/templates/ */
  file?: string;
  style?: StyleId;
}

export const SKILL_TEMPLATE_ID = 'skill-so-xay-dung';
/** the Department's Word report ("Tổng hợp Điểm tin Báo chí", supplied 16/11/2026), under web/public/templates/ */
export const DOCX_TEMPLATE_FILE = 'so-xay-dung.docx';
export const UPLOAD_TEMPLATE_ID = 'upload';

export const TEMPLATES: TemplateInfo[] = [
  {
    id: SKILL_TEMPLATE_ID, name: 'Mẫu Sở Xây dựng TP.HCM (từ Skill)', kind: 'original-pptx', orientation: 'portrait', file: 'skill-so-xay-dung.pptx',
    description: 'Mẫu PowerPoint gốc của Sở trong Skill: Bìa → Tồn tại → Tích cực → Trung lập → Kiến nghị, giữ nguyên định dạng.',
  },
  { id: 'hanh-chinh', name: 'Hành chính trang trọng', kind: 'style', style: 'hanh-chinh', orientation: 'portrait', description: 'A4 dọc, chữ có chân, viền kép, tông đỏ sẫm; bìa có số liệu + tiêu điểm, tin xếp liền mạch kèm ảnh – hợp văn bản gửi lãnh đạo.' },
  { id: 'ban-tin', name: 'Bản tin hiện đại', kind: 'style', style: 'ban-tin', orientation: 'landscape', description: '16:9, bìa tối có số liệu, tin chảy hai cột liền mạch (ảnh + tóm tắt + đề xuất) – hợp trình chiếu.' },
  { id: 'toi-gian', name: 'Tối giản', kind: 'style', style: 'toi-gian', orientation: 'portrait', description: 'A4 dọc, trắng đen gọn, tin xếp liền mạch, ít trang – dễ in, dễ đọc.' },
  { id: 'anh-lon', name: 'Ảnh lớn', kind: 'style', style: 'anh-lon', orientation: 'landscape', description: '16:9, mỗi tin có ảnh được một trang ảnh lớn; tin không ảnh và tin trung lập gom hai cột.' },
];

export function templateById(id: string | undefined | null): TemplateInfo {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]!;
}
