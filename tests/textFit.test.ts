import { describe, expect, it } from 'vitest';
import { cutText, measureShape, textWidthPt, wrapLines } from '../src/reports/textFit.js';

describe('real text measurement for the template (Arial-compatible widths, 19/11/2026)', () => {
  it('glyph widths match Arial, Vietnamese included', () => {
    expect(textWidthPt('a', 10)).toBeCloseTo(5.56, 2);
    expect(textWidthPt(' ', 10)).toBeCloseTo(2.78, 2);
    expect(textWidthPt('ệ', 10)).toBeCloseTo(5.56, 2);
    expect(textWidthPt('B', 10)).toBeCloseTo(6.67, 2);
    expect(textWidthPt('B', 10, true)).toBeCloseTo(7.22, 2); // Arial Bold
    // decomposed input (NFD) is measured like the precomposed letter
    expect(textWidthPt('ệ', 10)).toBeCloseTo(textWidthPt('ệ', 10), 2);
  });
  it('wraps word by word like PowerPoint', () => {
    expect(wrapLines('một hai ba', 1000, 14)).toBe(1);
    expect(wrapLines('aaaa bbbb', textWidthPt('aaaa', 14) + 1, 14)).toBe(2);
    expect(wrapLines('', 100, 14)).toBe(1);
  });
  it('measures a shape with its insets and paragraph spacing', () => {
    const sp = (text: string) => `<p:sp><a:off x="0" y="0"/><a:ext cx="1270000" cy="381000"/><p:txBody><a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/><a:p><a:pPr><a:spcAft><a:spcPts val="400"/></a:spcAft></a:pPr><a:r><a:rPr lang="vi-VN" sz="1000"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
    const one = measureShape(sp('ngắn'));
    expect(one.widthPt).toBe(100);
    expect(one.boxPt).toBe(30);
    expect(one.needPt).toBeCloseTo(10 * 1.2 + 4, 1);
    expect(measureShape(sp('chữ '.repeat(60))).needPt).toBeGreaterThan(30); // overflows → fitting kicks in
  });
  it('cuts at a sentence end, else a word end, with "…"', () => {
    expect(cutText('Câu một rất dài. Câu hai.', 100)).toBe('Câu một rất dài. Câu hai.');
    expect(cutText('Câu thứ nhất khá dài ở đây. Câu hai tiếp theo nữa.', 35)).toBe('Câu thứ nhất khá dài ở đây. …');
    expect(cutText('một hai ba bốn năm sáu bảy', 14)).toBe('một hai ba…');
  });
});
