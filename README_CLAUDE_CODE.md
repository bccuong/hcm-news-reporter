# HCM News Reporter — Claude Code Starter Pack v1.2

**Mục tiêu:** Giao cho **Claude Code** viết phần mềm HCM News Reporter theo đặc tả v1.1 đã chốt, không phải chuyển sang chạy Skill Claude Chat. v1.2 bổ sung quy trình lập trình, kiểm thử, quản lý tiến độ và tiếp tục qua nhiều phiên Claude Pro. **Đây là bộ tài liệu triển khai, chưa phải source code ứng dụng.**

## A. Chuẩn bị trên Windows

1. Tạo một thư mục mới, ví dụ `D:\Projects\HCM-News-Reporter`.
2. **Giải nén toàn bộ ZIP vào thư mục đó**, sao cho `CLAUDE.md` nằm ở **thư mục gốc** của project (không bị thêm một lớp thư mục không cần thiết).
3. Tạo thư mục `reference/` và bỏ vào đây các file **thật từ project cũ** nếu có:
   - Skill HCM News Reporter ZIP hoặc thư mục trích xuất có `SKILL.md`, `websites.txt`.
   - PPTX mẫu được duyệt chính thức, ví dụ `Báo cáo điểm tin ngành xây dựng mẫu.pptx`.
   - PPTX báo cáo tốt nhất gần đây, và DOCX điểm tin nếu muốn tích hợp import về sau.
   Các file gốc **không đi kèm** Starter Pack này.
4. Cài Git, Node.js LTS và Claude Code (và VS Code nếu muốn). Xem hướng dẫn cài cập nhật: https://code.claude.com/docs/en/overview .
5. Đăng nhập bằng tài khoản Claude Pro trong Claude Code. Nếu máy đang cấu hình `ANTHROPIC_API_KEY`, hãy kiểm tra cách xác thực/billing trước khi chạy để tránh vô tình tính phí API riêng.

## B. Khởi chạy Claude Code

Trong PowerShell mở thư mục project:

```powershell
cd D:\Projects\HCM-News-Reporter
claude
```

Dán **toàn bộ nội dung** `CLAUDE_START_PROMPT.txt` làm yêu cầu đầu tiên. Claude Code sẽ tự đọc `CLAUDE.md` trong project và lần lượt thực hiện các milestone. Chỉ sử dụng plan mode nếu bạn muốn duyệt kế hoạch trước; để **viết code thật**, Claude phải được cho phép thao tác sửa file/chạy lệnh trong phạm vi dự án.

Nếu không có quyền dùng terminal hoặc không cấp quyền ghi file, việc chỉ tải ZIP vào cuộc trò chuyện Claude Chat có thể chỉ tạo ra mã/đề xuất mà không chạy, test và bàn giao ứng dụng. Hãy làm việc trong một workspace Claude Code có quyền thao tác repository.

## C. Mỗi khi hết phiên Claude Pro

- Claude phải cập nhật `PROGRESS.md` và `ACCEPTANCE_REPORT.md` trước khi dừng nếu còn quyền thao tác.
- Lần sau mở lại thư mục, chạy `claude`, dán `CLAUDE_RESUME_PROMPT.txt`.
- Có thể dùng tính năng resume của Claude Code nếu phiên cũ còn truy cập được, nhưng **file tiến độ/Git mới là trạng thái có thể kiểm tra lâu dài**.
- Không cần dùng parallel agents hay mô hình đắt tiền ngay từ đầu; ưu tiên từng milestone chạy được.

## D. Cấu trúc và ý nghĩa file

| File | Vai trò |
|---|---|
| `CLAUDE.md` | Chỉ dẫn Claude Code tự đọc trong repository |
| `HCM_News_Reporter_Implementation_Plan.md` | Đặc tả gốc v1.1 được nâng lên v1.2 cho Claude Code |
| `UI_CONFIG_SPEC.md` | **P0:** mọi cấu hình thao tác trên GUI, không sửa JSON |
| `COLLECTION_COVERAGE_SPEC.md` | **P0:** quét nhiều đường, ledger URL và chống bỏ sót thầm lặng |
| `ACCEPTANCE_TEST_CASES.md` | Bài kiểm thử và điều kiện không chấp nhận |
| `MILESTONES.md` | Công việc chia thành các chặng có cổng nghiệm thu |
| `PROGRESS.md` | Tiến độ nối phiên, không mặc định đã chạy thành công |
| `ACCEPTANCE_REPORT.md` | Nhật ký kết quả test có chứng cứ |
| `CLAUDE_START_PROMPT.txt` | Prompt khởi tạo Claude Code |
| `CLAUDE_RESUME_PROMPT.txt` | Prompt tiếp tục qua phiên mới |
| `settings.example.json`, `sources.example.json` | **Chỉ mẫu lưu trữ nội bộ**, không phải giao diện cấu hình |
| `.gitignore` | Bỏ qua dữ liệu chạy, ảnh cache, báo cáo, secrets và build |

## E. Những điều KHÔNG được coi là hoàn thành

- UI chỉ là mockup, controls không kết nối API/lưu dữ liệu;
- Buộc người dùng sửa JSON/XML để thêm website, filters, location hoặc template;
- Crawler chỉ đọc vài tiêu đề và bỏ qua bài lỗi/thiếu bảng biểu;
- Nói đã quét đủ 100% tin trên một tờ báo mà không có bằng chứng;
- PowerPoint chỉ trông gần giống mẫu, chưa render kiểm tra trang;
- Gắn hình AI hoặc ảnh sai sự kiện;
- Báo cáo kết quả chạy/test khi lệnh thực tế chưa được thực hiện.

**Cách dùng hiệu quả:** ưu tiên M0 -> M2 một luồng thật; sau đó hoàn thiện các nguồn/UI/quality/report theo gate. Nếu cần cắt phạm vi do giới hạn Claude Pro, hãy để lại kết quả thật và đánh dấu trạng thái chưa hoàn thành, không ngầm bỏ tiêu chí P0.
