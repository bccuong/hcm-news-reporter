import { describe, expect, it } from 'vitest';
import { suggestAssessment } from '../src/domain/classify.js';
import { defaultSettings, parseWebsitesTxt } from '../src/domain/defaults.js';
import { detectLocation } from '../src/domain/location.js';
import { evaluateRule, validateRule } from '../src/domain/rules.js';
import type { RuleGroup } from '../src/domain/schemas.js';
import { inWindow, lastCompletedWindow, parsePublisherDate, todayWindow, windowForReportDate } from '../src/domain/timeWindow.js';
import { checkPublicUrl, isPrivateAddress, normalizeUrl } from '../src/domain/url.js';
import { readFileSync } from 'node:fs';

describe('time window (Asia/Ho_Chi_Minh, [from,to))', () => {
  it('morning report 2026-11-09 = 08/11 17:00 -> 09/11 08:00 +07:00', () => {
    expect(windowForReportDate('2026-11-09')).toEqual({ from: '2026-11-08T17:00:00+07:00', to: '2026-11-09T08:00:00+07:00' });
  });
  it('crosses month/year boundaries', () => {
    expect(windowForReportDate('2027-01-01').from).toBe('2026-12-31T17:00:00+07:00');
    expect(windowForReportDate('2026-03-01').from).toBe('2026-02-28T17:00:00+07:00');
  });
  it('last completed window at 20:00 VN is the one ending 08:00 today (not the incomplete one)', () => {
    const now = new Date('2026-11-09T20:00:00+07:00');
    const w = lastCompletedWindow(now);
    expect(w.to).toBe('2026-11-09T08:00:00+07:00');
    expect(w.reportDate).toBe('2026-11-09');
  });
  it('last completed window at 07:59 VN is yesterday morning window', () => {
    const w = lastCompletedWindow(new Date('2026-11-09T07:59:00+07:00'));
    expect(w.to).toBe('2026-11-08T08:00:00+07:00');
  });
  it('is independent of host timezone (computed from UTC instant)', () => {
    const w = lastCompletedWindow(new Date('2026-11-09T01:00:00Z')); // = 08:00 VN exactly
    expect(w.to).toBe('2026-11-09T08:00:00+07:00');
  });
  it('today window flags incomplete before 08:00', () => {
    expect(todayWindow(new Date('2026-11-09T06:00:00+07:00')).incomplete).toBe(true);
  });
  it('half-open boundaries: start inclusive, end exclusive', () => {
    const w = windowForReportDate('2026-11-09');
    expect(inWindow('2026-11-08T17:00:00+07:00', w)).toBe(true);
    expect(inWindow('2026-11-09T07:59:59+07:00', w)).toBe(true);
    expect(inWindow('2026-11-09T08:00:00+07:00', w)).toBe(false);
    expect(inWindow('2026-11-08T16:59:59+07:00', w)).toBe(false);
    expect(inWindow(null, w)).toBe(false);
  });
  it('parses publisher date formats', () => {
    expect(parsePublisherDate('2026-11-08T12:30:00Z')).toBe('2026-11-08T19:30:00+07:00');
    expect(parsePublisherDate('2026-11-08T19:30:00+0700')).toBe('2026-11-08T19:30:00+07:00');
    expect(parsePublisherDate('2026-11-08 19:30')).toBe('2026-11-08T19:30:00+07:00');
    expect(parsePublisherDate('08/11/2026 19:30 GMT+7')).toBe('2026-11-08T19:30:00+07:00');
    expect(parsePublisherDate('Thứ bảy, 31/10/2026 - 10:21')).toBe('2026-10-31T10:21:00+07:00');
    expect(parsePublisherDate('Sun, 08 Nov 2026 19:30:00 +0700')).toBe('2026-11-08T19:30:00+07:00');
    expect(parsePublisherDate('không rõ')).toBeNull();
  });
});

describe('URL normalization + SSRF', () => {
  it('strips tracking params, fragments, default port, trailing slash', () => {
    expect(normalizeUrl('HTTPS://Thanhnien.vn:443/a-b-185.htm/?utm_source=x&id=2#top')).toBe('https://thanhnien.vn/a-b-185.htm?id=2');
  });
  it('blocks private/loopback targets (SEC-01)', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '0.0.0.0', 'localhost']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress('203.0.113.10')).toBe(false);
    expect(checkPublicUrl('http://127.0.0.1/admin').ok).toBe(false);
    expect(checkPublicUrl('file:///etc/passwd').ok).toBe(false);
    expect(checkPublicUrl('https://user:pw@thanhnien.vn').ok).toBe(false);
    expect(checkPublicUrl('https://thanhnien.vn').ok).toBe(true);
  });
});

describe('article URL detection + URL date hints (from live run defects)', () => {
  it('rejects topic/section pages, accepts publisher article ids', async () => {
    const { looksLikeArticleUrl, urlDateHint } = await import('../src/domain/url.js');
    expect(looksLikeArticleUrl('https://thanhnien.vn/thoi-su/phong-su--dieu-tra.htm')).toBe(false);
    expect(looksLikeArticleUrl('https://tuoitre.vn/bau-cu-tong-thong-my-e587.htm')).toBe(false);
    expect(looksLikeArticleUrl('https://vnexpress.net/topic/ky-hop-thu-2-quoc-hoi-khoa-16-29184')).toBe(false);
    expect(looksLikeArticleUrl('https://vnexpress.net/hai-phong-du-kien-dau-gia-hon-200-nha-dat-cong-5144865.html')).toBe(true);
    expect(looksLikeArticleUrl('https://www.sggp.org.vn/tong-bi-thu-gap-tong-bi-thu-lao-post881908.html')).toBe(true);
    expect(urlDateHint('https://thanhnien.vn/luat-su-ha-hai-185261115132221306.htm')).toBe('2026-11-15');
    expect(urlDateHint('https://dantri.com.vn/xa-hoi/abc-20261031102100123.htm')).toBe('2026-10-31');
    expect(urlDateHint('https://vnexpress.net/abc-5144865.html')).toBeNull();
  });
  it('title skips empty logo <h1>', async () => {
    const { extractArticle } = await import('../src/collector/extract.js');
    const html = '<html><head><meta property="og:title" content="Tiêu đề thật của bài"></head><body><h1 class="logo"> <img src="l.png"> </h1><h1 class="title-detail">Tiêu đề thật của bài</h1><article class="fck_detail"><p>Đoạn một.</p></article></body></html>';
    expect(extractArticle(html, 'https://vnexpress.net/a-5144532.html', defaultSettings().quality).title).toBe('Tiêu đề thật của bài');
  });
});

describe('Boolean rule builder (UI-04)', () => {
  const t = (value: string, extra: Partial<{ negate: boolean; field: 'any' | 'title' | 'body' }> = {}) => ({ kind: 'term' as const, id: value, field: 'any' as const, match: 'word' as const, value, negate: false, ...extra });
  const rule: RuleGroup = {
    kind: 'group', id: 'r', op: 'AND', negate: false,
    children: [
      { kind: 'group', id: 'o', op: 'OR', negate: false, children: [t('metro'), t('ngập')] },
      { kind: 'group', id: 'n', op: 'OR', negate: true, children: [t('tuyển dụng')] },
    ],
  };
  it('include + OR + NOT', () => {
    expect(evaluateRule(rule, { title: 'Metro số 2 khởi công', body: '' }).matched).toBe(true);
    expect(evaluateRule(rule, { title: 'Ngập sâu', body: '' }).matched).toBe(true);
    expect(evaluateRule(rule, { title: 'Metro tuyển dụng kỹ sư', body: '' }).matched).toBe(false);
    expect(evaluateRule(rule, { title: 'Giá vàng', body: '' }).matched).toBe(false);
  });
  it('whole-word: "đê" does not match "đêm"', () => {
    expect(evaluateRule(t('đê'), { title: 'Mưa đêm qua', body: '' }).matched).toBe(false);
  });
  it('synonyms expand: rule "ùn tắc" matches "kẹt xe"', () => {
    const r = evaluateRule(t('ùn tắc'), { title: 'Kẹt xe kéo dài', body: '' }, [{ canonical: 'ùn tắc', aliases: ['kẹt xe'] }]);
    expect(r.matched).toBe(true);
    expect(r.lines.join(' ')).toContain('kẹt xe');
  });
  it('explains and validates conflicts', () => {
    const bad: RuleGroup = { kind: 'group', id: 'b', op: 'AND', negate: false, children: [t('metro'), t('metro', { negate: true })] };
    expect(validateRule(bad).join(' ')).toContain('mâu thuẫn');
    expect(validateRule({ kind: 'group', id: 'e', op: 'OR', negate: false, children: [] })[0]).toContain('chưa có điều kiện');
  });
});

describe('location aliases (UI-05)', () => {
  const s = defaultSettings();
  it('matches legacy + current names without literal "TP.HCM"', () => {
    expect(detectLocation('Ngập sâu ở phường Hiệp Bình', '', s.location).status).toBe('hcm');
    expect(detectLocation('Kẹt xe ở Thủ Đức', '', s.location).status).toBe('hcm');
    expect(detectLocation('Sài Gòn mưa lớn', '', s.location).status).toBe('hcm');
  });
  it('ambiguous ward names need prefix; no evidence -> unknown (review), not dropped', () => {
    expect(detectLocation('Tỉnh Hòa Bình mưa lớn', '', s.location).status).not.toBe('hcm');
    expect(detectLocation('Giá vàng tăng', '', s.location).status).toBe('unknown');
  });
  it('other province in title without HCM evidence', () => {
    expect(detectLocation('Hà Nội mở rộng đường', '', s.location).status).toBe('other_province');
  });
});

describe('editorial assessment is independent of topic', () => {
  it('flood completion is not negative', () => {
    expect(suggestAssessment('Hoàn thành dự án chống ngập, hết ngập đường Nguyễn Hữu Cảnh', '').value).toBe('positive');
  });
  it('specific flooding is needs_attention; forecast is neutral', () => {
    expect(suggestAssessment('Mưa lớn khiến đường ngập sâu, xe chết máy', '').value).toBe('needs_attention');
    expect(suggestAssessment('Dự báo mưa lớn, cảnh báo ngập cục bộ', '').value).toBe('neutral');
  });
});

describe('Skill websites.txt import (UI-09)', () => {
  it('imports every entry as editable source; Dân trí enabled by default; web: lines become manual_only', () => {
    const txt = readFileSync('src/domain/data/skill-websites.txt', 'utf8');
    const r = parseWebsitesTxt(txt);
    expect(r.sources.map((s) => s.id)).toEqual(['thanhnien-vn', 'vnexpress-net', 'dantri-com-vn', 'tuoitre-vn', 'baoxaydung-vn', 'sggp-org-vn']);
    expect(r.sources.every((s) => s.enabled)).toBe(true); // owner's decision 15/11/2026: Dân trí collected by default
    // the original Skill's "web:" prefix still means "publisher blocks automatic collection"
    const dt = parseWebsitesTxt('web: https://dantri.com.vn').sources[0]!;
    expect(dt.fetchMode).toBe('manual_only');
    expect(dt.enabled).toBe(false);
    expect(r.sources.find((s) => s.id === 'thanhnien-vn')!.rssUrls).toContain('https://thanhnien.vn/rss/thoi-su.rss');
    expect(r.comments.length).toBeGreaterThan(0);
  });
});

describe('RSS dates with a two-digit year (Thanh Niên, 16/11/2026)', () => {
  it('"Mon, 16 Nov 26 14:20:00 +0700" is 16/11/2026 14:20', () => {
    expect(parsePublisherDate('Mon, 16 Nov 26 14:20:00 +0700')).toBe('2026-11-16T14:20:00+07:00');
    expect(parsePublisherDate('Sun, 15 Nov 26 19:30:00 GMT')).toBe('2026-11-16T02:30:00+07:00');
    expect(parsePublisherDate('Mon, 16 Nov 2026 14:20:00 +0700')).toBe('2026-11-16T14:20:00+07:00');
  });
});
