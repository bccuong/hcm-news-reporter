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
