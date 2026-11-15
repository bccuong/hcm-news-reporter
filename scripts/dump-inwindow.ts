/** Dump in-window articles of a stored run (title, sapo, current verdict) for relevance labelling.
 *  Usage: npx tsx scripts/dump-inwindow.ts [runId] > out.json */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Article, Candidate } from '../src/domain/schemas.js';

const dir = 'data/runs';
const runId = process.argv[2] ?? readdirSync(dir).filter((d) => d.startsWith('run_2')).sort().pop()!;
const cands = JSON.parse(readFileSync(path.join(dir, runId, 'candidates.json'), 'utf8')) as Candidate[];
const rows = readFileSync(path.join(dir, runId, 'articles.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Article);
const arts = new Map(rows.map((a) => [a.id, a]));
const out = cands
  .filter((c) => c.articleId && !['outside_window', 'duplicate'].includes(c.state) && c.reasonCode !== 'EXCLUDED_URL_SECTION')
  .map((c) => {
    const a = arts.get(c.articleId!)!;
    return { id: a.id, source: a.sourceName, title: a.title, sapo: a.sapo.slice(0, 220), state: c.state, reason: c.reasonCode, cat: a.primaryCategory, loc: a.location.status };
  });
console.log(JSON.stringify({ runId, n: out.length, items: out }, null, 1));
