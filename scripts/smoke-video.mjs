import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const art = '/opt/cursor/artifacts';
fs.mkdirSync(art, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  recordVideo: { dir: art, size: { width: 1280, height: 720 } },
  viewport: { width: 1280, height: 720 },
});
const page = await context.newPage();
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Источники данных' }).click();
await page.locator('input[type="file"]').first().setInputFiles('/tmp/turbohub-fixtures/provodki.csv');
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Трансформация' }).click();
await page.waitForSelector('text=Шаг 3');
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Отчёты' }).click();
await page.waitForSelector('text=Шаг 4');
await page.locator('select').first().selectOption({ index: 1 });
await page.getByRole('button', { name: /Сформировать/ }).click();
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Шаблоны формул' }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Шаблоны отчётов' }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Универсальный отчёт' }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Стандартные отчёты 1С' }).click();
await page.waitForTimeout(400);
const video = page.video();
await context.close();
await browser.close();
const vpath = await video.path();
const dest = path.join(art, 'reports-walkthrough.webm');
fs.renameSync(vpath, dest);
console.log('video:', dest, fs.statSync(dest).size);
