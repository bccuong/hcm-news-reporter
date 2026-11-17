# PROGRESS — News Reporter (formerly HCM News Reporter) (Claude Code)

## Current status
- Specification: v1.2
- Milestones: **M0 DONE · M1 DONE · M2 DONE · M5 DONE (original template; PDF via Microsoft PowerPoint or LibreOffice, visually inspected)** · M3/M4 mostly done · M6 partial
- Repository: https://github.com/bccuong/news-reporter (renamed from hcm-news-reporter on 15/11/2026; branch `main`, public) · Live site: https://bccuong.github.io/news-reporter/ (real data, hourly auto collection switchable on the web + on-demand "Thu thập")
- Last session: 2026-11-16 (session 13) – hourly cloud runs continue the published period; label evaluation fixed
- The user (GitHub `bccuong`) has authorised commits/pushes to this repo and GitHub Pages/Actions for this project.

## ▶ RESUME HERE (session 14a – minimal, icon-led web UI; 2026-11-17)
- User: lines still wrapped; wants a minimal, professional, mostly visual UI that non-technical people understand.
- Top bar on one line: logo + title (settings subtitle), profile pill with map pin, status dot (live/demo/offline, full sentence in title + sr-only, testid live-banner), avatar chip for the reviewer with logout icon, icon buttons for login/settings (aria-labels kept). Long banner removed.
- Window card: rounded preset pills, compact window chip "17:00 16/11 → 08:00 17/11" (testid window-range) opening the date/time editors on demand (always open on Tùy chỉnh), saved-runs pill with history icon, Thu thập. Timezone text removed (tooltip). z-20 so the run list is never covered.
- Automatic strip: switches 08:00 / 16:30 (real checkboxes underneath), "Tiếp: 16:30 17/11", server dot. Metrics row removed (counts are on the tabs; link/duplicate/error totals in Độ phủ & nguồn).
- Motion: fade-up on appearing cards (fill backwards, no stacking context left), hover lift on source tiles, pulsing live dot; reduced-motion respected. Page background slate-50, rounded-xl cards.
- Tests: vitest 143/143, playwright 11/11, live 8/8. Screenshots checked at 1280 px and 390 px.

## (history) Session 13z – 4 tabs, Hạ tầng/Đầu tư công/Chính sách only for Xây dựng or Giao thông; 2026-11-17)
- Tabs: "Sổ ứng viên" removed from the main tabs; every discovered link (state + reason, "Thực ra liên quan?") stays at the end of "Độ phủ & nguồn" (folded, data-testid all-links) – no silent omission. Tabs restyled (segmented bar, icons, colour count badges; aria-label "Bài sẵn sàng (21)").
- Classifier: INFRA, INVEST, POLICY requiresCategories = BUILD/TRAFFIC (INDUSTRY_CODES); saved configs upgraded once (requiresRev 2), later choices kept. Real data replay (271 + 284 stories): ready 21→21 and 9→7 (2 off-topic removed), no on-topic story lost; applies to periods as they are (re)collected.
- Filter-quality card now refreshes after a save completes (was refreshing on the optimistic update).
- Tests: vitest 143/143, playwright 11/11, live 8/8.

## (history) Session 13y – fixed collection times replace the hourly run; 2026-11-17)
- User: instead of "Tự động thu thập mỗi giờ", two ticks per profile: 08:00 → 17:00 yesterday..08:00 today; 16:30 → 08:01..16:30 today.
- src/domain/schedule.ts (slots, windows, due check, next run) shared by worker + web. Worker cron now every 5 min (wrangler.toml); outside 08:02–10:00 / 16:32–18:30 it returns without KV; inside it dispatches pages.yml with trigger=schedule, slot, from/to, profile – one profile per tick, once per profile/day (KV sched:<pid>:<slot>:<date>, TTL 3 days), busy server → next tick retries. POST /auto now {slot, enabled}. Profile.schedule {morning, afternoon}; old hourly autoCollect no longer used by the cron.
- pages.yml: run-name "Thu thập theo lịch 08:00: …", input slot → cloud-collect --scheduled (note "Thu thập theo lịch 08:00", index day.scheduled); web run chip "lịch 08:00"; banner shows the ticked times.
- Windows join without a gap (user 17/11): morning 17:00 → 08:01 (includes the minute 08:00), afternoon 08:01 → 16:30.
- Tests: vitest 137/137 (worker: windows, once per day, busy retry, per profile), playwright 11/11, live 8/8.

## (history) Session 13x – ↑/↓ in Xuất báo cáo did nothing; 2026-11-16)
- Cause: "Chọn tất cả" gave every story the SAME order (Date.now() in one ms; touched stories also kept order 0) → swapping equal numbers changed nothing; and ↑/↓ swapped with the neighbour in the whole list, i.e. across groups at group edges.
- Fix: bulk select gives each story its own order (base + position); ↑/↓ work inside the group shown and renumber that group (one batched save on the web); ends of a group are greyed; ties broken by articleId on screen and in the report (src/reports/assemble.ts).
- Tests: vitest 136/136, playwright 11/11 (new: select all → ↓ / ↑ in Xuất báo cáo), live 8/8.

## (history) Session 13w – slow clicks on the web; 2026-11-16)
- Measured: rendering 2–23 ms (not the cause); each review-worker request 0.3–1.2 s from the user's network. "Chọn tất cả" saved story by story (await in a loop) → N × latency, boxes ticking one by one; "Thu thập" showed nothing until the worker + GitHub answered.
- Fix: worker POST /review accepts {items:[{articleId,patch}]} (≤300, all validated, one KV read + one write); web api.queueTeamReview batches every change made in the same tick and keeps ONE batch in flight per period (no self-overwrites); bulk select / merge run in parallel (all boxes change at once, one request); local copy re-read before saving; same error toast shown once; "Thu thập" shows "Đang gửi…" immediately.
- Measured after (350 ms simulated latency): select all ticked in ~55 ms with 1 POST; Thu thập reacts in ~54 ms.
- Note: KV free plan also limits writes to 1,000/day – batching reduces writes too.
- Tests: vitest 136/136 (worker batch: one put, merge, all-or-nothing validation), playwright 11/11, live 8/8.

## (history) Session 13v – "Lượt đã lưu" picker + delete; "Kỳ gần nhất" = latest run; 2026-11-16)
- RunPicker (web/src/App.tsx): compact labels ("16/11 · 08:01–16:30", "15/11 17:00 → 16/11 08:00") + chip (tự động / requester / đang diễn ra / status), newest first, current ticked, trash per row. Local: DELETE /api/runs/:id (stores.deleteRun; refused while running; exports kept). Web: reviewer hides a run for the whole team via worker POST /runs/hide (KV `hid:<profile>`, one get via GET /runs/hidden, public); "Lượt đã xoá (n)" › Khôi phục. Not logged in: no delete (greyed icon with hint).
- "Kỳ gần nhất" button now opens the most recent run (latestRun) instead of a computed 17:00→08:00 window; the most recent run shows "Kỳ gần nhất" highlighted. Without any run: the last completed window as before.
- Worker deployed d818872b. Tests: vitest 135/135 (worker hide/restore; server DELETE run), playwright 11/11, live 8/8 (compact label, Kỳ gần nhất, delete hidden for another browser, restore).
- Next: after 07:00 check the 16/11 shared decisions came back (see 13u).

## (history) Session 13u – F5 "Failed to fetch" = Cloudflare KV list() quota; publisher name → home page; 2026-11-16)
- Root cause (wrangler tail): "KV list() limit exceeded for the day" – the free plan allows 1,000 list()/day and every page load listed the period's reviews (GET /review) and the day's votes (GET /labels). The worker threw (1101) without CORS headers → browser "Failed to fetch".
- Fix (cloud/review-worker/src/handler.ts, deployed f0b63bcd): one aggregate KV value per period `rva:<profile>:<period>` and per day `la:<date>` → reads = ONE get, no list(). Old per-article keys are merged once when list() is available (`legacy` flag; while the quota is gone the answer carries `pending` and the merge is retried on a later read). Writes: read-merge-write of the aggregate (labels still keep their per-key record for the nightly /export). Config-history pruning tolerates a failed list(). Any unexpected error now answers JSON WITH CORS headers (503 + reason for quota errors).
- Known: decisions saved before the fix for the current period reappear after the daily quota reset (00:00 UTC = 07:00 VN). Concurrent edits of the same period by two reviewers within the same instant can overwrite each other (KV has no transactions).
- UI: the publisher name in "Nguồn tin trong kỳ" opens the source's home page (origin of baseUrl, new tab, noopener); the rest of the tile still opens "Chi tiết độ phủ".
- Tests: vitest 134/134 (worker: list-free reads under quota, legacy merge, CORS on error), playwright 11/11, live 8/8.
- Next: after 07:00 check that the earlier "duyệt chung" decisions of 16/11 are back (GET /review without "pending").

## (history) Session 13t – built-in PDF, one file name, pptx+docx ticked; 2026-11-16)
- User: Word file name = PowerPoint file name; .pptx + .docx ticked by default; "implement luôn library xuất pdf riêng".
- Names: web no longer appends the design id; the old docx regex cut the name to "HCM.docx". Local + web: <base>.pptx / .docx / .pdf share one stem (local keeps its _stamp on all three).
- Defaults: the shared web config had saved outputFormats [] → settings rev 3 re-ticks pptx+docx once (later choices kept); 'auto' PDF renderer → 'builtin'.
- src/reports/pdf.ts (pdf-lib + @pdf-lib/fontkit, MIT; font Tinos, SIL OFL, web/public/fonts + OFL.txt): A4 document like the Department's Word report – letterhead, title, window, counts bar chart, I/II/III groups, real photos beside the text, clickable source links, "Đề xuất" boxes, reply e-mail, footer "Trang x/y"; group heading kept with its first story; stories kept on one page when they fit; non JPEG/PNG photo → note + text layout. Runs locally (no Office) and in the browser. PowerPoint/LibreOffice conversion still selectable (Cài đặt › Báo cáo & mẫu › Bộ xuất PDF).
- Visual QA: Windows.Data.Pdf PNG render (scratchpad pdf2png.ps1) – 2 pages, Vietnamese diacritics correct.
- Tests: typecheck, vitest 132/132 (tests/pdf.test.ts; server export pptx+docx+pdf share a name), playwright 11/11, live 8/8 (web: names equal, .pptx/.docx ticked, .pdf built in the browser with the photo).
- Next: export a real collection to PDF and compare against the .docx side by side.

## (history) Session 13s – 4 PPTX designs reworked; 2026-11-16)
- User: the 4 app designs were sparse/disconnected. Rewrote src/reports/styles.ts: measured flow layout (no fixed 2 stories/page), cover with counts + headlines + photo, continuous groups with inline headings, 2 columns on 16:9, balanced last page, Đề xuất boxes, Kiến nghị table + totals; Ảnh lớn = photo page only for stories with a real photo. Template descriptions updated (src/reports/templates.ts).
- Chose original designs over third-party free templates (licence/attribution on public repo).
- Tests: typecheck, vitest 130/130, playwright 11/11, live 8/8; visual QA via PowerPoint PNG export (5/4/5/7 slides for 11 stories, no overlap).
- Next: check the new designs on a real collection with real photos (long titles/sapo) and tune glyph widths if any text overflows.

## (history) Session 13r – Word export from the Department .docx template; 2026-11-16)
- User supplied "Tổng hợp Điểm tin Báo chí sáng ngày 16.11.2026.docx" and asked for a .docx export ticked by default like .pptx.
- Template published as `web/public/templates/so-xay-dung.docx` (personal names removed from docProps; content = public news). `src/reports/templateDocx.ts` (`buildDocxFromTemplate`, Node + browser): keeps letterhead table, styles, numbering, header/footer, closing note, signature; rebuilds the body by cloning the template's own paragraphs (group heading, story heading with its ☹/😐 Wingdings symbol, summary, hyperlink, "Đề xuất" bold-underlined); dates the letterhead + title ("NGÀY dd/mm/yyyy", no "SÁNG"); one real hyperlink per source; contact e-mail from settings; the template's STATIC chart picture of another day is replaced by a real Word chart (literal data) of this report's counts; unused sample hyperlinks + picture removed; structural mismatch → BLOCKED (`DocxTemplateMismatchError`).
- Export: formats pptx | docx | pdf (local server writes the .docx next to the .pptx; the web builds it in the browser and downloads it; PowerPoint is skipped when only Word is ticked). `report.outputFormats` default ["pptx","docx"]; saved configs with the old ["pptx"] get "docx" once (`outputFormatsRev`). Checked visually (LibreOffice PNG) and opened in Word (2 pages, 1 chart, 5 links).
- Tests: typecheck, vitest 130/130 (tests/docx.test.ts), playwright 11/11 (.docx produced with both merged sources), live E2E 8/8 (.docx downloaded with the story).
- Next: rework the 4 original PPTX designs (user: slides sparse / disconnected).

## (history) Session 13q – open the latest collection; Từ/Đến follow the picked run; 2026-11-16)
- User: F5 selected "Hôm nay" instead of the most recent collection; Từ/Đến should follow the run picked in "Lượt đã lưu".
- Done (web/src/App.tsx): startup opens `latestRun()` (latest finish time); the default window preset only applies when there is no collection yet (Settings label updated). An effect on the shown run fills Từ/Đến from its window and highlights the matching preset (Kỳ gần nhất / Hôm nay / Hôm qua / Tùy chỉnh) – for the picker, startup and finished collections.
- Tests: typecheck, vitest 127/127, playwright 11/11, live E2E 8/8 (new: "F5 opens the most recent collection…").

## (history) Session 13p – cover without "SÁNG", suggested units for "Tồn tại", feed-date trust; 2026-11-16)
- User: the cover must not say "SÁNG NGÀY" (any window can be reported) → "NGÀY dd/mm/yyyy" in the Skill template (incl. dated layout/master footers) and the 4 designs.
- User: proposals for "Tồn tại cần khắc phục" follow the Sở guidance → `settings.editorial.assignmentRules` (6 default groups: mưa bão/ngập/thoát nước/cây xanh → P. Hạ tầng kỹ thuật + TT QL giao thông và HTKT; ùn tắc/kẹt xe → TT QL điều hành giao thông đô thị; huy động vốn/nhà ở hình thành trong tương lai → P. Phát triển đô thị; chất lượng/hư hỏng/xuống cấp/sụp đổ → P. QL chất lượng công trình; sai phép/trái phép/không phép → P. Kiểm tra chuyên ngành; mặt đường/ổ gà → P. Bảo trì và Khai thác CTGT) + fallback sentence. `suggestAssignment` (src/domain/assignment.ts: title keyword 3, sapo 1, strongest group). Used by the report when the editor wrote no proposal; Inspector shows the suggestion with its evidence and "Dùng gợi ý"; rules editable in Cài đặt › Báo cáo & mẫu. Recommendation slide lines capitalised ("Giao Phòng …"). Rendered with the Skill template and checked as PowerPoint PNGs.
- Collector: (a) a feed date read later (parser fix) is taken for links seen again in a continued run; (b) feed dates trusted per publisher once ≥ 5 stories read in the run match their page time (≤ 10 min) → links dated outside the window are recorded FEED_DATE_CONFIRMED without download.
- Tests: typecheck, vitest 127/127 (tests/assignment.test.ts, feed-date trust, cover text), playwright 11/11, live E2E 7/7.

## (history) Session 13o – why every publisher hit its limit; 2026-11-16)
- User: in the on-demand run 08:01 → 14:00 16/11 Thanh Niên, VnExpress, Dân trí all "chạm giới hạn tải". Live analysis showed two real causes (not a limit too low):
  1. **Bug:** Thanh Niên RSS pubDate uses a two-digit year ("Mon, 16 Nov 26 14:20:00 +0700") → `parsePublisherDate` returned null → all 151 RSS links undated → every story downloaded to learn its date. Fixed (RFC 822 two-digit year → 20yy); test in tests/domain.test.ts.
  2. Undated links from deep listing pages (up to 30 pages per section) – e.g. VnExpress spent 144/150 downloads on them. Now undated links are read newest publisher id first and, after `collection.undatedStopAfterOld` (default 8, Cài đặt › Hiệu năng; 0 = off) consecutive stories verified older than the window, the remaining undated links with smaller ids are recorded outside_window / OLDER_THAN_CHECKED without download ("Thử lại" still fetches). Test "links without any date" in tests/collector.test.ts.
- Tests: typecheck, vitest 117/117, playwright 11/11, live E2E 7/7.

## (history) Session 13n – 24-hour time fields; 2026-11-16)
- User: the window pickers showed AM/PM (browser datetime-local follows the OS locale). Replaced by `DateTime24` (web/src/App.tsx): native date picker + hour 00–23 + minute 00–59 selects, same "YYYY-MM-DDTHH:mm" value. Tests use `setWindowField()`; UI-06 checks 24 hour options. Tests: typecheck, vitest 114/114, playwright 11/11, live E2E 7/7.

## (history) Session 13m – per-publisher article limit; VnExpress 150; 2026-11-16)
- User: only VnExpress still "chạm giới hạn tải". Live analysis of 2026-11-16: 149 links pending – 78 RSS-dated but all OUTSIDE the window (within the 6 h verification margin or after the window end), 71 undated from deep listing pages (/bat-dong-san/chinh-sach-p3 …, weeks old). In-window VnExpress stories were already read; publisher ids in URLs are NOT safe to date stories (a 16/11 00:00 story had an old id).
- Done: `crawlLimits.perRunArticles` (Sửa nguồn › "Số bài tải tối đa mỗi lượt cho báo này"; empty = shared limit) overrides the shared 50/publisher; undated links are fetched newest publisher id first. Saved web config: VnExpress = 150. First refresh still fetched only ~50: the saved VnExpress `maxArticleFetches` was 50 (set earlier in the UI) and capped the new value → the publisher's own limit now decides (`maxArticleFetches` only caps the shared limit; shown as "Mức trần khi dùng giới hạn chung" when the own limit is empty).
- Tests: typecheck, vitest 114/114, playwright 11/11, live E2E 7/7.

## (history) Session 13l – source test/detect on the web; refresh a daily period; 2026-11-16)
- User: 2 sources "bóc tách suy giảm" (= the stale false flags of the frozen 2026-11-16 period, Thanh Niên + SGGP) and "Thử nguồn" said local-only.
- "Dò cấu trúc tự động" and "Thử thu thập" now work on the web: the collector's own discovery + extraction (src/collector/probe.ts) run in the browser; pages fetched through the review worker `GET /fetch?url=` (reviewers only; public http(s) pages only – private/local hosts and IP literals refused, redirects re-checked hop by hop, text/HTML/XML only, ≤ 3 MB, 15 s). Worker deployed (version aec9c21f); real check: Thanh Niên RSS 60 items, SGGP RSS 50 items. run.ts now imports EventEmitter as a type only (browser bundle).
- "Thu thập" with exactly the window of a published DAILY period refreshes that period in place (continued + re-classified) instead of creating a duplicate custom period – used to clear the stale flags of 2026-11-16.
- Still local-only on the web: per-source re-scan of a period ("Thử lại"/"Mở rộng quét" in Độ phủ) – use "Thu thập" for the window.
- Tests: typecheck, vitest 113/113 (worker proxy tests), playwright 11/11, live E2E 7/7 (new: web "Dò cấu trúc" + "Thử thu thập", screenshot docs/screenshots/web-source-test.png).

## (history) Session 13k – ONE team review on the web; 2026-11-16)
- User: results differed per machine – the web kept selection / Sẵn sàng / Loại / edits / merges in each BROWSER (localStorage). User chose "Dùng chung cả nhóm".
- Worker (deployed 2026-11-16 ~13:25 VN, version b17e0a27): `GET /review?profile&period` (public, like the published data), `POST /review` (access code + reviewer name) merges a patch into ONE decision per article per period. KV key `rv:<profile>:<period>:<articleId>`, compact decision in metadata (≤ 1 KB, one list per period), edited texts / photo URL in the value. Fields validated (`cleanReviewPatch`); `by`/`at` recorded. Tests in tests/review-worker.test.ts.
- Web (api.ts): `review()` = team decision (worker) + personal votes (✓/✗, note) from this browser; offline → last copy. `patchReview()` saves team fields to the worker first (login required – every web change now opens the login dialog without a session). First visit of a period with a session: decisions made earlier in this browser are shared once (never over the team's). App: team review refreshed every minute and on focus; each story shows "duyệt chung: <name> · <time>".
- Two real bugs found by the new two-machine E2E test and fixed: (1) concurrent run loads could show one period while saving to another → only the latest requested load is applied; (2) the web run id now always equals the listed period id (getRun), never the manifest's.
- Tests: typecheck, vitest 112/112, playwright 11/11, live E2E 6/6 (new: "web review is ONE for the whole team…", screenshot docs/screenshots/web-team-review.png). Local Windows app unchanged (its review is already one per run on the local server).

## (history) Session 13j – filter precision: other regions, place look-alikes, sports; 2026-11-16)
- User: review queue full of off-scope stories (miền Bắc, football, Hà Nội, Microsoft…). Causes found on the live custom period: (1) title names another province/region but the body mentions TP.HCM → counted as HCM; (2) place look-alikes ("giải thưởng/đường Hồ Chí Minh", "Sài Gòn - Hà Nội" bank, "đường sắt Hà Nội - TP HCM"); (3) VnExpress dateline glued to the sapo ("Hà NộiCầu…"); (4) place-less stories kept by ONE generic title word ("bồi thường", "xây dựng"); (5) sports wording not excluded; (6) REALESTATE keyword "thị trường" too generic.
- Done (all UI settings, Cài đặt › Địa điểm / Từ khóa / Lĩnh vực): `location.excludePhrases` (place look-alikes), other provinces/regions checked in title AND sapo – city absent from title/sapo → excluded NOT_GEOGRAPHICALLY_RELEVANT (regions miền Bắc/Trung, Bắc/Trung Bộ, Tây Nguyên added), glued words split before place detection, `location.noPlaceMinLeadScore` (default 4: title keyword 3 + sapo 1) for place-less stories, sector policy/law and `location.nationalSectorPhrases` (Bộ Xây dựng, ngành Xây dựng…) always kept for review, body safety net only with city evidence, sports/commodity title exclusions, REALESTATE "thị trường" → "thị trường bất động sản/nhà ở/căn hộ".
- Measured on the 3 live periods with the saved web config: review queue 31 → 12 (custom 15/11 17:00 → 16/11 11:45), 31 → 9 (16/11), 3 → 1 (15/11); NO team-labelled relevant story excluded; stories leaving "ready": hotels, flower villages, ready-built factories, consumer market (excluded with reason, visible in the ledger). Saved web config TP.HCM updated 12:14 VN by "Claude (theo yêu cầu của Cường)" (restorable). Published periods keep their old classification until re-collected.
- Tests: typecheck, vitest 110/110 (new regression cases), playwright 11/11, live E2E 5/5.
- Re-collecting the user's custom window after the settings change showed a design gap: a settings change made the next run start EMPTY, so the 50/publisher limit dropped stories already read (e.g. "Phường Chánh Hưng… thu hồi đất", team label relevant). Fixed (`seedFromPublished`): a changed settings hash no longer discards the period – stories already read are kept and RE-CLASSIFIED with the new settings (`stateFor` in src/collector/run.ts, shared with the collector; no download), URL-only exclusions are re-triaged, and on-demand re-collections of the same window continue too. Real dry run on the user's period: 211 kept → 283, 0 lost, ready 17, review 19 (was 31), no labelled-relevant story excluded. Remaining: "7 cây cầu mới… hai bờ sông Hồng" (Hà Nội) still ready.
- Note: SGGP returned NETWORK errors from the GitHub runner in the 12:22 run (transient).

## (history) Session 13i – newest first, default "Hôm nay", source tiles; 2026-11-16)
- Story lists sorted newest → oldest by publication time (unknown time last), toggle "Mới nhất trước / Cũ nhất trước" (`sort-toggle`).
- Default window preset = "Hôm nay" (schema default; saved web config TP.HCM updated 11:58 VN by "Claude (theo yêu cầu của Cường)", restorable in history). On open the app shows the saved run of that window if one exists, otherwise the most recent run.
- Per-publisher strip redesigned as `SourceStrip`: card "Nguồn tin trong kỳ" (period, last run, đang chạy / đang diễn ra / kỳ đã chốt, link to Độ phủ) with one tile per publisher (status dot, ready count, links, stories read, warnings: bóc tách suy giảm / chạm giới hạn tải / lỗi); disabled sources summarised. Screenshot `docs/screenshots/bulk-select.png`.
- Tests: typecheck, vitest 100/100, playwright 11/11, live E2E 5/5 (fixed a test selector that matched publisher D's story first once sorted).

## (history) Session 13h – action row under each story; source-strip caption; 2026-11-16)
- User: buttons below each story instead of the right column → one row (Xem chi tiết · Bài gốc · ✓ Liên quan · ✗ Không · team votes · → Sẵn sàng / ↩ Trả về … Loại at the far right), `data-testid="story-actions"`.
- User: "per-publisher stats don't reset after each collection?" – they belong to the viewed period and its last run; period 2026-11-16 was frozen at 10:00, so its 09:59 numbers (incl. the false "bóc tách suy giảm" for Thanh Niên/SGGP, fixed in 6578f69 after that run) stay. Added a caption before the source chips: "Từng báo – kỳ … · lượt cuối … · đang diễn ra / kỳ đã chốt". Offered (not done): clean re-collection of 16/11 via web "Thu thập" (custom period).
- Tests: typecheck, vitest 99/99, playwright 11/11, live E2E 5/5.

## (history) Session 13g – remove ("Loại") stories, restore; 2026-11-16)
- User: a way to remove a story from Bài sẵn sàng. Added review field `excludedByEditor`: per-story "Loại" (both tabs, no login needed), bulk "Loại n bài đã chọn", section "Đã loại (n)" under each list with "Khôi phục". "✗ Không" (not relevant) now also removes the story (label kept for filter quality; restore clears the label). Removed stories leave the report too. Collected data is never deleted. Test "Remove (\"Loại\")…" (app.spec.ts), screenshot `docs/screenshots/excluded.png`. Fixed test flakiness: wait for the new run to start and finish before reading tab counts. Tests: typecheck, vitest 99/99, playwright 11/11, live E2E 5/5.

## (history) Session 13f – bulk select, move review → ready; 2026-11-16)
- User: no select/unselect all for the report; how to move a story from "Cần kiểm tra" to "Bài sẵn sàng"? Done in both article lists (`ArticleList`, web/src/App.tsx): bar "Chọn tất cả (n đang hiển thị)" (tri-state, follows search + sector filter, skips merged secondaries) and "Bỏ chọn tất cả"; in Cần kiểm tra a per-story "→ Sẵn sàng" button and "Chuyển tất cả / n bài đã chọn sang Bài sẵn sàng"; moved stories show "từ Cần kiểm tra" and "↩ Trả về". Stored as review field `promotedToReady` (local API + browser store). Export checks still apply (unverified publication time must be confirmed). Test "Bulk select / unselect all…" (app.spec.ts), screenshot `docs/screenshots/bulk-select.png`. Tests: typecheck, vitest 99/99, playwright 10/10, live E2E 5/5.

## (history) Session 13e – Settings as one profile tree; 2026-11-16)
- User: profile list and its details should sit together, simpler to configure. Settings nav is now ONE tree: "Cấu hình" → every profile; the open one expanded with Tổng quan (rename / copy / delete), Nguồn tin, Từ khóa & quy tắc, Địa điểm, Lĩnh vực, Thời gian, Chất lượng, Báo cáo & mẫu, Hiệu năng, Sao lưu & lịch sử; other profiles one click away (switch → reload → Settings reopen on the same section via sessionStorage key `reopenSettings`); "+ Tạo cấu hình mới" at the bottom. Screenshot `docs/screenshots/profiles-tree.png`. Tests: typecheck, vitest 99/99, playwright 9/9, live E2E 5/5.

## (history) Session 13d – "Chính sách, pháp quy" must be construction/transport; 2026-11-16)
- User: "Chính sách, pháp quy" picks wrong stories – must relate to construction and transport. Cause: its keywords (nghị định, luật, quyết định…) alone counted as sector evidence (e.g. "TP.HCM quy định mới về trường tiên tiến" = education → ready); and TRAFFIC "cầu" matched "yêu cầu"/"toàn cầu", so almost every story also looked like transport.
- Done (all UI settings, Cài đặt › Lĩnh vực, per profile): category `requiresCategories` (POLICY default = LAND/BUILD/INFRA/TRAFFIC/REALESTATE/FLOOD/INVEST, must appear in title/sapo, else "không tính" with evidence) and `excludePhrases` (TRAFFIC: yêu cầu, nhu cầu, toàn cầu…; BUILD: xây dựng Đảng, xây dựng chính quyền…). Saved configs without these fields get the defaults on load (`CATEGORY_FIELD_DEFAULTS` in schemas.ts). Safety net `rules.bodySectorScoreForReview` (default 5): no sector in lead but strong body evidence → review (SECTOR_ONLY_IN_BODY), never excluded. New default TRAFFIC keywords: đường bộ, đường thủy, sân bay, bến xe, cảng biển (not added to the saved TP.HCM config – user adds them in the UI if wanted).
- Impact on live 15–16/11 with the saved web config: 2 relevant→excluded (education decree ✓, Cà Mau specialties = team label irrelevant ✓), 3 review→excluded (incl. team label irrelevant ✓), road-network plan relevant→review (not lost). "cầu Thủ Thiêm" still traffic ("cầu thủ" deliberately not excluded); "Xây dựng khu phố văn minh" (team label relevant) unchanged.
- Saved web config TP.HCM updated 2026-11-16 10:49 VN (by "Claude (theo yêu cầu của Cường)", user gave the access code; restorable in Cài đặt › Sao lưu & lịch sử): TRAFFIC + đường bộ, đường thủy, sân bay, bến xe, cảng biển; POLICY requires the 7 sectors; exclude phrases; bodySectorScoreForReview 5. Sources unchanged. Also `KEYWORD_UPGRADES`/`keywordsRev` in schemas.ts: older saved keyword lists (e.g. local configs) receive new default keywords once; later removals are kept.
- Tests: typecheck, vitest 99/99, playwright 9/9, live E2E 5/5.

## (history) Session 13c – user feedback on Settings/export, false "degraded" fixed; 2026-11-16)
- **Regression from 13a, fixed (7649d00):** carried-over articles were republished with `extractionContainer: null` → next run read "(none)" → Thanh Niên / Dân trí / Báo Xây dựng falsely "bóc tách suy giảm", ready stories pushed to "Cần kiểm tra" (09:12 run: ready 4). Now carried-over articles are no evidence for this run's health check; a stale ADAPTER_DEGRADED downgrade is undone and re-assessed. Pushed 09:48, re-collected 09:49 before the 10:00 freeze: all 6 sources ok, ready 35, 202 articles. Test: "carried-over articles are not evidence of adapter drift".
- **User feedback (screenshot of web Settings):** (1) location/categories/keywords & rules should belong to one profile – they already were stored per profile, the UI did not show it → Settings header chip "Cấu hình: <name>", nav grouped "Tất cả cấu hình" / "Riêng cấu hình «<name>»". (2) "no Department PPTX at export" and (3) "4 templates not visible" – they were in a drop-down → export panel and Settings › Báo cáo & mẫu now show every template as a radio card (Skill template default + 4 designs + browser template if any); misleading "(chưa có – dùng bố cục demo)" text removed. Evidence: `docs/screenshots/web-settings-per-profile.png`, `docs/screenshots/web-export-template.png`.
- Tests: typecheck, vitest 91/91, playwright 9/9, live E2E 5/5 (run from PowerShell).
- **Second false "degraded" (09:59 run), fixed (6578f69):** Thanh Niên/SGGP had no newly fetched article in that run (all carried over) → no container known → compared against the baseline anyway. Container drift now needs ≥ MIN_SAMPLE articles with a known container (`src/collector/health.ts`, `tests/health.test.ts`). Verified live UI after deploy: export shows 5 templates (Skill default), Settings chip "Cấu hình: TP.HCM", group "Riêng cấu hình «TP.HCM»".
- **Known leftover:** period 2026-11-16 was frozen at 10:00 with 10 ready stories carrying a false ADAPTER_DEGRADED note (they are still listed and reviewable). Not hand-edited. If wanted: web "Thu thập" with 17:00 15/11 → 08:00 16/11 creates a clean custom period.
- **Next single action:** at 18:07 / 19:07 (period 2026-11-17 provisional) check `live/hcm/2026-11-17.json`: note "Tiếp nối lần đăng trước", all adapters ok/unknown (no "degraded" without evidence), article count non-decreasing.

## (history) Session 13 – hourly web runs no longer drop stories; 2026-11-16)
- Ran the recorded next step (evaluate team labels): `scripts/eval-shared-labels.ts` read the pre-profile path → fixed (`live/<profile>/<date>.json`, `--profile`, URL fallback for labels with an older article id, one vote per reviewer = latest).
- **Defect found:** 10 of 17 team-labelled stories were missing from the published period. Cause: every hourly GitHub run starts with an empty store; with the 50/publisher limit (session 12) an article extracted at 21:07 could become `retry_pending FETCH_LIMIT` at 06:07, or be gone from the ledger once it left the RSS feed. Article ids could also change for the same URL → labels orphaned.
- **Fix:** `seedFromPublished()` (scripts/cloud-collect.ts) loads the same period's published ledger + articles into the run store under the same run id when window and settings hash are unchanged → runCollection resumes: extracted stories stay (same ids), the limit is spent on links not fetched yet; manifest note "Tiếp nối lần đăng trước…". `extractionContainer` is now published; health ignores unknown containers.
- Verified: typecheck, vitest 89/89, real 2-pass dry run (119 → 166 articles, 0 lost, adapters ok). Settings hash is stable across runs on real data (3d4dc3c5 at 00:15 and 06:11).
- Label evaluation now: 17 labels, 1 reviewer, 6 scored stories, precision/recall 100% → too few to tune rules; 10 labels were on dropped stories (cannot be scored).
- Also (13b): a link whose URL is already the canonical page of a story extracted from another link (VnExpress "Điểm tin" feed links redirect to the newest edition) is now recorded `duplicate` (DUPLICATE_CANONICAL) without a fetch, instead of a false `retry_pending FETCH_LIMIT` gap (`src/collector/run.ts`; test "a link that is already the canonical page…", verified failing without the fix).
- Tests (13b): typecheck, vitest 90/90, playwright 9/9. Playwright must be run from PowerShell here – from the Git-Bash tool Edge closes at launch (environment only).
- Note: the user changed the web config at 2026-11-15 23:30Z, so the first hourly run after deploy is a fresh run (hash differs); later runs of the same period continue.
- Pushed by the user's instruction (14e3e50). **Verified live** (push run 43784529412, 2026-11-16 08:13 VN): period 2026-11-16 note "Tiếp nối lần đăng trước của kỳ này: giữ 126 bài đã bóc tách…", 163 articles published, ready 27, retry_pending 365 (was 510 at 06:11 before the fix).
- **Next single action:** after more team labelling (several days, ideally 2+ reviewers), `git pull` then `npx tsx scripts/eval-shared-labels.ts` → tune rules only if the MISSED / FALSE READY lists show a pattern; add regression cases to `tests/relevance.test.ts`.

## (history) Session 12 – profiles, templates, 50/source, Dân trí, rename to News Reporter)
- User asked (15/11/2026):
  - Dân trí on by default.
  - Max 50 articles per publisher, configurable.
  - Rename to "News Reporter" (web + folder).
  - Settings as PROFILES (TP.HCM default; create new or clone for Hà Nội, Đà Nẵng…).
  - Default template from the Skill plus 4 more, chosen at export.
- Decisions asked and answered:
  - Publish the Skill template publicly as the default (`web/public/templates/skill-so-xay-dung.pptx`; reference/ itself stays ignored).
  - 4 ORIGINAL designs (`src/reports/styles.ts`: hanh-chinh, ban-tin, toi-gian, anh-lon), visually QA'd via PowerPoint PNG export.
  - Each profile has its own data and its own hourly switch.
- Done:
  - `collection.maxArticlesPerSource` (default 50, in-window dated articles first). A real dry-run showed no in-window dated article cut.
  - Profiles:
    - local: `config/profiles/<id>/`; legacy config is copied into "hcm"; runs carry `profileId`.
    - worker: `cfg:profiles`, `cfg:config:<id>`, history per profile, `/auto` per profile; cron dispatches one run for all auto profiles.
    - cloud-collect: one run publishes every profile (`live/<id>/`, `live/profiles.json`), collects the auto ones or `--profile`.
    - web: profile picker in the header, Settings › Cấu hình (profile).
  - Template picker at export (local + web) and a default template in Settings.
- Tests: vitest 88/88, playwright 9/9, live E2E 5/5.

## (history) Session 11b – web made equal to local
- User: "web articles have no photos like local – find the differences and make them the same". Decisions asked and answered: full text → **publish publicly**; export → **template chosen from the user's computer (browser-only)**; settings → **apply to the server collector**.
- Done: photos (links only, loaded from the publisher like local), full text (`contentSections`; bodyText rebuilt in the browser), shared config in worker KV (`/config`, history, rollback) read by `cloud-collect.ts` via `REVIEW_API_URL`, browser export with the original template + real photos via worker `/img`. Tests: vitest 84/84, playwright 8/8, live E2E 4/4 (the template part runs only where reference/ exists). Worker deployed.
- Remaining local-only: detect/test source, per-source rescan (need direct network). PDF only via PowerPoint locally (web: open .pptx › Save as PDF).
- Periods published before this change have no photos/full text; new collections have them.

## (history) Session 11 – auto-collect on/off switch, server status visible
- User saw "Đang có một lượt thu thập chạy" with no visible progress (a push-triggered deploy run + a real test dispatch were running) and asked for a switch for the hourly auto collection.
- Done: hourly auto moved from GitHub `schedule:` (it had NEVER fired on this repo) to the worker's Cloudflare cron `7 * * * *` → `scheduledCollect` dispatches `pages.yml` with `trigger=auto` unless KV `cfg:auto` is off or the server is busy. Web: checkbox "Tự động thu thập mỗi giờ" (login required to change), public `GET /status` strip shows the running run (tự động / theo yêu cầu (tên) / cập nhật phần mềm) and disables Thu thập with the reason. Worker deployed (cron registered). Tests: vitest 82/82, live E2E 3/3.
- Verified for real before this change: GITHUB_TOKEN set; on-demand 17:00→19:00 15/11 from the real site succeeded (run 20:21→20:25), custom period published.
- Next: after the next :07, check `gh run list --workflow pages.yml` shows "Thu thập tự động hằng giờ" and `/status` lastAuto=dispatched.

## (history) Session 10 – web "Thu thập" with from/to
- Web uses the same window controls as local; "Thu thập" → worker `POST /collect` → dispatches `pages.yml` (from/to/requested_by) → `cloud-collect.ts --from --to` publishes a "custom" period → page polls `/collect/status` and opens it. Max 72 h, one at a time, login required. GITHUB_TOKEN = fine-grained PAT (this repo, Actions R/W) stored as worker secret.

## (history) Session 9 – shared review is LIVE
- Review worker deployed: https://hcm-news-review.bccuong.workers.dev (health 200; real access code accepted, wrong code 401; export token OK). GitHub variable `REVIEW_API_URL` + secret `EXPORT_TOKEN` set.
- Real-site check (2026-11-15 ~19:50): login with the real code on https://bccuong.github.io/hcm-news-reporter/, vote on a real article shown immediately, no console errors; test votes removed (store = 0 labels).
- Fixes found by the real check: secrets set via a shell pipe had a trailing newline (worker now trims); KV list() is eventually consistent (UI shows own vote immediately, refreshes team votes every 2 min).
- `labels.yml` ran manually: success, `labels/labels.json` created (0 labels).
- The access code is NOT in the repo; it was saved for the user in the local file `review-secrets.txt` (session scratchpad, user opens it themselves – printing it from a tool was blocked). If lost, set a new one. Rotate: `cd cloud/review-worker; npx wrangler@3.112.0 secret put ACCESS_CODE` (pipe the value from Node or type it; worker trims whitespace).

**Next single action:** after reviewers have labelled a few days, `git pull` then `npx tsx scripts/eval-shared-labels.ts` → tune rules/keywords from MISSED / FALSE READY / sector & assessment fixes / notes, add regression cases to `tests/relevance.test.ts`, push.

## (history) Session 8 stopped on a user action
Goal of the user: ONE web version on GitHub; experienced reviewers open a link, log in (name + shared access code), label collected articles; labels are gathered centrally so Claude can make the collector more accurate.

Done and pushed: Cloudflare Worker code `cloud/review-worker/` (KV namespace created, id in `wrangler.toml`; secrets `ACCESS_CODE` + `EXPORT_TOKEN` already uploaded to the Worker), web login/votes UI, nightly `labels.yml`, analysis script. Read `cloud/README.md`.

**Blocked on:** Cloudflare account (chicuong.tanbinh's account, id `5c0a44e10fb8be13f57f5fd0ea4a62c5`) has no `workers.dev` subdomain. The user must register it once at https://dash.cloudflare.com/5c0a44e10fb8be13f57f5fd0ea4a62c5/workers/onboarding (suggested name `bccuong`). Claude must NOT read the wrangler OAuth token to do it via API (that was denied).

Then, in order:
1. `cd cloud/review-worker; npx --yes wrangler@3.112.0 deploy` → note the URL `https://hcm-news-review.<subdomain>.workers.dev`; check `GET <url>/health`.
2. Secrets: the generated values were saved OUTSIDE the repo in the session scratchpad file `review-secrets.txt` (may be gone after reboot). If missing, generate new ones and re-run `npx wrangler secret put ACCESS_CODE` / `EXPORT_TOKEN` (pipe the value; never commit or print it in logs/commits).
3. GitHub: `gh variable set REVIEW_API_URL --body "<worker url>" -R bccuong/hcm-news-reporter` and `gh secret set EXPORT_TOKEN -R bccuong/hcm-news-reporter` (same value as the Worker secret).
4. `gh workflow run pages.yml -R bccuong/hcm-news-reporter` → wait for success → open the site, check "Đăng nhập duyệt tin" appears; log in with the real ACCESS_CODE, label one article, verify `GET <url>/labels?date=…` (header `x-review-code`) returns the vote; then remove that test vote (POST same article with label null).
5. `gh workflow run labels.yml` → check `labels/labels.json` is committed with pseudonymised reviewers.
6. Give the user: link + access code (privately) + the short reviewer guide from `cloud/README.md`.
7. After reviewers have labelled some days: `npx tsx scripts/eval-shared-labels.ts` → tune rules/keywords (`src/domain/defaults.ts`, `relevance.ts`) with regression tests, push.

Optional offered to the user (not decided): official PPTX export on the web by storing the private template in the Worker behind the access code.

## Assets
See `docs/ASSET_INVENTORY.md`. Template integration: `docs/TEMPLATE_INTEGRATION.md`. Tools on this PC: Node 26, Git, gh (logged in as bccuong; `gh auth setup-git` done), **LibreOffice**, **Microsoft PowerPoint** (Office16, used for PDF), Microsoft Edge (Playwright locally), Cloudflare wrangler via `npx wrangler@3.112.0` (logged in). Python not installed (not needed). PowerShell 5.1: write commit messages to a file and use `git commit -F` (inline quotes break).

## Session 8 – done (with evidence)
- Shared team review: `cloud/review-worker` (Cloudflare Worker + KV, shared access code, CORS to Pages only, one vote per reviewer per article, `/export` bearer token); Pages app reviewer login, vote counts per card, review note, team-majority quality card; `.github/workflows/labels.yml` nightly pull → `labels/labels.json` (HMAC pseudonyms); `scripts/pull-labels.ts`, `scripts/eval-shared-labels.ts`; live-mode E2E with a local stand-in worker (`playwright.live.config.ts`, two reviewers).
- Playwright: 10 s expect timeout, trace on failure, 1 retry on CI (one load-related flake of the DIS-08 UI test observed, then 2 clean runs).
- Commands: tsc 0 · vitest **76/76** · playwright **8/8** · live review E2E **1/1**.

## Session 7 – done (with evidence)
- **Editor feedback loop for the filter** (`src/domain/quality.ts`): per-article `relevanceLabel` (✓ Liên quan / ✗ Không on ready & review cards; "Thực ra liên quan?" on excluded ledger rows); articles put into a report count as relevant implicitly. `GET /api/quality/relevance` + "Chất lượng bộ lọc" card on the coverage tab: precision of the Ready tab, recall incl. stories rescued from "excluded", list of wrongly excluded stories with the rule that excluded them, false-ready list. `scripts/eval-editor-labels.ts` aggregates labels across stored runs.
- Note: the 15 labels currently in local data come from Claude's QA selections (included=true), not editor decisions. On the public site labels stay in the viewer's browser only.
- Commands: tsc 0 · vitest **71/71** · playwright **8/8**.

## Session 6 – done (with evidence)
- **Relevance precision** measured on the labelled live sample (`tests/fixtures/relevance-labels-2026-11-15.json`, 64 in-window articles, labels by Claude per Skill criteria – editor to review) with `scripts/eval-relevance.ts`:
  ready precision **0.56 → 0.80**, review queue **37 → 6**, relevant excluded **0** (recall 1.00).
  Rules (all editable in Settings): sector keyword required in title/sapo (`NO_SECTOR_IN_LEAD`); no HCM evidence at all → excluded (`NO_HCM_EVIDENCE`) unless the title has a clear sector keyword (→ review); HCM only in body with <2 places → review (`HCM_ONLY_IN_BODY`); sports/price exclude phrases; "mưa lớn", "công trường" keywords.
- Cross-check on 16/11 live data (different day): both HCMC rain/flood stories kept, 17 off-topic excluded with reasons.
- Regression tests `tests/relevance.test.ts` (7 relevant never excluded, 7 irrelevant with expected reason, settings toggle).
- Commands: tsc 0 · vitest **68/68** · playwright **7/7**.

## Session 5 – done (with evidence)
- **Live public site** (user decision: GitHub Pages auto-updating hourly): `scripts/cloud-collect.ts` runs the real collector on GitHub Actions (`.github/workflows/pages.yml`, cron `7 * * * *` + push), publishes a redacted dataset (titles, links, sapo ≤300 chars, ledger, coverage, adapter health, clusters – no full text, no publisher photos) to `live/`; previous days + adapter baseline carried over from the deployed site; last completed window frozen 2 h after it ends. Pages UI switches to read-only LIVE mode (period selector, last-update banner, 5-min refresh). Tests moved to `.github/workflows/ci.yml`. First cloud run: all 5 sources reachable from GitHub runners (16/11 in-progress 1238 links, 15/11 1223 links).
- **SGGP adapter:** all 14 `ARTICLE_BODY_MISSING` were video pages (cms-body with `figure.video`, or "short video" feed with no h1). Extractor now recognises video/podcast articles → `parsed_partial` with `MEDIA_ARTICLE` (title, sapo, verified time kept); adapter health ignores media partials; SGGP print-edition pages excluded by URL pattern. Live run: parse_failed 14→**0** (all sources 0), SGGP failure rate 24%→**12%**, 15 video stories kept.
- Tools: `scripts/inspect-page.ts <url>` (container diagnosis), `scripts/shot-pages.mts` (Pages screenshot).
- Commands: tsc 0 · vitest **52/52** · playwright **7/7** · cloud run on GitHub ✓ · live run 1235/1235 accounted.

## Session 4 – done (with evidence)
- **DIS-08 adapter-degraded detection** (`src/collector/health.ts`): per source and run – fetched, parse failures, partial, unknown dates, main body container; compared with ≤3 previous HEALTHY runs. Degraded (failure rate +25 pts & ≥30%, or main container changed, or ≥50% failing with no history) → articles lose automatic "complete" (`ADAPTER_DEGRADED` warning), ready items go to the review queue, run marked incomplete, coverage tab shows reasons + recovery steps (open source settings, rescan). Degraded runs never become the baseline.
- **Same-event clustering rewritten** (`src/domain/cluster.ts`): union-find (no split clusters), title Jaccard + IDF-weighted title+sapo overlap with mutual-best guard (no chaining), time limits, generic titles ignored. Live 15/11 run: 19 multi-publisher events; the "6 quân nhân" event now 1 cluster of 4 publishers (was split in 2); the 24-article false mega-cluster from the first draft eliminated.
- Live baseline recorded for 5 real sources (all "ok"; SGGP 24% failure baseline – known special layouts).
- Commands: `npx tsc` 0 errors · `npx vitest run` **47/47** · `npx playwright test` **7/7** (incl. DIS-08 UI) · `npx tsx scripts/eval-clusters.ts` · `scripts/live-run.ps1` 1226/1226 accounted.

## Session 3 – done (with evidence)
- **Multi-source stories (DIS-06):** `groupId` merge model in `src/reports/assemble.ts` (one level, chronological sources, one per publisher, photo fallback from merged article, unverified merged source excluded with warning); UI "Nguồn cùng sự kiện" panel in Article Inspector + Export tab (suggestions from title clustering, manual pick, split). Template renders `Nguồn: A | B` with a hyperlink per publisher.
- **Microsoft PowerPoint verified:** exported PPTX opens via COM without repair; PowerPoint is now the preferred PDF backend (`auto`), LibreOffice fallback.
- **Overflow fixed for real:** cover/recommendation summary lists fitted to box ("… và N tin khác") – found from PowerPoint render.
- Default cover label cut at word boundary ≤42 chars; bug fixed in source ordering (in-place sort lost merged sources).
- Fixture publisher D (same event as A) for deterministic merge tests.
- Commands: `npx tsc` 0 errors · `npx vitest run` **42/42** · `npx playwright test` **6/6** · real-data QA: 14 cross-publisher clusters found in the 15/11 run; render check PDF by PowerPoint inspected.

## Session 2 – done (with evidence)
- Original-template PPTX renderer `src/reports/templatePptx.ts` wired into export (falls back to labeled DEMO only when no template uploaded; mismatching template → BLOCKED/422).
- Real-photo pipeline: jpeg/png only, magic-byte + dimension checks, cover-crop, TC feature photo = second photo of the same positive article.
- PDF via LibreOffice; visual QA of a real 15/11/2026 report; 5 renderer defects found & fixed.
- Precision: weak sector evidence → review queue (`WEAK_TOPIC_EVIDENCE`).
- Playwright UI tests (6) clicking real controls + reload persistence; screenshots in `docs/screenshots/`.
- Server crash fixed (SSE write-after-end), optimistic review updates, CI runs UI tests.

## Commands executed and results (session 2)
- `npx tsc -p tsconfig.json --noEmit` → 0 errors
- `npx vitest run` → **38/38** (template tests run locally only – private template not in repo, skipped in CI)
- `npx playwright test` → **6/6** (Edge locally)
- `scripts/live-run.ps1` → 1221 candidates, 1221 accounted, 41 ready (before WEAK_TOPIC change)
- `npx tsx scripts/qa-template.ts <template>` → PPTX + PDF ok, inspected

## Acceptance gates
| Gate | Status | Evidence |
|---|---|---|
| M0 | DONE | docs/ASSET_INVENTORY.md |
| M1 | DONE | server tests + Playwright UI-01/03/04/05/06/07 |
| M2 | DONE | collector fixtures + live runs |
| M3 | IN PROGRESS | coverage/retry UI done; DIS-08 (adapter degraded detection) missing |
| M4 | IN PROGRESS | manual merge/split of same-event groups, multi-source stories missing |
| M5 | DONE (local) | template PPTX + LibreOffice PDF visually inspected; MS PowerPoint not verified |
| M6 | PARTIAL | CI typecheck+unit+UI+Pages; Windows launcher scripts; no packaged installer |

## Known issues
- VnExpress: 120 `retry_pending` at default 300 fetches (no URL date) – use "Mở rộng quét" or raise limit.
- SGGP: ~16 `ARTICLE_BODY_MISSING` (special layouts) – adapter needed.
- Default topic rule is still broad; borderline stories (e.g. sport events of the construction sector) reach "ready" – reviewer decides.
- Long short-labels overflow cover/recommendation list boxes → warned, not auto-fixed.
- Demo (GitHub Pages) still uses the DEMO renderer: the Department template is private and not published.

## Next single executable action
After the editor has labelled 1–2 weeks of runs in the local app: `npx tsx scripts/eval-editor-labels.ts`, review the MISSED list (rule that wrongly excluded each story) and adjust keywords/rules in Settings; optionally add a "Tải nhãn đánh giá" export on the public site so labels made there can be merged.

## Session handoff log
| Session date | Changes made | Tests actually run | Next action |
|---|---|---|---|
| 2026-11-15 (1) | M0–M2, UI, API, demo Pages, live run | tsc, vitest 33/33, build, live | UI tests, template |
| 2026-11-15 (2) | Original template renderer, LibreOffice PDF + visual QA, Playwright UI tests, server crash fix | tsc, vitest 38/38, playwright 6/6, live run + template export | Multi-source stories |
| 2026-11-15 (3) | Multi-source stories, PowerPoint verification + PDF backend, list-fit fix | tsc, vitest 42/42, playwright 6/6, PowerPoint render QA | DIS-08 degraded adapter |
| 2026-11-15 (4) | DIS-08 adapter health + UI, clustering rewrite (union-find, IDF, mutual-best) | tsc, vitest 47/47, playwright 7/7, live run, cluster eval | SGGP adapter |
| 2026-11-15 (5) | Live GitHub Pages (hourly cloud collection), SGGP video articles | tsc, vitest 52/52, playwright 7/7, cloud run, live run | Relevance precision |
| 2026-11-15 (6) | Relevance precision rules + labelled evaluation + UI settings | tsc, vitest 68/68, playwright 7/7, eval 15/11 + cross-check 16/11 | Editor feedback labels |
| 2026-11-16 (13) | Hourly cloud carry-over (no dropped stories), label eval per profile, health container fix | tsc, vitest 89/89, real 2-pass dry run | Check notes after 2 hourly runs; more labels |
| 2026-11-15 (7) | Editor relevance labels, filter-quality card + endpoint + script | tsc, vitest 71/71, playwright 8/8 | Use labels to tune rules |
