# PROGRESS — HCM News Reporter (Claude Code)

## Current status
- Specification: v1.2
- Current milestone: **M3 (coverage UI) / M4 (editorial) in progress; M5 template integration BLOCKED on adapter work**
- Last verified milestone: **M0 DONE, M1 DONE (backend-tested; UI not browser-automated yet), M2 DONE on fixtures + live**
- Repository: https://github.com/bccuong/hcm-news-reporter (branch `main`)
- Last session: 2026-11-15

## Assets discovered
| Asset | Status | Actual path / notes |
|---|---|---|
| Skill (SKILL.md, scripts, references) | FOUND | `reference/hcm-news-reporter-skill/` (git-ignored) |
| `websites.txt` | FOUND | seeded from `src/domain/data/skill-websites.txt` |
| Approved official PPTX template | FOUND | `reference/hcm-news-reporter-skill/assets/reference-report.pptx` – not yet wired into renderer |
| Word digest | NOT SUPPLIED | later |
See `docs/ASSET_INVENTORY.md`.

## Completed work (evidence)
- Domain: Zod schemas, VN time windows `[from,to)`, URL normalization + SSRF checks, Boolean rule engine w/ synonyms + explanations, location detection from Skill place list, category/assessment suggestions (`src/domain/*`).
- Collector: SSRF-guarded HTTP client (per-host limits, retry/backoff, Retry-After, manual redirects), RSS/Atom, sitemap(+index), section+pagination BFS with limits, durable candidate ledger with 15 states + reason codes, full-content extraction (paragraph order, headings, lists, tables, figures+credit, JSON-LD cross-check, continuation), URL date hint triage, same-event clustering, cancel/resume (`src/collector/*`).
- Storage: atomic JSON writes, JSONL articles, settings/sources history + rollback, backup/restore (`src/storage/*`).
- API: Fastify on 127.0.0.1, Host/Origin guard, per-session token for mutations, all settings/sources/rules/runs/review/export endpoints (`src/server/app.ts`).
- UI: dashboard (window presets, live source strip, metrics, ready list, review queue, ledger w/ CSV, coverage w/ retry/rescan/expand, Article Inspector with evidence + editorial overlay, export panel) and Settings drawer with 9 sections incl. source wizard, websites.txt import, visual AND/OR/NOT builder + preview, location editor, categories, time, quality/photos, report/template upload, performance, backup/history (`web/src/*`).
- Report: demo PPTX (A4 portrait, cover/TT/TC/TL/Kiến nghị, hyperlinks, real images only, DEMO label) + fit warnings + export manifest.
- GitHub Pages static demo on synthetic fixture data; CI runs typecheck + tests.

## Commands executed and results (2026-11-15)
- `npx tsc -p tsconfig.json --noEmit` → 0 errors
- `npx vitest run` → **33 passed / 33** (domain 22, collector 8, server 3)
- `npx vite build` → OK (316 kB JS)
- `npm run spike` → 5 live sources OK (see docs/ASSET_INVENTORY.md)
- Live full run via `scripts/live-run.ps1` → 1227 candidates, reconciliation balanced, 41 ready_for_review (docs/SOURCE_SUPPORT.md)

## Acceptance gates (live state)
| Gate | Status | Evidence |
|---|---|---|
| M0 | DONE | docs/ASSET_INVENTORY.md, `npm run spike` |
| M1 | DONE (API-level) | tests/server.test.ts persistence/restart/rollback; UI build; Playwright UI tests NOT yet written |
| M2 | DONE | tests/collector.test.ts + live run |
| M3 | IN PROGRESS | coverage tab, retry/rescan/expand wired; adapter-degraded detection (DIS-08) missing |
| M4 | IN PROGRESS | review overlay, image choice, number-consistency warning; manual merge/split of event groups missing |
| M5 | BLOCKED | demo renderer only; original template not mapped; LibreOffice not installed |
| M6 | NOT STARTED | |

## Known blockers / risks
- Original PPTX template fidelity requires a shape-mapping adapter (pptx-automizer, or install Python and reuse Skill `build_report.py`).
- No LibreOffice → no PDF, no rendered visual QA.
- VnExpress needs higher fetch budget or RSS-first triage to avoid `retry_pending`.
- UI not verified with automated browser tests (UI-01..09 click-through).

## Next single executable action
Add Playwright UI tests for UI-01/03/04/05/06 (`npm i -D @playwright/test` then `tests/ui/*.spec.ts` against `npm start`), then start the template adapter spike: `npx tsx scripts/template-audit.ts reference/hcm-news-reporter-skill/assets/reference-report.pptx`.

## Session handoff log
| Session date | Changes made | Tests actually run | Next action |
|---|---|---|---|
| 2026-11-15 | M0–M2 implemented, UI + API + demo Pages, live run | tsc, vitest 33/33, vite build, live spike + full run | Playwright UI tests; template adapter |
