# HCM News Reporter

Ứng dụng **local-first** (chạy trên máy Windows) tổng hợp điểm tin báo chí ngành xây dựng TP.HCM: thu thập bài từ các báo cấu hình, ghi **sổ ứng viên** cho mọi link phát hiện (không bỏ sót âm thầm), bóc tách toàn văn có kiểm tra độ đầy đủ, duyệt biên tập, và xuất PowerPoint.

- **Trang web dữ liệu thật (chỉ xem, cập nhật tự động mỗi giờ):** https://bccuong.github.io/hcm-news-reporter/ – xem [deploy/README.md](deploy/README.md)
- Mọi cấu hình (nguồn tin, RSS/sitemap/chuyên mục, từ khóa, quy tắc AND/OR/NOT, địa bàn, khung giờ, giới hạn quét, mẫu báo cáo…) **chỉnh trong giao diện Cài đặt**. Không cần sửa JSON.

> **Trạng thái:** MVP. Xem [PROGRESS.md](PROGRESS.md) và [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md). Xuất PPTX theo **đúng mẫu gốc của Sở** (khi đã tải mẫu) và PDF; đã kiểm tra bằng Microsoft PowerPoint và LibreOffice. Tin cùng sự kiện từ nhiều báo được gộp thành một tin nhiều nguồn.

## Chạy trên Windows

Yêu cầu: [Node.js LTS](https://nodejs.org) (≥ 20). Xuất PDF: tự dùng **Microsoft PowerPoint** nếu máy có Office, nếu không thì [LibreOffice](https://www.libreoffice.org).

Mẫu PPTX của Sở: tải trong **Cài đặt › Báo cáo & mẫu** (ứng dụng lưu bản sao, không sửa tệp gốc). Khi chưa tải mẫu, báo cáo dùng bố cục DEMO có nhãn rõ ràng.

```powershell
git clone https://github.com/bccuong/hcm-news-reporter.git
cd hcm-news-reporter
scripts\install-local.cmd      # npm install
scripts\start-local.cmd        # build giao diện + chạy tại http://127.0.0.1:5178
```

Hoặc: `npm install` rồi `npm start`. Chế độ phát triển (tự nạp lại): `npm run dev` → mở http://127.0.0.1:5173.

API chỉ lắng nghe trên `127.0.0.1` (không mở ra mạng LAN). Dữ liệu lưu cục bộ:

| Đường dẫn | Nội dung |
|---|---|
| `config/settings.json`, `config/sources.json` | Cài đặt và nguồn tin (do giao diện ghi; có lịch sử trong `config/history/`) |
| `data/runs/<runId>/` | `manifest.json`, `candidates.json` (sổ ứng viên), `articles.jsonl` |
| `data/reviews/<runId>.json` | Quyết định biên tập (chọn/bỏ, tóm tắt, tính chất…) |
| `exports/YYYY-MM-DD/` | PPTX/PDF và manifest nguồn gốc |

Không cần Internet để xem lại, duyệt và xuất dữ liệu đã thu thập; chỉ cần Internet khi thu thập tin mới.

## Lệnh

| Lệnh | Việc |
|---|---|
| `npm test` | Unit + integration tests (fixture, không cần mạng) |
| `npm run typecheck` | TypeScript strict |
| `npm run build` | typecheck + build giao diện |
| `npm run spike` | Dò thử các báo thật (đọc, giới hạn lịch sự) |
| `npm run build:pages` | Build bản demo tĩnh cho GitHub Pages |

## Kiến trúc

```
web/ (React + Vite + Tailwind)  ──REST/SSE──▶  src/server (Fastify, 127.0.0.1, token + kiểm Origin/Host)
                                                 ├─ src/collector  RSS/Atom, sitemap, chuyên mục + phân trang, sổ ứng viên, bóc tách, chống SSRF
                                                 ├─ src/domain     schema Zod, khung giờ Asia/Ho_Chi_Minh [from,to), quy tắc Boolean, địa bàn, phân loại
                                                 ├─ src/reports    ghép tin đã duyệt → PPTX (demo), kiểm tràn chữ
                                                 └─ src/storage    ghi JSON nguyên tử, JSONL, lịch sử/khôi phục
```

Bản demo GitHub Pages dùng cùng mã `src/domain` + `src/reports` trong trình duyệt; dữ liệu là kết quả chạy **bộ thu thập thật trên website mẫu tổng hợp** (`tests/fixtures/siteA.ts`), vì trình duyệt không được phép tải trực tiếp trang báo (CORS).

## Nguồn dữ liệu ban đầu

Danh sách báo, tuyến RSS/chuyên mục, từ khóa ngành và danh mục phường/xã lấy từ Skill gốc `hcm-news-reporter` (xem [docs/ASSET_INVENTORY.md](docs/ASSET_INVENTORY.md)). Tệp mẫu PPTX gốc của Sở **không** được đưa lên repository (`reference/` bị `.gitignore`).

## Giới hạn

- Không phần mềm nào bảo đảm bắt được 100% bài đã đăng; ứng dụng bảo đảm **mọi link đã phát hiện** đều có trạng thái + lý do, và báo rõ khi chạm giới hạn quét.
- Không vượt chặn/paywall/CAPTCHA. Dân trí đang chặn thu thập tự động (theo ghi chú Skill) → chế độ "chỉ nhập thủ công".
- Ảnh: chỉ dùng ảnh thật từ bài gốc, ghi nguồn; không bao giờ dùng ảnh AI.
