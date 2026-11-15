import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { ContentSection, DateEvidence, ImageCandidate, Settings } from '../domain/schemas.js';
import { parsePublisherDate } from '../domain/timeWindow.js';
import { normalizeUrl } from '../domain/url.js';

export const EXTRACTOR_VERSION = 'generic-cheerio@0.2.0';

export interface Extracted {
  canonicalUrl: string | null;
  title: string;
  sapo: string;
  author: string | null;
  sections: ContentSection[];
  bodyText: string;
  links: string[];
  dateEvidence: DateEvidence[];
  publishedAt: string | null;
  modifiedAt: string | null;
  dateConfidence: 'verified' | 'inferred' | 'unknown';
  images: ImageCandidate[];
  continuation: { detected: boolean; urls: string[] };
  warnings: string[];
  completeness: 'auto_checks_passed' | 'partial' | 'failed';
  containerSelector: string | null;
}

/** Known body containers of configured publishers first, then generic semantic containers. */
const BODY_SELECTORS = [
  '[itemprop="articleBody"]',
  '.detail-content', // tuoitre, thanhnien
  '.detail-cmain',
  'article.fck_detail', // vnexpress
  '.fck_detail',
  '.singular-content', // dantri
  '.dt-news__content',
  '.article-content',
  '.article__body',
  '.content-detail',
  '.detail__content',
  '.post-content',
  '.entry-content',
  'article',
  'main',
];

const NOISE = 'script,style,noscript,iframe,form,button,nav,aside,footer,.related,.relate,.box-related,.ads,.advertisement,[class*="banner"],[class*="social"],[class*="share"],[class*="comment"],[class*="recommend"],.tags,.box-tag';

function clean(s: string): string {
  return s.normalize('NFC').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function meta($: cheerio.CheerioAPI, ...names: string[]): string | null {
  for (const n of names) {
    const v = $(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`).first().attr('content');
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function jsonLdObjects($: cheerio.CheerioAPI): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const j = JSON.parse($(s).contents().text());
      const walk = (x: any) => {
        if (!x || typeof x !== 'object') return;
        if (Array.isArray(x)) return x.forEach(walk);
        if (x['@graph']) walk(x['@graph']);
        out.push(x);
      };
      walk(j);
    } catch {
      /* malformed JSON-LD is ignored but noted below */
    }
  });
  return out;
}

export function extractArticle(html: string, pageUrl: string, quality: Settings['quality']): Extracted {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const ld = jsonLdObjects($).filter((o) => /Article|NewsArticle|BlogPosting|ReportageNewsArticle/i.test(String(o['@type'] ?? '')));
  const ld0 = ld[0];

  const canonicalUrl = normalizeUrl($('link[rel="canonical"]').attr('href') ?? meta($, 'og:url') ?? '', pageUrl);
  // first NON-EMPTY h1 (site logos are often an empty/whitespace <h1>), then structured metadata
  const h1 = $('h1')
    .map((_, el) => clean($(el).text()))
    .get()
    .find((t) => t.length >= 8);
  const title = clean(h1 || meta($, 'og:title') || (ld0?.headline as string | undefined) || $('title').text() || '');
  if (!title) warnings.push('MISSING_TITLE: không tìm thấy tiêu đề');

  /* ---------------- dates with evidence ---------------- */
  const dateEvidence: DateEvidence[] = [];
  const pushDate = (field: DateEvidence['field'], source: DateEvidence['source'], raw: string | null | undefined) => {
    if (raw && raw.trim()) dateEvidence.push({ field, source, raw: raw.trim().slice(0, 80), value: parsePublisherDate(raw) });
  };
  pushDate('published', 'meta', meta($, 'article:published_time', 'pubdate', 'datePublished', 'publishdate', 'dc.date.issued'));
  pushDate('modified', 'meta', meta($, 'article:modified_time', 'dateModified', 'og:updated_time'));
  if (ld0) {
    pushDate('published', 'jsonld', ld0.datePublished as string);
    pushDate('modified', 'jsonld', ld0.dateModified as string);
  }
  const timeTag = $('time[datetime]').first().attr('datetime');
  pushDate('published', 'time_tag', timeTag);
  const visible = $('[data-role="publishdate"], .detail-time, .date-time, .date, .time, .dt-news__time, .author-time, .article__meta time, .meta-time')
    .first()
    .text();
  pushDate('published', 'visible', visible || null);

  const pubVals = dateEvidence.filter((d) => d.field === 'published' && d.value);
  const structured = pubVals.filter((d) => d.source === 'meta' || d.source === 'jsonld' || d.source === 'time_tag');
  let publishedAt: string | null = null;
  let dateConfidence: Extracted['dateConfidence'] = 'unknown';
  if (structured.length) {
    publishedAt = structured[0]!.value;
    dateConfidence = 'verified';
    const distinct = new Set(pubVals.map((d) => d.value!.slice(0, 16)));
    if (distinct.size > 1) {
      // tolerate minute-level drift but flag hour-level conflicts
      const ts = pubVals.map((d) => new Date(d.value!).getTime());
      if (Math.max(...ts) - Math.min(...ts) > 60 * 60_000) {
        warnings.push(`DATE_CONFLICT: các nguồn ngày đăng không khớp (${[...distinct].join(' | ')})`);
        dateConfidence = 'inferred';
      }
    }
  } else if (pubVals.length) {
    publishedAt = pubVals[0]!.value;
    dateConfidence = 'inferred';
    warnings.push('DATE_FROM_VISIBLE_TEXT_ONLY: chỉ có ngày giờ hiển thị, cần xác minh');
  } else {
    warnings.push('MISSING_PUBLISHED_AT: không xác định được giờ đăng');
  }
  const modifiedAt = dateEvidence.find((d) => d.field === 'modified' && d.value)?.value ?? null;

  /* ---------------- sapo ---------------- */
  const sapo = clean(
    $('.detail-sapo, .sapo, .description, .article__sapo, .singular-sapo, h2.sapo, p.description, .lead').first().text() ||
      meta($, 'description', 'og:description') ||
      '',
  );

  /* ---------------- body container ---------------- */
  let container: cheerio.Cheerio<Element> | null = null;
  let containerSelector: string | null = null;
  for (const sel of BODY_SELECTORS) {
    const c = $(sel).first();
    if (c.length && c.find('p').length >= 1) {
      container = c as cheerio.Cheerio<Element>;
      containerSelector = sel;
      break;
    }
  }
  const sections: ContentSection[] = [];
  const images: ImageCandidate[] = [];
  const links = new Set<string>();
  let ordinal = 0;

  if (!container) {
    warnings.push('ARTICLE_BODY_MISSING: không xác định được khung nội dung bài');
  } else {
    container.find(NOISE).remove();
    const sapoNorm = sapo.slice(0, 60);
    const walk = (nodes: cheerio.Cheerio<AnyNode>) => {
      nodes.each((_, node) => {
        if (node.type !== 'tag') return;
        const el = $(node);
        const tag = (node as Element).tagName.toLowerCase();
        if (/^h[2-6]$/.test(tag)) {
          const t = clean(el.text());
          if (t) sections.push({ ordinal: ordinal++, type: 'heading', level: Number(tag[1]), text: t, evidence: `${containerSelector} > ${tag}` });
          return;
        }
        if (tag === 'p') {
          const t = clean(el.text());
          if (t && !(sapoNorm && t.startsWith(sapoNorm) && sections.length === 0)) {
            sections.push({ ordinal: ordinal++, type: 'paragraph', text: t, evidence: `${containerSelector} > p` });
          }
          el.find('a[href]').each((__, a) => {
            const u = normalizeUrl($(a).attr('href') ?? '', pageUrl);
            if (u) links.add(u);
          });
          return;
        }
        if (tag === 'ul' || tag === 'ol') {
          el.children('li').each((__, li) => {
            const t = clean($(li).text());
            if (t) sections.push({ ordinal: ordinal++, type: 'list_item', text: t, evidence: `${containerSelector} > ${tag} > li` });
          });
          return;
        }
        if (tag === 'blockquote') {
          const t = clean(el.text());
          if (t) sections.push({ ordinal: ordinal++, type: 'quote', text: t, evidence: `${containerSelector} > blockquote` });
          return;
        }
        if (tag === 'table') {
          const rows: string[][] = [];
          el.find('tr').each((__, tr) => {
            const cells = $(tr)
              .find('th,td')
              .map((___, c) => clean($(c).text()))
              .get();
            if (cells.some(Boolean)) rows.push(cells);
          });
          const caption = clean(el.find('caption').text());
          // tables used purely as image+caption wrappers (common on VN sites) become figures
          const img = el.find('img').first();
          if (img.length && rows.length <= 2 && rows.flat().join(' ').length < 300) {
            addFigure(el, img);
            return;
          }
          if (rows.length) {
            sections.push({ ordinal: ordinal++, type: 'table', text: rows.map((r) => r.join(' | ')).join('\n'), rows, caption: caption || undefined, evidence: `${containerSelector} > table` });
          }
          return;
        }
        if (tag === 'figure' || tag === 'picture') {
          const img = el.find('img').first();
          if (img.length) addFigure(el, img);
          else walk(el.children());
          return;
        }
        if (tag === 'img') {
          addFigure(el, el);
          return;
        }
        if (/(fact|box|note|highlight|info)/i.test(el.attr('class') ?? '') && clean(el.text()).length > 40 && tag !== 'div') {
          sections.push({ ordinal: ordinal++, type: 'factbox', text: clean(el.text()), evidence: `${containerSelector} > .${el.attr('class')}` });
          return;
        }
        walk(el.children());
      });
    };
    const addFigure = (wrap: cheerio.Cheerio<AnyNode>, img: cheerio.Cheerio<AnyNode>) => {
      const src = img.attr('data-src') || img.attr('data-original') || img.attr('src') || '';
      const url = normalizeUrl(src, pageUrl);
      const caption = clean(wrap.find('figcaption, .caption, .PhotoCMS_Caption, .fig-caption, p').first().text() || img.attr('alt') || '');
      const creditM = /(?:Ảnh|ẢNH|Photo)\s*:\s*([^.\n]{2,60})/.exec(caption);
      sections.push({ ordinal: ordinal++, type: 'figure', text: caption, caption, evidence: `${containerSelector} > figure img` });
      if (url && !/\.(gif|svg)(\?|$)/i.test(url) && !/1x1|pixel|tracking/i.test(url)) {
        images.push({
          url,
          caption: caption || undefined,
          credit: creditM?.[1]?.trim(),
          sourceArticleUrl: pageUrl,
          origin: 'body',
          rightsStatus: 'review',
          width: Number(img.attr('width')) || undefined,
          height: Number(img.attr('height')) || undefined,
        });
      }
    };
    walk(container.children());
  }

  const og = meta($, 'og:image');
  const ogUrl = og ? normalizeUrl(og, pageUrl) : null;
  if (ogUrl && !images.some((i) => i.url === ogUrl)) {
    images.unshift({ url: ogUrl, sourceArticleUrl: pageUrl, origin: 'og:image', rightsStatus: 'review' });
  }

  const paragraphs = sections.filter((s) => s.type === 'paragraph');
  const bodyText = sections
    .filter((s) => s.type !== 'figure')
    .map((s) => s.text)
    .join('\n');

  /* ---------------- completeness checks ---------------- */
  if (container) {
    if (bodyText.length < quality.minBodyChars) warnings.push(`SHORT_BODY: nội dung chỉ ${bodyText.length} ký tự (ngưỡng ${quality.minBodyChars})`);
    if (paragraphs.length < quality.minParagraphs) warnings.push(`FEW_PARAGRAPHS: ${paragraphs.length} đoạn (ngưỡng ${quality.minParagraphs})`);
    // compare against JSON-LD articleBody when present (independent evidence)
    const ldBody = typeof ld0?.articleBody === 'string' ? clean(ld0.articleBody as string) : '';
    if (ldBody.length > 200) {
      const ratio = bodyText.length / ldBody.length;
      if (ratio < 1 - quality.jsonLdMismatchRatio) {
        warnings.push(`EXTRACTOR_DISAGREEMENT: nội dung bóc tách (${bodyText.length}) ngắn hơn articleBody JSON-LD (${ldBody.length}) – có thể thiếu đoạn`);
      }
    }
    // compare raw <p> count inside container (before our filtering) with extracted paragraphs
    if (quality.flagMissingTables) {
      const rawTables = cheerio.load(html)(containerSelector!).first().find('table').length;
      const gotTables = sections.filter((s) => s.type === 'table').length + sections.filter((s) => s.type === 'figure').length;
      if (rawTables > gotTables) warnings.push(`MISSING_TABLE: phát hiện ${rawTables} bảng, mới trích ${gotTables}`);
    }
    if (quality.flagMissingCaptions) {
      const noCap = sections.filter((s) => s.type === 'figure' && !s.caption).length;
      if (noCap) warnings.push(`MISSING_CAPTION: ${noCap} ảnh không có chú thích`);
    }
    if (/[ÃÂ][\u0080-¿]|Ã¡|Ã©|á»/.test(bodyText)) warnings.push('MOJIBAKE: ký tự tiếng Việt có thể bị lỗi mã hóa');
  }

  /* ---------------- continuation / read-more ---------------- */
  const contUrls = new Set<string>();
  if (quality.flagPagination) {
    $('link[rel="next"], a[rel="next"], .pagination a, .page-numbers a, a.next-page, .detail-pagination a').each((_, a) => {
      const u = normalizeUrl($(a).attr('href') ?? '', pageUrl);
      if (u && u !== normalizeUrl(pageUrl)) contUrls.add(u);
    });
    const tail = bodyText.slice(-200).toLowerCase();
    if (/(xem tiếp|đọc tiếp|còn nữa|kỳ sau|\(còn tiếp\))/.test(tail)) warnings.push('CONTINUATION_TEXT: bài có dấu hiệu còn tiếp/đọc tiếp');
  }
  if (contUrls.size) warnings.push(`MULTIPAGE: bài có ${contUrls.size} trang tiếp theo chưa gộp`);

  const blocking = warnings.some((w) => /^(ARTICLE_BODY_MISSING|MISSING_TITLE)/.test(w));
  const partial = warnings.some((w) => /^(SHORT_BODY|FEW_PARAGRAPHS|EXTRACTOR_DISAGREEMENT|MISSING_TABLE|MULTIPAGE|CONTINUATION_TEXT|MOJIBAKE)/.test(w));

  return {
    canonicalUrl,
    title,
    sapo,
    author: clean($('.author, .detail-author, [rel="author"], .author-info .name').first().text()) || (meta($, 'author') ?? null),
    sections,
    bodyText,
    links: [...links].slice(0, 100),
    dateEvidence,
    publishedAt,
    modifiedAt,
    dateConfidence,
    images: images.slice(0, 8),
    continuation: { detected: contUrls.size > 0 || warnings.some((w) => w.startsWith('CONTINUATION_TEXT')), urls: [...contUrls] },
    warnings,
    completeness: blocking ? 'failed' : partial ? 'partial' : 'auto_checks_passed',
    containerSelector,
  };
}
