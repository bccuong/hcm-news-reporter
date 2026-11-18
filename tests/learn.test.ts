import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/domain/defaults.js';
import { explainScore, scoreStory, trainModel } from '../src/domain/learn.js';
import { SettingsSchema, type Article } from '../src/domain/schemas.js';
import { uncertainStories } from '../src/domain/suggest.js';

const s = SettingsSchema.parse(defaultSettings());
let n = 0;
const art = (title: string, sapo: string, body = ''): Article => ({ id: `a_${(++n).toString().padStart(12, '0')}`, sourceId: 'tn', sourceName: 'Thanh Niên', title, sapo, bodyText: body, contentSections: [], imageCandidates: [] }) as unknown as Article;
const REL = ['thi công cầu', 'giải phóng mặt bằng', 'nhà ở xã hội', 'dây điện chằng chịt', 'cấp phép xây dựng', 'hàng rào tôn'];
const OFF = ['giải bóng đá', 'ca sĩ ra mắt', 'giá vàng hôm nay', 'khám sức khỏe', 'lễ hội văn hóa', 'thời tiết lạnh'];
const sample = (k: number) =>
  Array.from({ length: k }, (_, i) => [
    { article: art(`TP.HCM đẩy nhanh ${REL[i % REL.length]} khu ${i}`, `Dự án ${REL[(i + 1) % REL.length]} tại phường ${i}.`), relevant: true },
    { article: art(`TP.HCM tổ chức ${OFF[i % OFF.length]} lần ${i}`, `Sự kiện ${OFF[(i + 2) % OFF.length]} thu hút người dân.`), relevant: false },
  ]).flat();

describe('self-learned second opinion (word statistics from the team\'s judged stories, 18/11/2026)', () => {
  it('learns the topic the team wants; cross-validated accuracy from 30 stories; small and explainable', () => {
    const m = trainModel(sample(24));
    expect(m.n).toEqual({ relevant: 24, irrelevant: 24 });
    expect(m.accuracy).toBeGreaterThan(0.8);
    expect(scoreStory(m, { title: 'TP.HCM chậm giải phóng mặt bằng dự án nhà ở xã hội', sapo: '', bodyText: '' })).toBeGreaterThan(0.7);
    expect(scoreStory(m, { title: 'Giải bóng đá phong trào khai mạc', sapo: 'Ca sĩ ra mắt', bodyText: '' })).toBeLessThan(0.3);
    expect(explainScore(m, { title: 'Đẩy nhanh giải phóng mặt bằng', sapo: '', bodyText: '' }).up).toContain('giải phóng');
    expect(JSON.stringify(m).length).toBeLessThan(200_000);
    expect(trainModel(sample(5)).accuracy).toBeNull(); // too few stories to say
  });
  it('"Hỏi nhanh" asks first where the model disagrees with a TOPIC decision of the rules – never about another province', () => {
    const m = trainModel(sample(24));
    // excluded by the rules (no sector word in the title/sapo) but the model is sure the team wants it
    const missed = art('Người dân TP.HCM bức xúc vì dây điện chằng chịt, hàng rào tôn', 'Dây điện ở phường An Khánh, TP.HCM chằng chịt.', 'Người dân mong sớm xử lý.');
    const hanoi = art('Hà Nội đẩy nhanh giải phóng mặt bằng nhà ở xã hội', 'Dự án nhà ở xã hội tại Hà Nội.', 'Giải phóng mặt bằng.');
    const picked = uncertainStories([hanoi, missed], s, new Set(), 8, m);
    const first = picked[0]!;
    expect(picked.some((x) => x.article.id === hanoi.id)).toBe(false);
    expect(first.article.id).toBe(missed.id);
    expect(first.status).toBe('irrelevant');
    expect(first.why).toMatch(/Máy tự học chấm \d+% là bài liên quan/);
    expect(first.learned).toBeGreaterThan(0.5);
    // without a model: the rules alone, as before
    expect(uncertainStories([hanoi, missed], s, new Set()).every((x) => x.learned === undefined)).toBe(true);
  });
});
