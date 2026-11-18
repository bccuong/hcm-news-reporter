/**
 * Word report from the Department's ORIGINAL .docx ("Tổng hợp Điểm tin Báo chí", supplied by the user 16/11/2026):
 * the letterhead table, title, numbering, styles, symbols, closing note, signature, header/footer are kept; the body is
 * rebuilt by cloning the template's own paragraphs (group heading, story heading, summary, link, proposal) per story.
 * Works in Node and in the browser (JSZip only).
 */
import JSZip from 'jszip';
import type { ReportStory } from './pptx.js';

export interface DocxReportInput {
  reportDate: string; // YYYY-MM-DD (VN)
  stories: ReportStory[];
  contactEmail?: string;
}

export class DocxTemplateMismatchError extends Error {}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const textOf = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
/** cloned paragraphs must not repeat Word's paragraph ids */
const noIds = (xml: string) => xml.replace(/ w14:(?:paraId|textId)="[^"]*"/g, '');

/** top-level body parts: paragraphs, tables, final sectPr */
function splitBody(body: string): string[] {
  const parts: string[] = [];
  let i = 0;
  for (;;) {
    const m = /<w:(p|tbl|sectPr)\b/.exec(body.slice(i));
    if (!m) break;
    const s = i + m.index;
    let e: number;
    if (m[1] === 'p') {
      const gt = body.indexOf('>', s);
      e = body[gt - 1] === '/' ? gt + 1 : body.indexOf('</w:p>', s) + 6;
    } else if (m[1] === 'tbl') e = body.indexOf('</w:tbl>', s) + 8;
    else e = body.indexOf('</w:sectPr>', s) + 11;
    parts.push(body.slice(s, e));
    i = e;
  }
  return parts;
}

const pPr = (p: string) => /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p)?.[0] ?? '';
const runs = (p: string) => [...p.matchAll(/<w:r>[\s\S]*?<\/w:r>|<w:r\s[^>]*>[\s\S]*?<\/w:r>/g)].map((m) => m[0]);
const rPrOf = (run: string | undefined) => (run ? /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(run)?.[0] ?? '' : '');
const run = (rPr: string, text: string) => `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

/** same paragraph (properties + first text run's format), new text; symbol runs (☹ / 😐 in Wingdings) are kept only on request (the user removed them, 18/11/2026) */
function withText(p: string, text: string, keepSymbols = false): string {
  const rs = runs(p);
  const first = rs.find((r) => /<w:t[\s>]/.test(r));
  const syms = keepSymbols ? rs.filter((r) => r.includes('<w:sym ')) : [];
  return noIds(`<w:p>${pPr(p)}${run(rPrOf(first), text)}${syms.length ? run(rPrOf(first), ' ') + syms.join('') : ''}</w:p>`);
}

/** "Đề xuất" bold-underlined + ": Giao …" as in the template */
function proposalPara(proto: string, proposal: string): string {
  const rs = runs(proto).filter((r) => /<w:t[\s>]/.test(r));
  const rest = proposal.replace(/^Đề xuất\s*:?\s*/i, '').trim();
  const body = rest ? rest.charAt(0).toLocaleUpperCase('vi') + rest.slice(1) : '';
  return noIds(`<w:p>${pPr(proto)}${run(rPrOf(rs[0]), 'Đề xuất')}${run(rPrOf(rs[1] ?? rs[0]), `: ${body}`)}</w:p>`);
}

/** clustered column chart, one category, one series per group (values written literally) */
function chartXml(title: string, subtitle: string, category: string, series: Array<[string, string, number]>): string {
  const ser = series.map(([name, color, v], i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(name)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/><c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1100" b="1"/></a:pPr><a:endParaRPr lang="vi-VN"/></a:p></c:txPr><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls><c:cat><c:strLit><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(category)}</c:v></c:pt></c:strLit></c:cat><c:val><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>${v}</c:v></c:pt></c:numLit></c:val></c:ser>`).join('');
  const txt = (sz: number, bold: boolean) => `<a:defRPr sz="${sz}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="595959"/></a:solidFill></a:defRPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:lang val="vi-VN"/><c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${txt(1400, false)}</a:pPr><a:r><a:rPr lang="vi-VN" sz="1400" b="0"><a:solidFill><a:srgbClr val="595959"/></a:solidFill></a:rPr><a:t>${esc(title)}</a:t></a:r></a:p><a:p><a:pPr>${txt(1200, false)}</a:pPr><a:r><a:rPr lang="vi-VN" sz="1200" b="0"><a:solidFill><a:srgbClr val="595959"/></a:solidFill></a:rPr><a:t>${esc(subtitle)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser}<c:gapWidth val="219"/><c:overlap val="-27"/><c:axId val="1001"/><c:axId val="1002"/></c:barChart><c:catAx><c:axId val="1001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${txt(1000, false)}</a:pPr><a:endParaRPr lang="vi-VN"/></a:p></c:txPr><c:crossAx val="1002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="1002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="EDEDED"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${txt(900, false)}</a:pPr><a:endParaRPr lang="vi-VN"/></a:p></c:txPr><c:crossAx val="1001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/><c:majorUnit val="1"/></c:valAx><c:spPr><a:noFill/></c:spPr></c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${txt(1000, false)}</a:pPr><a:endParaRPr lang="vi-VN"/></a:p></c:txPr></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>`;
}

export async function buildDocxFromTemplate(templateBytes: Uint8Array, input: DocxReportInput): Promise<{ bytes: Uint8Array; notes: string[] }> {
  const zip = await JSZip.loadAsync(templateBytes);
  const notes: string[] = [];
  const docFile = zip.file('word/document.xml');
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (!docFile || !relsFile) throw new DocxTemplateMismatchError('thiếu word/document.xml');
  const doc = await docFile.async('string');
  let rels = await relsFile.async('string');
  const bStart = doc.indexOf('<w:body>') + '<w:body>'.length;
  const bEnd = doc.lastIndexOf('</w:body>');
  const parts = splitBody(doc.slice(bStart, bEnd));
  const T = parts.map(textOf).map((t) => t.replace(/\s+/g, ' ').trim());
  const find = (pred: (t: string, i: number) => boolean, from = 0) => {
    for (let i = from; i < parts.length; i++) if (pred(T[i]!, i)) return i;
    return -1;
  };
  const isNum = (i: number) => /<w:numPr>/.test(parts[i] ?? '');

  // anchors of the surveyed template (any change → BLOCKED instead of a wrong file)
  const iDate = find((t) => /^(SÁNG\s+)?NGÀY\s*\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4}$/i.test(t));
  const iTT = find((t) => t === 'TỒN TẠI CẦN KHẮC PHỤC');
  const iTC = find((t) => t === 'TÍCH CỰC');
  const iTL = find((t) => t === 'TIN TRUNG LẬP');
  const iNote = find((t) => t.startsWith('Lưu ý'));
  const iLink = find((_, i) => (parts[i] ?? '').includes('<w:hyperlink') && i < iNote);
  const iProp = find((t) => t.startsWith('Đề xuất'));
  const missing = [['ngày báo cáo', iDate], ['nhóm Tồn tại', iTT], ['nhóm Tích cực', iTC], ['nhóm Trung lập', iTL], ['Lưu ý', iNote], ['liên kết bài', iLink], ['Đề xuất', iProp]].filter(([, i]) => (i as number) < 0);
  if (missing.length) throw new DocxTemplateMismatchError(`không tìm thấy: ${missing.map(([n]) => n).join(', ')}`);
  const storyAfter = (h: number) => find((_, i) => i > h && isNum(i), h + 1);
  /** the group's story heading, preferably one with the template's symbol run (☹ for Tồn tại, 😐 for the others) */
  const storyProto = (h: number, next: number) => {
    for (let i = h + 1; i < next; i++) if (isNum(i) && (parts[i] ?? '').includes('<w:sym ')) return parts[i]!;
    return parts[storyAfter(h)]!;
  };
  const proto = {
    TT: { heading: parts[iTT]!, story: storyProto(iTT, iTC) },
    TC: { heading: parts[iTC]!, story: storyProto(iTC, iTL) },
    TL: { heading: parts[iTL]!, story: storyProto(iTL, iNote) },
    summary: parts[storyAfter(iTT) + 1]!,
    link: parts[iLink]!,
    proposal: parts[iProp]!,
  };
  if ([proto.TT.story, proto.TC.story, proto.TL.story, proto.summary].some((x) => !x)) throw new DocxTemplateMismatchError('không tìm thấy đoạn mẫu của tin');

  const [y, mo, d] = input.reportDate.split('-');
  let picRelId: string | null = null;
  const chartRun = (cx: number, cy: number) =>
    `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="90001" name="Biểu đồ điểm tin"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdNRChart"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  // letterhead: "Thành phố Hồ Chí Minh, ngày 16 tháng 11 năm 2026"
  const head = parts.slice(0, iDate).map((p) => p.replace(/(<w:p\b[\s\S]*?<\/w:p>)/g, (para) => {
    const t = textOf(para);
    return /ngày\s*\d{1,2}\s*tháng\s*\d{1,2}\s*năm\s*\d{4}/.test(t) ? withText(para, t.replace(/ngày\s*\d{1,2}\s*tháng\s*\d{1,2}\s*năm\s*\d{4}/, `ngày ${Number(d)} tháng ${Number(mo)} năm ${y}`)) : para;
  }));
  // title date: any window can be reported → "NGÀY dd/mm/yyyy" (no "SÁNG")
  const title = withText(parts[iDate]!, `NGÀY ${d}/${mo}/${y}`);
  const counts = { positive: 0, needs_attention: 0, neutral: 0 } as Record<ReportStory['group'], number>;
  for (const s of input.stories) counts[s.group]++;
  let chartAdded = false;
  const regionPart = parts.slice(iDate + 1, iTT).map((p) => {
    // decorative line + chart picture + "A. NGÀNH XÂY DỰNG …": only the picture run is replaced
    const pic = /r:embed="([^"]+)"/.exec(p);
    if (!pic) return p;
    const at = p.indexOf(pic[0]);
    const rs = Math.max(p.lastIndexOf('<w:r>', at), p.lastIndexOf('<w:r ', at));
    const re = p.indexOf('</w:r>', at) + 6;
    const ext = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(p.slice(rs, re));
    chartAdded = true;
    picRelId = pic[1]!;
    return p.slice(0, rs) + chartRun(Number(ext?.[1] ?? 5486400), Number(ext?.[2] ?? 3200400)) + p.slice(re);
  });
  if (!chartAdded) notes.push('Mẫu Word không có ảnh biểu đồ – bỏ qua biểu đồ.');

  // hyperlinks: one relationship per story link
  let relN = 0;
  const newRels: string[] = [];
  const linkRun = rPrOf(runs(proto.link).find((r) => /<w:t[\s>]/.test(r)));
  const linkPara = (url: string) => {
    const id = `rIdNR${++relN}`;
    newRels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(url)}" TargetMode="External"/>`);
    return noIds(`<w:p>${pPr(proto.link)}<w:hyperlink r:id="${id}" w:history="1">${run(linkRun, url)}</w:hyperlink></w:p>`);
  };

  const groups: Array<{ key: 'TT' | 'TC' | 'TL'; group: ReportStory['group'] }> = [
    { key: 'TT', group: 'needs_attention' }, { key: 'TC', group: 'positive' }, { key: 'TL', group: 'neutral' },
  ];
  const out: string[] = [...head, title, ...regionPart];
  for (const g of groups) {
    out.push(noIds(proto[g.key].heading));
    const list = input.stories.filter((s) => s.group === g.group);
    if (!list.length) out.push(withText(proto.summary, '(Không có tin.)'));
    for (const s of list) {
      out.push(withText(proto[g.key].story, s.title));
      if (s.summary) out.push(withText(proto.summary, s.summary));
      for (const src of s.sources) out.push(linkPara(src.url));
      if (g.group === 'needs_attention' && s.proposal) out.push(proposalPara(proto.proposal, s.proposal));
    }
  }
  // closing note (contact e-mail from the settings), signature and the section properties
  let note = parts[iNote]!;
  const oldMail = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(textOf(note))?.[0];
  if (oldMail && input.contactEmail && oldMail !== input.contactEmail) {
    note = note.split(oldMail).join(esc(input.contactEmail));
    rels = rels.split(`mailto:${oldMail}`).join(`mailto:${esc(input.contactEmail)}`);
  }
  out.push(noIds(note), ...parts.slice(iNote + 1));

  // drop the template's own hyperlinks (sample stories) that are no longer referenced; add ours
  const body = out.join('');
  rels = rels.replace(/<Relationship [^>]*Type="[^"]*\/hyperlink"[^>]*\/>/g, (r) => {
    const id = /Id="([^"]+)"/.exec(r)?.[1];
    return id && body.includes(`r:id="${id}"`) ? r : '';
  });
  rels = rels.replace('</Relationships>', `${newRels.join('')}</Relationships>`);
  if (chartAdded) {
    const label = `Ngày ${d}/${mo}/${y}`;
    zip.file('word/charts/chart1.xml', chartXml(`Điểm tin Báo chí ngày ${d}/${mo}/${y}`, `Tổng: ${input.stories.length}`, label, [
      ['Tích cực', '00B050', counts.positive], ['Tồn tại cần khắc phục', 'FF0000', counts.needs_attention], ['Trung lập', '0070C0', counts.neutral],
    ]));
    rels = rels.replace('</Relationships>', '<Relationship Id="rIdNRChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/></Relationships>');
    if (picRelId) {
      const target = new RegExp(`<Relationship [^>]*Id="${picRelId}"[^>]*Target="([^"]+)"[^>]*/>`).exec(rels)?.[1];
      rels = rels.replace(new RegExp(`<Relationship [^>]*Id="${picRelId}"[^>]*/>`), '');
      if (target && !body.includes(`"${picRelId}"`)) zip.remove(`word/${target}`);
    }
    const ctFile = zip.file('[Content_Types].xml')!;
    const ct = await ctFile.async('string');
    if (!ct.includes('/word/charts/chart1.xml')) zip.file('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>'));
  }
  // group numbers "I." / "II." / "III." take the colour of their heading (the template's list level forced "auto" = black)
  const numFile = zip.file('word/numbering.xml');
  if (numFile) {
    let num = await numFile.async('string');
    for (const h of [proto.TT.heading, proto.TC.heading, proto.TL.heading]) {
      const numId = /<w:numId w:val="(\d+)"/.exec(h)?.[1];
      const ilvl = /<w:ilvl w:val="(\d+)"/.exec(h)?.[1] ?? '0';
      const abs = numId ? new RegExp(`<w:num w:numId="${numId}"[^>]*>\\s*<w:abstractNumId w:val="(\\d+)"`).exec(num)?.[1] : undefined;
      if (!abs) continue;
      const a0 = num.indexOf(`w:abstractNumId="${abs}"`);
      const a1 = num.indexOf('</w:abstractNum>', a0);
      const l0 = num.indexOf(`<w:lvl w:ilvl="${ilvl}"`, a0);
      if (a0 < 0 || l0 < 0 || l0 > a1) continue;
      const l1 = num.indexOf('</w:lvl>', l0);
      num = num.slice(0, l0) + num.slice(l0, l1).replace(/<w:color [^>]*\/>/g, '') + num.slice(l1);
    }
    zip.file('word/numbering.xml', num);
  }
  zip.file('word/document.xml', doc.slice(0, bStart) + body + doc.slice(bEnd));
  zip.file('word/_rels/document.xml.rels', rels);

  // document properties: no personal names from the template
  const core = zip.file('docProps/core.xml');
  if (core) {
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    zip.file('docProps/core.xml', (await core.async('string'))
      .replace(/<dc:creator>[^<]*<\/dc:creator>/, '<dc:creator>News Reporter</dc:creator>')
      .replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, '<cp:lastModifiedBy>News Reporter</cp:lastModifiedBy>')
      .replace(/(<dcterms:modified[^>]*>)[^<]*/, `$1${now}`)
      .replace(/<cp:revision>[^<]*<\/cp:revision>/, '<cp:revision>1</cp:revision>'));
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { bytes, notes };
}
