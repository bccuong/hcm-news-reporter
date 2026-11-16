import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { SettingsSchema } from '../src/domain/schemas.js';
import type { ReportStory } from '../src/reports/pptx.js';
import { buildDocxFromTemplate, DocxTemplateMismatchError } from '../src/reports/templateDocx.js';

/** the Department's Word report template (supplied 16/11/2026, personal names removed from its properties) */
const TPL = readFileSync('web/public/templates/so-xay-dung.docx');
const st = (id: string, group: ReportStory['group'], title: string, urls: string[], proposal?: string): ReportStory =>
  ({ id, articleId: id, mergedArticleIds: [], group, sector: '', shortLabel: title, title, summary: `Tóm tắt ${id} & <đặc biệt>.`, sources: urls.map((u) => ({ name: 'Báo', url: u, publishedAt: '2026-11-17T07:00:00+07:00' })), proposal, image: null, imageUrl: null }) as ReportStory;
const stories = [
  st('tt1', 'needs_attention', 'Mưa lớn gây ngập sâu ở TP.HCM', ['https://thanhnien.vn/a-1.htm', 'https://vnexpress.net/a-2.html'], 'Đề xuất: giao Phòng Hạ tầng kỹ thuật tham mưu, xử lý.'),
  st('tc1', 'positive', 'Thông xe nút giao', ['https://dantri.com.vn/b.htm']),
];
const read = async (bytes: Uint8Array) => {
  const z = await JSZip.loadAsync(bytes);
  const doc = await z.file('word/document.xml')!.async('string');
  const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  return { z, doc, text: unesc([...doc.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')), rels: await z.file('word/_rels/document.xml.rels')!.async('string') };
};

describe('Word report from the Department template', () => {
  it('keeps the letterhead, dates the report, no "SÁNG", no sample news; one block per story in the template format', async () => {
    const { bytes } = await buildDocxFromTemplate(TPL, { reportDate: '2026-11-17', stories, contactEmail: 'phucdap@example.gov.vn' });
    const { z, doc, text, rels } = await read(bytes);
    expect(text).toContain('SỞ XÂY DỰNG');
    expect(text).toContain('ngày 17 tháng 11 năm 2026');
    expect(text).toContain('NGÀY 17/11/2026');
    expect(text).not.toContain('SÁNG');
    expect(text).not.toMatch(/Thiên niên kỷ|Chánh Hưng|The Aristo/); // the template's own stories are gone
    expect(text).toContain('Mưa lớn gây ngập sâu ở TP.HCM');
    expect(text).toContain('Tóm tắt tt1 & <đặc biệt>.'); // escaped, not broken XML
    expect(doc).toContain('Tóm tắt tt1 &amp; &lt;đặc biệt&gt;.');
    expect(text).toContain('Đề xuất: Giao Phòng Hạ tầng kỹ thuật tham mưu, xử lý.');
    expect(text).toContain('(Không có tin.)'); // empty "Tin trung lập"
    expect(text).toContain('phucdap@example.gov.vn');
    // real hyperlinks for every source, the template's sample links removed
    for (const u of ['https://thanhnien.vn/a-1.htm', 'https://vnexpress.net/a-2.html', 'https://dantri.com.vn/b.htm']) expect(rels).toContain(`Target="${u}"`);
    expect(rels).not.toMatch(/thien-nien-ky|chanh-hung/);
    // the static chart picture of another day → a Word chart of THIS report's counts
    const chart = await z.file('word/charts/chart1.xml')!.async('string');
    expect(chart).toContain('Điểm tin Báo chí ngày 17/11/2026');
    expect(chart).toContain('Tổng: 2');
    expect(chart).toMatch(/Tồn tại cần khắc phục<\/c:v><\/c:tx>[\s\S]*?<c:v>1<\/c:v><\/c:pt><\/c:numLit>/);
    expect(z.file('word/media/image1.png')).toBeNull();
    expect(await z.file('[Content_Types].xml')!.async('string')).toContain('/word/charts/chart1.xml');
    // no personal names in the file properties
    const core = await z.file('docProps/core.xml')!.async('string');
    expect(core).toContain('<dc:creator>News Reporter</dc:creator>');
    expect(core).toContain('<cp:lastModifiedBy>News Reporter</cp:lastModifiedBy>');
    // valid XML parts
    expect(doc.split('<w:p>').length + doc.split('<w:p ').length).toBeGreaterThan(20);
    expect(doc.match(/<w:hyperlink /g)?.length).toBe(3 + 1); // 3 sources + the e-mail link of the closing note
  });
  it('a template whose structure changed is BLOCKED instead of producing a wrong file', async () => {
    const z = await JSZip.loadAsync(TPL);
    const doc = await z.file('word/document.xml')!.async('string');
    z.file('word/document.xml', doc.replace('TÍCH CỰC', 'KHÁC'));
    await expect(buildDocxFromTemplate(await z.generateAsync({ type: 'uint8array' }), { reportDate: '2026-11-17', stories })).rejects.toBeInstanceOf(DocxTemplateMismatchError);
  });
  it('Word is ticked by default; saved configs from before (only pptx) get it once', () => {
    expect(SettingsSchema.parse({}).report.outputFormats).toEqual(['pptx', 'docx']);
    expect(SettingsSchema.parse({ report: { outputFormats: ['pptx'] } }).report.outputFormats).toEqual(['pptx', 'docx']);
    expect(SettingsSchema.parse({ report: { outputFormats: [], outputFormatsRev: 2 } }).report.outputFormats).toEqual(['pptx', 'docx']); // an empty saved list (shared web config) is ticked again
    expect(SettingsSchema.parse({ report: { outputFormats: ['pptx'], outputFormatsRev: 3 } }).report.outputFormats).toEqual(['pptx']); // a later choice is kept
    expect(SettingsSchema.parse({}).report.pdfRenderer).toBe('builtin');
    expect(SettingsSchema.parse({ report: { pdfRenderer: 'auto' } }).report.pdfRenderer).toBe('builtin');
    expect(SettingsSchema.parse({ report: { pdfRenderer: 'powerpoint' } }).report.pdfRenderer).toBe('powerpoint');
  });
});
