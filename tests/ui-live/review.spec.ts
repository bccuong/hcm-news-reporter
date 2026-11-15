import { expect, test, type Page } from '@playwright/test';

/** Two reviewers label the same published (fixture) articles through the shared review store. */
const FLOOD = /Liên quan: \[Mẫu thử\] Mưa lớn tối 8\.11 khiến/;
const METRO_NO = /^Không liên quan: \[Mẫu thử\] Khánh thành nhà ga metro/;

async function login(page: Page, name: string, code: string) {
  await page.getByRole('button', { name: 'Đăng nhập duyệt tin' }).click();
  await page.getByLabel('Họ tên').fill(name);
  await page.getByLabel('Mã truy cập (do quản trị gửi)').fill(code);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
}

test('shared review: login gate, votes from two reviewers, team quality, export', async ({ browser, request }) => {
  const a = await (await browser.newContext()).newPage();
  await a.goto('');
  await expect(a.getByTestId('live-banner')).toBeVisible();
  // labelling without a session opens the login dialog
  await a.getByRole('button', { name: FLOOD }).click();
  await expect(a.getByRole('dialog', { name: 'Đăng nhập người duyệt' })).toBeVisible();
  await a.getByLabel('Họ tên').fill('Người duyệt A');
  await a.getByLabel('Mã truy cập (do quản trị gửi)').fill('SAI-MA');
  await a.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(a.getByText('Mã truy cập không đúng')).toBeVisible();
  await a.getByLabel('Mã truy cập (do quản trị gửi)').fill('HCM-TEST-CODE');
  await a.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(a.getByTestId('reviewer-chip')).toContainText('Người duyệt A');
  await a.getByRole('button', { name: FLOOD }).click();
  await a.getByRole('button', { name: METRO_NO }).click();
  await expect(a.getByText(/Nhóm duyệt: ✓1 ✗0/).first()).toBeVisible();

  // second reviewer in a separate browser sees A's vote and adds their own
  const b = await (await browser.newContext()).newPage();
  await b.goto('');
  await login(b, 'Người duyệt B', 'HCM-TEST-CODE');
  await expect(b.getByText(/Nhóm duyệt: ✓1 ✗0/).first()).toBeVisible();
  await b.getByRole('button', { name: FLOOD }).click();
  await expect(b.getByText(/Nhóm duyệt: ✓2 ✗0/).first()).toBeVisible();
  // team quality card uses the majority vote
  await b.getByRole('button', { name: /Độ phủ/ }).click();
  await expect(b.getByTestId('quality-card')).toContainText('Độ chính xác tab Sẵn sàng: 50%');
  await b.screenshot({ path: 'docs/screenshots/shared-review.png', fullPage: false });

  // nightly export (what the GitHub Action pulls) contains both reviewers' labels
  const ex = await (await request.get('http://127.0.0.1:5181/export', { headers: { authorization: 'Bearer test-export-token' } })).json();
  expect(ex.count).toBe(3);
  expect(new Set(ex.labels.map((l: { reviewerId: string }) => l.reviewerId))).toEqual(new Set(['nguoi-duyet-a', 'nguoi-duyet-b']));
});

test('hourly automatic switch + busy server is visible and blocks "Thu thập"', async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.goto('');
  const strip = page.getByTestId('server-status');
  const auto = strip.getByLabel('Tự động thu thập mỗi giờ');
  await expect(auto).toBeChecked();
  await expect(page.getByTestId('server-idle')).toBeVisible();
  // switching needs a reviewer session
  await auto.click(); // stays on: no session yet
  await expect(page.getByRole('dialog', { name: 'Đăng nhập người duyệt' })).toBeVisible();
  await expect(auto).toBeChecked();
  await page.getByLabel('Họ tên').fill('Người duyệt D');
  await page.getByLabel('Mã truy cập (do quản trị gửi)').fill('HCM-TEST-CODE');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await auto.click(); // saved on the worker, then reflected
  await expect(auto).not.toBeChecked();
  await expect(page.getByTestId('auto-info')).toContainText('Tắt – chỉ thu thập khi có người bấm');
  await expect(page.getByTestId('auto-info')).toContainText('Người duyệt D đổi lúc');
  await expect(page.getByTestId('live-banner')).toContainText('tự động thu thập đang TẮT');
  // the worker cron skips while switched off
  expect((await (await request.get('http://127.0.0.1:5181/__cron')).json()).result).toBe('off');
  await auto.click();
  await expect(auto).toBeChecked();
  // another run (e.g. a deploy after a push) occupies the server: shown to everyone, Thu thập disabled with the reason
  await request.get('http://127.0.0.1:5181/__deploy');
  await page.reload();
  await expect(page.getByTestId('server-busy')).toContainText('Máy chủ đang chạy: cập nhật phần mềm & dữ liệu');
  await expect(page.getByRole('button', { name: 'Thu thập' })).toBeDisabled();
  await page.screenshot({ path: 'docs/screenshots/web-server-busy.png' });
  await expect(page.getByTestId('server-idle')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByRole('button', { name: 'Thu thập' })).toBeEnabled();
});

test('web "Thu thập" like the local app: choose from/to → server collection → progress → new period opens', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('');
  // same window controls as the local app
  await page.getByRole('button', { name: 'Tùy chỉnh' }).click();
  await page.getByLabel('Từ (gồm)').fill('2026-11-08T18:00');
  await page.getByLabel('Đến (không gồm)').fill('2026-11-09T07:00');
  await expect(page.getByText('[18:00 08/11/2026, 07:00 09/11/2026)')).toBeVisible();
  // collecting requires a reviewer session
  await page.getByRole('button', { name: 'Thu thập' }).click();
  await expect(page.getByRole('dialog', { name: 'Đăng nhập người duyệt' })).toBeVisible();
  await page.getByLabel('Họ tên').fill('Người duyệt C');
  await page.getByLabel('Mã truy cập (do quản trị gửi)').fill('HCM-TEST-CODE');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByTestId('reviewer-chip')).toBeVisible();
  await page.getByRole('button', { name: 'Thu thập' }).click();
  await expect(page.getByTestId('remote-collect')).toContainText('Đang thu thập trên máy chủ GitHub');
  await expect(page.getByRole('button', { name: 'Thu thập' })).toBeDisabled(); // one collection at a time
  await page.screenshot({ path: 'docs/screenshots/web-collect-progress.png' });
  // the page polls the workflow and opens the new period when it is published
  await expect(page.getByText(/Đã thu thập xong 18:00 08\/11\/2026 → 07:00 09\/11\/2026/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('remote-collect')).toHaveCount(0);
  const selected = page.locator('select').filter({ hasText: 'theo yêu cầu' });
  await expect(selected).toContainText('18:00 08/11/2026 → 07:00 09/11/2026 · Thu thập theo yêu cầu (Người duyệt C)');
});
