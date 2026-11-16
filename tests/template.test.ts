import { existsSync, readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { buildReportPptx, type ReportStory } from '../src/reports/pptx.js';
import { buildFromTemplate, estimateLines, imageSize, TemplateMismatchError, type TemplateImage } from '../src/reports/templatePptx.js';

/** The Department's template is private (reference/ is git-ignored) – these tests run only where it exists. */
const TEMPLATE = 'reference/hcm-news-reporter-skill/assets/reference-report.pptx';
const has = existsSync(TEMPLATE);

// 2x1 PNG (synthetic test pixel data, not a news photo)
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHxkzIAsAtjsN8wF8hLsAAAAASUVORK5CYII=', 'base64'));

const story = (i: number, group: ReportStory['group'], img = false): ReportStory & { imageKey: string | null } => ({
  id: `${group}-${i}`, group, sector: 'Giao thông', shortLabel: `[Mẫu thử] Nhãn ${i}`, title: `[Mẫu thử] Tiêu đề tin số ${i} có dấu tiếng Việt: Thủ Đức – Cần Giờ`,
  summary: `[Mẫu thử] Tóm tắt ${i} với số liệu 1.250 tỷ đồng & ký tự đặc biệt <>"'.`, sources: [{ name: 'Báo mẫu', url: `https://fixture-a.example.vn/bai-${i}-1851101001.htm`, publishedAt: '2026-11-08T19:30:00+07:00' }],
  proposal: group === 'needs_attention' ? 'Đề xuất: đầu mối đề xuất, chờ rà soát.' : undefined, image: null, imageKey: img ? 'img1' : null,
});

describe.skipIf(!has)('original template adapter (RPT-01/02/03 structural)', () => {
  const images = new Map<string, TemplateImage>([['img1', { bytes: PNG, ext: 'png', width: 2, height: 1, credit: 'Báo mẫu', sourceUrl: 'https://fixture-a.example.vn/x' }]]);
  const input = {
    organization: 'SỞ XÂY DỰNG THÀNH PHỐ HỒ CHÍ MINH – VĂN PHÒNG SỞ', reportDate: '2026-11-09', images, coverImageKey: 'img1', tcFeatureKey: null,
    stories: [
      { ...story(1, 'needs_attention', true), sources: [...story(1, 'needs_attention').sources, { name: 'Báo mẫu D', url: 'https://fixture-d.example.vn/bai-1-1851101101.htm', publishedAt: '2026-11-08T20:15:00+07:00' }] },
      story(2, 'needs_attention'), story(3, 'needs_attention', true), story(4, 'positive', true), ...[5, 6, 7, 8].map((i) => story(i, 'neutral'))],
  };

  it('builds dynamic slide count, valid XML, no stale sample content, real hyperlinks', async () => {
    const out = await buildFromTemplate(readFileSync(TEMPLATE), input);
    expect(out.slideCount).toBe(1 + 2 + 1 + 2 + 1); // cover, TT×2, TC, TL×2, kiến nghị
    const zip = await JSZip.loadAsync(out.bytes);
    let allText = '';
    for (const f of Object.keys(zip.files).filter((x) => /\.(xml|rels)$/.test(x))) {
      const xml = await zip.file(f)!.async('string');
      expect(XMLValidator.validate(xml), f).toBe(true);
      allText += xml;
    }
    for (const stale of ['Vĩnh Hội', 'Gamuda', 'HoREA', '05/11/2026', 'can-canh-chung-cu', 'Minh họa metro', 'Ảnh minh họa', 'notesSlide']) {
      expect(allText.includes(stale), stale).toBe(false);
    }
    // any window can be reported: the cover says "NGÀY …", never "SÁNG NGÀY …" (user, 16/11/2026)
    expect(allText).toContain('NGÀY 09/11/2026');
    expect(allText).not.toContain('SÁNG NGÀY');
    expect(allText).toContain('ngày 09 tháng 11 năm 2026');
    expect(allText).toContain('TỒN TẠI (2/2)');
    expect(allText).toContain('https://fixture-a.example.vn/bai-1-1851101001.htm');
    // multi-source line: both publishers hyperlinked in the same "Nguồn:" paragraph
    const s2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(s2).toMatch(/Nguồn: <\/a:t>[\s\S]*?Báo mẫu<\/a:t>[\s\S]*?  \|  <\/a:t>[\s\S]*?Báo mẫu D<\/a:t>/);
    expect(allText).toContain('https://fixture-d.example.vn/bai-1-1851101101.htm');
    expect(allText).toContain('&lt;&gt;&quot;'); // escaped special characters
    const media = Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/') && !zip.files[f]!.dir);
    expect(media.some((m) => /hcm_photo_\d+\.png$/.test(m))).toBe(true);
    expect(media.some((m) => /image[2-9]\.(jpeg|png)$/.test(m))).toBe(false); // sample photos removed
    const pres = await zip.file('ppt/presentation.xml')!.async('string');
    expect(pres).toContain('<p:sldSz cx="7556500" cy="10693400"/>'); // A4 portrait preserved
    expect((pres.match(/<p:sldId /g) ?? []).length).toBe(7);
  });

  it('cover/recommendation summary lists never overflow: "… và N tin khác" + note', async () => {
    const many = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ ...story(i, 'neutral'), shortLabel: `[Mẫu thử] Nhãn khá dài số ${i} về dự án nhà ở` }));
    const out = await buildFromTemplate(readFileSync(TEMPLATE), { ...input, stories: many });
    const zip = await JSZip.loadAsync(out.bytes);
    const cover = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(cover).toMatch(/… và \d+ tin khác/);
    expect(out.notes.join(' ')).toMatch(/Bìa – nhóm TIN TRUNG LẬP: khung chỉ đủ \d+\/8 nhãn/);
    expect(out.slideCount).toBe(1 + 3 + 1); // cover, 3 TL pages (3+3+2), kiến nghị – no story dropped
  });

  it('text-only when no usable photo (RPT-02): frame removed, never substituted', async () => {
    const out = await buildFromTemplate(readFileSync(TEMPLATE), { ...input, images: new Map(), coverImageKey: null });
    const zip = await JSZip.loadAsync(out.bytes);
    expect(Object.keys(zip.files).some((f) => f.includes('hcm_photo'))).toBe(false);
    expect(out.notes.join(' ')).toContain('không dùng ảnh thay thế');
  });

  it('refuses a different template instead of producing a wrong document (RPT-03)', async () => {
    const demo = await buildReportPptx({ organization: 'x', window: { from: '2026-11-08T17:00:00+07:00', to: '2026-11-09T08:00:00+07:00' }, reportDateLabel: '09/11/2026', stories: [], storiesPerPage: 2, isDemoTemplate: true });
    await expect(buildFromTemplate(demo, input)).rejects.toBeInstanceOf(TemplateMismatchError);
  });
});

describe('template helpers', () => {
  it('reads PNG/JPEG dimensions', () => {
    expect(imageSize(PNG)).toEqual({ width: 2, height: 1, ext: 'png' });
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x01, 0x2c, 0x01, 0x90, 3]);
    expect(imageSize(jpeg)).toEqual({ width: 400, height: 300, ext: 'jpeg' });
  });
  it('estimates wrapped lines for overflow warnings', () => {
    expect(estimateLines(['ngắn'], 2.2)).toBe(1);
    expect(estimateLines(['x'.repeat(60)], 2.2)).toBeGreaterThan(2);
  });
});
