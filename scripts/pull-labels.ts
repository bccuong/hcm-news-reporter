/**
 * Nightly: pull the team's review labels from the Cloudflare Worker into the repo (labels/labels.json).
 * Reviewer names are replaced by stable pseudonyms (HMAC with EXPORT_TOKEN) because the repository is public.
 * Env: REVIEW_API_URL, EXPORT_TOKEN
 */
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const api = process.env.REVIEW_API_URL;
const token = process.env.EXPORT_TOKEN;
if (!api || !token) {
  console.log('REVIEW_API_URL / EXPORT_TOKEN not configured – nothing to pull');
  process.exit(0);
}
const r = await fetch(`${api.replace(/\/$/, '')}/export`, { headers: { authorization: `Bearer ${token}` } });
if (!r.ok) throw new Error(`export failed: HTTP ${r.status}`);
const j = (await r.json()) as { count: number; labels: Array<Record<string, unknown>> };
const pseudo = (id: string) => `r_${createHmac('sha256', token).update(id).digest('hex').slice(0, 10)}`;
const key = (x: Record<string, unknown>) => `${String(x.reportDate)}|${String(x.articleId)}|${String(x.reviewer)}`;
const labels: Array<Record<string, unknown>> = j.labels
  .map(({ reviewer: _name, reviewerId, ...rest }) => ({ ...rest, reviewer: pseudo(String(reviewerId)) }) as Record<string, unknown>)
  .sort((a, b) => key(a).localeCompare(key(b)));
mkdirSync('labels', { recursive: true });
writeFileSync('labels/labels.json', `${JSON.stringify({ note: 'Team review labels pulled nightly from the review worker; reviewer names pseudonymised.', count: labels.length, labels }, null, 1)}\n`);
console.log(`pulled ${labels.length} labels from ${new Set(labels.map((l) => l.reviewer)).size} reviewers`);
