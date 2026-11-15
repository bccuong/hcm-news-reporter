/**
 * Visual-QA driver for the report templates (operator-side, uses the running local server on 127.0.0.1:5178):
 * selects real ready articles of the latest TP.HCM run (summary = the article's own sapo, assessment = suggestion),
 * then exports the SAME selection with every built-in template (PPTX + PDF through PowerPoint/LibreOffice).
 * Usage: npx tsx scripts/qa-styles.ts [templateId …]
 */
export {};
const base = 'http://127.0.0.1:5178';
const tok = ((await (await fetch(`${base}/api/session`)).json()) as { token: string }).token;
const H = { 'content-type': 'application/json', 'x-hcm-token': tok };
const call = async (method: string, url: string, body?: unknown) => {
  const r = await fetch(base + url, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${url}: ${JSON.stringify(j)}`);
  return j as any;
};

const runs = await call('GET', '/api/runs');
const run = runs.find((r: any) => r.trigger !== 'fixture' && (r.profileId ?? 'hcm') === 'hcm');
if (!run) throw new Error('no TP.HCM run in the local data');
const arts: any[] = await call('GET', `/api/runs/${run.runId}/articles`);
const cands: any[] = await call('GET', `/api/runs/${run.runId}/candidates`);
const ready = arts.filter((a) => {
  const c = cands.find((x) => x.articleId === a.id);
  return c?.state === 'ready_for_review' && !c.reasonCode && a.sapo;
});
const prev = await call('GET', `/api/runs/${run.runId}/review`);
for (const id of Object.keys(prev)) await call('PATCH', `/api/runs/${run.runId}/reviews/${id}`, { included: false, groupId: null });
const pick = (g: string, n: number) => ready.filter((a) => a.suggestedAssessment === g).sort((x, y) => y.imageCandidates.length - x.imageCandidates.length).slice(0, n);
const chosen = [...pick('needs_attention', 2), ...pick('positive', 2), ...pick('neutral', 2)];
const cut = (s: string, max: number) => (s.length <= max ? s : s.slice(0, s.lastIndexOf(' ', max - 1)) + '…');
let order = 1;
for (const a of chosen) {
  const g = a.suggestedAssessment;
  await call('PATCH', `/api/runs/${run.runId}/reviews/${a.id}`, {
    included: true, order: order++, assessment: g, summary: cut(a.sapo, g === 'neutral' ? 330 : 260), shortLabel: cut(a.title, 42), title: cut(a.title, 120),
    ...(g === 'needs_attention' ? { proposal: 'Đề xuất: đầu mối đề xuất, chờ rà soát.' } : {}),
  });
  console.log(`+ [${g}] ${a.sourceName}: ${a.title} (${a.imageCandidates.length} ảnh)`);
}
const { templates } = await call('GET', '/api/templates');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : templates.filter((t: any) => t.id !== 'upload').map((t: any) => t.id);
for (const templateId of ids) {
  const res = await call('POST', `/api/runs/${run.runId}/export`, { formats: ['pptx', 'pdf'], templateId });
  console.log(`${templateId}: ${res.files.join(', ')} pdf=${res.pdfStatus} ${res.warnings.filter((w: string) => !/Tóm tắt|Tiêu đề/.test(w)).slice(0, 3).join(' | ')}`);
}
