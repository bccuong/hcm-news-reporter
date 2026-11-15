# PROGRESS — HCM News Reporter (Claude Code)

## Current status
- Specification: v1.2
- Milestones: **M0 DONE · M1 DONE · M2 DONE · M5 DONE locally (original template + LibreOffice PDF, visually inspected)** · M3/M4 in progress · M6 partial
- Repository: https://github.com/bccuong/hcm-news-reporter (branch `main`) · Demo: https://bccuong.github.io/hcm-news-reporter/
- Last session: 2026-11-15 (session 2)

## Assets
See `docs/ASSET_INVENTORY.md`. Template integration: `docs/TEMPLATE_INTEGRATION.md`. Tools on this PC: Node 26, Git, gh, **LibreOffice** (installed session 2), Microsoft Edge (used by Playwright locally). Python not installed (not needed).

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
DIS-08 adapter-degraded detection: per source, compare this run's extraction success rate / container selector with the last 3 runs and mark the source "degraded" in the coverage tab (`src/collector/run.ts` + `web/src/App.tsx` Coverage). Also consider transitive same-event clusters (one event split into 2 clusters in the 15/11 run).

## Session handoff log
| Session date | Changes made | Tests actually run | Next action |
|---|---|---|---|
| 2026-11-15 (1) | M0–M2, UI, API, demo Pages, live run | tsc, vitest 33/33, build, live | UI tests, template |
| 2026-11-15 (2) | Original template renderer, LibreOffice PDF + visual QA, Playwright UI tests, server crash fix | tsc, vitest 38/38, playwright 6/6, live run + template export | Multi-source stories |
| 2026-11-15 (3) | Multi-source stories, PowerPoint verification + PDF backend, list-fit fix | tsc, vitest 42/42, playwright 6/6, PowerPoint render QA | DIS-08 degraded adapter |
