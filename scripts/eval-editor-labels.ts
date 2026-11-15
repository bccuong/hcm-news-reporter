/** Filter quality on REAL editor labels stored by the local app (data/reviews/*.json) across all runs.
 *  Usage: npx tsx scripts/eval-editor-labels.ts [--limit 60] */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { computeRelevanceQuality } from '../src/domain/quality.js';
import type { Article, Candidate, ReviewDecision, RunManifest } from '../src/domain/schemas.js';

const i = process.argv.indexOf('--limit');
const limit = i > 0 ? Number(process.argv[i + 1]) : 60;
const runsDir = 'data/runs';
const data = readdirSync(runsDir)
  .filter((d) => existsSync(path.join(runsDir, d, 'manifest.json')))
  .map((d) => {
    const manifest = JSON.parse(readFileSync(path.join(runsDir, d, 'manifest.json'), 'utf8')) as RunManifest;
    const rf = path.join('data/reviews', `${d}.json`);
    const reviews = existsSync(rf) ? (JSON.parse(readFileSync(rf, 'utf8')) as Record<string, ReviewDecision>) : {};
    const cf = path.join(runsDir, d, 'candidates.json');
    const af = path.join(runsDir, d, 'articles.jsonl');
    return {
      manifest,
      reviews,
      candidates: existsSync(cf) ? (JSON.parse(readFileSync(cf, 'utf8')) as Candidate[]) : [],
      articles: existsSync(af) ? readFileSync(af, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Article) : [],
    };
  })
  .filter((d) => d.manifest.status === 'completed')
  .sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt))
  .slice(0, limit);
const q = computeRelevanceQuality(data);
const pct = (x: number | null) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`);
console.log(`runs=${q.runs.length} labelled=${q.total.labelled}  precision(ready)=${pct(q.precisionReady)}  recall=${pct(q.recall)}`);
console.log(`ready R/N=${q.total.ready.R}/${q.total.ready.N}  review R/N=${q.total.review.R}/${q.total.review.N}  excluded R/N=${q.total.excluded.R}/${q.total.excluded.N}`);
for (const m of q.missed) console.log(`  MISSED [${m.reasonCode}] ${m.source}: ${m.title}`);
for (const m of q.falseReady) console.log(`  FALSE READY ${m.source}: ${m.title}`);
