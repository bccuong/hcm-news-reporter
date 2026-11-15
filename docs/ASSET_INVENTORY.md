# Asset inventory (M0) – 2026-11-15

| Asset | Status | Location / notes |
|---|---|---|
| HCM News Reporter Skill (`SKILL.md`, scripts, references) | **FOUND** | Installed Claude skill, copied to `reference/hcm-news-reporter-skill/` (git-ignored). Used as business-rule reference only. |
| `websites.txt` | **FOUND** | `assets/websites.txt` → committed seed copy `src/domain/data/skill-websites.txt` (6 sites; Dân trí marked `web:` = blocks automated fetch). |
| Listing/RSS routes | **FOUND** | `scripts/collect_candidates.py` `LISTS` (author note: tried 15/11/2026) → seeded into source cards as editable values (`src/domain/defaults.ts`). |
| Places (wards/communes/landmarks/other provinces) | **FOUND** | `assets/hcm_places.json` (Wikipedia, NQ 1685/NQ-UBTVQH15) → `src/domain/data/hcm_places.json`. |
| Classification rules | **FOUND** | `references/classification-rules.md` → category labels + independent assessment dimension. |
| Approved PPTX template | **FOUND, NOT YET INTEGRATED** | `assets/reference-report.pptx` (6.9 MB, 6 slides, 7556500×10693400 EMU = A4 portrait). Audit in `references/current-template-audit.json`. Not committed (official file). |
| Example approved PPTX | Same file as above | – |
| Word digest (.docx) | NOT SUPPLIED | Later milestone. |
| LibreOffice (PDF) | NOT INSTALLED | PDF export reports "unavailable" with install guidance. |
| Python | NOT INSTALLED | Skill's `build_report.py` (python-pptx) therefore not usable as template adapter on this PC. |

## Technical spike (live, 2026-11-15 ~15:00 ICT) – `npm run spike`

| Source | RSS | Section pages | Candidates (2 RSS + 2 sections) | Sample extraction |
|---|---|---|---|---|
| Thanh Niên | 200 ×2 | 200 ×2 | 160 | 2/2 verified publish time, 15–19 paragraphs, `[itemprop=articleBody]` |
| VnExpress | 200 ×2 | 200 ×4 (incl. pagination) | 173 | 2/2 verified, 8 paragraphs, `article.fck_detail` |
| Tuổi Trẻ | 200 ×2 | 200 ×2 | 122 | 2/2 verified |
| Báo Xây dựng | 200 | 200 ×3 | 97 | 2/2 verified |
| SGGP | 200 ×2 | 200 ×2 | 167 | 2/2 verified |
| Dân trí | – | – | – | `manual_only` per Skill note (IP block); not probed |

Template spike: demo PPTX generated with pptxgenjs at the audited A4 portrait size (`tests/server.test.ts` export case). **Not** the original template → fidelity gate BLOCKED.
