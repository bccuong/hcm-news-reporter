# ACCEPTANCE_REPORT — Evidence log (2026-11-15)

`PASS` = automated test or reproducible command executed this session. `PARTIAL` = implemented & wired, evidence incomplete. `BLOCKED` = missing tool/asset.

| ID | Status | Evidence | Notes |
|---|---|---|---|
| UI-01 add source, persist restart | PARTIAL | `tests/server.test.ts` (PUT sources → restart → present); wizard in `web/src/SourcesPanel.tsx` | No automated click-through test yet |
| UI-02 RSS/sitemap/section + preview | PARTIAL | `/api/sources/detect`, `/api/sources/test`; verified/hypothesis chips | Manual UI check pending |
| UI-03 disabled source not fetched | PASS | `collector.test.ts` asserts no request to source C; failing B doesn't block A | |
| UI-04 include + OR + NOT | PASS (logic) | `domain.test.ts` Boolean rule builder; builder UI + preview wired | UI click test pending |
| UI-05 HCMC aliases | PASS (logic) | `domain.test.ts` location; unknown → review | |
| UI-06 from/to, VN tz, [from,to) | PASS (logic) | `domain.test.ts` time window (8 cases); custom window persisted via settings | |
| UI-07 retry/concurrency/depth | PASS (logic) | `collector.test.ts` page-limit → `PAGINATION_LIMIT` surfaced; settings persisted (server test) | |
| UI-08 upload PPTX, test render | PARTIAL | `/api/templates` stores copy; export works with DEMO renderer | Uploaded template not used by renderer |
| UI-09 import websites.txt / restore | PASS (logic) | `domain.test.ts` import; rollback in `server.test.ts`; UI never overwrites existing ids | |
| DIS-01 RSS+sitemap overlap | PASS | `collector.test.ts` | |
| DIS-02 pagination late article | PASS | page-2 article found; limit case flagged | |
| DIS-03 only on section page | PASS | | |
| DIS-04 403/429/timeout | PASS | 403 → `blocked`; 503 source → `failed`; retry/backoff covered | 429 Retry-After path not fixture-tested |
| DIS-05 no publish time | PASS | `date_unverified`; export blocked unless manually verified (server test) | |
| DIS-06 same event | PARTIAL | Jaccard clustering flags "cùng sự kiện?" | Manual merge/split UI missing |
| DIS-07 out-of-window | PASS | feed date + exact 08:00 boundary → `outside_window` | |
| DIS-08 selector change → degraded | NOT STARTED | | |
| EXT-01 sapo + 8 paragraphs + 2 subheads | PASS | `collector.test.ts` ground truth | |
| EXT-02 numeric table | PASS | rows/caption exact | |
| EXT-03 caption/credit, 2 images | PASS | credit + og:image + body image, rights=review | |
| EXT-04 continuation | PASS | rel=next + "(Còn tiếp)" → partial | Pages not auto-merged |
| EXT-05 posted vs updated | PASS | publishedAt used, modifiedAt kept | |
| EXT-06 extractor disagreement | PASS | JSON-LD articleBody mismatch warning | |
| EXT-07 summary changes figure | PARTIAL | Inspector warns on numbers absent from source | No automated UI test |
| LED-01 interrupted run | PASS | abort mid-run → balanced ledger → resume completes | |
| LED-02 rejection reason visible | PASS | every non-ready state has reasonCode; ledger tab + CSV | Override = inspect + include |
| LED-03 retry delta | PARTIAL | `newSinceLast` per source shown | |
| RPT-01..03 template fidelity / PDF parity | **BLOCKED** | Demo renderer only; no LibreOffice | Not a pass |
| OFF-01 offline review/export | PASS (API) | export from stored run without network in server test | |
| SEC-01 SSRF / loopback | PASS | private IP/redirect refused; Host/Origin/token guard tests; listen 127.0.0.1 | |

## Latest verified commands
```text
npx tsc -p tsconfig.json --noEmit     -> exit 0
npx vitest run                        -> 3 files, 33 tests passed
npx vite build                        -> built OK
npm run spike                         -> 5/5 direct sources reachable, 10/10 sample extractions verified date
scripts/live-run.ps1                  -> 1227 candidates, 1227 accounted, completeness=incomplete (VnExpress fetch limit)
```

## Real source checks
See `docs/SOURCE_SUPPORT.md`.

## PPTX/PDF verification
- Demo PPTX generated (valid ZIP, downloaded via API in test). Not rendered/inspected visually (no renderer). Original template `reference-report.pptx` not yet used.

## Release recommendation
NOT READY for production: template fidelity (M5) and UI automation (M1/M6) outstanding.
