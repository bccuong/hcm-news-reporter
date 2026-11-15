# Claude Code Milestones — HCM News Reporter v1.2

**Execution rule:** Work on only the next unfinished gate unless a dependency genuinely blocks it. For each gate, implement, run, verify, record evidence in `PROGRESS.md` and `ACCEPTANCE_REPORT.md`, then move on. No milestone is automatically "done" because a code generator emitted files.

## M0 — Asset audit & technical spike
**Implement:** Inventory actual source Skill ZIP, `websites.txt`, approved PPTX and optional Word from `reference/`; inspect source adapters, template slide dimensions/layout. Probe **one accessible** article and **one template-driven slide** with measured results. If assets missing, create explicit adapter interface and temporary labeled fixture/template without falsely claiming fidelity.
**Gate:** `docs/ASSET_INVENTORY.md` with supplied/missing assets, source feasibility table and a prototype execution command. If tools/network unavailable, mark BLOCKED and proceed with deterministic fixture path.

## M1 — TypeScript local app & UI settings persistence
**Implement:** React/Vite SPA, Fastify loopback-only, strict shared TypeScript/Zod schemas, file-backed atomic stores. Create real Sources wizard and functional controls for keyword, Boolean AND/OR/NOT, geographic aliases, date window, crawl limits, template selection and image/export settings. Save via API; load after restart. No JSON editing by user.
**Gate:** Start from documented command; UI settings persistence/restart tests; at least UI-01, UI-03, UI-04, UI-05, UI-06, UI-07 implemented and demonstrated, with UI-02/08/09 progress recorded. Build/typecheck must be reproducible.

## M2 — End-to-end vertical slice, two source fixtures and one real source where allowed
**Implement:** Multi-path RSS/sitemap/category listing discovery, canonicalize links, durable URL candidate ledger, bounded fetch, timing evidence `[from,to)` in Asia/Ho_Chi_Minh, complete paragraph/subheading/table/caption extraction with detected gaps, relevance filtering, review UI and basic report adapter. Use recorded fixtures with known expected links/sections; exercise live source only where accessible/allowed.
**Gate:** Candidate accounting reconciliation tests, extraction completeness fixtures, visible failure/retry states and end-to-end artifact evidence; DIS-01 to DIS-05, EXT-01/02/04/05 and LED-01/02 started. If PPTX template missing, report step is placeholder and NOT a fidelity pass.

## M3 — Source coverage & UI audit
**Implement:** Multiple permitted discovery routes, pagination, per-source health and run diagnostics, candidate ledger statuses, retry/rescan, partial extraction, click-through Article Inspector, source change warning, independent extractor comparisons, search/filter previews, filters/exclusions traceability.
**Gate:** Run `COLLECTION_COVERAGE_SPEC.md` fixture suite; UI shows candidate reconciliation and all partial/blocked/unverified items; no misleading website-completeness percentage. Verify UI-02/09 and DIS/EXT/LED scenarios.

## M4 — Editorial workflow and original photos
**Implement:** Original-source citation, article image candidates + metadata/attribution, rights status, editable summaries, title/figure/date inconsistency warnings, include/exclude, group sources by event, reorder, offline review persistence.
**Gate:** Reviewed sample can be reopened offline, no fake image, no fabricated fact; reviewer changes stored separate from source evidence; acceptance evidence recorded.

## M5 — Official-template PPTX/PDF & visual QA
**Implement:** Shape-mapped approved template (when present), dynamic slide layouts, Vietnamese typography, factual image + source/caption, overlong text strategy, PPTX editable content, headless PDF conversion or clearly documented verified fallback. Render slides for visual inspections and verify slide count, clipping, overlap and parity.
**Gate:** Actual PPTX and PDF plus rendered previews from approved template when supplied; RPT-01 to RPT-03 pass; otherwise BLOCKED clearly (not "pass" with a demo template).

## M6 — Release readiness / Windows launcher
**Implement:** Complete UI tests for all config options, regression fixtures for each supported publisher adapter, error recovery, offline review/export, security URL tests, `.gitignore`, deterministic installation/run scripts, user documentation and Windows smoke test if Windows environment accessible.
**Gate:** CI-equivalent `typecheck`, tests and build run successfully; test matrix PASS/FAIL/BLOCKED completed; correct limitations disclosed; deliver source ZIP and actual sample outputs. If no Windows environment, label Windows runtime test NOT VERIFIED.

### Session-scale recommendation for Claude Pro
Split an M gate into 30–90 minute tasks when needed; no requirement to finish a whole gate in one Claude session. Before stopping, update `PROGRESS.md` with a precise next executable task and exact command. Use `CLAUDE_RESUME_PROMPT.txt` on the next session. Multi-agent parallelism is optional, not required; avoid it by default to conserve usage.

### Acceptance priority
P0 = `UI_CONFIG_SPEC.md`, `COLLECTION_COVERAGE_SPEC.md`, and every relevant entry of `ACCEPTANCE_TEST_CASES.md`; they override any convenient shortcut or attractive mockup. Total-site recall cannot be guaranteed on inaccessible or undiscoverable publisher pages; the **goal is auditable discovery and zero silent omissions among observed candidates**.
