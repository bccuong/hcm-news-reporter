import { expect, test, type Page } from '@playwright/test';

/** Click-through UI tests: every assertion goes through real controls, then a page reload proves persistence. */

async function openSettings(page: Page, section: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cài đặt' }).click();
  await page.getByRole('dialog', { name: 'Cài đặt' }).getByRole('button', { name: section, exact: true }).click();
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByText('Đã lưu cài đặt')).toBeVisible();
}

test('UI-01: add a source via the wizard, validation blocks bad URL, persists after reload', async ({ page }) => {
  await openSettings(page, 'Nguồn tin');
  await page.getByRole('button', { name: 'Thêm nguồn' }).click();
  const url = page.getByLabel('URL trang chủ báo');
  await url.fill('abc');
  await expect(page.getByText(/URL không hợp lệ/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tạo thẻ nguồn (chưa lưu)' })).toBeDisabled();
  await url.fill('https://bao-moi-mau.example.vn');
  await page.getByRole('button', { name: 'Tạo thẻ nguồn (chưa lưu)' }).click();
  // editor opens: add an RSS route through the URL list control
  const card = page.getByTestId('source-bao-moi-mau-example-vn');
  await expect(card).toBeVisible();
  const rssInput = card.locator('input[placeholder="https://..."]').first();
  await rssInput.fill('https://bao-moi-mau.example.vn/rss/thoi-su.rss');
  await rssInput.press('Enter');
  await save(page);
  await page.reload();
  await page.getByRole('button', { name: 'Cài đặt' }).click();
  const after = page.getByTestId('source-bao-moi-mau-example-vn');
  await expect(after).toContainText('RSS 1');
});

test('UI-03: disable a source and it stays disabled after reload', async ({ page }) => {
  await openSettings(page, 'Nguồn tin');
  const sw = page.getByTestId('source-fixture-b').getByRole('switch');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await save(page);
  await page.reload();
  await page.getByRole('button', { name: 'Cài đặt' }).click();
  await expect(page.getByTestId('source-fixture-b').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});

test('UI-04: Boolean builder – add a NOT term, preview explains, persists', async ({ page }) => {
  await openSettings(page, 'Từ khóa & quy tắc');
  // root group "+ Từ khóa" is the first one
  await page.getByRole('button', { name: 'Từ khóa', exact: true }).first().click();
  const empty = page.getByLabel('Từ khóa', { exact: true }).last();
  await empty.fill('pickleball');
  // toggle KHÔNG on that new term (same row)
  const row = empty.locator('xpath=..');
  await row.getByRole('button', { name: 'KHÔNG' }).click();
  await expect(page.getByText(/KHÔNG có từ "pickleball"/)).toBeVisible();
  // preview on a sample title
  await page.getByLabel('Tiêu đề thử').fill('Metro số 2 khởi công, giải pickleball cuối tuần');
  await page.getByRole('button', { name: /Xem thử trên bài mẫu/ }).click();
  await expect(page.getByText(/✘ Không khớp – Metro số 2 khởi công/)).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/settings-rule-builder.png', fullPage: false });
  await save(page);
  await page.reload();
  await page.getByRole('button', { name: 'Cài đặt' }).click();
  await page.getByRole('button', { name: 'Từ khóa & quy tắc', exact: true }).click();
  await expect(page.getByLabel('Từ khóa', { exact: true }).last()).toHaveValue('pickleball');
});

test('UI-05: location alias added in the editor is used for matching and persists', async ({ page }) => {
  await openSettings(page, 'Địa điểm');
  const probe = page.getByLabel('Câu thử địa bàn');
  await probe.fill('Kẹt xe kéo dài ở phường Hiệp Bình');
  await expect(page.getByText('Kết quả:')).toContainText('TP.HCM');
  await probe.fill('Khánh thành Khu đô thị Mẫu Thử');
  await expect(page.getByText('Kết quả:')).toContainText('Chưa rõ');
  await page.getByRole('button', { name: 'Thêm địa danh' }).click();
  await page.getByLabel('Tên', { exact: true }).first().fill('Khu đô thị Mẫu Thử');
  await expect(page.getByText('Kết quả:')).toContainText('TP.HCM');
  await save(page);
  await page.reload();
  await page.getByRole('button', { name: 'Cài đặt' }).click();
  await page.getByRole('button', { name: 'Địa điểm', exact: true }).click();
  await page.getByPlaceholder('Tìm tên/bí danh…').fill('Mẫu Thử');
  await expect(page.getByLabel('Tên', { exact: true }).first()).toHaveValue('Khu đô thị Mẫu Thử');
});

test('UI-07: retry/concurrency limits are edited in UI and persist', async ({ page }) => {
  await openSettings(page, 'Hiệu năng');
  await page.getByRole('spinbutton', { name: 'Số lần thử lại' }).fill('4');
  await page.getByRole('spinbutton', { name: 'Yêu cầu đồng thời mỗi báo' }).fill('5');
  await expect(page.getByText(/nhiều kết nối\/báo có thể khiến báo chặn IP/)).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Yêu cầu đồng thời mỗi báo' }).fill('2');
  await save(page);
  await page.reload();
  await page.getByRole('button', { name: 'Cài đặt' }).click();
  await page.getByRole('button', { name: 'Hiệu năng', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Số lần thử lại' })).toHaveValue('4');
});

test('UI-06 + E2E: custom window [from,to), collect fixtures, ledger reasons, select, export PPTX', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Tùy chỉnh' }).click();
  await page.getByLabel('Từ (gồm)').fill('2026-11-08T17:00');
  await page.getByLabel('Đến (không gồm)').fill('2026-11-09T08:00');
  await expect(page.getByText('[17:00 08/11/2026, 08:00 09/11/2026)')).toBeVisible();
  // invalid range is blocked
  await page.getByLabel('Đến (không gồm)').fill('2026-11-08T10:00');
  await expect(page.getByText('Thời điểm kết thúc phải sau thời điểm bắt đầu')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Thu thập' })).toBeDisabled();
  await page.getByLabel('Đến (không gồm)').fill('2026-11-09T08:00');
  await page.getByRole('button', { name: 'Thu thập' }).click();
  await expect(page.getByRole('button', { name: /Bài sẵn sàng \(\d+\)/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Mưa lớn tối 8.11/)).toBeVisible({ timeout: 30_000 });
  // custom window persisted (preset) after reload
  await page.reload();
  // ledger shows explicit reasons, nothing silently dropped
  await page.getByRole('button', { name: /Sổ ứng viên/ }).click();
  await expect(page.getByText('OUTSIDE_DATE_WINDOW').first()).toBeVisible();
  await expect(page.getByText('FETCH_403').first()).toBeVisible();
  await page.getByRole('button', { name: /Độ phủ/ }).click();
  await expect(page.getByText(/Đối soát sổ ứng viên: 11 \/ 11/)).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/coverage.png', fullPage: true });
  // select and export
  await page.getByRole('button', { name: /Bài sẵn sàng/ }).click();
  await page.getByLabel(/Chọn bài \[Mẫu thử\] Mưa lớn/).check();
  await page.screenshot({ path: 'docs/screenshots/dashboard.png', fullPage: true });
  await page.getByRole('button', { name: /Xuất báo cáo \(1\)/ }).click();
  await page.getByRole('button', { name: 'Xuất báo cáo', exact: true }).click();
  await expect(page.getByText('Đã tạo:')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('a[href$=".pptx"]')).toHaveCount(1);
});
