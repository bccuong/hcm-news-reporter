import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

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

/** The Department's template is private (reference/ is git-ignored): the template part runs only where it exists. */
const TEMPLATE = 'reference/hcm-news-reporter-skill/assets/reference-report.pptx';

test('web = local: photos, full article text, shared settings used by the server, export with the original template', async ({ page, request }) => {
  test.setTimeout(120_000);
  const png = await (await request.get('http://127.0.0.1:5181/__png')).body();
  // publisher photo links load straight from the publisher in the browser (fixture domains are served here)
  await page.route(/^https:\/\/fixture-[a-z]\.example\.vn\/img\//, (r) => r.fulfill({ body: png, contentType: 'image/png' }).catch(() => {})); // a photo may still be loading when the page navigates
  await page.goto('');
  const card = page.locator('article').filter({ hasText: 'Mưa lớn tối 8.11 khiến' }).first();
  const thumb = card.locator('img').first();
  await expect(thumb).toBeVisible();
  await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1200);

  // full text in "Xem chi tiết", like the local app
  await card.getByRole('button', { name: 'Xem chi tiết' }).click();
  await expect(page.getByText('Nhiều điểm ngập kéo dài')).toBeVisible();
  await expect(page.getByText('Lượng mưa theo trạm')).toBeVisible();
  await expect(page.getByText(/Kỳ này được đăng trước khi web có toàn văn/)).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/web-full-text.png' });
  await page.keyboard.press('Escape');
  await page.goto('');

  // settings are SHARED: saved through the worker, which the server collector reads (scripts/cloud-collect.ts)
  await login(page, 'Người duyệt E', 'HCM-TEST-CODE');
  await page.getByRole('button', { name: 'Cài đặt' }).click();
  const dlg = page.getByRole('dialog', { name: 'Cài đặt' });
  await expect(dlg.getByTestId('shared-config-note')).toBeVisible();
  await dlg.getByRole('button', { name: 'Báo cáo & mẫu', exact: true }).click();
  await dlg.getByLabel('Tên cơ quan trên bìa').fill('SỞ XÂY DỰNG TP.HCM (thử web)');
  if (existsSync(TEMPLATE)) {
    await dlg.locator('input[type=file][accept=".pptx"]').setInputFiles(TEMPLATE);
    await expect(page.getByText(/Đã lưu bản sao mẫu/)).toBeVisible();
  }
  await dlg.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByText('Đã lưu cài đặt')).toBeVisible();
  const cfg = (await (await request.get('http://127.0.0.1:5181/config')).json()).config;
  expect(cfg.by).toBe('Người duyệt E');
  expect(cfg.settings.report.organization).toBe('SỞ XÂY DỰNG TP.HCM (thử web)');
  expect(cfg.settings.report.templateFile).toBe(''); // the template never leaves this browser
  expect(cfg.sources.length).toBeGreaterThan(0);
  await dlg.getByRole('button', { name: 'Đóng cài đặt' }).click();

  // export: selected story with the real photo, through the worker's image proxy
  await page.getByLabel(/Chọn bài \[Mẫu thử\] Mưa lớn tối 8.11 khiến/).check();
  await page.getByRole('button', { name: /Xuất báo cáo \(1\)/ }).click();
  // capture the generated file in the page (a real browser download makes Playwright+Edge throw at teardown)
  await page.evaluate(() => {
    const w = window as unknown as { __dl?: { name: string; b64: string } };
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      const name = this.download;
      void fetch(this.href).then((r) => r.arrayBuffer()).then((buf) => {
        let s = '';
        const u = new Uint8Array(buf);
        for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
        w.__dl = { name, b64: btoa(s) };
      });
    };
  });
  await page.getByRole('button', { name: 'Xuất báo cáo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __dl?: unknown }).__dl), { timeout: 30_000 }).toBe(true);
  const out = await page.evaluate(() => (window as unknown as { __dl: { name: string; b64: string } }).__dl);
  const file = { suggestedFilename: () => out.name };
  const zip = await JSZip.loadAsync(Buffer.from(out.b64, 'base64'));
  const media = Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/'));
  const slidesXml = (await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).map((f) => zip.file(f)!.async('string')))).join('');
  expect(slidesXml).toContain('Mưa lớn tối 8.11');
  // default template = the Department's template from the Skill (published with the site), with the real photo
  await expect(page.getByLabel('Mẫu báo cáo')).toHaveValue('skill-so-xay-dung');
  expect(file.suggestedFilename()).not.toContain('DEMO');
  expect(slidesXml).not.toContain('BẢN DEMO');
  const hasPhoto = async (z: JSZip) => {
    for (const f of Object.keys(z.files).filter((x) => x.startsWith('ppt/media/') && !z.files[x]!.dir)) if ((await z.file(f)!.async('uint8array')).length === png.length) return true;
    return false;
  };
  expect(media.length).toBeGreaterThan(0);
  expect(await hasPhoto(zip)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/web-export-template.png' });

  // another template, chosen at export: one of the app's original designs
  await page.getByLabel('Mẫu báo cáo').selectOption('ban-tin');
  await expect(page.getByTestId('template-info')).toContainText('16:9');
  await page.evaluate(() => delete (window as unknown as { __dl?: unknown }).__dl);
  await page.getByRole('button', { name: 'Xuất báo cáo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __dl?: unknown }).__dl), { timeout: 30_000 }).toBe(true);
  const out2 = await page.evaluate(() => (window as unknown as { __dl: { name: string; b64: string } }).__dl);
  expect(out2.name).toContain('ban-tin');
  const zip2 = await JSZip.loadAsync(Buffer.from(out2.b64, 'base64'));
  expect(await hasPhoto(zip2)).toBe(true);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
test('web profiles: create Đà Nẵng (stored by the worker), own settings + hourly switch, switch back to TP.HCM', async ({ page, request }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('');
  await login(page, 'Người duyệt F', 'HCM-TEST-CODE');
  await page.getByRole('button', { name: 'Cài đặt' }).click();
  const dlg = page.getByRole('dialog', { name: 'Cài đặt' });
  await dlg.getByRole('button', { name: 'Cấu hình (profile)', exact: true }).click();
  await dlg.getByLabel('Tên cấu hình').fill('Đà Nẵng');
  await dlg.getByLabel('Tên địa bàn').fill('Đà Nẵng');
  await dlg.getByRole('button', { name: 'Tạo cấu hình' }).click();
  await expect(page.getByLabel('Cấu hình (profile)')).toHaveValue('da-nang');
  const cfg = (await (await request.get('http://127.0.0.1:5181/config?profile=da-nang')).json()).config;
  expect(cfg.settings.location.regionName).toBe('Đà Nẵng');
  expect(cfg.by).toBe('Người duyệt F');
  // no data yet for the new profile; its hourly switch is off (TP.HCM's stays on)
  const strip = page.getByTestId('server-status');
  await expect(strip).toContainText('cấu hình: Đà Nẵng');
  await expect(strip.getByLabel('Tự động thu thập mỗi giờ')).not.toBeChecked();
  await strip.getByLabel('Tự động thu thập mỗi giờ').click();
  await expect(strip.getByLabel('Tự động thu thập mỗi giờ')).toBeChecked();
  const st = (await (await request.get('http://127.0.0.1:5181/status')).json()) as { profiles: Array<{ id: string; autoCollect: boolean }> };
  expect(st.profiles.map((p) => [p.id, p.autoCollect])).toEqual([['hcm', true], ['da-nang', true]]);
  // the cron now collects both profiles in one run
  expect((await (await request.get('http://127.0.0.1:5181/__cron')).json()).profiles).toEqual(['hcm', 'da-nang']);
  await page.screenshot({ path: 'docs/screenshots/web-profile-da-nang.png' });
  await strip.getByLabel('Tự động thu thập mỗi giờ').click();
  await expect(strip.getByLabel('Tự động thu thập mỗi giờ')).not.toBeChecked();
  // back to TP.HCM: its published data is shown again
  await page.getByLabel('Cấu hình (profile)').selectOption('hcm');
  await expect(page.getByLabel('Cấu hình (profile)')).toHaveValue('hcm');
  await expect(page.locator('article').filter({ hasText: 'Mưa lớn tối 8.11 khiến' }).first()).toBeVisible();
});