# Source support

Live full run, window `2026-11-14 17:00 → 2026-11-15 08:00 (+07:00)`, run `run_20261115_*` (second run after URL/title fixes), default limits (30 listing pages, depth 2, 300 article fetches/source).

| Source | Status | Unique candidates | Notes |
|---|---|---|---|
| Thanh Niên | ok | 232 | RSS thoi-su + dia-oc + home; sections thoi-su, dan-sinh, dia-oc |
| VnExpress | partial | 519 | **Article-fetch limit reached** (URLs carry no date; section items have no feed date) → 120 `retry_pending`, visible with "Mở rộng quét". |
| Tuổi Trẻ | ok | 170 | |
| Báo Xây dựng | ok | 104 | Pagination heuristic followed `english.htm` once (false "next") – harmless but to fix. |
| SGGP | ok | 202 | ~16 `parse_failed: ARTICLE_BODY_MISSING` (likely photo/video/special layouts) – need adapter check. |
| Dân trí | manual_only | 0 | Skill note: blocks automated fetch from server IPs; source kept disabled, links can be added manually later. |

Run totals: 1227 candidates; reconciliation 1227/1227 accounted (0 transient); `outside_window` 1021 (incl. `URL_DATE_HINT` skips), `ready_for_review` 41, `irrelevant_with_evidence` 22, `parse_failed` 17, `parsed_partial` 6, `retry_pending` 120. Run completeness: **incomplete** (VnExpress limit) – shown in UI.

Real-world recall vs. everything each publisher posted is **unknown** (not measurable without a publisher manifest).

## Fixture coverage (deterministic)
`tests/fixtures/siteA.ts`: RSS + news sitemap + 2-page section listing, 11 known candidates incl. utm-duplicate, canonical duplicate, missing date, other province, old feed item, 403, JSON-LD disagreement, continuation, 08:00 boundary, excluded section. All 11 end in the expected state with reason codes.
