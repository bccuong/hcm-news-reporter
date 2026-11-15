# HCM News Reporter - Local-First Implementation Plan

**Version:** 1.2 (Claude Code execution pack; preserves v1.1 UI-first and coverage-audited requirements)  
**Date:** 2026-11-09  
**Audience:** Claude Code running in a local repository (terminal, VS Code, or Claude Desktop Code workspace)  
**Priority:** Build and demonstrate a working MVP, not another planning document. **P0: every setting is editable from the application UI; P0: never silently omit a discovered article or a material article section.**

## CLAUDE CODE EXECUTION PROTOCOL (v1.2 OVERRIDE)

This project is implemented **in Claude Code**, not by merely pasting the specification into a regular chatbot. Put the extracted starter files **in the repository root** before starting Claude Code. `CLAUDE.md` is the short persistent instruction file; refer to `MILESTONES.md`, `PROGRESS.md`, `UI_CONFIG_SPEC.md`, `COLLECTION_COVERAGE_SPEC.md` and `ACCEPTANCE_TEST_CASES.md` as needed rather than copying all text into chat each session.

1. **Entry point:** Read `CLAUDE.md` and `PROGRESS.md`, inventory repository and reference assets, then follow `CLAUDE_START_PROMPT.txt` or `CLAUDE_RESUME_PROMPT.txt`. Start implementing code promptly; do not produce an unending plan.
2. **One testable milestone at a time:** Use `MILESTONES.md` to work in small vertical slices. A milestone is DONE only after runnable code, relevant tests, actual commands and results, and its acceptance criteria are recorded. Favor one connected source-to-report path before building decorative UI screens.
3. **Continuity under Claude Pro limits:** Before ending any session or context compaction, update `PROGRESS.md` with exact completed tasks, failing tests, next single action and blockers. Keep this file concise and factual. Never claim Claude continues working while its session is stopped.
4. **Commands:** Identify project scripts before running them. After scaffolding, create `package.json` scripts such as `dev`, `typecheck`, `lint`, `test`, `build`; validate them by actually running them. Do not invent successful build output. Prefer reproducible project scripts to one-off global commands.
5. **Repository hygiene:** Commit at completed milestones if Git is configured; do not `git push`, publish artifacts, install unusual global utilities, delete user files, or write outside the project without explicit user approval. Respect permission prompts; do not instruct users to bypass permissions for convenience.
6. **Asset integrity:** Inspect the actual Skill ZIP, `websites.txt`, approved PPTX and optional DOCX if provided. They are **not** included in this pack. Never claim the original template was reused if it is missing; create only a clearly labeled replaceable demo when necessary.
7. **Verification:** Prefer fixture-based deterministic automated tests for discovery, full article extraction, correct geography/timing, source ledger, UI-only settings and PPTX layout. When live Internet access is blocked, report fixture passes separately from live-source passes.
8. **Operations:** No database, no paid AI API, no deployment, no account requirement at runtime. Fresh news requires Internet; cached review/export must work offline. Never claim universal 100% website coverage; disclose unenumerated/blocked/partial routes.
9. **Handoff:** Provide real commands, file paths, working/failing tests, screenshots or rendered slides where available, and an updated `PROGRESS.md` and `ACCEPTANCE_REPORT.md`. Do not say 'finished' when P0 acceptance gates fail.

**Critical user mandate preserved from v1.1:** EVERY operator-facing config (websites, keywords, Boolean filters, location, sources, crawling limits, templates, export options) MUST be editable via a wired GUI. JSON/XML is an internal persistence format only. Collection must prioritize high recall and **never silently drop discovered candidates or material article content**.

---

## 0. IMPLEMENTATION ORDER - READ FIRST

You are the implementation engineer. Build the application described below in the current workspace. Do not stop after making mockups, architecture notes, or a list of tasks. Write real source code; run it; test it; fix evident bugs; and deliver a working repository and reproducible run instructions. Continue making sensible technical decisions without repeatedly seeking confirmation.

**Input assets the user may supply:**

1. The current `HCM News Reporter` Skill ZIP or extracted directory, especially `SKILL.md` and `websites.txt`.
2. The original PowerPoint design, e.g. `Bao cao diem tin nganh xay dung mau.pptx` (the user may provide the original Vietnamese filename).
3. A more recent example report that the user approved as visually correct.
4. Optional original Word news digest (`.docx`) for later import support.

First inventory the attached assets. Reuse the actual source list and visual template if present. Treat the existing Skill as business-rule reference, not executable production code. Do **not** assert that a template or source file was available if it was not. If assets are missing, continue with a replaceable demo template and clearly mark the necessary follow-up integration point.

**Expected delivery:** a usable single-page local web application with full in-app configuration and a transparent collection-coverage inspector plus source code, tests, a sample collection run where network availability permits, sample PPTX/PDF outputs where a rendering tool is available, and a README with one-command start instructions. If a live source refuses collection or a tool is unavailable, surface that limitation clearly and still complete everything else.

### Mandatory companion specifications (part of acceptance, not optional ideas)

- **`UI_CONFIG_SPEC.md`**: exhaustive no-code Settings UX, source setup wizard, keyword/Boolean/location editors, validation and test interactions.
- **`COLLECTION_COVERAGE_SPEC.md`**: high-recall discovery, full-content extraction, candidate ledger, coverage diagnostics and realistic accuracy guarantees.
- **`ACCEPTANCE_TEST_CASES.md`**: scenarios the implementation must pass, including UI-only configuration and missing-content detection.

If these documents conflict with a vague statement elsewhere, use the more precise P0 requirement in these companion specs. JSON/XML must NEVER be the normal operational interface. Claude Code must **implement**, not merely summarize, these specifications.

## 1. PRODUCT BRIEF

The product transforms the existing ChatGPT Skill workflow for daily Ho Chi Minh City construction-sector news reporting into a local-first application. A user opens the application on a Windows PC and can:

1. Automatically start a collection for the last completed reporting window (once per window) when Internet is available.
2. Select arbitrary `from` and `to` date/time values and manually collect within the selected window.
3. Manage **ALL** configurable news sites, sections, search/filter rules, geography, synonyms, categories, schedules, templates, quality thresholds, crawler and report options **visually in Settings**; a nontechnical operator must NEVER have to open or hand-edit JSON/XML.
4. Read newly discovered articles; inspect how every relevant link and article section was discovered/extracted; audit source/time, completeness and coverage; deduplicate and classify.
5. Review, include/exclude, reclassify, and edit summaries before final export.
6. Retrieve original editorial photographs, preserve provenance, and never generate artificial news photos.
7. Export editable `.pptx` and a corresponding `.pdf` using a defined PowerPoint template.
8. Reopen previously cached reports and export again even without an Internet connection.
9. Optionally, later import a `.docx` digest containing links and use that content as a controlled input to the same report pipeline.

This is **local-first**, not "offline Internet access": the UI, stored records, editing, and exporting must work offline; collection of new external news still requires Internet access. There is no hosting, cloud database, paid AI API, or account authentication requirement for the MVP.

### 1.1 Existing editorial workflow to preserve

- Organization/report: Press coverage of the construction sector for Ho Chi Minh City, prepared in the style of the city's Department of Construction (So Xay Dung TP.HCM).
- Default daily morning window: **17:00 previous day to 08:00 current day**, time zone **Asia/Ho_Chi_Minh**.
- Group by editorial assessment: **Needs attention / Positive developments / Neutral news**. Use Vietnamese labels in the UI/report: `Ton tai can khac phuc`, `Chuyen dong tich cuc`, `Tin trung lap`, with properly accented Vietnamese in the final localized app.
- Independently classify primary subject matter: transport infrastructure, construction/urban development, public investment, traffic management, land/housing/real estate, flooding/drainage, policy/regulation.
- Work from an editable source list migrated from existing `websites.txt`, not a permanently hardcoded set of ten sites. **The file format is an internal persistence detail, never the configuration UX.**
- Use **original news photos only**, with attribution/provenance; never AI-generated illustrative images.
- Preserve the official PPTX look, including A4 portrait dimensions if confirmed in the supplied PPTX, title hierarchy, color, page number placement, spacing, images, and footer.

Do not invent reported incidents, sources, publication times, captions, legal conclusions, or recommended actions. If a field is absent or uncertain, mark it for review.

## 2. ARCHITECTURE AND TECHNOLOGY

### 2.1 Preferred stack

| Area | Default choice | Notes |
| --- | --- | --- |
| Language | TypeScript (strict) | Shared types between frontend/backend. |
| Frontend | React + Vite | Single-page dashboard with panel/drawer/modal navigation. |
| UI system | Tailwind CSS + shadcn/ui + Lucide icons | Consistent, professional enterprise aesthetic. |
| Local API | Node.js LTS + Fastify | Bind **127.0.0.1 only**, never 0.0.0.0 by default. |
| Validation | Zod | Validate config, API requests, article and run records. |
| Fetch/RSS | Native fetch + RSS parser | Prefer feeds and public APIs where supported. |
| HTML extraction | Cheerio + Readability or equivalent | Process static HTML first. |
| Crawl orchestration | Crawlee or bounded custom scheduler | Per-host limits, backoff, retries, queue. |
| JS pages | Playwright fallback | Only if really necessary; avoid launching Chromium for all sites. |
| PPTX | pptx-automizer where viable, plus PptxGenJS | Preserve supplied template; support dynamic pages. |
| PDF | Render PPTX via LibreOffice headless | Detect renderer; clear fallback/error when unavailable. |
| Storage | Versioned JSON config + JSONL records + files | No SQL database for MVP. |
| Desktop distribution | Windows launcher first; Tauri optional later | Avoid packaging work delaying core functionality. |

Do not claim raw TypeScript is always faster than Go/Rust; crawling speed is predominantly constrained by external sites. Optimize network behavior, bounded concurrency, caching, and template generation first.

### 2.2 Mandatory module boundaries

```
UI (React SPA)
  -> Local REST/SSE API (Fastify, 127.0.0.1)
    -> Collection Engine (sources, parsers, throttling)
    -> Normalization + Date Verification
    -> Relevance + Classification + Deduplication
    -> Human Review Workflow
    -> Report Builder (PPTX -> PDF + QA)
    -> File Storage (config, runs, images, exports, logs)
```

Core business logic must not depend directly on React or the PPTX package. Use typed domain entities and adapters so future sources, report templates, and import formats can reuse the same code.

### 2.3 Suggested repository layout

```
hcm-news-reporter/
  apps/
    web/                      # React / Vite SPA
    local-api/                # Fastify, entrypoint, HTTP/SSE
  packages/
    domain/                   # Types, schemas, filters, classifications
    collector/                # RSS, HTML, site adapters, scheduler
    reports/                  # PPTX template bridge, PDF adapter, QA
    storage/                  # Atomic JSON/JSONL file operations
    imports/                  # DOCX importer, optional follow-on
  config/
    settings.example.json
    sources.example.json
    categories.example.json
  templates/
    README.md
    template-map.example.json
    *.pptx                    # Only templates user has supplied/licenses
  data/                       # Runtime, ignored in Git
    runs/
    articles/
    reviews/
  cache/                      # Runtime, ignored in Git
    images/
    http/
  exports/                    # Runtime, ignored in Git
  tests/
    fixtures/
    integration/
    visual/
  docs/
    ARCHITECTURE.md
    SOURCE_SUPPORT.md
    TEMPLATE_INTEGRATION.md
  scripts/
    start-local.cmd
    install-local.cmd
  package.json
  pnpm-workspace.yaml         # If using pnpm monorepo
  README.md
  .gitignore
```

You can simplify the repository if it improves implementation speed, but preserve the four independent concerns: collection, domain/review, report generation, storage.

## 3. USER EXPERIENCE: SINGLE-PAGE DASHBOARD

### 3.1 Visual language

- Professional, calm government/enterprise dashboard; light UI by default.
- Accent colors: navy blue + restrained teal, neutral gray surfaces, unobtrusive status colors.
- Responsive 1440px desktop first; usable down to 1024px, mobile read-only convenience if practical.
- Font: Be Vietnam Pro or locally bundled/open licensed equivalent; no runtime Google Fonts requirement.
- Accessible labels, keyboard navigation, visible focus, good contrast, loading/success/error states.
- Support complete Vietnamese copy in the working product, even if implementation documentation is in English.

### 3.2 Page anatomy

1. **Header**: application name, connection indicator, most recent successful collection, Settings drawer.
2. **Reporting window**: from/to date-time pickers, quick presets (`Latest completed`, `Today`, `Yesterday`, `Custom`), timezone label, Collect button.
3. **Source progress strip**: status for each site; live counts; retry failed sites; cancel run.
4. **Metric cards**: discovered / valid / duplicate / selected / failed.
5. **Article workspace**: searchable/filterable rows/cards; category chips; source, time, photo thumbnail, summary, link.
6. **Review panel**: select/exclude, edit title and summary, change categories and assessment, confidence and provenance view.
7. **Report preview**: slide/page preview and overflow warnings.
8. **Export bar**: `.pptx`, `.pdf`, both; display selected template and destination.

Use a full-height drawer for Settings, not a second route. **Everything** configurable must be surfaced as usable form controls, builders, selectors and test/preview actions. See `UI_CONFIG_SPEC.md` for the binding specification. JSON files are internal and must not be required for any everyday or advanced operation.

### 3.3 Core interaction behavior

- On startup: load local state immediately. If the selected default reporting window is already completed, not previously collected, Internet is present, and auto-collect is enabled, begin a run; never create duplicate runs simply by refreshing the UI.
- Show the latest cached articles immediately before network completion.
- Show per-source failures; an unavailable source must not cancel other sources.
- Review changes autosave atomically or via an explicit Save state with clear confirmation.
- Any edited or excluded article persists on restart.
- No article is automatically inserted into final output unless accepted under the configured review policy; use `manual_review_required` as MVP default. Show uncertain/missing content in an explicit review queue, not as omitted or approved.
- Export must be disabled or explain its blockers if there are zero selected items or a required template is missing.

## 4. LOCAL STORAGE AND DATA CONTRACTS

### 4.1 Storage rules

Use JSON for **internal persistence only**; the sole day-to-day configuration interface is the UI. Use JSONL separated by date/run for larger article caches, with run manifests and reviews stored separately. Never rewrite a single giant JSON file for every changed article.

- `config/settings.json`: versioned settings, validated with Zod.
- `config/sources.json`: source definitions, no guessed feed links.
- `data/runs/<runId>/manifest.json`: start/end/status/source counts/errors.
- `data/runs/<runId>/articles.jsonl`: normalized collected articles.
- `data/reviews/<runId>.json`: selected article IDs, edits, category overrides, user decisions.
- `cache/images/<sha256>.<ext>`: validated real image files.
- `exports/YYYY-MM-DD/*`: generated reports.

All writes affecting a JSON state document should use temporary-file + fsync/rename where supported. Do not allow concurrent collectors to mutate the same run data without serialization. Validate and migrate settings by `schemaVersion`; preserve original copies during migrations. Provide export/import config and a basic backup option.

### 4.2 Typed article contract (illustrative)

```ts
type EditorialAssessment = 'needs_attention' | 'positive' | 'neutral';
type NewsCategory =
  | 'INFRA' | 'BUILD' | 'INVEST' | 'TRAFFIC'
  | 'LAND' | 'FLOOD' | 'POLICY';

type DateConfidence = 'verified' | 'inferred' | 'unknown';

type Article = {
  id: string;
  sourceId: string;
  sourceName: string;
  originalUrl: string;
  canonicalUrl: string | null;
  title: string;
  bodyText: string;
  extractedSummary: string | null;
  publishedAt: string | null;   // ISO 8601, with offset
  modifiedAt: string | null;
  collectedAt: string;          // ISO 8601
  dateConfidence: DateConfidence;
  primaryCategory: NewsCategory | null;
  secondaryCategories: NewsCategory[];
  editorialAssessment: EditorialAssessment | null;
  relevanceScore: number | null;
  classificationEvidence: string[];
  imageCandidates: Array<{
    url: string;
    caption?: string;
    credit?: string;
    sourceArticleUrl: string;
    localCachePath?: string;
    rightsStatus: 'verified' | 'review' | 'not_usable';
  }>;
  duplicateGroupId: string | null;
  warnings: string[];
};
```

Store imported Word news in the same common `Article`/`ReportItem` pipeline with a distinct origin type (`website` or `docx`) and provenance fields. Keep raw source text separate from edited report text.

**Mandatory coverage/provenance extensions** (build typed Zod schemas): `discoveryMethods[]`, `listingUrl`, `sourceFetchId`, `extractionAdapterVersion`, `extractionCompleteness`, `contentSections[]` with section type/ordinal/source evidence, `articleLinks[]`, `dateEvidence[]`, `rejectionReason`, `manualOverride`, `coverageStatus`, `fetchErrors[]`. Candidate URLs must have a ledger record **even if parsing, relevance or date verification fails**. Never silently discard a candidate before creating a status/reason record.

## 5. COLLECTION ENGINE

### 5.1 Source adapters

Each enabled source should have an explicit adapter configuration, for example `rss`, `html_listing`, `sitemap`, `api`, or `playwright`, with `auto` as an ordered strategy. Support per-source selectors/config only when necessary. Use site-specific adapters for incompatible sites rather than brittle universal selectors.

Processing steps:

1. Discover candidate URLs from an RSS feed, public API, category pages or sitemap.
2. Bound exploration according to reporting window (with a configured safety/lookback margin).
3. Fetch page HTML and extract canonical URL, title, original publication time, body and image candidates.
4. Normalize URLs and Unicode; remove navigation, advertisements and unrelated paragraphs.
5. Validate published date and geographic/topic relevance.
6. Deduplicate exact URL first, then flag likely same-event items for review.
7. Store every result/error with traceable origin.

### 5.1A Coverage-first discovery (MANDATORY, P0)

Aim for **maximum recall within technically accessible configured sources**, not a false promise of absolute 100% recall on the public web. Sources can hide content, alter HTML, restrict access, or publish items that no public index exposes. The system must therefore measure and reveal **known coverage gaps and uncertain cases**.

- For **each configured website**, enumerate from all applicable user-enabled discovery routes: RSS/Atom; sitemap + sitemap indexes; supported category/list pages; pagination/infinite scroll; site-provided search/API when accessible. Cross-check discoveries, record which route found each URL, and consolidate canonical URLs. A site with a working RSS does not automatically mean RSS alone is complete.
- Support **multi-level traversal** with per-source maximum depth, page limits, date lookback padding, pagination next-link rules, and a visible indicator if bounds truncate collection. Configurable entirely in UI. Use rate limits, robots and publisher policies; do not bypass blocks.
- Pagination must not stop merely because one old article appears. Only use date-based early termination when a listing is verified to be monotonically ordered; otherwise continue until a declared bound, recording whether enumeration is partial.
- Maintain a persistent **Candidate URL Ledger** recording discovered/fetched/parsed/relevant/filtered/failed/retry-pending status; source, discovery method, timestamp, fetch HTTP status, and explicit rejection reason. Failed sources and uncertain items must remain visible.
- Build a **source health and coverage dashboard**: listing pages inspected, unique candidate URLs, fetched, parsed, out-of-window, irrelevant, duplicates, error/unverified, and run completeness status (complete within enumerated scope / incomplete / unknown). Do not present a fabricated global percentage of all news published.
- Support one-click **Retry failed**, **Rescan this source**, **Expand scan/lookback**, and **Inspect why excluded** with before/after delta of newly discovered items.
- Fixture-based recall tests for every supported domain (site listing and article variants). Report exactly what was tested, with audit-ready counts.

### 5.1B Article-level full-content extraction (MANDATORY, P0)

For each candidate article, extract and preserve the **material information**, not just headline, description tag, or first paragraphs. Capture: canonical URL, original and updated publication timestamps with evidence, headline, subtitle/sapo, body text and paragraph order, heading structure, key numbers/names/dates, tables and table captions, fact boxes, bullet lists, figures, photo captions and photo credits, hyperlinks to original sources, and note whether it continues onto multiple pages. Also detect corrected/updated article indications where visible.

- Prefer explicit structured metadata + site-specific extraction adapters + robust generic fallback. Compare extracted content with structured article body/visible content and flag suspiciously short extractions, missing tables, missing sections, large unparsed blocks or pagination gaps.
- Separate factual **source extraction** from a short **editorial summary**. Any summary must preserve significant quantified details and avoid inventing new facts. A misleading summary is a correctness failure even when extraction succeeded.
- Provide an **Article Inspector** with side-by-side original page link and structured extracted content (source evidence for date, sections, images, tables, highlights, missing-field warnings) and a quick mark-complete/flag button.
- Some sites expose partial article text, dynamic widgets or inaccessible embedded media; surface these explicitly as partial and prevent quietly labeling them complete.
- Normalization should keep unit fidelity, number formatting, proper names and date/time, and link citations. Treat syndicated duplicates as separate source records but cluster same-event reports for reviewer choice.

See `COLLECTION_COVERAGE_SPEC.md` for ledger state machine, confidence/QA details, sampling and acceptance thresholds.

### 5.2 Network performance and reliability

- Prefer RSS/API, next `fetch + Cheerio`, then Playwright only as last resort.
- Default concurrency: about 4-6 global requests, 1-2 requests/domain, configurable; obey server limits and tune empirically.
- Per-request timeout and bounded retries with exponential backoff + jitter.
- Honor `Retry-After`; avoid scraping paywalls, CAPTCHA bypass, and forbidden access.
- Conditional requests with ETag/Last-Modified when available; cache visited canonical URLs.
- Cancel/resume safe processing, idempotent runs, and progress via SSE or equivalent.
- Prevent SSRF by restricting remote schemes to HTTP(S), disallowing localhost/private network targets for user-editable sources, and validating redirects and DNS resolution. Local file paths must be sanitized.
- Log enough to diagnose errors without persisting secrets or indiscriminately storing copyrighted full article HTML.

### 5.3 Publication time semantics

Use `Asia/Ho_Chi_Minh`, not the computer's current locale, and store explicit-offset ISO timestamps. Select published articles in **[from, to)**, inclusive start and exclusive end. Do not silently substitute `modifiedAt` or `collectedAt` for `publishedAt`.

For morning report `2026-11-09`, default range is `2026-11-08 17:00 +07:00` through `2026-11-09 08:00 +07:00` (end exclusive). If actual publish time cannot be verified, send the article to a "Needs time verification" queue and exclude from automatic ready-to-report results.

Opening the app after 17:00 but before next 08:00 should default to the **last completed** window, not an incomplete one. Custom ranges may be incomplete by design when selected manually.

### 5.4 Geographical and topical relevance

Do not rely on keyword presence alone. A relevant article may mention a changed administrative name or a provincial project connected with HCMC. Maintain a configurable geographic list and exclude globally irrelevant stories; permit the user to override.

Classification dimensions must remain independent:

- **Topic**: `INFRA`, `BUILD`, `INVEST`, `TRAFFIC`, `LAND`, `FLOOD`, `POLICY`.
- **Editorial assessment**: `needs_attention`, `positive`, `neutral`.

A story about completion of flood prevention works is not necessarily negative merely because it contains the word "flood". Provide evidence fields and confidence labels. No cloud LLM required; implement high-precision rules and manual corrections first. AI may be plugged in later, but its suggestions must not be mistaken for source facts.

### 5.4A Visual filter and location engine (MANDATORY, P0)

The UI must implement a no-code Boolean rule builder for include/exclude, `AND`/`OR`/`NOT` groups, phrase matching, aliases/synonyms, source-specific overrides, required/optional geographic matches, date/time window, categories, confidence thresholds, and inclusion of nearby connected projects. Avoid treating geographic keyword matching as definitive; an article can be about HCMC without spelling "TP.HCM". Every rule provides a human-readable explanation and a **Test against article / Preview matches** action. All operators must be able to manage rules and aliases without modifying JSON. See `UI_CONFIG_SPEC.md`.

### 5.5 Deduplication

Use canonical URL and normalized URL exact matching first. Then normalized title similarity and event clues (date, location, main entities). Do not automatically collapse separate incidents simply because topics overlap. Present clusters with their primary article plus secondary source links, allowing manual split/merge.

## 6. REVIEW AND EDITORIAL SAFEGUARDS

- Each article displays source name, hyperlink, verified publication time and captured image credit.
- Raw article fields are read-only; reviewed report title and summary are editable overlays.
- Support include/exclude, reorder, change topic and editorial assessment, set primary photo, request time verification, and manual grouping.
- Do not invent quotations, agency recommendations, or administrative assignments. If optional recommended action is available, label it clearly as draft and require user approval.
- Mark contested or uncertain claims. When multiple reputable sources disagree, flag for review instead of arbitrarily selecting one.
- Export uses only approved reviewed items and records provenance in the report or accompanying manifest.
- Keep audit trail: collection run ID, changes (timestamp and field), template version/hash, exported filename.

## 7. ORIGINAL NEWS PHOTOS

Never use generative-AI images as if they depict real incidents. Discover image candidates from article metadata (`og:image`, JSON-LD, body lead images); verify file type and basic resolution, and keep original URL, caption, photographer/credit, and parent story URL.

Public visibility does not equal unrestricted reuse. Support a `rightsStatus` and a configurable strict-photo policy: assets whose use is not authorized or cannot be established should be shown for review or linked to at source, rather than silently included. Maintain caption/source attribution as applicable. Do not replace a missing event image with unrelated stock or AI art. If there is no usable image, either use a text-only layout or mark the required-photo slide as blocked, as defined by template policy.

Download at most a few candidate images per shortlisted article, not every image on every crawled page. Cache by content hash; validate dimensions and aspect ratio. Avoid downloading tracking pixels and unsupported animation formats.

## 8. TEMPLATE-FAITHFUL PPTX AND PDF

### 8.1 Template strategy

**Do not recreate the final official design entirely from scratch if the user supplied an editable `.pptx` template.** Inspect the template's slide dimensions, layouts, masters, backgrounds, typography, placeholder names, text styles, image frames, tables/shapes, and footer elements. Build an adapter that maps normalized report fields into the actual existing shapes/layouts. `pptx-automizer` is an option to investigate; if it cannot reliably edit a specific shape, use a documented alternative rather than silently flattening the whole presentation.

Do not assume shape placeholders such as `NEWS_TITLE_01` already exist. If needed, perform a one-time normalization of a **copy** of the original template and document mappings in `templates/template-map.json`.

Suggested mapping keys:

- organization and report title
- report start/end date-time
- cover summary / assessment groups
- news item headline, summary, image, source, time, source link
- page count, category header, footer

Maintain the user's original template as an untouched reference. Preserve or faithfully reproduce A4 portrait dimensions if confirmed by that file.

### 8.2 Layout constraints

- Use a documented grid and fixed page margins. Consistent column baselines and vertical alignment are mandatory.
- Measure approximate text extents and overflow before export; do not indiscriminately shrink font sizes.
- If content does not fit, shorten an *editable report summary* only with review or flow to an additional template-derived slide.
- Keep aspect ratio of real photographs; apply `contain` or `cover` by explicit per-placeholder policy.
- Vary page count according to actual approved news count; never fill with invented articles.
- Preserve font size hierarchy, metadata attribution, page numbers, official header/footer elements.
- Export an editable PPTX. Do not replace every slide with a bitmap snapshot.

### 8.3 PDF output

Generate PPTX first and convert it to PDF with local LibreOffice headless if available. On Windows, PowerPoint automation may be offered as an optional higher-fidelity backend if installed; it cannot be required for the cross-platform MVP. Detect PDF conversion capability and present clear install/troubleshooting steps. Store preview raster images separately where possible.

Test visual parity of PPTX/PDF and verify no image clipping, missing characters, overlapping text, or slides rendered with unexpected size. Include a representative sample with short and long headlines, 1 to 2 images, and an overflowing section.

### 8.4 Export filenames

Example:

```
exports/2026-11-09/
  HCM_News_2026-11-09_1700-0800.pptx
  HCM_News_2026-11-09_1700-0800.pdf
  HCM_News_2026-11-09_manifest.json
```

Exact names may be refined, but avoid collisions, preserve source review state, and include the correct date window in metadata. Use template version or checksum in the manifest.

## 9. SETTINGS SPECIFICATION

**No manual JSON/XML configuration is acceptable.** All user-facing settings must be created and updated via the GUI. JSON/JSONL are private app storage/export formats only. Include a source onboarding wizard and no-code rule builder as non-negotiable MVP features. See `UI_CONFIG_SPEC.md` for the exhaustive field-to-control mapping, interaction states, validation and UX acceptance criteria.

Settings drawer sections (all interactive and persisted):

1. **Nguồn tin**: add/duplicate/edit/disable/remove websites; base URL, official name, enabled discovery routes, RSS/sitemap/category/search URLs, pagination/depth/lookback controls, static/dynamic extraction mode, adapter status, test scan and preview.
2. **Chủ đề & từ khóa**: chip editor with suggestions and synonym groups; include/exclude phrases, source overrides, Boolean `(AND/OR/NOT)` rule builder, category assignment and match preview.
3. **Khu vực địa lý**: selectable city/district/ward/project areas, legacy/new administrative name aliases, custom locations, optional connected neighboring areas, inclusion exceptions and preview.
4. **Thời gian**: daily defaults, manual from/to with date/time pickers, timezone, full reporting window semantics, last completed and custom ranges.
5. **Chất lượng thu thập**: discover routes, pagination, extraction checks, confidence thresholds, bounded retries, review queue and completeness reporting.
6. **Bản tin & mẫu báo cáo**: upload/switch template, image attribution/rights controls, export formats, paths, density/overflow policy, preview and test render.
7. **Hiệu năng & Lịch sử**: concurrency, cache, max lookback, retry policy, change history, backup/restore, UI import/export.

Every control needs label, help tooltip, inline validation, Save/Cancel or unambiguous autosave, reset, and undo where practical. Import the source list from the Skill `websites.txt` into the GUI on first use; do not require editing source config files. Keep versioned JSON examples for developers only. No guessed RSS endpoints.

## 10. API CONTRACT (SUGGESTED)

```
GET    /api/health
GET    /api/config
PUT    /api/config
POST   /api/config/import
GET    /api/sources
PUT    /api/sources
POST   /api/sources/:id/test
POST   /api/runs                    # start collection for date window
GET    /api/runs/:id               # progress/status
GET    /api/runs/:id/events        # SSE progress, if implemented
POST   /api/runs/:id/cancel
GET    /api/runs/:id/articles
PATCH  /api/runs/:id/reviews/:articleId
GET    /api/runs/:id/review
POST   /api/runs/:id/export         # pptx/pdf/both
GET    /api/exports/:exportId      # controlled local download
```

Use Zod for input validation. Protect state-mutating local endpoints with a per-session local token or equivalent CSRF/origin protection; never expose unrestricted local file access to arbitrary websites. Reject unrecognized file extension and path traversal attempts. Browser connects only to local API through a controlled origin.

### 10.1 Additional required UI/quality endpoints

- `GET/PUT /api/settings` and scoped `GET/PUT /api/settings/:section` (validated and atomic writes).
- `POST /api/sources/test` and `POST /api/sources/import-skill` (parse candidate site list into editable draft).
- `GET/POST/PUT/DELETE /api/sources` and `GET /api/sources/:id/health`.
- `POST /api/rules/preview` with article-match explanations; `GET/PUT /api/rules`.
- `GET /api/runs/:runId/candidates` with filtering by failure/exclusion reason, discovery method and confidence.
- `GET /api/runs/:runId/coverage` and `POST /api/runs/:runId/retry` with constrained target/source.
- `GET /api/articles/:id/inspection` with extraction evidence and omission warnings.
- `POST /api/templates/test-render` and `GET /api/settings/history` with rollback as safe.

Make request/response contracts typed and validate with Zod. Never expose a remote-listening API by default. Avoid forwarding arbitrary user-defined local URLs through the crawler.

## 11. IMPLEMENTATION PHASES AND GATES

**Claude Code mapping:** Use the smaller, session-sized gates in `MILESTONES.md` as the execution order. The phases below remain the product-level scope and estimation; avoid attempting all phases in a single Claude Pro session. Every checked item must be backed by a command, artifact, or manual test evidence.


### Phase 0 - Asset audit and technical spike (estimated 1-2 engineer-days)

- Inventory Skill ZIP, source list, original and preferred template.
- Extract a definitive source list and categorize source capability (RSS, static HTML, JavaScript, inaccessible).
- Open sample PPTX, document layouts/dimensions and identify a viable edit/render path.
- Create a technical spike: collect and normalize at least one accessible real article; render at least one template-based slide. If this fails, document precisely what failed and choose a realistic fallback.

**Gate:** source ingestion and PPTX template handling have proven feasibility.

### Phase 1 - Local app skeleton AND full GUI Settings foundations (5-7 engineer-days)

- TypeScript monorepo, strict lint/format/tests.
- React dashboard, settings drawer, date range, status and article table skeleton.
- Fastify API on 127.0.0.1 and file-based storage schema.
- One-command development start; example settings and source definitions.

**Gate:** UI, API and file storage work through a restart.

### Phase 2 - Coverage-audited end-to-end collection (8-12 engineer-days)

- RSS and static HTML adapters, bounded scheduler, retries, time filtering, HTML extraction.
- Source health, progress, cancellation, caching and error states.
- Deduplication and subject/assessment suggestion, review queue.
- Playwright fallback for a justified subset of sources.

**Gate:** a complete run from configured sites produces traceable article records, with clear failures rather than fabricated results.

### Phase 3 - Editorial review (3-5 engineer-days)

- Article details, original links, images, editable report fields.
- Categorize, select/exclude, merge/split event groups, reorder.
- Persist reviews; allow offline revisit; handle uncertain dates.

**Gate:** a user can complete editorial selection and reopen the reviewed report offline.

### Phase 4 - PPTX/PDF reporting (5-8 engineer-days)

- Proper original-template integration and layout mappings.
- Dynamic slide count, photo handling, source/credit, cover summary.
- PPTX exporter, PDF exporter and preview/QA.

**Gate:** a user can export visually valid, editable PPTX and matching PDF from reviewed articles.

### Phase 5 - Testing and packaging (3-5 engineer-days)

- Unit, integration, source fixture, and visual regression tests.
- Error handling on inaccessible sites, missing images and renderer.
- Windows launcher and reproducible installation instructions.
- Complete README, architecture note, report source manifest, sample artifacts.

**Gate:** a fresh environment can install, run, and recreate an example export via documented steps.

**Revised human-engineering estimate:** approximately 27-40 engineer-days (the original 20-32-day estimate did not include the expanded full-UI configuration and audited high-recall discovery requirements). An autonomous coding agent should work toward the same deliverables but must report achieved versus incomplete gates instead of claiming that everything is finished automatically.

### Later features (not required to block MVP)

1. Import a Word `.docx` report, preserving titles, hyperlinks and original supplied facts; crawl linked articles only for verification/photo candidates.
2. Multiple named PPTX templates, configurable per report type.
3. Scheduled collector via Windows Task Scheduler while PC is on.
4. Optional local Ollama classifier/summarizer (never required for baseline).
5. Tauri/Electron packaging after local backend and export workflow are stable.
6. Optional migration path to SQLite if concurrency, search and data volume demand it.

## 12. TEST STRATEGY AND ACCEPTANCE CRITERIA

### 12.1 Functional acceptance

- [ ] App starts offline, shows cached data, and Settings persist across restarts.
- [ ] Reports can be manually requested for arbitrary from/to times.
- [ ] Default 17:00-08:00 window is calculated for last completed period in Asia/Ho_Chi_Minh.
- [ ] Auto-collection runs at most once for each completed period unless manually retriggered.
- [ ] Each configured source has readable success/empty/failed status.
- [ ] An unreachable source does not block successful ones.
- [ ] Verified article inclusion follows `[from, to)` publication time semantics.
- [ ] Unknown/inferred publication time is clearly flagged and not silently approved.
- [ ] Users can edit, reorder, select, unselect and save article review decisions.
- [ ] Exact duplicate URLs are removed; near-duplicates are reviewable.
- [ ] No fake images, fabricated citations or fake positive results are inserted.
- [ ] Exported PPTX is editable and based on the supplied template, when supplied.
- [ ] PDF has the same selected content and slide sequence as PPTX.
- [ ] Cached content can be re-exported offline.
- [ ] UI and error messages are usable in Vietnamese.
- [ ] **Every config property needed to operate or fine-tune supported sources, keywords, geography, rules, date ranges, templates and crawler limits has a usable UI control; no JSON/XML editing is required.**
- [ ] A nontechnical tester can add a news site, configure category pages/feed/sitemap, location aliases, inclusion/exclusion conditions, test and save, using only the UI.
- [ ] All candidate URLs in the run's enumerated scope have a final ledger state or visible retry/error status with a reason; no silent drop.
- [ ] Listing pagination/finite crawl limits are surfaced with warnings when coverage may be incomplete.
- [ ] Article inspector shows body sections, tables, images/captions and date evidence or flags missing/uncertain items; it never falsely asserts complete extraction.
- [ ] Run coverage dashboard reconciles discovered/fetched/parsed/eligible/filtered/error counts and supports retry/rescan.
- [ ] Golden fixtures for each supported source demonstrate no omitted material article sections; 100% candidate accounting on controlled fixtures; real-world recall is reported as unknown when it cannot be proven.

### 12.2 Test suite

- Unit tests: date-window calculation across midnight, timezone, validation, URL normalization, duplicate grouping, category rules, serialization.
- Integration tests: mock HTTP/RSS/sitemap/category pages and multipage article fixtures; page pagination, source failures, retries, caching, ledger reconciliation, incomplete extraction, file persistence, UI settings operations, and API operations.
- Template tests: short/long headline, missing/portrait/landscape image, special Vietnamese glyphs, empty group, many news items, PDF conversion errors.
- Visual QA: render PPTX/PDF pages to images and inspect side by side with approved template examples; capture regression baselines.
- Security tests: invalid local paths, SSRF/private IP attempts, malformed RSS/HTML, file extensions, API origin/token.

### 12.3 Performance targets, not promises

- Local UI becomes interactive quickly, aiming at <2 seconds on a specified test PC after startup.
- Network throughput depends on source latency and throttling; provide run metrics before setting a fixed collection SLA.
- Cache hits should avoid refetching unchanged article pages.
- Do not launch a Chromium process for every source when RSS/static HTML suffices.

## 13. LIMITATIONS AND NON-GOALS

- Internet still required for fresh news collection.
- A browser-only standalone HTML file is not the primary solution because cross-origin restrictions block generic access to third-party news HTML.
- **No crawler can truthfully guarantee zero missing articles across arbitrary publisher websites.** The software must instead maximize recall on accessible areas, expose uncertainty, surface blocked/incomplete routes, and objectively verify completeness against a documented known set of URLs and fixtures.
- Do not bypass publisher protections, paywalls or access controls.
- Do not assume that articles from historic dates remain accessible via current RSS feeds.
- Do not claim unrestricted copyright/photograph rights merely because a webpage is public.
- Do not require a paid LLM, cloud hosting or database for baseline collection and reporting.
- Do not postpone critical data accuracy checks merely to polish the UI.
- Do not claim a full native Windows executable was produced if it was only tested in Linux; provide reproducible Windows packaging instructions instead.

## 14. FINAL HANDOFF EXPECTATIONS FOR CLAUDE CODE

At the end of implementation, provide the user:

1. **Working source repository**: preferably a ZIP plus individual high-value artifacts, not just screenshots.
2. **How to run**: prerequisites; Windows install/start; local address; demo/test source limitations; expected data paths.
3. **Verified features**: what was tested end-to-end, including counts and status for actual sources.
4. **Generated example**: PPTX and PDF made with the supplied template if it was accessible; if not, label demo assets explicitly.
5. **Acceptance report**: which checklist items passed, failed, or require user assets/environment.
6. **Known issues**: specific source parser problems, image rights review, template limitations, PDF font differences.
7. **Next prioritized tasks**: the smallest set of actions needed to move from working MVP to daily production use.

Do not hand over only a design or plan. Do not fabricate screenshots, successful crawls, report samples, source references, or visual verification. Show concrete build/test commands and their results.

---

## 15. RECOMMENDED FIRST ACTIONS FOR THE IMPLEMENTATION AGENT

1. Inspect every user-supplied Skill/template/source file.
2. Create the repository and select package versions appropriate to the current runtime.
3. Implement the time-window functions, file-backed domain schema, **full GUI Settings editor and candidate ledger**, with tests.
4. Build a minimal vertical slice: **configure source/rules/location in UI** -> multi-path discover -> candidate ledger -> **full article extraction and inspection** -> reviewed item -> real-template PPTX -> PDF.
5. Build the dashboard around that working slice; then add more site adapters and error/QA coverage.
6. Continue until an executable, usable MVP is available and the acceptance report is honest and detailed.

**Primary success criterion:** a nontechnical user can open the one-page local UI on Windows, **configure every source, keyword, Boolean rule, geography filter and report option by interacting only with the GUI**, collect and audit broad coverage of real news within an exact reporting window, inspect gaps and full extracted content, verify and edit results, and export a correctly formatted official-looking PPTX/PDF without ChatGPT/Claude for daily operation.


## 16. CLAUDE CODE REPOSITORY PROTOCOL (v1.2)

- Keep `CLAUDE.md` in the repository root: persistent engineering instructions and pointers, **not** a duplicate of the 600-line plan.
- Use `MILESTONES.md` as the executable work breakdown, `PROGRESS.md` as cross-session state, and `ACCEPTANCE_REPORT.md` as proof-based gate verification.
- Record each source's discovery routes, last working extraction fixtures, and any blocked paths in `docs/SOURCE_SUPPORT.md` once code scaffolding exists.
- Use actual binary template/Skill files in `reference/` (do not invent them); names and locations can be mapped by the implementation.
- At each session start, read no more than needed: `CLAUDE.md`, `PROGRESS.md`, current milestone, and its referenced acceptance sections. Avoid reopening all long specs repeatedly just to consume context.
- When user-provided assets are missing, create a documented adapter contract and an obvious UI/template placeholder; do not mark original-template fidelity as passed.
- Project must remain usable without Claude Code after the software is built.

### Claude Code completion definition

A milestone can be marked **DONE** only if (a) code is in the repository, (b) relevant automated tests or exact manual steps are executed, (c) results and limitations are recorded, and (d) dependent features are genuinely wired from UI through API to storage or export. Screenshots of non-functional controls are not proof.
