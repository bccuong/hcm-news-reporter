# Duyệt tin theo nhóm (GitHub Pages + Cloudflare Worker)

```
Báo ──(mỗi giờ)──▶ GitHub Actions: thu thập ──▶ GitHub Pages (một bản web, cùng giao diện bản local)
                                                    │ người duyệt: tên + mã truy cập → ✓/✗, lĩnh vực, tính chất, ghi chú
                                                    ▼
                                   Cloudflare Worker + KV (miễn phí) – cloud/review-worker
                                                    │ 23:30 mỗi đêm (.github/workflows/labels.yml)
                                                    ▼
                         labels/labels.json trong repo (tên người duyệt → mã ẩn danh)
                                                    ▼
                         npx tsx scripts/eval-shared-labels.ts → chỉnh quy tắc/từ khóa → bộ thu thập chính xác hơn
```

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
