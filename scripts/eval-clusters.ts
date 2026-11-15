/** Evaluate same-event clustering on a stored run (default: latest non-fixture run). Prints multi-publisher clusters. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { clusterArticles } from '../src/domain/cluster.js';
import type { Article } from '../src/domain/schemas.js';

const dir = 'data/runs';
const runId = process.argv[2] ?? readdirSync(dir).filter((d) => d.startsWith('run_2')).sort().pop()!;
const rows = readFileSync(path.join(dir, runId, 'articles.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Article);
const arts = [...new Map(rows.map((a) => [a.id, a])).values()].map((a) => ({ ...a, duplicateGroupId: null }));
import type { PairEvidence } from '../src/domain/cluster.js';
const ev: PairEvidence[] = [];
const groups = clusterArticles(arts, ev);
const byId = new Map(arts.map((a) => [a.id, a]));
let multi = 0;
for (const ids of groups.values()) {
  const g = ids.map((id) => byId.get(id)!);
  const pubs = new Set(g.map((a) => a.sourceId));
  if (pubs.size > 1) multi++;
  if (pubs.size < 2 && !process.argv.includes('--all')) continue;
  console.log(`\n[${g.length} bài, ${pubs.size} báo] ${ev.filter((e) => ids.includes(e.a)).map((e) => `${e.rule}:${e.score.toFixed(2)}`).join(' ')}`);
  for (const a of g) console.log(`  ${a.sourceName.padEnd(18)} ${a.publishedAt?.slice(5, 16) ?? '?'}  ${a.title}`);
}
console.log(`\nrun=${runId} articles=${arts.length} clusters=${groups.size} multi-publisher=${multi}`);
