/** Precision/recall of the relevance verdict on a labelled live run (full stored articles, current code + default settings).
 *  Usage: npx tsx scripts/eval-relevance.ts [labels.json] */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defaultSettings } from '../src/domain/defaults.js';
import { annotateArticle } from '../src/domain/relevance.js';
import type { Article, Candidate } from '../src/domain/schemas.js';

const labels = JSON.parse(readFileSync(process.argv[2] ?? 'tests/fixtures/relevance-labels-2026-11-15.json', 'utf8')) as { run: string; R: string[]; B: string[] };
const dir = path.join('data/runs', labels.run);
const cands = JSON.parse(readFileSync(path.join(dir, 'candidates.json'), 'utf8')) as Candidate[];
const arts = new Map(readFileSync(path.join(dir, 'articles.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Article).map((a) => [a.id, a]));
const settings = defaultSettings();
const items = cands.filter((c) => c.articleId && !['outside_window', 'duplicate'].includes(c.state) && c.reasonCode !== 'EXCLUDED_URL_SECTION').map((c) => arts.get(c.articleId!)!);

const bucket = { ready: [] as string[], review: [] as string[], excluded: [] as string[] };
const label = (t: string) => (labels.R.includes(t) ? 'R' : labels.B.includes(t) ? 'B' : 'N');
for (const a of items) {
  const { _verdict: v } = annotateArticle(a, settings);
  const b = v.status === 'irrelevant' ? 'excluded' : v.status === 'relevant' ? 'ready' : 'review';
  bucket[b].push(`${label(a.title)} ${a.title}${v.reasonCode ? `  [${v.reasonCode}]` : ''}`);
}
const n = (b: keyof typeof bucket, l: string) => bucket[b].filter((x) => x.startsWith(l)).length;
const R = labels.R.length;
console.log(`items=${items.length}  R=${R} B=${labels.B.length}`);
console.log(`READY    ${bucket.ready.length}: R=${n('ready', 'R')} N=${n('ready', 'N')} B=${n('ready', 'B')}  → precision ${(n('ready', 'R') / Math.max(1, n('ready', 'R') + n('ready', 'N'))).toFixed(2)}`);
console.log(`REVIEW   ${bucket.review.length}: R=${n('review', 'R')} N=${n('review', 'N')} B=${n('review', 'B')}  (editor load)`);
console.log(`EXCLUDED ${bucket.excluded.length}: R=${n('excluded', 'R')} N=${n('excluded', 'N')} B=${n('excluded', 'B')}`);
console.log(`recall (ready+review) = ${((n('ready', 'R') + n('review', 'R')) / R).toFixed(2)}   recall (ready) = ${(n('ready', 'R') / R).toFixed(2)}`);
if (process.argv.includes('-v')) for (const [k, v] of Object.entries(bucket)) console.log(`\n--- ${k}\n${v.join('\n')}`);
