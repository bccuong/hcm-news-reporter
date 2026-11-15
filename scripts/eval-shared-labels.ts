/**
 * Analyse the team's review labels (labels/labels.json) against what the collector decided (published live/<date>.json):
 * precision/recall by majority vote, sector + assessment confusion, reviewer agreement and notes.
 * Usage: npx tsx scripts/eval-shared-labels.ts [--site https://bccuong.github.io/news-reporter/]
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { computeRelevanceQuality } from '../src/domain/quality.js';
import type { ReviewDecision } from '../src/domain/schemas.js';

interface L { reportDate: string; articleId: string; title: string; sourceId: string; reviewer: string; label: 'relevant' | 'irrelevant' | null; category: string | null; assessment: string | null; note: string }
const i = process.argv.indexOf('--site');
const SITE = i > 0 ? process.argv[i + 1]! : 'https://bccuong.github.io/news-reporter/';
const labels = (JSON.parse(readFileSync('labels/labels.json', 'utf8')) as { labels: L[] }).labels;
const byDate = new Map<string, L[]>();
for (const l of labels) byDate.set(l.reportDate, [...(byDate.get(l.reportDate) ?? []), l]);

async function day(date: string) {
  const local = path.join('web/public/live', `${date}.json`);
  if (existsSync(local)) return JSON.parse(readFileSync(local, 'utf8'));
  const r = await fetch(new URL(`live/${date}.json`, SITE));
  return r.ok ? r.json() : null;
}
const majority = <T,>(xs: T[]) => {
  const m = new Map<T, number>();
  for (const x of xs) if (x != null) m.set(x, (m.get(x) ?? 0) + 1);
  const s = [...m.entries()].sort((a, b) => b[1] - a[1]);
  return s.length && (s.length === 1 || s[0]![1] > s[1]![1]) ? s[0]![0] : null;
};

const data = [];
const catConf = new Map<string, number>();
const asmConf = new Map<string, number>();
let agree = 0;
let multi = 0;
for (const [date, ls] of byDate) {
  const d = await day(date);
  if (!d) {
    console.log(`(no published data for ${date})`);
    continue;
  }
  const arts = new Map<string, any>(d.articles.map((a: any) => [a.id, a]));
  const reviews: Record<string, ReviewDecision> = {};
  const per = new Map<string, L[]>();
  for (const l of ls) per.set(l.articleId, [...(per.get(l.articleId) ?? []), l]);
  for (const [aid, vs] of per) {
    const lab = majority(vs.map((v) => v.label));
    if (lab) reviews[aid] = { articleId: aid, included: false, order: 0, updatedAt: '', changes: [], relevanceLabel: lab };
    const voted = vs.filter((v) => v.label);
    if (voted.length > 1) {
      multi++;
      if (voted.every((v) => v.label === voted[0]!.label)) agree++;
    }
    const a = arts.get(aid);
    const cat = majority(vs.map((v) => v.category));
    if (a && cat && cat !== a.primaryCategory) catConf.set(`${a.primaryCategory ?? '—'} → ${cat}`, (catConf.get(`${a.primaryCategory ?? '—'} → ${cat}`) ?? 0) + 1);
    const asm = majority(vs.map((v) => v.assessment));
    if (a && asm && asm !== a.suggestedAssessment) asmConf.set(`${a.suggestedAssessment ?? '—'} → ${asm}`, (asmConf.get(`${a.suggestedAssessment ?? '—'} → ${asm}`) ?? 0) + 1);
  }
  data.push({ manifest: { runId: `run_live_${date.replace(/-/g, '')}`, window: d.manifest.window }, candidates: d.candidates, articles: d.articles.map((a: any) => ({ ...a, originalUrl: a.url })), reviews });
}
const q = computeRelevanceQuality(data);
const pct = (x: number | null) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`);
console.log(`labels=${labels.length} reviewers=${new Set(labels.map((l) => l.reviewer)).size} days=${byDate.size}`);
console.log(`precision(ready)=${pct(q.precisionReady)}  recall=${pct(q.recall)}  labelled articles=${q.total.labelled}`);
console.log(`ready R/N=${q.total.ready.R}/${q.total.ready.N}  review R/N=${q.total.review.R}/${q.total.review.N}  excluded R/N=${q.total.excluded.R}/${q.total.excluded.N}`);
console.log(`reviewer agreement on multi-voted articles: ${multi ? pct(agree / multi) : '—'} (${multi})`);
for (const m of q.missed) console.log(`  MISSED [${m.reasonCode}] ${m.source}: ${m.title}`);
for (const m of q.falseReady) console.log(`  FALSE READY ${m.source}: ${m.title}`);
for (const [k, v] of [...catConf].sort((a, b) => b[1] - a[1])) console.log(`  sector fix ${k}: ${v}`);
for (const [k, v] of [...asmConf].sort((a, b) => b[1] - a[1])) console.log(`  assessment fix ${k}: ${v}`);
for (const l of labels.filter((x) => x.note)) console.log(`  NOTE (${l.label ?? '-'}) ${l.title}: ${l.note}`);
