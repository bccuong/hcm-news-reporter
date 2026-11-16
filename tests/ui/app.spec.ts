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
  await expect(page.getByText(/Mưa lớn tối 8.11 khiến/)).toBeVisible({ timeout: 30_000 });
  // custom window persisted (preset) after reload
  await page.reload();
  // ledger shows explicit reasons, nothing silently dropped
  await page.getByRole('button', { name: /Sổ ứng viên/ }).click();
  await expect(page.getByText('OUTSIDE_DATE_WINDOW').first()).toBeVisible();
  await expect(page.getByText('FETCH_403').first()).toBeVisible();
  await page.getByRole('button', { name: /Độ phủ/ }).click();
  await expect(page.getByText(/Đối soát sổ ứng viên: 12 \/ 12/)).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/coverage.png', fullPage: true });
  // select and export
  await page.getByRole('button', { name: /Bài sẵn sàng/ }).click();
  await page.getByLabel(/Chọn bài \[Mẫu thử\] Mưa lớn tối 8.11 khiến/).check();
  await page.screenshot({ path: 'docs/screenshots/dashboard.png', fullPage: true });
  await page.getByRole('button', { name: /Xuất báo cáo \(1\)/ }).click();

  // DIS-06: same event reported by publisher D is suggested and merged as a second source
  const story = page.getByTestId(/^merge-/).first();
  await expect(story).toContainText('Gợi ý cùng sự kiện');
  await story.getByRole('button', { name: 'Gộp vào tin này' }).click();
  await expect(page.getByText('Đã gộp nguồn vào tin')).toBeVisible();
  await expect(page.getByText(/Nguồn: Báo mẫu thử A {2}\| {2}Báo mẫu thử D/)).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/export-merged-sources.png', fullPage: true });

  await page.getByRole('button', { name: 'Xuất báo cáo', exact: true }).click();
  await expect(page.getByText('Đã tạo:')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('a[href$=".pptx"]')).toHaveCount(1);
  const manifestHref = await page.locator('a[href$="_manifest.json"]').getAttribute('href');
  const manifest = await (await page.request.get(manifestHref!)).json();
  expect(manifest.stories).toHaveLength(1);
  expect(manifest.stories[0].sources.map((s: { name: string }) => s.name)).toEqual(['Báo mẫu thử A', 'Báo mẫu thử D']);

  // split back: the merged article becomes independent again
  await story.getByRole('button', { name: 'Tách ra' }).click();
  await expect(page.getByText(/^Nguồn: Báo mẫu thử A ·/)).toBeVisible();
  await expect(story).toContainText('Gợi ý cùng sự kiện');
});

test('Editor feedback: label ready / excluded stories → filter quality card (precision, missed stories)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Bài sẵn sàng/ }).click();
  // flood was selected for the report in the previous test → counts as relevant implicitly
  await expect(page.getByText('đã chọn vào báo cáo = liên quan').first()).toBeVisible();
  await page.getByRole('button', { name: /^Không liên quan: \[Mẫu thử\] Khánh thành nhà ga metro/ }).click();
  await expect(page.getByRole('button', { name: /^Không liên quan: \[Mẫu thử\] Khánh thành nhà ga metro/ })).toHaveAttribute('aria-pressed', 'true');
  // a story the filter excluded, rescued by the editor from the ledger
  await page.getByRole('button', { name: /Sổ ứng viên/ }).click();
  const row = page.locator('tr', { hasText: 'mau-thu-ha-noi-mo-rong-duong-vanh-dai' });
  await row.getByRole('button', { name: 'Thực ra liên quan?' }).click();
  await expect(row.getByRole('button', { name: /Liên quan \(bị loại nhầm\)/ })).toBeVisible();
  await page.getByRole('button', { name: /Độ phủ/ }).click();
  const card = page.getByTestId('quality-card');
  await expect(card).toContainText('Đã đánh giá: 3');
  await expect(card).toContainText('Độ chính xác tab Sẵn sàng: 50%');
  await expect(card).toContainText('Tin bị bộ lọc loại nhầm (1)');
  await expect(card).toContainText('Hà Nội mở rộng đường vành đai');
  await page.screenshot({ path: 'docs/screenshots/filter-quality.png', fullPage: false });
  // labels persist (stored with the review)
  await page.reload();
  await page.getByRole('button', { name: /Độ phủ/ }).click();
  await expect(page.getByTestId('quality-card')).toContainText('Đã đánh giá: 3');
});

test('DIS-08: publisher redesign → coverage tab shows degraded adapter, articles move to review queue', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Độ phủ/ }).click();
  await expect(page.getByTestId('adapter-health').first()).toContainText('Bộ bóc tách: ổn định');
  await request.post('/__e2e/redesign', { data: { mode: 'new_container' } });
  await page.getByRole('button', { name: 'Tùy chỉnh' }).click();
  await page.getByLabel('Từ (gồm)').fill('2026-11-08T17:00');
  await page.getByLabel('Đến (không gồm)').fill('2026-11-09T08:00');
  await page.getByRole('button', { name: 'Thu thập' }).click();
  await expect(page.getByText('bóc tách suy giảm')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Độ phủ/ }).click();
  const card = page.getByTestId('adapter-health').first();
  await expect(card).toContainText('Bộ bóc tách: SUY GIẢM');
  await expect(card).toContainText('Khung nội dung bài đổi từ ".detail-content"');
  await expect(card.getByRole('button', { name: 'Quét lại nguồn này' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/adapter-degraded.png', fullPage: true });
  // the publisher's articles are no longer "ready": they sit in the review queue with the reason
  await page.getByRole('button', { name: /Cần kiểm tra/ }).click();
  await expect(page.getByText(/Bộ bóc tách nguồn này suy giảm/).first()).toBeVisible();
  await request.post('/__e2e/redesign', { data: { mode: 'none' } });
});

test('Profiles: create Hà Nội from the defaults, its own settings and runs, clone TP.HCM, switch back', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await openSettings(page, 'Tổng quan');
  const dlg = page.getByRole('dialog', { name: 'Cài đặt' });
  // one tree: the open profile with all its sections underneath
  const tree = dlg.getByTestId('nav-this-profile');
  await expect(tree).toContainText('TP.HCM');
  for (const l of ['Tổng quan', 'Nguồn tin', 'Từ khóa & quy tắc', 'Địa điểm', 'Lĩnh vực']) await expect(tree.getByRole('button', { name: l, exact: true })).toBeVisible();
  await expect(dlg.getByTestId('profiles-table')).toContainText('TP.HCM');
  await expect(dlg.getByTestId('profiles-table')).toContainText('đang dùng');
  // new region from the standard configuration, used right away (page reloads, Settings reopen on its overview)
  await dlg.getByRole('button', { name: 'Tạo cấu hình mới', exact: true }).click();
  await dlg.getByLabel('Tên cấu hình').fill('Hà Nội');
  await dlg.getByLabel('Tên địa bàn').fill('Hà Nội');
  await dlg.getByLabel('Cách viết khác của địa bàn (cách nhau bằng dấu phẩy)').fill('TP Hà Nội, Thủ đô');
  await dlg.getByRole('button', { name: 'Tạo cấu hình', exact: true }).click();
  await expect(page.getByLabel('Cấu hình (profile)')).toHaveValue('ha-noi');
  await expect(dlg.getByTestId('nav-this-profile')).toContainText('Hà Nội');
  await expect(dlg.getByTestId('profiles-table')).toContainText('Hà Nội');
  await expect(dlg.getByTestId('nav-profile-hcm')).toContainText('TP.HCM'); // the other profile, one click away
  // its settings: region Hà Nội, location filter
  await dlg.getByRole('button', { name: 'Địa điểm', exact: true }).click();
  await expect(dlg.getByLabel('Tên địa bàn (hiển thị trong ứng dụng và báo cáo)')).toHaveValue('Hà Nội');
  await dlg.getByLabel('Câu thử địa bàn').fill('Ùn tắc kéo dài ở Thủ đô sáng nay');
  await expect(dlg.getByText('Kết quả: Hà Nội')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/profiles-tree.png' });
  await dlg.getByRole('button', { name: 'Đóng cài đặt' }).click();
  await expect(page.getByLabel('Lượt đã lưu')).toHaveCount(0); // TP.HCM runs are not listed under Hà Nội
  await expect(page.getByTestId('app-subtitle')).toHaveText('Điểm tin báo chí ngành xây dựng Hà Nội');
  await page.screenshot({ path: 'docs/screenshots/profile-ha-noi.png' });

  // switch from the tree: TP.HCM opens on the same section
  await page.getByRole('button', { name: 'Cài đặt' }).click();
  await dlg.getByRole('button', { name: 'Địa điểm', exact: true }).click();
  await dlg.getByTestId('nav-profile-hcm').click();
  await expect(page.getByLabel('Cấu hình (profile)')).toHaveValue('hcm');
  await expect(dlg.getByTestId('nav-this-profile')).toContainText('TP.HCM');
  await expect(dlg.getByLabel('Tên địa bàn (hiển thị trong ứng dụng và báo cáo)')).toHaveValue('TP.HCM');

  // clone TP.HCM without switching: it appears in the tree
  await dlg.getByRole('button', { name: 'Tổng quan', exact: true }).click();
  await dlg.getByRole('button', { name: 'Sao chép thành cấu hình mới' }).click();
  await expect(dlg.getByLabel('Tên cấu hình')).toHaveValue('TP.HCM (bản sao)');
  await dlg.getByLabel('Dùng cấu hình mới ngay sau khi tạo').uncheck();
  await dlg.getByRole('button', { name: 'Tạo cấu hình', exact: true }).click();
  await expect(dlg.getByRole('navigation')).toContainText('TP.HCM (bản sao)');
  await page.screenshot({ path: 'docs/screenshots/profiles-settings.png' });
  await dlg.getByRole('button', { name: 'Đóng cài đặt' }).click();
  await expect(page.getByTestId('app-subtitle')).toHaveText('Điểm tin báo chí ngành xây dựng TP.HCM');
  await expect(page.getByLabel('Lượt đã lưu')).toBeVisible(); // TP.HCM's runs are back
});