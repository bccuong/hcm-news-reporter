import { describe, expect, it } from 'vitest';
import { liteDay } from '../scripts/cloud-collect.js';

describe('light copy of a published period (first paint on phones, 18/11/2026)', () => {
  it('drops only the full text of excluded stories, marks them; everything else is unchanged', () => {
    const body = [{ type: 'paragraph', text: 'Đoạn văn dài…' }];
    const d = {
      kind: 'hcm-live-day', manifest: { x: 1 }, candidates: [{ id: 'c1' }],
      articles: [
        { id: 'a1', title: 'Sẵn sàng', relevance: { status: 'relevant' }, contentSections: body },
        { id: 'a2', title: 'Cần kiểm tra', relevance: { status: 'review' }, contentSections: body },
        { id: 'a3', title: 'Bị loại', sapo: 'Sapo vẫn còn', relevance: { status: 'irrelevant' }, contentSections: body },
      ],
    };
    const l = liteDay(d);
    expect(l.articles[0]).toBe(d.articles[0]);
    expect(l.articles[1]).toBe(d.articles[1]);
    expect(l.articles[2]).toMatchObject({ id: 'a3', sapo: 'Sapo vẫn còn', contentSections: [], bodyDeferred: true });
    expect(d.articles[2]!.contentSections).toBe(body); // the full copy is not touched
    expect(l.candidates).toBe(d.candidates);
  });
});
