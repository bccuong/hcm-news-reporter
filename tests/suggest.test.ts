import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/domain/defaults.js';
import { SettingsSchema, type Article } from '../src/domain/schemas.js';
import { applySuggestion, phrasesOf, statusOf, suggestFilter, withTitleExclusion, type Judged } from '../src/domain/suggest.js';

const s = SettingsSchema.parse(defaultSettings());
let n = 0;
const art = (title: string, sapo: string, body = ''): Article => ({ id: `a_${(++n).toString().padStart(12, '0')}`, sourceId: 'tn', sourceName: 'Thanh Niên', title, sapo, bodyText: body, contentSections: [], imageCandidates: [] }) as unknown as Article;

describe('daily filter suggestions (learned from the team review, applied by an editor)', () => {
  it('phrases: 2–3 words, no function words at the ends, no numbers, no city name', () => {
    const p = phrasesOf('TP.HCM đẩy nhanh tiến độ cải tạo kênh Tham Lương năm 2026');
    expect(p).toContain('đẩy nhanh');
    expect(p).toContain('kênh tham lương');
    expect(p.some((x) => /\d/.test(x))).toBe(false);
    expect(p.some((x) => x.startsWith('năm') || x.endsWith('của'))).toBe(false);
  });
  it('include: a relevant story excluded for a missing word → that word, with no judged story broken', () => {
    const missed = art('Cử tri phường Bình Thạnh TP.HCM kiến nghị lát lại lối đi bộ', 'Người dân phường Bình Thạnh phản ánh lối đi bộ xuống cấp.');
    const missed2 = art('TP.HCM lát đá lại lối đi bộ phố Nguyễn Huệ', 'Lối đi bộ phố Nguyễn Huệ ở TP.HCM được lát đá lại sau 10 năm.');
    const off = art('Phường Bình Thạnh TP.HCM tổ chức giải chạy', 'Giải chạy bộ cuối tuần ở phường Bình Thạnh.');
    const judged = new Map<string, Judged>([[missed.id, { relevant: true, why: 'label' }], [missed2.id, { relevant: true, why: 'decision' }], [off.id, { relevant: false, why: 'label' }]]);
    expect(statusOf(missed, s)).toBe('irrelevant');
    const sug = suggestFilter([missed, missed2, off], judged, s);
    const inc = sug.find((x) => x.kind === 'include');
    expect(inc).toBeTruthy();
    expect(inc!.fixes).toBeGreaterThanOrEqual(1);
    // applying it keeps the stories and does not let the judged off-topic one in
    expect(inc!.phrase).toBe('lối đi bộ');
    expect(inc!.fixes).toBe(2);
    const next = applySuggestion(s, inc!);
    expect(statusOf(missed2, next)).not.toBe('irrelevant');
    expect(statusOf(missed, next)).not.toBe('irrelevant');
    expect(statusOf(off, next)).not.toBe('relevant');
    // a dismissed suggestion is not proposed again
    expect(suggestFilter([missed, missed2, off], judged, s, { dismissed: sug.map((x) => x.id) }).find((x) => x.id === inc!.id)).toBeUndefined();
  });
  it('exclude_title: an off-topic story in "Bài sẵn sàng" → a title phrase that does not touch any relevant story', () => {
    const wrong = art('Khởi công xây dựng trung tâm thương mại mới ở TP.HCM', 'Công trình trung tâm thương mại được khởi công xây dựng tại phường An Khánh, TP.HCM.');
    const good = art('Khởi công xây dựng cầu Thủ Thiêm 4 ở TP.HCM', 'Công trình cầu Thủ Thiêm 4 được khởi công, xây dựng trong 3 năm tại TP.HCM.');
    expect(statusOf(wrong, s)).toBe('relevant');
    expect(statusOf(good, s)).toBe('relevant');
    const wrong2 = art('Xây dựng trung tâm thương mại 20 tầng ở TP.HCM', 'Công trình trung tâm thương mại được xây dựng tại phường Bến Thành, TP.HCM.');
    expect(statusOf(wrong2, s)).toBe('relevant');
    const judged = new Map<string, Judged>([[wrong.id, { relevant: false, why: 'decision' }], [wrong2.id, { relevant: false, why: 'label' }], [good.id, { relevant: true, why: 'label' }]]);
    // one off-topic story is a coincidence, not a trend: no suggestion
    expect(suggestFilter([wrong, good], new Map([[wrong.id, judged.get(wrong.id)!], [good.id, judged.get(good.id)!]]), s).filter((x) => x.kind === 'exclude_title')).toEqual([]);
    const ex = suggestFilter([wrong, wrong2, good], judged, s).find((x) => x.kind === 'exclude_title');
    expect(ex).toBeTruthy();
    expect(ex!.phrase).toBe('trung tâm thương mại');
    expect(ex!.examples.sort()).toEqual([wrong.title, wrong2.title].sort());
    const next = withTitleExclusion(s, ex!.phrase);
    expect(statusOf(wrong, next)).toBe('irrelevant');
    expect(statusOf(good, next)).toBe('relevant'); // never at the cost of a relevant story
  });
  it('a football exclusion ("cầu thủ") does not drop the bridges "cầu Thủ Thiêm" / "cầu Thủ Đức"', () => {
    expect(statusOf(art('Khởi công xây dựng cầu Thủ Thiêm 4 ở TP.HCM', 'Công trình cầu Thủ Thiêm 4 được khởi công tại TP.HCM.'), s)).toBe('relevant');
    expect(statusOf(art('Cầu thủ đội TP.HCM tập luyện trên công trình sân mới', 'Cầu thủ TP.HCM tập luyện tại công trình sân mới.'), s)).toBe('irrelevant');
  });
  it('nothing to suggest when the filter already agrees with the team', () => {
    const good = art('Khởi công xây dựng cầu Thủ Thiêm 4 ở TP.HCM', 'Công trình cầu Thủ Thiêm 4 được khởi công tại TP.HCM.');
    expect(suggestFilter([good], new Map([[good.id, { relevant: true, why: 'label' }]]), s)).toEqual([]);
  });
});
