# HCM News Reporter — Claude Code project rules

## Goal
Implement a **working Windows local-first SPA**, not another plan or mockup. Keep all v1.1 business requirements; the v1.2 execution flow only adapts them for Claude Code.

## Read in this order
1. `PROGRESS.md` (where the previous session stopped).
2. `MILESTONES.md` (current gate; work on one at a time).
3. `HCM_News_Reporter_Implementation_Plan.md` (master specification, relevant sections).
4. `UI_CONFIG_SPEC.md`, `COLLECTION_COVERAGE_SPEC.md`, `ACCEPTANCE_TEST_CASES.md` (mandatory contracts).
5. `reference/` user-provided Skill ZIP / `websites.txt` / approved PPTX, when present.

Do not duplicate the whole specification in every answer. Seek only the files needed for the current milestone.

## Hard product invariants
- **NO manual JSON/XML editing for end users.** Every source, section, keyword, AND/OR/NOT rule, geography filter, date window, crawl limit, image rule, template and export option requires a functioning UI control, API binding and persistence.
- **NO silent omissions.** Discovery across accessible RSS, sitemap, category, pagination; store candidate ledger states and discovery route. Detect incomplete extracts, missing tables/captions/pagination, uncertain dates. Surface gaps and retry in UI. Never promise 100% undiscoverable news coverage.
- **NO fabricated news.** Preserve URLs, original facts, quantities, dates, provenance. Editorial summaries are user-reviewable. Use real appropriately sourced photographs only; never AI news photos.
- **NO pretend template fidelity.** Reuse the supplied PPTX when available; render and visually QA PPTX and converted PDF. Demo assets are clearly labeled when real templates are absent.
- **NO online dependency for normal app operation.** Node/Fastify bound to 127.0.0.1, React/TS frontend, local files not database, no paid AI API. Fresh external collection still needs Internet.
- Enforce URL/redirect SSRF protections, local API origin/CSRF defenses, safe file paths, bounded requests, publisher access rules and reasonable permissions.

## Implementation working style
- Start with an evidence-backed thin vertical slice: UI configuration -> discovery -> candidate ledger -> full article extraction -> human review -> template PPTX -> PDF.
- Use **TypeScript strict**. Separate collector, domain/filter/review, renderer and storage. Prefer RSS/static HTML over browser crawling, Playwright only if needed.
- Keep changes small and testable; run the relevant package scripts (`typecheck`, `test`, `build`) after implementing them. Don't claim tests passed unless actually executed.
- Do not ask for the same missing asset again if it is already in `reference/`. If not available, document exactly what is missing and continue on replaceable test fixtures.
- Do **not** `git push` or publish data; don't run broad destructive commands or bypass permission controls. Git commit at a verified milestone if repository is initialized.
- Minimize repeated large file reads and expensive parallel agents; Claude Pro has usage limits. Prefer one focused milestone per session.

## Every session handoff
Update `PROGRESS.md`: current milestone, implemented code paths, commands/results, unresolved defects, asset blockers, and **one concrete next step**. Update `ACCEPTANCE_REPORT.md` (PASS/FAIL/BLOCKED with evidence). Never mark a milestone DONE based only on drafted files, mock UI or unverified examples.

## Completion test
A nontechnical Windows user can configure all sources and filters **through the UI**, inspect source coverage/partial failures, review genuine articles and photos, and export verified editable PPTX + matching PDF without using Claude after installation.
