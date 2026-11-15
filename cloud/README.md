# Duyệt tin theo nhóm (GitHub Pages + Cloudflare Worker)

```
Worker cron :07 mỗi giờ (nếu ô "Tự động thu thập mỗi giờ" đang bật) ─┐
Nút "Thu thập" trên web (khung từ/đến, cần đăng nhập) ───────────────┤ workflow_dispatch pages.yml
Push mã mới lên main ─────────────────────────────────────────────────┘
Báo ──▶ GitHub Actions: thu thập ──▶ GitHub Pages (một bản web, cùng giao diện bản local)
                                                    │ người duyệt: tên + mã truy cập → ✓/✗, lĩnh vực, tính chất, ghi chú
                                                    ▼
                                   Cloudflare Worker + KV (miễn phí) – cloud/review-worker
                                                    │ 23:30 mỗi đêm (.github/workflows/labels.yml)
                                                    ▼
                         labels/labels.json trong repo (tên người duyệt → mã ẩn danh)
                                                    ▼
                         npx tsx scripts/eval-shared-labels.ts → chỉnh quy tắc/từ khóa → bộ thu thập chính xác hơn
```

## Cơ chế thu thập trên web
- **Tự động mỗi giờ**: Cloudflare cron (`wrangler.toml` → `[triggers] crons = ["7 * * * *"]`) gọi `scheduledCollect` → gửi `workflow_dispatch` với `trigger=auto` (tên lượt "Thu thập tự động hằng giờ"). Không dùng `schedule:` của GitHub vì hay trễ/bỏ lượt. Bỏ qua nếu ô **Tự động thu thập mỗi giờ** đang tắt (KV `cfg:auto`) hoặc máy chủ đang bận; kết quả lần hẹn giờ gần nhất lưu ở `cfg:autoLast`.
- **Theo yêu cầu**: nút **Thu thập** → `POST /collect` (tối đa 72 h, mỗi lúc một lượt).
- **Push mã mới** cũng chạy một lượt thu thập + deploy.
- `GET /status` (công khai) trả về chế độ tự động + lượt đang chạy; web hiển thị ở dòng trạng thái máy chủ và khóa nút Thu thập khi máy chủ bận. `POST /auto {enabled}` (cần mã truy cập) bật/tắt.

## Web giống bản local (quyết định của chủ dự án 15/11/2026)
- **Toàn văn bài** được đăng công khai trong dữ liệu web (`contentSections`), ảnh chỉ đăng **link** (trình duyệt tải trực tiếp từ báo, như bản local).
- **Cài đặt dùng chung**: `GET /config` (công khai, không chứa bí mật) / `POST /config` (cần mã truy cập; mỗi lần lưu giữ bản cũ ở `cfg:hist:<thời điểm>`, tối đa 30) / `GET /config/history`, `POST /config/rollback`. Bộ thu thập trên GitHub (`scripts/cloud-collect.ts`, biến `REVIEW_API_URL`) dùng cấu hình này; cấu hình không hợp lệ bị bỏ qua (dùng mặc định) và ghi log.
- **Xuất báo cáo trên web**: người dùng chọn tệp mẫu .pptx của Sở **từ máy mình** (Cài đặt › Báo cáo & mẫu) – lưu trong IndexedDB của trình duyệt, không tải lên đâu; PPTX dựng ngay trong trình duyệt bằng cùng bộ điền mẫu với bản local. Ảnh báo gốc lấy qua `GET /img?url=` (cần mã truy cập, chỉ https, chỉ ảnh ≤ 8 MB). PDF: mở .pptx bằng PowerPoint › Lưu thành PDF (bản local chuyển tự động).
- Còn khác bản local: dò/thử nguồn và "quét lại từng nguồn" cần mạng trực tiếp từ máy → chỉ ở bản local; trên web bấm **Thu thập** để quét lại cả khung giờ.

## Gửi cho người duyệt
- Link: https://bccuong.github.io/hcm-news-reporter/
- Mã truy cập: gửi riêng (không đăng công khai). Đổi mã: `cd cloud/review-worker && npx wrangler secret put ACCESS_CODE` (người cũ phải đăng nhập lại).
- Hướng dẫn ngắn: bấm **Đăng nhập duyệt tin** → nhập họ tên + mã → ở tab *Bài sẵn sàng* và *Cần kiểm tra* bấm **✓ Liên quan / ✗ Không**; mở **Xem chi tiết** để sửa *lĩnh vực*, *tính chất* và ghi *góp ý*; ở *Sổ ứng viên* bấm **Thực ra liên quan?** cho tin bị loại nhầm.

## Cài đặt lần đầu (đã làm ngày 15/11/2026, ghi lại để tái lập)
```powershell
cd cloud/review-worker
npx wrangler login
npx wrangler kv namespace create REVIEWS        # điền id vào wrangler.toml
npx wrangler secret put ACCESS_CODE             # mã cho người duyệt
npx wrangler secret put EXPORT_TOKEN            # token cho GitHub Action
npx wrangler deploy                             # cần đăng ký subdomain workers.dev một lần trên dashboard
gh variable set REVIEW_API_URL --body "https://hcm-news-review.<subdomain>.workers.dev"
gh secret set EXPORT_TOKEN                      # cùng giá trị như trên
```

## Giới hạn & riêng tư
- Gói miễn phí KV: 1.000 lượt ghi/ngày – đủ cho vài người duyệt mỗi ngày; vượt thì lượt ghi báo lỗi rõ ràng.
- Tên người duyệt chỉ lưu trên Cloudflare; repo công khai chỉ chứa mã ẩn danh. **Ghi chú góp ý được công khai** trong repo.
- Mã truy cập là mã chung: ai có mã đều ghi được phiếu (mỗi tên một phiếu/bài). Mỗi phiếu có tên người duyệt nên dễ phát hiện phiếu lạ.
