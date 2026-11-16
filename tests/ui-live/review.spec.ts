import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

/** Two reviewers label the same published (fixture) articles through the shared review store. */
/** the window fields are date + 24-hour selects (not datetime-local): set "YYYY-MM-DDTHH:mm" */
async function setWindowField(p: Page, label: string, v: string) {
  const [d, hm] = v.split('T');
  const [h, m] = hm!.split(':');
  await p.getByLabel(`${label} – ngày`).fill(d!);
  await p.getByLabel(`${label} – giờ`).selectOption(h!);
  await p.getByLabel(`${label} – phút`).selectOption(m!);
}

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
  await setWindowField(page, 'Từ (gồm)', '2026-11-08T18:00');
  await setWindowField(page, 'Đến (không gồm)', '2026-11-09T07:00');
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
  // the new period is opened: compact label + who asked for it
  await expect(page.getByTestId('run-picker')).toContainText('08/11 18:00 → 09/11 07:00');
  await expect(page.getByTestId('run-picker')).toContainText('Người duyệt C');
});

/** The Department's template is private (reference/ is git-ignored): the template part runs only where it exists. */
const TEMPLATE = 'reference/hcm-news-reporter-skill/assets/reference-report.pptx';

test('web = local: photos, full article text, shared settings used by the server, export with the original template', async ({ page, request }) => {
  test.setTimeout(120_000);
  const png = await (await request.get('http://127.0.0.1:5181/__png')).body();
  // publisher photo links load straight from the publisher in the browser (fixture domains are served here)
  await page.route(/^https:\/\/fixture-[a-z]\.example\.vn\/img\//, (r) => r.fulfill({ body: png, contentType: 'image/png' }).catch(() => {})); // a photo may still be loading when the page navigates
  await page.goto('');
  const card = page.locator('article').filter({ hasText: 'khiến nhiều tuyến đường ở phường Hiệp Bình' }).first();
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
    // one export now downloads the .pptx AND the .docx: __dl = the PowerPoint, __docx = the Word file
    const w = window as unknown as { __dl?: { name: string; b64: string }; __docx?: { name: string; b64: string }; __pdf?: { name: string; b64: string } };
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      const name = this.download;
      void fetch(this.href).then((r) => r.arrayBuffer()).then((buf) => {
        let s = '';
        const u = new Uint8Array(buf);
        for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
        if (name.endsWith('.docx')) w.__docx = { name, b64: btoa(s) };
        else if (name.endsWith('.pdf')) w.__pdf = { name, b64: btoa(s) };
        else w.__dl = { name, b64: btoa(s) };
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
  await expect(page.getByTestId('template-picker').locator('input[value="skill-so-xay-dung"]')).toBeChecked();
  for (const id of ['skill-so-xay-dung', 'hanh-chinh', 'ban-tin', 'toi-gian', 'anh-lon']) await expect(page.getByTestId('template-picker').locator(`input[value="${id}"]`)).toBeVisible(); // Skill template + 4 original designs, all visible
  expect(file.suggestedFilename()).not.toContain('DEMO');
  expect(slidesXml).not.toContain('BẢN DEMO');
  const hasPhoto = async (z: JSZip) => {
    for (const f of Object.keys(z.files).filter((x) => x.startsWith('ppt/media/') && !z.files[x]!.dir)) if ((await z.file(f)!.async('uint8array')).length === png.length) return true;
    return false;
  };
  expect(media.length).toBeGreaterThan(0);
  expect(await hasPhoto(zip)).toBe(true);
  // Word, ticked by default: the Department's .docx template with the same story
  await expect(page.getByRole('checkbox', { name: '.docx' })).toBeChecked();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __docx?: unknown }).__docx), { timeout: 30_000 }).toBe(true);
  const word = await page.evaluate(() => (window as unknown as { __docx: { name: string; b64: string } }).__docx);
  expect(word.name).toBe(out.name.replace(/\.pptx$/, '.docx')); // same file name as the PowerPoint
  await expect(page.getByRole('checkbox', { name: '.pptx' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '.pdf' })).not.toBeChecked();
  const wordXml = await (await JSZip.loadAsync(Buffer.from(word.b64, 'base64'))).file('word/document.xml')!.async('string');
  expect(wordXml).toContain('Mưa lớn tối 8.11');
  expect(wordXml).toContain('TỒN TẠI CẦN KHẮC PHỤC');
  expect(wordXml).not.toContain('SÁNG');
  await page.screenshot({ path: 'docs/screenshots/web-export-template.png' });

  // another template, chosen at export: one of the app's original designs
  await page.getByTestId('template-picker').locator('input[value="ban-tin"]').check();
  await expect(page.getByTestId('template-info')).toContainText('16:9');
  await page.evaluate(() => delete (window as unknown as { __dl?: unknown }).__dl);
  // + the app's own PDF, built in the browser (no Office)
  await page.getByRole('checkbox', { name: '.pdf' }).check();
  await page.getByRole('button', { name: 'Xuất báo cáo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __dl?: unknown }).__dl), { timeout: 30_000 }).toBe(true);
  const out2 = await page.evaluate(() => (window as unknown as { __dl: { name: string; b64: string } }).__dl);
  expect(out2.name).toBe(out.name); // the design is not appended to the name: .pptx / .docx / .pdf share one name
  const zip2 = await JSZip.loadAsync(Buffer.from(out2.b64, 'base64'));
  const sz = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(await zip2.file('ppt/presentation.xml')!.async('string'))!;
  expect(Number(sz[1]) / Number(sz[2])).toBeCloseTo(16 / 9, 1); // landscape 16:9 = "Bản tin hiện đại"
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __pdf?: unknown }).__pdf), { timeout: 30_000 }).toBe(true);
  const pdf = await page.evaluate(() => (window as unknown as { __pdf: { name: string; b64: string } }).__pdf);
  expect(pdf.name).toBe(out.name.replace(/\.pptx$/, '.pdf'));
  const pdfBytes = Buffer.from(pdf.b64, 'base64');
  expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdfBytes.toString('latin1')).toContain('/Subtype /Image'); // the real photo is in the PDF
  expect(await hasPhoto(zip2)).toBe(true);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
test('web profiles: create Đà Nẵng (stored by the worker), own settings + hourly switch, switch back to TP.HCM', async ({ page, request }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('');
  await login(page, 'Người duyệt F', 'HCM-TEST-CODE');
  await page.getByRole('button', { name: 'Cài đặt' }).click();
  const dlg = page.getByRole('dialog', { name: 'Cài đặt' });
  await dlg.getByRole('button', { name: 'Tạo cấu hình mới', exact: true }).click();
  await dlg.getByLabel('Tên cấu hình').fill('Đà Nẵng');
  await dlg.getByLabel('Tên địa bàn').fill('Đà Nẵng');
  await dlg.getByRole('button', { name: 'Tạo cấu hình', exact: true }).click();
  await expect(page.getByLabel('Cấu hình (profile)')).toHaveValue('da-nang');
  // Settings reopen on the new profile's overview after the reload
  await expect(dlg.getByTestId('nav-this-profile')).toContainText('Đà Nẵng');
  await expect(dlg.getByTestId('nav-profile-hcm')).toBeVisible();
  await dlg.getByRole('button', { name: 'Đóng cài đặt' }).click();
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
  // Settings say which profile every section edits: sources, rules, location, categories… are grouped under it
  await page.getByRole('button', { name: 'Cài đặt' }).click();
  const dlg2 = page.getByRole('dialog', { name: 'Cài đặt' });
  await expect(dlg2.getByTestId('settings-profile')).toContainText('Đà Nẵng');
  const own = dlg2.getByTestId('nav-this-profile');
  await expect(own).toContainText('Đà Nẵng');
  for (const l of ['Nguồn tin', 'Từ khóa & quy tắc', 'Địa điểm', 'Lĩnh vực']) await expect(own.getByRole('button', { name: l, exact: true })).toBeVisible();
  await own.getByRole('button', { name: 'Lĩnh vực', exact: true }).click();
  // "Chính sách, pháp quy" counts only with a construction/transport sector in the title/sapo – a UI setting, not a file
  const pol = dlg2.getByTestId('category-POLICY');
  await expect(pol.getByRole('group', { name: /Lĩnh vực bắt buộc đi kèm/ }).getByLabel('Xây dựng')).toBeChecked();
  await expect(pol.getByRole('group', { name: /Lĩnh vực bắt buộc đi kèm/ }).getByLabel('Giao thông')).toBeChecked();
  await dlg2.getByTestId('category-TRAFFIC').locator('summary').click();
  await expect(dlg2.getByTestId('category-TRAFFIC')).toContainText('yêu cầu');
  await page.screenshot({ path: 'docs/screenshots/web-settings-per-profile.png' });
  await dlg2.getByRole('button', { name: 'Đóng cài đặt' }).click();
  await strip.getByLabel('Tự động thu thập mỗi giờ').click();
  await expect(strip.getByLabel('Tự động thu thập mỗi giờ')).not.toBeChecked();
  // back to TP.HCM: its published data is shown again
  await page.getByLabel('Cấu hình (profile)').selectOption('hcm');
  await expect(page.getByLabel('Cấu hình (profile)')).toHaveValue('hcm');
  await expect(page.locator('article').filter({ hasText: 'khiến nhiều tuyến đường ở phường Hiệp Bình' }).first()).toBeVisible();
});
test('web review is ONE for the whole team: what A selects / moves / removes on one machine, B sees on another', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await a.goto('');
  await login(a, 'Người duyệt G', 'HCM-TEST-CODE');
  await expect(a.getByTestId('reviewer-chip')).toContainText('Người duyệt G');
  await a.reload();
  await a.waitForLoadState('networkidle'); // the team review is loaded (earlier tests already changed it)
  const readyTab = (p: Page) => p.getByRole('button', { name: /^Bài sẵn sàng/ });
  const reviewTab = (p: Page) => p.getByRole('button', { name: /^Cần kiểm tra/ });
  const n = async (l: ReturnType<typeof readyTab>) => Number(/\((\d+)\)/.exec(await l.innerText())![1]);
  // A: select one ready story for the report, remove another, move one story from Cần kiểm tra
  const stories = a.locator('article');
  const t1 = (await stories.nth(0).locator('h3').innerText()).trim();
  const t2 = (await stories.nth(1).locator('h3').innerText()).trim();
  await stories.nth(0).getByLabel(/^Chọn bài/).check();
  await a.locator('article').filter({ hasText: t2 }).getByRole('button', { name: /^Loại bài:/ }).click();
  await reviewTab(a).click();
  const review1 = await n(reviewTab(a));
  const t3 = (await a.locator('article').first().locator('h3').innerText()).trim();
  await a.locator('article').first().getByRole('button', { name: /Chuyển sang Bài sẵn sàng/ }).click();
  await expect(reviewTab(a)).toHaveText(`Cần kiểm tra (${review1 - 1})`);
  const readyA = await readyTab(a).innerText();
  const reviewA = await reviewTab(a).innerText();
  const exportA = await a.getByRole('button', { name: /^Xuất báo cáo/ }).innerText();
  const nSel = Number(/\((\d+)\)/.exec(exportA)![1]);

  // B on another machine (fresh browser), not logged in: sees the same team review
  const b = await (await browser.newContext()).newPage();
  await b.goto('');
  await b.waitForLoadState('networkidle');
  await expect(readyTab(b)).toHaveText(readyA); // the same lists on the other machine
  await expect(reviewTab(b)).toHaveText(reviewA);
  await expect(b.getByRole('button', { name: /^Xuất báo cáo/ })).toHaveText(exportA);
  const s1 = b.locator('article').filter({ hasText: t1 });
  await expect(s1.getByLabel(/^Chọn bài/)).toBeChecked();
  await expect(s1.getByTestId('shared-by')).toContainText('Người duyệt G');
  await expect(b.locator('article').filter({ hasText: t3 })).toContainText('từ Cần kiểm tra');
  await b.getByTestId('excluded-list').locator('summary').click();
  await expect(b.getByTestId('excluded-list')).toContainText(t2);
  await b.screenshot({ path: 'docs/screenshots/web-team-review.png' });
  // without a session B cannot change it (login dialog), with one B's change reaches A
  await s1.getByLabel(/^Chọn bài/).uncheck().catch(() => undefined);
  await expect(b.getByRole('dialog', { name: 'Đăng nhập người duyệt' })).toBeVisible();
  await b.getByLabel('Họ tên').fill('Người duyệt H');
  await b.getByLabel('Mã truy cập (do quản trị gửi)').fill('HCM-TEST-CODE');
  await b.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(b.getByTestId('reviewer-chip')).toContainText('Người duyệt H');
  await b.locator('article').filter({ hasText: t1 }).getByLabel(/^Chọn bài/).uncheck();
  await expect(b.getByRole('button', { name: /^Xuất báo cáo/ })).toHaveText(`Xuất báo cáo (${nSel - 1})`);
  await a.reload();
  await expect(a.getByRole('button', { name: /^Xuất báo cáo/ })).toHaveText(`Xuất báo cáo (${nSel - 1})`);
  await expect(a.locator('article').filter({ hasText: t1 }).getByTestId('shared-by')).toContainText('Người duyệt H');
});

test('web: "Dò cấu trúc" and "Thử thu thập" run in the browser through the review worker (reviewers only)', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('');
  await page.getByRole('button', { name: 'Cài đặt' }).click();
  const dlg = page.getByRole('dialog', { name: 'Cài đặt' });
  await dlg.getByRole('button', { name: 'Nguồn tin', exact: true }).click();
  // not logged in: a clear message (no longer "only in the local app")
  await dlg.getByRole('button', { name: 'Thêm nguồn' }).click();
  await dlg.getByLabel('URL trang chủ báo').fill('https://fixture-a.example.vn/');
  await dlg.getByRole('button', { name: /Dò cấu trúc tự động/ }).click();
  await expect(page.getByText(/Hãy đăng nhập người duyệt để dò \/ thử nguồn trên web/).first()).toBeVisible();
  await dlg.getByRole('button', { name: 'Đóng cài đặt' }).click();
  await login(page, 'Người duyệt T', 'HCM-TEST-CODE');
  await page.getByRole('button', { name: 'Cài đặt' }).click();
  await dlg.getByRole('button', { name: 'Nguồn tin', exact: true }).click();
  await dlg.getByRole('button', { name: 'Thêm nguồn' }).click();
  await dlg.getByLabel('URL trang chủ báo').fill('https://fixture-a.example.vn/');
  await dlg.getByRole('button', { name: /Dò cấu trúc tự động/ }).click();
  await expect(dlg.getByText('https://fixture-a.example.vn/rss/thoi-su.rss').first()).toBeVisible({ timeout: 20_000 });
  await dlg.getByRole('button', { name: 'Tạo thẻ nguồn (chưa lưu)' }).click();
  const card = dlg.locator('[data-testid^="source-"]').filter({ hasText: 'fixture-a.example.vn' }).first();
  await card.getByRole('button', { name: 'Thử thu thập' }).click();
  await expect(card).toContainText(/Kết quả thử \(\d+ link ứng viên\)/, { timeout: 30_000 });
  await expect(card).toContainText('[rss] ok');
  await expect(card).toContainText('Mưa lớn tối 8.11'); // a sample article really extracted
  await page.screenshot({ path: 'docs/screenshots/web-source-test.png' });
});

test('F5 opens the most recent collection; "Kỳ gần nhất" = latest run; picking a saved run loads its window; reviewers remove / restore runs', async ({ page }) => {
  await page.goto('');
  await page.waitForLoadState('networkidle');
  const picker = page.getByTestId('run-picker');
  const rows = page.getByRole('listbox', { name: 'Danh sách các lượt' }).getByRole('option');
  const field = async (l: string) => `${await page.getByLabel(`${l} – ngày`).inputValue()}T${await page.getByLabel(`${l} – giờ`).inputValue()}:${await page.getByLabel(`${l} – phút`).inputValue()}`;
  // the on-demand period 18:00 08/11 → 07:00 09/11 (collected in an earlier test) is the most recent collection
  await expect(picker).toContainText('08/11 18:00 → 09/11 07:00'); // compact label
  expect(await field('Từ (gồm)')).toBe('2026-11-08T18:00');
  expect(await field('Đến (không gồm)')).toBe('2026-11-09T07:00');
  await expect(page.getByRole('button', { name: 'Kỳ gần nhất' })).toHaveClass(/bg-navy-700/); // latest run = "Kỳ gần nhất"
  await picker.click();
  expect(await rows.count()).toBeGreaterThanOrEqual(2);
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true'); // newest first, current one ticked
  // pick the daily period: Từ / Đến follow
  await rows.filter({ hasText: '08/11 17:00 → 09/11 08:00' }).click();
  await expect.poll(() => field('Từ (gồm)')).toBe('2026-11-08T17:00');
  expect(await field('Đến (không gồm)')).toBe('2026-11-09T08:00');
  // "Kỳ gần nhất" goes back to the most recent run (not a computed clock window)
  await page.getByRole('button', { name: 'Kỳ gần nhất' }).click();
  await expect(picker).toContainText('08/11 18:00 → 09/11 07:00');
  await expect.poll(() => field('Từ (gồm)')).toBe('2026-11-08T18:00');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(picker).toContainText('08/11 18:00 → 09/11 07:00'); // F5 → most recent again
  // not logged in: no delete
  await picker.click();
  await expect(page.getByRole('button', { name: /^Xoá lượt/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // a reviewer removes the on-demand run: hidden for the team (another browser), the latest remaining run opens; restore brings it back
  await login(page, 'Người duyệt E', 'HCM-TEST-CODE');
  await picker.click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Xoá lượt 08/11 18:00 → 09/11 07:00' }).click();
  await expect(picker).not.toContainText('08/11 18:00 → 09/11 07:00');
  const other = await page.context().browser()!.newPage();
  await other.goto(page.url());
  await other.waitForLoadState('networkidle');
  await other.getByTestId('run-picker').click();
  await expect(other.getByRole('listbox', { name: 'Danh sách các lượt' })).not.toContainText('08/11 18:00 → 09/11 07:00');
  await other.close();
  await picker.click();
  await page.getByText(/^Lượt đã xoá \(1\)/).click();
  await page.getByRole('button', { name: 'Khôi phục' }).click(); // the list stays open
  await expect(rows.filter({ hasText: '08/11 18:00 → 09/11 07:00' })).toHaveCount(1);
});
