import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { buildReportPdf, PDF_FONT_FILES } from '../src/reports/pdf.js';
import type { ReportStory } from '../src/reports/pptx.js';

const font = (f: string) => new Uint8Array(readFileSync(`web/public/fonts/${f}`));
const fonts = { regular: font(PDF_FONT_FILES.regular), bold: font(PDF_FONT_FILES.bold), italic: font(PDF_FONT_FILES.italic) };
const story = (i: number, group: ReportStory['group'], proposal?: string): ReportStory => ({
  id: `s${i}`, group, sector: 'Ngập lụt', shortLabel: '', title: `Tin số ${i}: Mưa lớn gây ngập đường Nguyễn Hữu Cảnh 🌧`, summary: 'Nhiều tuyến đường ngập sâu 20–40 cm, người dân dắt bộ xe chết máy. '.repeat(3),
  sources: [{ name: 'Thanh Niên', url: `https://thanhnien.vn/bai-${i}.htm`, publishedAt: '2026-11-16T07:30:00+07:00' }], proposal,
});

describe('built-in PDF', () => {
  it('builds an A4 report with every story, clickable source links and the contact e-mail', async () => {
    const stories = [story(1, 'needs_attention', 'Đề xuất: giao Phòng Hạ tầng kỹ thuật tham mưu, xử lý.'), ...Array.from({ length: 14 }, (_, i) => story(i + 2, i % 2 ? 'positive' : 'neutral'))];
    const r = await buildReportPdf({ organization: 'SỞ XÂY DỰNG THÀNH PHỐ HỒ CHÍ MINH – VĂN PHÒNG SỞ', reportDate: '2026-11-16', window: { from: '2026-11-15T17:00:00+07:00', to: '2026-11-16T08:00:00+07:00' }, stories, contactEmail: 'vp@example.vn', regionName: 'TP.HCM' }, fonts);
    expect(Buffer.from(r.bytes.subarray(0, 5)).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(r.bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1); // flows over pages
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
    const uris = doc.getPages().flatMap((p) => {
      const a = p.node.lookup(PDFName.of('Annots'));
      return a instanceof PDFArray ? a.asArray().map((x) => ((doc.context.lookup(x) as PDFDict).lookup(PDFName.of('A')) as PDFDict).lookup(PDFName.of('URI')) as PDFString).map((u) => u.decodeText()) : [];
    });
    for (const s of stories) expect(uris).toContain(s.sources[0]!.url);
    expect(uris).toContain('mailto:vp@example.vn');
    expect(doc.getTitle()).toBe('Tổng hợp thông tin báo chí ngày 16/11/2026');
  });
  it('a photo that is not JPEG/PNG is left out with a note (text layout), never replaced', async () => {
    const st = { ...story(1, 'positive'), image: { data: 'data:image/webp;base64,AAAA', credit: 'x' } };
    const r = await buildReportPdf({ organization: 'Sở', reportDate: '2026-11-16', window: { from: '2026-11-15T17:00:00+07:00', to: '2026-11-16T08:00:00+07:00' }, stories: [st] }, fonts);
    expect(r.notes.join(' ')).toContain('không phải JPEG/PNG');
  });
});
