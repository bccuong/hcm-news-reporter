/** Diagnose an article page: which containers hold the text, and what the extractor currently gets.
 *  Usage: npx tsx scripts/inspect-page.ts <url> [<url>...] */
import * as cheerio from 'cheerio';
import { extractArticle } from '../src/collector/extract.js';
import { nodeTransport } from '../src/collector/http.js';
import { defaultSettings } from '../src/domain/defaults.js';

for (const url of process.argv.slice(2)) {
  const r = await nodeTransport(url, { timeoutMs: 20000, userAgent: 'HCMNewsReporter/0.1 (local editorial tool)' });
  const $ = cheerio.load(r.body);
  console.log(`\n=== ${url}\nHTTP ${r.status}, ${r.body.length} bytes, title: ${$('h1').first().text().trim().slice(0, 90)}`);
  const rows: Array<[string, number, number]> = [];
  $('div,article,section,main').each((_, el) => {
    const e = $(el);
    const ps = e.find('p').filter((__, p) => $(p).text().trim().length > 40).length;
    if (ps < 2) return;
    const cls = (e.attr('class') ?? '').trim().split(/\s+/).slice(0, 3).join('.');
    rows.push([`${(el as { tagName: string }).tagName}${e.attr('id') ? '#' + e.attr('id') : ''}${cls ? '.' + cls : ''}`, ps, e.text().replace(/\s+/g, ' ').length]);
  });
  rows.sort((a, b) => b[1] - a[1] || a[2] - b[2]);
  for (const [sel, ps, len] of rows.slice(0, 8)) console.log(`  ${String(ps).padStart(3)} <p>  ${String(len).padStart(6)} chars  ${sel}`);
  const ex = extractArticle(r.body, url, defaultSettings().quality);
  console.log(`  extractor: container=${ex.containerSelector} completeness=${ex.completeness} paragraphs=${ex.sections.filter((s) => s.type === 'paragraph').length} warnings=${ex.warnings.map((w) => w.split(':')[0]).join(',')}`);
  const vid = $('video, iframe[src*="video"], .video, [class*="video"], audio, [class*="podcast"]').length;
  if (vid) console.log(`  media elements: ${vid} (video/audio/podcast page?)`);
}
