/** Audit a PPTX template: slides, shapes (id, name, type, position EMU, text), pictures and relationships. */
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';

const file = process.argv[2];
if (!file) throw new Error('usage: tsx scripts/template-audit.ts <template.pptx>');
const zip = await JSZip.loadAsync(readFileSync(file));
const pres = await zip.file('ppt/presentation.xml')!.async('string');
console.log('sldSz', /<p:sldSz[^>]*>/.exec(pres)?.[0]);
const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => +a.match(/\d+/)![0] - +b.match(/\d+/)![0]);
for (const s of slides) {
  const xml = await zip.file(s)!.async('string');
  const rels = (await zip.file(s.replace('slides/', 'slides/_rels/') + '.rels')?.async('string')) ?? '';
  const layout = /Target="\.\.\/slideLayouts\/([^"]+)"/.exec(rels)?.[1];
  console.log(`\n=== ${s} layout=${layout}`);
  const re = /<p:(sp|pic|grpSp|cxnSp|graphicFrame)>([\s\S]*?)<\/p:\1>/g;
  for (const m of xml.matchAll(re)) {
    const body = m[2]!;
    const nv = /<p:cNvPr id="(\d+)" name="([^"]*)"/.exec(body);
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/.exec(body);
    const text = [...body.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => x[1]).join('').slice(0, 70);
    const embed = /r:embed="([^"]+)"/.exec(body)?.[1];
    const link = /r:id="([^"]+)"/.exec(body)?.[1];
    const sz = /sz="(\d+)"/.exec(body)?.[1];
    const fill = /<a:srgbClr val="([0-9A-F]{6})"/i.exec(body)?.[1];
    console.log(
      `${m[1]!.padEnd(5)} #${nv?.[1]} "${nv?.[2]}" ${off ? `@${(+off[1]! / 914400).toFixed(2)},${(+off[2]! / 914400).toFixed(2)} ${(+off[3]! / 914400).toFixed(2)}x${(+off[4]! / 914400).toFixed(2)}in` : ''} ${sz ? `sz=${sz}` : ''} ${fill ? `fill=${fill}` : ''} ${embed ? `img=${embed}` : ''}${link && !embed ? ` rid=${link}` : ''} | ${text}`,
    );
  }
  console.log('rels:', [...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((r) => `${r[1]}=${r[2]}`).join(' '));
}
