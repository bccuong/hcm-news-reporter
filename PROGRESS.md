# PROGRESS — HCM News Reporter (Claude Code)

## Current status
- Specification: v1.2
- Milestones: **M0 DONE · M1 DONE · M2 DONE · M5 DONE (original template; PDF via Microsoft PowerPoint or LibreOffice, visually inspected)** · M3/M4 mostly done · M6 partial
- Repository: https://github.com/bccuong/hcm-news-reporter (branch `main`, public) · Live site: https://bccuong.github.io/hcm-news-reporter/ (real data, hourly auto collection switchable on the web + on-demand "Thu thập")
- Last session: 2026-11-15 (session 8) – last commit `6293e33` (shared team review), all tests green locally
- The user (GitHub `bccuong`) has authorised commits/pushes to this repo and GitHub Pages/Actions for this project.

## ▶ RESUME HERE (session 11 – auto-collect on/off switch, server status visible)
- User saw "Đang có một lượt thu thập chạy" with no visible progress (a push-triggered deploy run + a real test dispatch were running) and asked for a switch for the hourly auto collection.
- Done: hourly auto moved from GitHub `schedule:` (it had NEVER fired on this repo) to the worker's Cloudflare cron `7 * * * *` → `scheduledCollect` dispatches `pages.yml` with `trigger=auto` unless KV `cfg:auto` is off or the server is busy. Web: checkbox "Tự động thu thập mỗi giờ" (login required to change), public `GET /status` strip shows the running run (tự động / theo yêu cầu (tên) / cập nhật phần mềm) and disables Thu thập with the reason. Worker deployed (cron registered). Tests: vitest 82/82, live E2E 3/3.
- Verified for real before this change: GITHUB_TOKEN set; on-demand 17:00→19:00 15/11 from the real site succeeded (run 20:21→20:25), custom period published.
- Next: after the next :07, check `gh run list --workflow pages.yml` shows "Thu thập tự động hằng giờ" and `/status` lastAuto=dispatched.

## (history) Session 10 – web "Thu thập" with from/to
- Web uses the same window controls as local; "Thu thập" → worker `POST /collect` → dispatches `pages.yml` (from/to/requested_by) → `cloud-collect.ts --from --to` publishes a "custom" period → page polls `/collect/status` and opens it. Max 72 h, one at a time, login required. GITHUB_TOKEN = fine-grained PAT (this repo, Actions R/W) stored as worker secret.

## (history) Session 9 – shared review is LIVE
- Review worker deployed: https://hcm-news-review.bccuong.workers.dev (health 200; real access code accepted, wrong code 401; export token OK). GitHub variable `REVIEW_API_URL` + secret `EXPORT_TOKEN` set.
- Real-site check (2026-11-15 ~19:50): login with the real code on https://bccuong.github.io/hcm-news-reporter/, vote on a real article shown immediately, no console errors; test votes removed (store = 0 labels).
- Fixes found by the real check: secrets set via a shell pipe had a trailing newline (worker now trims); KV list() is eventually consistent (UI shows own vote immediately, refreshes team votes every 2 min).
- `labels.yml` ran manually: success, `labels/labels.json` created (0 labels).
- The access code is NOT in the repo; it was saved for the user in the local file `review-secrets.txt` (session scratchpad, user opens it themselves – printing it from a tool was blocked). If lost, set a new one. Rotate: `cd cloud/review-worker; npx wrangler@3.112.0 secret put ACCESS_CODE` (pipe the value from Node or type it; worker trims whitespace).

**Next single action:** after reviewers have labelled a few days, `git pull` then `npx tsx scripts/eval-shared-labels.ts` → tune rules/keywords from MISSED / FALSE READY / sector & assessment fixes / notes, add regression cases to `tests/relevance.test.ts`, push.

## (history) Session 8 stopped on a user action
Goal of the user: ONE web version on GitHub; experienced reviewers open a link, log in (name + shared access code), label collected articles; labels are gathered centrally so Claude can make the collector more accurate.

Done and pushed: Cloudflare Worker code `cloud/review-worker/` (KV namespace created, id in `wrangler.toml`; secrets `ACCESS_CODE` + `EXPORT_TOKEN` already uploaded to the Worker), web login/votes UI, nightly `labels.yml`, analysis script. Read `cloud/README.md`.

**Blocked on:** Cloudflare account (chicuong.tanbinh's account, id `5c0a44e10fb8be13f57f5fd0ea4a62c5`) has no `workers.dev` subdomain. The user must register it once at https://dash.cloudflare.com/5c0a44e10fb8be13f57f5fd0ea4a62c5/workers/onboarding (suggested name `bccuong`). Claude must NOT read the wrangler OAuth token to do it via API (that was denied).

Then, in order:
1. `cd cloud/review-worker; npx --yes wrangler@3.112.0 deploy` → note the URL `https://hcm-news-review.<subdomain>.workers.dev`; check `GET <url>/health`.
2. Secrets: the generated values were saved OUTSIDE the repo in the session scratchpad file `review-secrets.txt` (may be gone after reboot). If missing, generate new ones and re-run `npx wrangler secret put ACCESS_CODE` / `EXPORT_TOKEN` (pipe the value; never commit or print it in logs/commits).
3. GitHub: `gh variable set REVIEW_API_URL --body "<worker url>" -R bccuong/hcm-news-reporter` and `gh secret set EXPORT_TOKEN -R bccuong/hcm-news-reporter` (same value as the Worker secret).
4. `gh workflow run pages.yml -R bccuong/hcm-news-reporter` → wait for success → open the site, check "Đăng nhập duyệt tin" appears; log in with the real ACCESS_CODE, label one article, verify `GET <url>/labels?date=…` (header `x-review-code`) returns the vote; then remove that test vote (POST same article with label null).
5. `gh workflow run labels.yml` → check `labels/labels.json` is committed with pseudonymised reviewers.
6. Give the user: link + access code (privately) + the short reviewer guide from `cloud/README.md`.
7. After reviewers have labelled some days: `npx tsx scripts/eval-shared-labels.ts` → tune rules/keywords (`src/domain/defaults.ts`, `relevance.ts`) with regression tests, push.

Optional offered to the user (not decided): official PPTX export on the web by storing the private template in the Worker behind the access code.

## Assets
See `docs/ASSET_INVENTORY.md`. Template integration: `docs/TEMPLATE_INTEGRATION.md`. Tools on this PC: Node 26, Git, gh (logged in as bccuong; `gh auth setup-git` done), **LibreOffice**, **Microsoft PowerPoint** (Office16, used for PDF), Microsoft Edge (Playwright locally), Cloudflare wrangler via `npx wrangler@3.112.0` (logged in). Python not installed (not needed). PowerShell 5.1: write commit messages to a file and use `git commit -F` (inline quotes break).

## Session 8 – done (with evidence)
- Shared team review: `cloud/review-worker` (Cloudflare Worker + KV, shared access code, CORS to Pages only, one vote per reviewer per article, `/export` bearer token); Pages app reviewer login, vote counts per card, review note, team-majority quality card; `.github/workflows/labels.yml` nightly pull → `labels/labels.json` (HMAC pseudonyms); `scripts/pull-labels.ts`, `scripts/eval-shared-labels.ts`; live-mode E2E with a local stand-in worker (`playwright.live.config.ts`, two reviewers).
- Playwright: 10 s expect timeout, trace on failure, 1 retry on CI (one load-related flake of the DIS-08 UI test observed, then 2 clean runs).
- Commands: tsc 0 · vitest **76/76** · playwright **8/8** · live review E2E **1/1**.

## Session 7 – done (with evidence)
- **Editor feedback loop for the filter** (`src/domain/quality.ts`): per-article `relevanceLabel` (✓ Liên quan / ✗ Không on ready & review cards; "Thực ra liên quan?" on excluded ledger rows); articles put into a report count as relevant implicitly. `GET /api/quality/relevance` + "Chất lượng bộ lọc" card on the coverage tab: precision of the Ready tab, recall incl. stories rescued from "excluded", list of wrongly excluded stories with the rule that excluded them, false-ready list. `scripts/eval-editor-labels.ts` aggregates labels across stored runs.
- Note: the 15 labels currently in local data come from Claude's QA selections (included=true), not editor decisions. On the public site labels stay in the viewer's browser only.
- Commands: tsc 0 · vitest **71/71** · playwright **8/8**.

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
After the editor has labelled 1–2 weeks of runs in the local app: `npx tsx scripts/eval-editor-labels.ts`, review the MISSED list (rule that wrongly excluded each story) and adjust keywords/rules in Settings; optionally add a "Tải nhãn đánh giá" export on the public site so labels made there can be merged.

## Session handoff log
| Session date | Changes made | Tests actually run | Next action |
|---|---|---|---|
| 2026-11-15 (1) | M0–M2, UI, API, demo Pages, live run | tsc, vitest 33/33, build, live | UI tests, template |
| 2026-11-15 (2) | Original template renderer, LibreOffice PDF + visual QA, Playwright UI tests, server crash fix | tsc, vitest 38/38, playwright 6/6, live run + template export | Multi-source stories |
| 2026-11-15 (3) | Multi-source stories, PowerPoint verification + PDF backend, list-fit fix | tsc, vitest 42/42, playwright 6/6, PowerPoint render QA | DIS-08 degraded adapter |
| 2026-11-15 (4) | DIS-08 adapter health + UI, clustering rewrite (union-find, IDF, mutual-best) | tsc, vitest 47/47, playwright 7/7, live run, cluster eval | SGGP adapter |
| 2026-11-15 (5) | Live GitHub Pages (hourly cloud collection), SGGP video articles | tsc, vitest 52/52, playwright 7/7, cloud run, live run | Relevance precision |
| 2026-11-15 (6) | Relevance precision rules + labelled evaluation + UI settings | tsc, vitest 68/68, playwright 7/7, eval 15/11 + cross-check 16/11 | Editor feedback labels |
| 2026-11-15 (7) | Editor relevance labels, filter-quality card + endpoint + script | tsc, vitest 71/71, playwright 8/8 | Use labels to tune rules |
