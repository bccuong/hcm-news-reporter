# Template integration (original Department PPTX)

Renderer: `src/reports/templatePptx.ts`. It edits the user's template **as OOXML** (JSZip) instead of re-drawing it:

1. Validates the template is the audited one (labels in known shapes); otherwise `TemplateMismatchError` → export answers **BLOCKED** (HTTP 422), never a wrong document.
2. Clones the template's own slides per group: cover (slide 1), TỒN TẠI first page (slide 2, 2 stories) and following pages (slide 3), TÍCH CỰC (slide 4, 2 stories + feature photo), TRUNG LẬP (slide 5, 3 stories), KIẾN NGHỊ (slide 6). Page count follows the approved stories.
3. Rewrites text inside existing shapes, reusing each paragraph's own `pPr`/`rPr` (font, size, colour, bold, alignment). Source names become hyperlinks to the original articles.
4. Puts REAL article photos into the existing picture frames with cover-crop (`a:srcRect`), never stretched; when no usable photo exists, the frame is removed and the summary widened (text-only). No stock/AI substitute.
5. Removes unused story slots, all sample stories, sample photos (`ppt/media/image2..9`), old hyperlinks and speaker notes; replaces the dated footer in `slideLayout3` with the report date. Icons on the recommendations slide and layout artwork are kept.
6. Slide numbers use the template's `slidenum` field. Slide size (A4 portrait, 7556500×10693400 EMU) is untouched.
7. Fit check: list boxes on cover/recommendations are estimated (14 pt Arial) and a warning is returned when labels would overflow – fonts are never shrunk silently.

Shape-id map: `TEMPLATE_MAP` (derived with `npx tsx scripts/template-audit.ts <file.pptx>`).

## How the operator uses it
Settings › Báo cáo & mẫu › "Tải mẫu .pptx". The upload is stored as a copy in `templates/user/` (original untouched) and selected automatically. PDF: LibreOffice (auto-detected at `C:\Program Files\LibreOffice\program\soffice.exe`, or path set in the same panel).

## Verification done (2026-11-15)
- `tests/template.test.ts` (runs only where the private template exists): dynamic slide count 7, every XML part well-formed, no stale sample text/photos/notes, escaped special characters, A4 size kept, text-only path, mismatch refusal.
- Visual QA with real articles of the 15/11/2026 window (`scripts/qa-template.ts` → PPTX → LibreOffice PDF, inspected page by page). Defects found and fixed: broken XML from nested `hlinkClick` (lost sources and second story), JSZip folder removal deleting all images, stale "05/11/2026" footer in layout, feature photo gap on single-story TÍCH CỰC page. Remaining: long short-labels can overflow list boxes → warned at export.
- **Microsoft PowerPoint (Office16) verified (session 3):** exported files open read-only via COM without repair; PowerPoint's own PDF export matches the LibreOffice render (A4 595×842 pt, Vietnamese glyphs, photos, hyperlinks, page numbers, footer).
- PDF backend order (`pdfRenderer = auto`): Microsoft PowerPoint (`scripts/pptx-to-pdf-powerpoint.ps1`, serialized, never closes the user's other presentations) → LibreOffice.
- Multi-source stories: merged same-event articles render as `Nguồn: A | B` (one hyperlink per publisher, chronological).
- Summary lists on cover/recommendations are fitted to their boxes ("… và N tin khác") instead of overflowing – found when PowerPoint's render showed the list running over the footer.
