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
    expect(phrasesOf('Chi gần 100 triệu đồng dựng giàn rau, 5 tỷ đồng làm cầu')).not.toContain('triệu đồng'); // an amount is no topic
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
  it('place: relevant stories held back because the city was not recognised → the place they share', () => {
    const p1 = art('Cư dân khu đô thị Sao Mai Xanh phản ánh công trình xây dựng sai phép', 'Công trình xây dựng không phép trong khu đô thị Sao Mai Xanh gây bức xúc.');
    const p2 = art('Khu đô thị Sao Mai Xanh ngập sâu sau mưa lớn', 'Nhiều tuyến đường trong khu đô thị Sao Mai Xanh ngập sâu, công trình thoát nước chậm thi công.');
    expect(statusOf(p1, s)).not.toBe('relevant');
    const judged = new Map<string, Judged>([[p1.id, { relevant: true, why: 'label' }], [p2.id, { relevant: true, why: 'decision' }]]);
    const pl = suggestFilter([p1, p2], judged, s).find((y) => y.kind === 'place');
    expect(pl?.phrase).toBe('khu đô thị Sao Mai Xanh');
    expect(pl!.fixes).toBe(2);
    const next = applySuggestion(s, pl!);
    expect(next.location.areas.at(-1)).toMatchObject({ name: 'khu đô thị Sao Mai Xanh', kind: 'landmark' });
    expect(statusOf(p1, next)).toBe('relevant');
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

describe('impact preview and "Hỏi nhanh"', async () => {
  const { impactOf, uncertainStories, withTitleExclusion } = await import('../src/domain/suggest.js');
  it('impact of a settings change on the judged stories: scores before/after and the stories that change', () => {
    const good = art('Khởi công xây dựng cầu Thủ Thiêm 4 ở TP.HCM', 'Công trình cầu Thủ Thiêm 4 được khởi công, xây dựng tại TP.HCM.');
    const off = art('Khởi công xây dựng trung tâm thương mại mới ở TP.HCM', 'Công trình trung tâm thương mại được khởi công xây dựng tại phường An Khánh, TP.HCM.');
    const judged = new Map<string, Judged>([[good.id, { relevant: true, why: 'label' }], [off.id, { relevant: false, why: 'label' }]]);
    const better = impactOf([good, off], judged, s, withTitleExclusion(s, 'trung tâm thương mại'));
    expect(better.before.precision).toBe(0.5);
    expect(better.after.precision).toBe(1);
    expect(better.changes).toEqual([expect.objectContaining({ id: off.id, before: 'relevant', after: 'irrelevant', better: true })]);
    const worse = impactOf([good, off], judged, s, withTitleExclusion(s, 'Thủ Thiêm'));
    expect(worse.after.recall).toBe(0);
    expect(worse.changes[0]).toMatchObject({ id: good.id, better: false });
  });
  it('"Hỏi nhanh" picks the near misses first and skips stories already judged', () => {
    const near = art('Cử tri phường Bình Thạnh TP.HCM kiến nghị lát lại lối đi bộ', 'Người dân phường Bình Thạnh phản ánh lối đi bộ xuống cấp.', 'Công trình thi công chậm, công trường bừa bộn, nhà thầu chưa hoàn trả mặt bằng.');
    const clear = art('Khởi công xây dựng cầu Thủ Thiêm 4 ở TP.HCM', 'Công trình cầu Thủ Thiêm 4 được khởi công, xây dựng tại TP.HCM.');
    const far = art('Giá vàng hôm nay tăng mạnh', 'Giá vàng miếng tăng 1 triệu đồng mỗi lượng.');
    const picked = uncertainStories([clear, far, near], s, new Set());
    expect(picked[0]!.article.id).toBe(near.id);
    expect(picked[0]!.why).toMatch(/sát nút/);
    expect(picked.some((x) => x.article.id === far.id)).toBe(false);
    expect(uncertainStories([near], s, new Set([near.id]))).toEqual([]);
  });
  it('"Hỏi nhanh" never asks about a story whose title names another province (excluded without a person, 17/11/2026)', () => {
    const other = art('Gia Lai: Khởi công dự án chung cư gần 600 căn hộ tại phường Thống Nhất', 'Dự án chung cư góp phần bổ sung nguồn cung nhà ở, thúc đẩy phát triển đô thị tại Gia Lai.', 'Dự án nhà ở, chung cư, xây dựng, khởi công công trình. Doanh nghiệp từng làm dự án ở TP.HCM.');
    const hanoi = art('Hà Nội sắp mở bán nhà xã hội gần 30 triệu một m2 ở Đông Anh', 'Chủ đầu tư nhận hồ sơ hơn 300 căn nhà ở xã hội, căn hộ, giá bán từ 1,1 tỷ đồng.', 'Dự án nhà ở xã hội xây dựng xong.');
    expect(uncertainStories([other, hanoi], s, new Set())).toEqual([]);
  });
});

describe('learning from stories the team moved to "Sẵn sàng" by hand (18/11/2026)', () => {
  it('setting: national stories with the sector in the title, kept in "Cần kiểm tra" while the team moves them up → suggest the rule, with its counts', () => {
    const off = structuredClone(s);
    off.location.nationalToReady = false;
    const st = [
      art('Áp trần giá chuyển nhượng nhà ở xã hội?', 'Dự thảo nghị định đề xuất áp trần giá.', 'Một doanh nghiệp làm nhà ở xã hội tại TP.HCM cho biết.'),
      art('Đề xuất mới về nhà ở xã hội, chuyên gia lo người mua khó vay vốn', 'Bộ Xây dựng đề xuất sửa quy định.', 'Nhiều dự án ở TP.HCM.'),
      art('Sửa Luật Đất đai: quy định rõ thủ tục bồi thường, tái định cư', 'Quốc hội thảo luận dự thảo luật.', 'Các đại biểu góp ý.'),
    ];
    for (const a of st) expect(statusOf(a, off)).toBe('review');
    const judged = new Map<string, Judged>(st.map((a) => [a.id, { relevant: true, why: 'decision' }]));
    const sug = suggestFilter(st, judged, off).find((x) => x.kind === 'setting');
    expect(sug).toMatchObject({ id: 'setting:location.nationalToReady=true', fixes: 3, harms: 0 });
    const next = applySuggestion(off, sug!);
    expect(next.location.nationalToReady).toBe(true);
    for (const a of st) expect(statusOf(a, next)).toBe('relevant');
    // dismissed → not proposed again
    expect(suggestFilter(st, judged, off, { dismissed: [sug!.id] }).find((x) => x.id === sug!.id)).toBeUndefined();
  });
  it('setting: not proposed when it would put judged stories wrong as often as right', () => {
    const off = structuredClone(s);
    off.location.nationalToReady = false;
    const good = art('Áp trần giá chuyển nhượng nhà ở xã hội?', 'Dự thảo nghị định đề xuất áp trần giá.', 'Một doanh nghiệp tại TP.HCM.');
    const bad1 = art('Nhà ở xã hội ở Singapore được bán thế nào?', 'Chính sách nhà ở của Singapore.', 'Người dân TP.HCM quan tâm.');
    const bad2 = art('Giá nhà ở xã hội tăng mạnh', 'Dự thảo nghị định mới.', 'Khảo sát ở TP.HCM.');
    const bad3 = art('Nhà ở xã hội: người mua than khó', 'Quy định mới gây khó.', 'Một người ở TP.HCM kể.');
    const judged = new Map<string, Judged>([[good.id, { relevant: true, why: 'decision' }], [bad1.id, { relevant: false, why: 'label' }], [bad2.id, { relevant: false, why: 'label' }], [bad3.id, { relevant: false, why: 'label' }]]);
    expect(suggestFilter([good, bad1, bad2, bad3], judged, off).find((x) => x.id === 'setting:location.nationalToReady=true')).toBeUndefined();
  });
  it('sector: a title word shared by stuck relevant stories (weak sector evidence, in Cần kiểm tra) becomes a sector keyword', () => {
    const a1 = art('Đại đô thị định hình diện mạo Đông Bắc TP.HCM', 'Các công trình mới ở TP.HCM.', 'Người dân rất quan tâm.');
    const a2 = art('Vì sao đại đô thị phía Tây TP.HCM hút dân?', 'Nhiều công trình mọc lên ở TP.HCM.', 'Người dân rất quan tâm.');
    for (const a of [a1, a2]) expect(statusOf(a, s)).toBe('review');
    const judged = new Map<string, Judged>([[a1.id, { relevant: true, why: 'decision', category: 'BUILD' }], [a2.id, { relevant: true, why: 'decision', category: 'BUILD' }]]);
    const sug = suggestFilter([a1, a2], judged, s).find((x) => x.kind === 'sector');
    expect(sug).toMatchObject({ id: 'sector:đại đô thị', phrase: 'đại đô thị', category: 'BUILD', fixes: 2 });
    const next = applySuggestion(s, sug!);
    expect(next.categories.find((c) => c.code === 'BUILD')!.keywords).toContain('đại đô thị');
    expect(statusOf(a1, next)).toBe('relevant');
    expect(statusOf(a2, next)).toBe('relevant');
  });

});

describe('never a suggestion to look for another province (18/11/2026)', () => {
  it('"hà nội" is not proposed as a word to include, even when two judged stories would be kept by it', () => {
    const a1 = art('Công ty Hà Nội huy động vốn làm khu nhà ở', 'Doanh nghiệp tại Hà Nội làm dự án ở TP.HCM.', 'Dự án tại phường An Khánh, TP.HCM.');
    const a2 = art('Nhà đầu tư Hà Nội mua quỹ đất', 'Một nhà đầu tư Hà Nội mua đất ở TP.HCM.', 'Khu đất ở phường Bình Trưng, TP.HCM.');
    const judged = new Map<string, Judged>([[a1.id, { relevant: true, why: 'decision' }], [a2.id, { relevant: true, why: 'decision' }]]);
    expect(suggestFilter([a1, a2], judged, s).filter((x) => /hà nội/i.test(x.phrase))).toEqual([]);
  });
});

describe('suggestion hygiene (18/11/2026)', async () => {
  const { alreadyApplied, distinctStories } = await import('../src/domain/suggest.js');
  it('one press release published twice is one story, not a trend', () => {
    expect(distinctStories(['Bán đảo SOLA - Tư duy toàn cầu gặp gỡ giá trị gia đình Việt', 'Bán đảo SOLA - Nơi tư duy toàn cầu gặp gỡ giá trị gia đình Việt'])).toHaveLength(1);
    expect(distinctStories(['TP.HCM lát đá lối đi bộ Nguyễn Huệ', 'Cử tri Bình Thạnh kiến nghị lát lại lối đi bộ'])).toHaveLength(2);
    const a1 = art('Bán đảo SOLA - Tư duy toàn cầu gặp gỡ giá trị gia đình Việt', 'Dự án tại TP.HCM.', 'Công trình nhà ở.');
    const a2 = art('Bán đảo SOLA - Nơi tư duy toàn cầu gặp gỡ giá trị gia đình Việt', 'Dự án tại TP.HCM.', 'Công trình nhà ở.');
    const judged = new Map<string, Judged>([[a1.id, { relevant: true, why: 'decision' }], [a2.id, { relevant: true, why: 'decision' }]]);
    expect(suggestFilter([a1, a2], judged, s).filter((x) => /giá trị gia đình/.test(x.phrase))).toEqual([]);
  });
  it('an applied (saved) suggestion is recognised in the settings, so it is not shown again', () => {
    const x = { kind: 'include' as const, phrase: 'lối đi bộ', category: 'INFRA' as const };
    expect(alreadyApplied(s, x)).toBe(false);
    expect(alreadyApplied(applySuggestion(s, x), x)).toBe(true);
    const st = { kind: 'setting' as const, phrase: 'x', setting: { path: 'location.nationalToReady', value: false, from: true, label: 'x' } };
    expect(alreadyApplied(s, st)).toBe(false);
    expect(alreadyApplied(applySuggestion(s, st), st)).toBe(true);
    expect(alreadyApplied(applySuggestion(s, { kind: 'sector', phrase: 'đại đô thị', category: 'BUILD' }), { kind: 'sector', phrase: 'đại đô thị' })).toBe(true);
  });
  it('every example comes with the address of its original article', () => {
    const missed = { ...art('Cử tri phường Bình Thạnh TP.HCM kiến nghị lát lại lối đi bộ', 'Người dân phường Bình Thạnh phản ánh lối đi bộ xuống cấp.'), originalUrl: 'https://tn.vn/a-1.htm' } as Article;
    const missed2 = { ...art('TP.HCM lát đá lại lối đi bộ phố Nguyễn Huệ', 'Lối đi bộ phố Nguyễn Huệ ở TP.HCM được lát đá lại sau 10 năm.'), originalUrl: 'https://tn.vn/a-2.htm' } as Article;
    const judged = new Map<string, Judged>([[missed.id, { relevant: true, why: 'label' }], [missed2.id, { relevant: true, why: 'label' }]]);
    const inc = suggestFilter([missed, missed2], judged, s).find((x) => x.kind === 'include')!;
    expect(inc.links).toEqual({ [missed.title]: 'https://tn.vn/a-1.htm', [missed2.title]: 'https://tn.vn/a-2.htm' });
  });
});
