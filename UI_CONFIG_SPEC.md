# UI_CONFIG_SPEC.md - UI-First, No-Code Configuration Contract

**Version:** 1.1 | **Priority:** P0, a hard requirement for MVP.  
**Rule:** All sources, keywords, filters, locations, time windows, report templates, image/quality and collection settings MUST be configurable from the application GUI. Users do NOT edit JSON/XML or source code. JSON remains only as hidden, versioned local storage and import/export format.

## 1. UX skeleton

- One-page React SPA, desktop-first. The main page has date range, Collect, source-status/coverage dashboard, article review, preview, export. Keep previous run visible while a new run processes.
- Right drawer named **Cài đặt** (full-height, search within settings, wide enough for forms). Side navigation **Nguồn tin**, **Từ khóa & quy tắc**, **Địa điểm**, **Lĩnh vực**, **Thời gian**, **Chất lượng thu thập**, **Báo cáo & mẫu**, **Hiệu năng**, **Sao lưu & lịch sử**. No separate page required.
- Every section supports clear labels and help, inline field validation, unsaved-change guard, save/cancel or explicit auto-save state, reset to defaults, and success/error toast. Keyboard-friendly and Vietnamese-first. Show example before/after effects for risky options.
- First run: onboarding wizard (1) import legacy Skill `websites.txt` or paste a list; (2) confirm source names; (3) test each source; (4) set locations/topics/time; (5) attach PPTX template; (6) preview one test article and test export. Missing assets should not prevent other configuration.
- Guided Basic view plus collapsible Advanced view. Never use a raw JSON text area as the sole advanced control.

## 2. All settings must have real UI controls

| Panel | Editable items (examples; no hidden user-facing settings) | Recommended controls | Validation / preview |
| --- | --- | --- | --- |
| Nguồn tin | Add/remove/disable, name, domain, homepage, priority, categories | Source cards, toggle, URL input, drag reorder, duplicate | Domain URL checks and "Kiểm tra nguồn" |
| Kênh thu thập (per site) | RSS/Atom, sitemap, sitemap index, section/listing URLs, permitted search/API URL | Multi-URL chip editor, add route, route order, enable/disable | "Tìm đường dẫn bài" displays candidates + status |
| Dò trang (per site) | Discovery mode auto/manual, max page/depth, pagination, historical lookback, fetch/timeout, dynamic-page fallback, article selector/metadata override | Sliders/steppers, dropdown, selector test panel, paginated HTML preview | Sample extraction with highlight and compare |
| Từ khóa & quy tắc | Include/exclude words & phrases, synonyms/aliases, keyword sets, per-source overrides, strict/soft match, AND/OR/NOT groups | Chips, token search, visual nested rule builder, source selector | Match count, examples included/excluded and WHY |
| Địa điểm | HCMC/wards/districts/neighbouring related areas, custom addresses/places, aliases for historic names, required/optional location, blacklist | Location chips, hierarchy tree + autocomplete, alias group | On/off test against sample articles |
| Lĩnh vực | Categories/subcategories, priority, classification rule mappings, allow manual override | Tag manager, drag priority, rules builder | Classification explanation |
| Thời gian | From & To datetime, presets, default daily time, timezone, publish vs update policy, lookback margin | Date/time pickers, presets, timezone selector | Preview exact inclusive/exclusive boundaries |
| Chất lượng | Valid publication date rules, multi-path discovery, completeness thresholds, missing table/image warning, failure/retry policy, review queue | Toggles, score controls, validation help | Status/coverage preview and known limitations |
| Ảnh | Original photos, caption/attribution, size/type, rights handling, strict-photo and text-only fallback | Toggles, dropdowns, photo test preview | Image candidates and provenance |
| Báo cáo | Upload/swap PPTX template, map placeholders, density, fonts/layout warnings, PDF renderer, output folder, filename | File picker, visual mapping, dropdowns, test render | Render a 1-item PPTX/PDF test and preview |
| Hiệu năng | Concurrent requests, per-domain rate, timeouts, retry, cache expiry, schedule | Sliders/steppers/toggles | Clear performance warnings |
| Lịch sử & dữ liệu | Past runs, history, clear cache with confirmation, configuration backups, restore/import/export | History table, buttons, file dialogs | Restore confirmation and change diff |

## 3. Source onboarding - must be usable by a non-programmer

**Flow:** Cài đặt > Nguồn tin > + Thêm nguồn > Enter URL > **Dò cấu trúc tự động** > show name, homepage, detected RSS/sitemap/category options and candidate article links > enable desired routes > **Thử thu thập** > see titles, published times, extract completeness and missing fields > Save.

Automatic suggestions are hypotheses, never silently treated as verified. User can manually add/edit discovery URLs and pick category pages; auto-discovered feeds remain previewed and need not all be correct. Site-specific extraction can use advanced selector pickers, but always expose a visual test on a concrete page. Import from the existing Skill must generate editable source cards.

Each source card has: ON/OFF, source identity, last success/error, coverage confidence, accessible routes, recent candidate count, test status, **Test**, **Inspect**, **Retry**, **Edit**, **Duplicate**, **Remove**. Source failures never disappear.

## 4. Keywords and filter rule builder

- Group rules with nested AND/OR/NOT, include/deny and exact phrase vs substring; use visually constructed blocks (no regular expression or source code required). Regex optional under Advanced, always with safe bounds and preview.
- Examples: `Region = Ho Chi Minh City OR related project` AND `(metro OR traffic OR construction)` NOT `(job advertisements OR unrelated travel offers)`. User can save named presets and per-source overrides.
- Maintain synonym and geographic alias sets (e.g. "TP.HCM" / "Thành phố Hồ Chí Minh" / "Sài Gòn"; legacy/new administrative unit names). **Do not infer location exclusively from a literal keyword.** Track evidence (body/title/metadata/recognized place) and confidence.
- "Xem thử kết quả" runs against cached articles / limited fresh sample and displays matched, missed, conflicts, and reason badges. Users can temporarily adjust rules without overwriting them, then Apply/Undo.
- Uncertain relevance remains visible in a **Cần kiểm tra** queue; do not silently exclude important articles solely due to an absent matching keyword.

## 5. Reporting date / location examples

- Date picker must show both dates and times, use `Asia/Ho_Chi_Minh`, and offer **Kỳ gần nhất**, **Hôm nay**, **Hôm qua**, **Tùy chỉnh**. Default last complete: previous day 17:00 -> report day 08:00, inclusive start/exclusive end. Distinguish posted/updated/collected date.
- A location selector stores selected geographic entities and aliases, not solely a comma-separated keyword list. Optional connected-neighbor rules allow a HCMC project located partly outside administrative boundary to be reviewed.
- Every active filter is visible as a dismissible chip in the dashboard; saved presets can be chosen without opening the JSON file.

## 6. Acceptance - UI-only usability

1. Fresh user can add a website, set RSS/sitemap/sections, test parser, save, close and reopen; data persists.
2. Fresh user can add synonyms, one AND/OR/NOT group, a location/alias, and a custom time window using only controls; see correct matching explanation.
3. Fresh user can upload a PPTX template and export with a test article, without entering paths into JSON.
4. User can locate any user-facing setting by name and edit it in UI, including advanced network, scanning and completeness bounds.
5. Invalid URLs, conflicting rules and bad dates are blocked with useful Vietnamese messages.
6. User can undo/revert an accidental change; importing config never destroys existing settings without confirmation.
7. Automated UI tests (e.g. Playwright) cover create/edit/delete sources, filters, location, range, template and persistence.

**Reject the implementation if the engineer writes "edit settings.json manually" as required operating instructions.**
