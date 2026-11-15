# COLLECTION_COVERAGE_SPEC.md - High-Recall Discovery and Complete Extraction

**Version:** 1.1 | **Priority:** P0.  
**Goal:** Find and accurately extract as much relevant accessible content as possible from the configured websites without silently losing candidate URLs or material article sections. **No software can guarantee 100% of every article on arbitrary publisher sites** (hidden items, paywalls, dynamically changing site indexes, network restrictions). Show documented coverage, failures and uncertainty instead of claiming impossible certainty.

## 1. Separate two completeness problems

- **Discovery coverage:** Did the engine enumerate relevant article links from the configured site, within the selected date window and discovery scope?
- **Extraction completeness:** For each found article, did the engine extract every important fact/section (dates, key figures, people/agencies, subhead, paragraphs, tables, captions, corrections)?

Both need independent metrics, diagnostics and fail/review states. A site can be successfully fetched but incompletely scanned; an article can have a correct title and incomplete body.

## 2. Multi-path discovery per configured source

Priority is not exclusivity. In user-enabled, permitted routes:

1. RSS/Atom and public content APIs, including relevant topical feeds.
2. Sitemap indexes, XML sitemaps and article/news sitemaps when available.
3. Category/section pages and listing pagination, including "next" links, page-number rules and bounded infinite scroll using Playwright only when needed.
4. Search pages provided by the publisher where accessible and supported; not a substitute for sitemap/sections.
5. Optional manual URL paste/import of Word-linked stories into the same ledger.

Reconcile discoveries from multiple routes by canonical URL while retaining all discovery evidence. Support rescan with wider date lookback. Preserve known URLs across runs for incremental backfill. If pagination or request limits are reached, mark the route **incomplete due to limit**. Do not stop after one old article; verify chronological ordering before any early termination.

## 3. Durable candidate URL ledger (never silently drop)

Required states: `discovered`, `fetch_queued`, `fetched`, `parsed_complete`, `parsed_partial`, `date_unverified`, `outside_window`, `irrelevant_with_evidence`, `duplicate`, `blocked`, `fetch_failed`, `parse_failed`, `retry_pending`, `ready_for_review`, `reviewed`. Every candidate has source URL, canonical URL if known, discoveredVia[], discoveredAt, listingUrl, relevant time window, attemptedAt, HTTP status/errors, parser version, last state and reason code. Every branch must persist an outcome before returning.

**Invariant:** `unique discovered candidates = terminal known outcomes + queued/in-progress + explicit retry/unknown` after canonical merge. On interruption, recover unfinished states; never hide failures. Provide a downloadable JSON/CSV run manifest and concise GUI reconciliation status.

Never use "filter out" as a silent skip. Example reasons: `MISSING_PUBLISHED_AT`, `OUTSIDE_DATE_WINDOW`, `NOT_GEOGRAPHICALLY_RELEVANT`, `FETCH_403`, `PAGINATION_LIMIT`, `ARTICLE_BODY_MISSING`, `REDIRECT_LOOP`, `DUPLICATE_CANONICAL`, `INVALID_ARTICLE_URL`.

## 4. Complete article representation

Article extraction should retain **facts and structure**:

- Publication date vs update time, timezone, verification evidence (visible text, JSON-LD, meta, feed); conflicting evidence flagged.
- Main headline, subtitle/sapo, topic tags, all paragraphs in order, subheadings, list items, meaningful embedded quotes, author, publisher.
- Key numbers, units, monetary values, dates, organizations, public projects, geographic entities and source links.
- HTML tables, footnotes, linked continuation/multipage parts, side fact-boxes if substantive to the story, captions/credit/metadata for relevant photos and graphics.
- Corrections/updates when visible; provenance for structured extraction (selector/metadata and evidence for each key field).

Exclude navigation/ads/unrelated recommendations without removing substantively relevant paragraphs. Preserve a raw-to-normalized section mapping in memory or permitted cached evidence. Avoid storing copyrighted full articles beyond what is necessary and permitted; keep essential evidence/citations/metadata in report manifest.

## 5. Completeness detection and cross-checking

- Compare site-specific extracted body with independent fallback extraction (e.g. Readability) or JSON-LD article body when available. Discrepancies beyond thresholds trigger `parsed_partial` or manual inspection; do not pick an arbitrary winner silently.
- Compare estimated relevant section/paragraph counts in article container with extracted sections; detect near-empty or unusually short body, missing text after a "read more" break, unparsed tables, missing continuation pages, and malformed Vietnamese characters.
- Validate number/unit/date consistency between source evidence and summary. A summary must not introduce unsupported facts; review should highlight important figures, dates, location and recommendations.
- Show source evidence, confidence and missing section warnings in Article Inspector. Button to open original URL plus re-extract with alternative adapter; manual correction stores an overlay rather than rewriting original article fields.
- **Do not classify as 100% complete based only on a content length threshold.** Completeness requires bounded evidence comparisons and/or human review.

## 6. Coverage UI design (first-class feature)

For each source and run show:

| Metric | Meaning |
| --- | --- |
| Discovery routes | RSS / sitemap / sections / search, success/error per route |
| Listing pages crawled | Actual number visited, and user-configured page limits |
| Unique candidates | Canonical URLs found; duplicates reconciled |
| Fetched / fetch failures | Completed URLs vs errors (incl. 403/429/timeout) |
| Parsed complete / partial | Content-level QA and extraction warnings |
| Window verified / unknown | Publication-time confidence, inclusive/exclusive boundary |
| Eligible / review / excluded | With count by explicit exclusion reason |
| Retry and rescan delta | Newly found/recovered URLs after rerun |
| Run completeness | `complete within enumerated scope`, `incomplete`, or `unknown` |

Avoid a misleading 'site news completeness = 99%' unless a reliable full source manifest exists. Use 'candidate accounting coverage: 100%' only when every **discovered** candidate has a recorded status, with no inference about undiscoverable articles.

## 7. Design for high recall without overloading publisher sites

- Concurrent bounded requests, per-host rate limiter, retry-after, exponential backoff, maximum depth/pages, resilient pagination.
- Cache successful fetches, conditional GET and response hash, dedup canonical URLs, date-bound windows with lookback padding.
- One source failure must not block other sources. Retry failed URL vs retry whole source; give user controls for each.
- Honor access restrictions/robots and publisher terms. No CAPTCHA or paywall evasion. Mark blocked routes visibly.
- Dynamically inspect sites only when necessary (Playwright fallback), avoid launching a browser per URL.

## 8. Precision / recall measurement and acceptance

- **Controlled source fixtures:** 100% of enumerated candidate links are represented in ledger; 100% explicitly marked material sections extracted or flagged partial; no silent omission; verify boundary dates, pagination, competing links, special characters, tables, galleries, corrections, infinite scroll fixture.
- **Real site audit:** at least 2 configured sources end-to-end in initial vertical slice, then each configured source with at least one successful live/recorded fixture case; manual comparison of article listing pages vs discovered links and source article vs extracted content. Document exceptions.
- **Report correctness:** 100% exported statements in acceptance samples trace to selected source article/approved editorial overlay; missing source evidence triggers review. Never invent numbers or responsible government agencies.
- **Always expose residual uncertainty:** source robots/blocking, unverifiable publication timestamps, dynamic content not present, route not enumerated, historical listing unavailable, source content edits after collection.

If a publisher changes markup, mark adapter degraded and disable automatic 'complete' labeling until tested; retain previous parsed records and enable manual URL import.
