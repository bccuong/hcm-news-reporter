/** Screenshot the built GitHub Pages site (served by `vite preview --mode pages`) for visual QA. */
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:5180/hcm-news-reporter/';
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'msedge' });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
await page.goto(url);
await page.getByTestId('live-banner').waitFor({ timeout: 20000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'docs/screenshots/pages-live.png' });
await page.getByRole('button', { name: /Độ phủ/ }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: 'docs/screenshots/pages-live-coverage.png', fullPage: false });
console.log('title:', await page.title(), '| banner:', (await page.getByTestId('live-banner').innerText()).slice(0, 120));
await browser.close();
