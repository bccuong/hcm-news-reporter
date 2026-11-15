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

const tpl = process.argv.slice(2).find((a) => !a.startsWith('--'));
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
// reset previous QA decisions for this run
const prevReview = await call('GET', `/api/runs/${run.runId}/review`);
for (const id of Object.keys(prevReview)) await call('PATCH', `/api/runs/${run.runId}/reviews/${id}`, { included: false, groupId: null });

// same-event clusters across DIFFERENT publishers (from the collector's title clustering)
const clusters = new Map<string, any[]>();
for (const a of arts) if (a.duplicateGroupId) clusters.set(a.duplicateGroupId, [...(clusters.get(a.duplicateGroupId) ?? []), a]);
const multi = [...clusters.values()].filter((g) => new Set(g.map((a) => a.sourceId)).size > 1);
console.log(`same-event clusters across publishers: ${multi.length}`);
for (const g of multi) console.log('  cluster:', g.map((a) => `${a.sourceName}: ${a.title}`).join('  ||  '));
let clusterPrimaries = multi.map((g) => g.find((a: any) => ready.includes(a))).filter(Boolean);
if (process.argv.includes('--render-check-clusters')) {
  // RENDER CHECK ONLY (not a deliverable report): use sector-tagged clusters even if outside HCMC scope
  clusterPrimaries = multi
    .filter((g) => g.some((a: any) => ['LAND', 'BUILD', 'INVEST', 'REALESTATE'].includes(a.primaryCategory)))
    .map((g) => [...g].sort((x: any, y: any) => (y.imageCandidates.length - x.imageCandidates.length))[0])
    .slice(0, 2);
  for (const a of clusterPrimaries) a.suggestedAssessment = 'neutral';
  console.log('RENDER CHECK – cluster stories forced in:', clusterPrimaries.map((a: any) => a.title));
}

const pick = (g: string, n: number) => ready.filter((a) => a.suggestedAssessment === g && a.location.status === 'hcm' && !clusterPrimaries.includes(a)).slice(0, n);
const chosen = [...clusterPrimaries, ...pick('needs_attention', 2), ...pick('positive', 2), ...pick('neutral', 3)];
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
  // merge the other publishers' reports of the same event as additional sources
  if (a.duplicateGroupId) {
    for (const o of arts.filter((x) => x.duplicateGroupId === a.duplicateGroupId && x.id !== a.id && x.sourceId !== a.sourceId)) {
      await call('PATCH', `/api/runs/${run.runId}/reviews/${o.id}`, { groupId: a.id, included: false });
      console.log(`    ↳ merged source ${o.sourceName}: ${o.title}`);
    }
  }
}
const res = await call('POST', `/api/runs/${run.runId}/export`, { formats: ['pptx', 'pdf'] });
console.log(JSON.stringify(res, null, 2));
