import { describe, expect, it } from 'vitest';
import { extractArticle } from '../src/collector/extract.js';
import { defaultSettings, sourceFromUrl } from '../src/domain/defaults.js';
import { looksLikeArticleUrl } from '../src/domain/url.js';

/** Structures modelled on SGGP pages that failed in the 15/11/2026 live run (synthetic text). */
const q = defaultSettings().quality;
const head = (t: string) => `<head><title>${t} | BÁO</title><meta property="og:title" content="${t}"><meta property="og:type" content="article">
<meta name="description" content="[Mẫu thử] Mô tả ngắn của bài video."><meta property="article:published_time" content="2026-11-10T14:39:31+0700"></head>`;

describe('video / podcast articles (SGGP layouts)', () => {
  it('video page without text container keeps title, sapo, verified time → partial MEDIA_ARTICLE (not a parse failure)', () => {
    const html = `<html>${head('[Mẫu thử] TPHCM: Tàu sắt bốc cháy dữ dội tại cảng cá')}<body><h1 class="article__title"></h1>
      <div class="article"><figure class="video"><div class="video-player" data-video-src="x.mp4"></div></figure><div class="article__author">PV</div></div></body></html>`;
    const ex = extractArticle(html, 'https://www.sggp.org.vn/tau-sat-boc-chay-post881009.html', q);
    expect(ex.title).toBe('[Mẫu thử] TPHCM: Tàu sắt bốc cháy dữ dội tại cảng cá');
    expect(ex.sapo).toContain('Mô tả ngắn');
    expect(ex.publishedAt).toBe('2026-11-10T14:39:31+07:00');
    expect(ex.completeness).toBe('partial');
    expect(ex.warnings.join(' ')).toContain('MEDIA_ARTICLE');
    expect(ex.warnings.join(' ')).not.toContain('ARTICLE_BODY_MISSING');
  });
  it('SGGP "short video" feed page (no h1, no body) → partial MEDIA_ARTICLE with og:title', () => {
    const html = `<html class="sggp">${head('[Mẫu thử] TPHCM: Tàu sắt bốc cháy')}<body><div class="site-body"><div class="box-short-video-detail">
      <div class="short-video-slider short-video-slider-js"><article class="story"><figure class="story__thumb"></figure><div class="video-controls"></div>
      <div class="infor_shortvideo"><h2 class="story__heading">[Mẫu thử] TPHCM: Tàu sắt bốc cháy</h2></div></article></div></div></div></body></html>`;
    const ex = extractArticle(html, 'https://www.sggp.org.vn/tphcm-tau-sat-post881009.html', q);
    expect(ex.completeness).toBe('partial');
    expect(ex.title).toBe('[Mẫu thử] TPHCM: Tàu sắt bốc cháy');
    expect(ex.warnings.join(' ')).toContain('MEDIA_ARTICLE');
  });
  it('cms-body with video + short text: MEDIA_ARTICLE instead of SHORT_BODY', () => {
    const html = `<html>${head('[Mẫu thử] Xe tải tông lan can cầu')}<body><h1>[Mẫu thử] Xe tải tông lan can cầu</h1>
      <div class="article__body cms-body"><figure class="video"><video src="v.mp4"></video></figure>
      <p>[Mẫu thử] Đoạn một mô tả sự việc ban đầu với thông tin ngắn gọn về vụ tai nạn trên cầu.</p>
      <p>[Mẫu thử] Đoạn hai cho biết lực lượng chức năng đang điều tra nguyên nhân.</p></div></body></html>`;
    const ex = extractArticle(html, 'https://www.sggp.org.vn/xe-tai-post881320.html', q);
    expect(ex.completeness).toBe('partial'); // video content is not extractable → never "complete"
    expect(ex.warnings.some((w) => w.startsWith('MEDIA_ARTICLE') && w.includes('2 đoạn chữ'))).toBe(true);
    expect(ex.warnings.some((w) => w.startsWith('SHORT_BODY'))).toBe(false);
  });
  it('normal text article with an unrelated video widget elsewhere is unaffected', () => {
    const paras = Array.from({ length: 6 }, (_, i) => `<p>[Mẫu thử] Đoạn ${i + 1} nội dung đầy đủ của bài viết, có đủ độ dài để vượt ngưỡng kiểm tra tự động về số ký tự tối thiểu.</p>`).join('');
    const html = `<html>${head('[Mẫu thử] Bài chữ bình thường')}<body><h1>[Mẫu thử] Bài chữ bình thường</h1><div class="article__body cms-body">${paras}</div>
      <aside><figure class="video"><video></video></figure></aside></body></html>`;
    const ex = extractArticle(html, 'https://www.sggp.org.vn/bai-chu-post1.html', q);
    expect(ex.completeness).toBe('auto_checks_passed');
  });
  it('SGGP print-edition pages are not articles', () => {
    const s = sourceFromUrl('https://www.sggp.org.vn');
    expect(looksLikeArticleUrl('https://www.sggp.org.vn/bao-sai-gon-giai-phong-ngay-15112026-post881836.html', s.articleUrlPattern, s.excludeUrlPattern)).toBe(false);
    expect(looksLikeArticleUrl('https://www.sggp.org.vn/xe-tai-tong-lan-can-post881320.html', s.articleUrlPattern, s.excludeUrlPattern)).toBe(true);
  });
});
