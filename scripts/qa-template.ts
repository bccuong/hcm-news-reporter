/**
 * Visual-QA driver (operator-side check, uses the running local server):
 *  1. uploads the template given on the command line (stored as a COPY in templates/user/),
 *  2. selects real articles from the latest run (summary = the article's own sapo, assessment = suggestion),
 *  3. exports PPTX + PDF through the normal API.
 * Usage: npx tsx scripts/qa-template.ts reference/hcm-news-reporter-skill/assets/reference-report.pptx
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const base = 'http://127.0.0.1:5178';
const tok = ((await (await fetch(`${base}/api/session`)).json()) as { token: string }).token;
const H = { 'content-type': 'application/json', 'x-hcm-token': tok };
const call = async (method: string, url: string, body?: unknown) => {
  const r = await fetch(base + url, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${url}: ${JSON.stringify(j)}`);
  return j as any;
};

const tpl = process.argv[2];
if (tpl) {
  const up = await call('POST', '/api/templates', { name: path.basename(tpl), base64: readFileSync(tpl).toString('base64') });
  console.log('template copy:', up.templateFile);
}
const runs = await call('GET', '/api/runs');
const run = runs.find((r: any) => r.trigger !== 'fixture');
const arts: any[] = await call('GET', `/api/runs/${run.runId}/articles`);
const cands: any[] = await call('GET', `/api/runs/${run.runId}/candidates`);
const ready = arts.filter((a) => {
  const c = cands.find((x) => x.articleId === a.id);
  return c?.state === 'ready_for_review' && !c.reasonCode && a.sapo;
});
const pick = (g: string, n: number) => ready.filter((a) => a.suggestedAssessment === g && a.location.status === 'hcm').slice(0, n);
const chosen = [...pick('needs_attention', 3), ...pick('positive', 2), ...pick('neutral', 4)];
const cut = (s: string, max: number) => (s.length <= max ? s : s.slice(0, s.lastIndexOf(' ', max - 1)) + '…');
let order = 1;
for (const a of chosen) {
  const g = a.suggestedAssessment;
  await call('PATCH', `/api/runs/${run.runId}/reviews/${a.id}`, {
    included: true, order: order++, assessment: g,
    summary: cut(a.sapo, g === 'neutral' ? 330 : 260),
    shortLabel: cut(a.title, 42),
    title: cut(a.title, 120),
    ...(g === 'needs_attention' ? { proposal: 'Đề xuất: đầu mối đề xuất, chờ rà soát.' } : {}),
  });
  console.log(`+ [${g}] ${a.sourceName}: ${a.title}`);
}
const res = await call('POST', `/api/runs/${run.runId}/export`, { formats: ['pptx', 'pdf'] });
console.log(JSON.stringify(res, null, 2));
