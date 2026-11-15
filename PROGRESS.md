# PROGRESS — HCM News Reporter (Claude Code)

## Current status
- Specification: v1.2
- Milestones: **M0 DONE · M1 DONE · M2 DONE · M5 DONE locally (original template + LibreOffice PDF, visually inspected)** · M3/M4 in progress · M6 partial
- Repository: https://github.com/bccuong/hcm-news-reporter (branch `main`) · Demo: https://bccuong.github.io/hcm-news-reporter/
- Last session: 2026-11-15 (session 2)

## Assets
See `docs/ASSET_INVENTORY.md`. Template integration: `docs/TEMPLATE_INTEGRATION.md`. Tools on this PC: Node 26, Git, gh, **LibreOffice** (installed session 2), Microsoft Edge (used by Playwright locally). Python not installed (not needed).

## Session 6 – done (with evidence)
- **Relevance precision** measured on the labelled live sample (`tests/fixtures/relevance-labels-2026-11-15.json`, 64 in-window articles, labels by Claude per Skill criteria – editor to review) with `scripts/eval-relevance.ts`:
  ready precision **0.56 → 0.80**, review queue **37 → 6**, relevant excluded **0** (recall 1.00).
  Rules (all editable in Settings): sector keyword required in title/sapo (`NO_SECTOR_IN_LEAD`); no HCM evidence at all → excluded (`NO_HCM_EVIDENCE`) unless the title has a clear sector keyword (→ review); HCM only in body with <2 places → review (`HCM_ONLY_IN_BODY`); sports/price exclude phrases; "mưa lớn", "công trường" keywords.
- Cross-check on 16/11 live data (different day): both HCMC rain/flood stories kept, 17 off-topic excluded with reasons.
- Regression tests `tests/relevance.test.ts` (7 relevant never excluded, 7 irrelevant with expected reason, settings toggle).
- Commands: tsc 0 · vitest **68/68** · playwright **7/7**.

## Session 5 – done (with evidence)
- **Live public site** (user decision: GitHub Pages auto-updating hourly): `scripts/cloud-collect.ts` runs the real collector on GitHub Actions (`.github/workflows/pages.yml`, cron `7 * * * *` + push), publishes a redacted dataset (titles, links, sapo ≤300 chars, ledger, coverage, adapter health, clusters – no full text, no publisher photos) to `live/`; previous days + adapter baseline carried over from the deployed site; last completed window frozen 2 h after it ends. Pages UI switches to read-only LIVE mode (period selector, last-update banner, 5-min refresh). Tests moved to `.github/workflows/ci.yml`. First cloud run: all 5 sources reachable from GitHub runners (16/11 in-progress 1238 links, 15/11 1223 links).
- **SGGP adapter:** all 14 `ARTICLE_BODY_MISSING` were video pages (cms-body with `figure.video`, or "short video" feed with no h1). Extractor now recognises video/podcast articles → `parsed_partial` with `MEDIA_ARTICLE` (title, sapo, verified time kept); adapter health ignores media partials; SGGP print-edition pages excluded by URL pattern. Live run: parse_failed 14→**0** (all sources 0), SGGP failure rate 24%→**12%**, 15 video stories kept.
- Tools: `scripts/inspect-page.ts <url>` (container diagnosis), `scripts/shot-pages.mts` (Pages screenshot).
- Commands: tsc 0 · vitest **52/52** · playwright **7/7** · cloud run on GitHub ✓ · live run 1235/1235 accounted.

## Session 4 – done (with evidence)
- **DIS-08 adapter-degraded detection** (`src/collector/health.ts`): per source and run – fetched, parse failures, partial, unknown dates, main body container; compared with ≤3 previous HEALTHY runs. Degraded (failure rate +25 pts & ≥30%, or main container changed, or ≥50% failing with no history) → articles lose automatic "complete" (`ADAPTER_DEGRADED` warning), ready items go to the review queue, run marked incomplete, coverage tab shows reasons + recovery steps (open source settings, rescan). Degraded runs never become the baseline.
- **Same-event clustering rewritten** (`src/domain/cluster.ts`): union-find (no split clusters), title Jaccard + IDF-weighted title+sapo overlap with mutual-best guard (no chaining), time limits, generic titles ignored. Live 15/11 run: 19 multi-publisher events; the "6 quân nhân" event now 1 cluster of 4 publishers (was split in 2); the 24-article false mega-cluster from the first draft eliminated.
- Live baseline recorded for 5 real sources (all "ok"; SGGP 24% failure baseline – known special layouts).
- Commands: `npx tsc` 0 errors · `npx vitest run` **47/47** · `npx playwright test` **7/7** (incl. DIS-08 UI) · `npx tsx scripts/eval-clusters.ts` · `scripts/live-run.ps1` 1226/1226 accounted.

## Session 3 – done (with evidence)
- **Multi-source stories (DIS-06):** `groupId` merge model in `src/reports/assemble.ts` (one level, chronological sources, one per publisher, photo fallback from merged article, unverified merged source excluded with warning); UI "Nguồn cùng sự kiện" panel in Article Inspector + Export tab (suggestions from title clustering, manual pick, split). Template renders `Nguồn: A | B` with a hyperlink per publisher.
- **Microsoft PowerPoint verified:** exported PPTX opens via COM without repair; PowerPoint is now the preferred PDF backend (`auto`), LibreOffice fallback.
- **Overflow fixed for real:** cover/recommendation summary lists fitted to box ("… và N tin khác") – found from PowerPoint render.
- Default cover label cut at word boundary ≤42 chars; bug fixed in source ordering (in-place sort lost merged sources).
- Fixture publisher D (same event as A) for deterministic merge tests.
- Commands: `npx tsc` 0 errors · `npx vitest run` **42/42** · `npx playwright test` **6/6** · real-data QA: 14 cross-publisher clusters found in the 15/11 run; render check PDF by PowerPoint inspected.

## Session 2 – done (with evidence)
- Original-template PPTX renderer `src/reports/templatePptx.ts` wired into export (falls back to labeled DEMO only when no template uploaded; mismatching template → BLOCKED/422).
- Real-photo pipeline: jpeg/png only, magic-byte + dimension checks, cover-crop, TC feature photo = second photo of the same positive article.
- PDF via LibreOffice; visual QA of a real 15/11/2026 report; 5 renderer defects found & fixed.
- Precision: weak sector evidence → review queue (`WEAK_TOPIC_EVIDENCE`).
- Playwright UI tests (6) clicking real controls + reload persistence; screenshots in `docs/screenshots/`.
- Server crash fixed (SSE write-after-end), optimistic review updates, CI runs UI tests.

## Commands executed and results (session 2)
- `npx tsc -p tsconfig.json --noEmit` → 0 errors
- `npx vitest run` → **38/38** (template tests run locally only – private template not in repo, skipped in CI)
- `npx playwright test` → **6/6** (Edge locally)
- `scripts/live-run.ps1` → 1221 candidates, 1221 accounted, 41 ready (before WEAK_TOPIC change)
- `npx tsx scripts/qa-template.ts <template>` → PPTX + PDF ok, inspected

## Acceptance gates
| Gate | Status | Evidence |
|---|---|---|
| M0 | DONE | docs/ASSET_INVENTORY.md |
| M1 | DONE | server tests + Playwright UI-01/03/04/05/06/07 |
| M2 | DONE | collector fixtures + live runs |
| M3 | IN PROGRESS | coverage/retry UI done; DIS-08 (adapter degraded detection) missing |
| M4 | IN PROGRESS | manual merge/split of same-event groups, multi-source stories missing |
| M5 | DONE (local) | template PPTX + LibreOffice PDF visually inspected; MS PowerPoint not verified |
| M6 | PARTIAL | CI typecheck+unit+UI+Pages; Windows launcher scripts; no packaged installer |

## Known issues
- VnExpress: 120 `retry_pending` at default 300 fetches (no URL date) – use "Mở rộng quét" or raise limit.
- SGGP: ~16 `ARTICLE_BODY_MISSING` (special layouts) – adapter needed.
- Default topic rule is still broad; borderline stories (e.g. sport events of the construction sector) reach "ready" – reviewer decides.
- Long short-labels overflow cover/recommendation list boxes → warned, not auto-fixed.
- Demo (GitHub Pages) still uses the DEMO renderer: the Department template is private and not published.

## Next single executable action
Editor feedback loop: add "Đúng / Không liên quan" buttons in the review list that store a label per article (review file), and extend `scripts/eval-relevance.ts` to read these editor labels across runs – so precision/recall are tracked on real editorial decisions instead of Claude's sample labels.

## Session handoff log
| Session date | Changes made | Tests actually run | Next action |
|---|---|---|---|
| 2026-11-15 (1) | M0–M2, UI, API, demo Pages, live run | tsc, vitest 33/33, build, live | UI tests, template |
| 2026-11-15 (2) | Original template renderer, LibreOffice PDF + visual QA, Playwright UI tests, server crash fix | tsc, vitest 38/38, playwright 6/6, live run + template export | Multi-source stories |
| 2026-11-15 (3) | Multi-source stories, PowerPoint verification + PDF backend, list-fit fix | tsc, vitest 42/42, playwright 6/6, PowerPoint render QA | DIS-08 degraded adapter |
| 2026-11-15 (4) | DIS-08 adapter health + UI, clustering rewrite (union-find, IDF, mutual-best) | tsc, vitest 47/47, playwright 7/7, live run, cluster eval | SGGP adapter |
| 2026-11-15 (5) | Live GitHub Pages (hourly cloud collection), SGGP video articles | tsc, vitest 52/52, playwright 7/7, cloud run, live run | Relevance precision |
| 2026-11-15 (6) | Relevance precision rules + labelled evaluation + UI settings | tsc, vitest 68/68, playwright 7/7, eval 15/11 + cross-check 16/11 | Editor feedback labels |
