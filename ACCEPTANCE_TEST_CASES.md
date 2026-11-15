# ACCEPTANCE_TEST_CASES.md - Claude Code Acceptance Gates v1.2

**P0 means a working feature, not a simulated form or future task.** For every case, automated tests or demonstrable manual test steps must be included in handoff.

| ID | Scenario | Required result |
| --- | --- | --- |
| UI-01 | In GUI add source via URL | Editable source card, URL validated, saved across restart |
| UI-02 | Add category/sitemap/RSS listings | UI input, discovered candidate preview, distinguish verified/unverified discovery |
| UI-03 | Turn off one source and retest | Disabled source never fetched; other sources continue |
| UI-04 | Configure include + NOT + OR rules | Correct article examples, explanations, saved and editable with no JSON edit |
| UI-05 | Configure HCMC location aliases | Matches legacy/current aliases; unknown cases reviewable, not silent filtered |
| UI-06 | Change from/to date-time | Range uses Asia/Ho_Chi_Minh and [from,to); persisted preset |
| UI-07 | Change retry/concurrency/crawl depth | Changes applied to test run, UI reflects limit warnings |
| UI-08 | Upload PPTX template, choose images/PDF | Visual test render and export with no JSON editing |
| UI-09 | Restore Settings or import legacy websites.txt | All imported entries appear in editable UI; no overwrite without confirmation |
| DIS-01 | RSS and sitemap overlap | Canonical reconciliation, both discovery routes recorded |
| DIS-02 | Pagination hides late qualifying article | Listing traversal finds it; limits documented if reached |
| DIS-03 | RSS misses article only found on section page | Article still found; no false complete label |
| DIS-04 | 403/429/timeout | Explicit ledger error, source health reflects failure, retry control |
| DIS-05 | No trustworthy publish time | `date_unverified` review queue, not auto-approved or discarded |
| DIS-06 | Multiple articles describe one event | Group sources, preserve every individual source link |
| DIS-07 | Out-of-window article | Explicit reason, exact date-boundary test |
| DIS-08 | Source selector changes | Adapter degraded/incomplete status; recovery path visible |
| EXT-01 | Article with title, sapo, 8 paragraphs, 2 subheads | Full text and order extracted or sections flagged partial |
| EXT-02 | Article with important numeric table | Table content + labels retained, or marked missing |
| EXT-03 | Photo caption credits and 2 image candidates | True image metadata, rights review and source evidence shown |
| EXT-04 | Article split across pages/read-more | Detect continuation, collect permitted pages or mark partial |
| EXT-05 | Different posted and updated timestamps | Date eligibility based on verified publish time |
| EXT-06 | Two extractors disagree on key section | Warning and Article Inspector, not silent selection |
| EXT-07 | Summary omits or changes critical figure | Reviewer warning/manual correction, no factual fabrication |
| LED-01 | Crawl interrupted mid-run | Recovery from pending queue; counts reconcile after restart |
| LED-02 | Candidate rejected by filter | User can see reason/source and override/review |
| LED-03 | Retry one source | Newly found vs existing candidates delta visible |
| RPT-01 | Long Vietnamese title + table + image | Editable PPTX, no clipping/overlap, PDF visual parity |
| RPT-02 | No usable licensed image | Text-only/blocked policy obeyed; never AI substitute |
| RPT-03 | Template replaced via UI | Preserves original untouched and emits test-render QA |
| OFF-01 | Internet disconnected | Settings/history/review/export existing data function locally |
| SEC-01 | Source URL redirects to localhost/private IP | SSRF refused; backend remains loopback-bound |

## Evidence required at handoff

1. Screenshots or a short capture of source onboarding wizard, Boolean rules, location editor, date-range editor, and coverage dashboard, plus working source repo.
2. Automated UI tests or equivalent scripted/manual assertions for UI-01 through UI-09; tests must click real controls and verify persisted values.
3. At least two actual or recorded representative sites fully exercised in vertical slice; each configured site inventoried with supported routes and status.
4. Golden fixtures with known candidate URLs and material sections; `candidate ledger accounted = discovered candidates` verified in tests.
5. One PPTX and one PDF with actual template if supplied, visual inspection and source/provenance manifest.
6. Exact failures/uncertainty and incomplete coverage disclosed rather than a '100% all news captured' claim.

**Hard rejection conditions:** operational instruction requires manual JSON/XML edits; collector only reads a few headlines from first listing; articles with parse errors disappear silently; export invents content; PPTX/PDF unverified and misaligned; simulated UI not wired to backend.
