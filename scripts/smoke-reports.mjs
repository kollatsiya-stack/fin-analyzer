import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';
const art = '/opt/cursor/artifacts';
fs.mkdirSync(art, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const log = [];
const say = (m) => {
  console.log(m);
  log.push(m);
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('text=Turbohub ETL', { timeout: 15000 });
  say('OK: app loaded');

  const navLabels = ['Источники данных', 'Развёртывание субконто', 'Трансформация', 'Отчёты'];
  for (const label of navLabels) {
    const btn = page.getByRole('button', { name: label });
    if (!(await btn.count())) throw new Error('Missing nav: ' + label);
  }
  say('OK: 4 nav steps present');

  await page.getByRole('button', { name: 'Источники данных' }).click();
  await page.waitForSelector('text=Шаг 1');
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles('/tmp/turbohub-fixtures/provodki.csv');
  await page.waitForTimeout(1000);
  const header = await page.locator('header').innerText();
  say('header after upload: ' + header.replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: path.join(art, 'step1-sources.png'), fullPage: true });
  say('OK: upload attempted');

  // Make primary if possible
  const makePrimary = page.getByRole('button', { name: /основн/i });
  if (await makePrimary.count()) {
    await makePrimary.first().click();
    say('OK: set primary');
  }

  await page.getByRole('button', { name: 'Трансформация' }).click();
  await page.waitForSelector('text=Шаг 3');
  const step3 = await page.locator('main').innerText();
  if (!/правил|Правил|Обогащение/.test(step3)) throw new Error('Step 3 content unexpected');
  say('OK: step 3 rules registry visible');
  await page.screenshot({ path: path.join(art, 'step3-rules.png'), fullPage: true });

  await page.getByRole('button', { name: 'Отчёты' }).click();
  await page.waitForSelector('text=Шаг 4. Отчёты');
  for (const t of [
    'Стандартные отчёты 1С',
    'Шаблоны формул',
    'Шаблоны отчётов',
    'Универсальный отчёт',
  ]) {
    if (!(await page.getByRole('button', { name: t }).count())) throw new Error('Missing tab: ' + t);
  }
  say('OK: report tabs present');
  await page.screenshot({ path: path.join(art, 'step4-reports.png'), fullPage: true });

  await page.getByRole('button', { name: 'Шаблоны формул' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(art, 'step4-formulas.png'), fullPage: true });
  say('OK: formulas tab');

  await page.getByRole('button', { name: 'Шаблоны отчётов' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(art, 'step4-templates.png'), fullPage: true });
  say('OK: templates tab');

  await page.getByRole('button', { name: 'Универсальный отчёт' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(art, 'step4-universal.png'), fullPage: true });
  say('OK: universal tab');

  await page.getByRole('button', { name: 'Стандартные отчёты 1С' }).click();
  const sourceSelect = page.locator('select').first();
  const options = await sourceSelect.locator('option').allTextContents();
  say('source options: ' + JSON.stringify(options));
  if (options.length > 1) {
    await sourceSelect.selectOption({ index: 1 });
    const runBtn = page.getByRole('button', { name: /Сформировать|Построить|Рассчитать/i }).first();
    if (await runBtn.count()) {
      await runBtn.click();
      await page.waitForTimeout(600);
      const main = await page.locator('main').innerText();
      say('after osv: ' + main.slice(0, 400).replace(/\s+/g, ' '));
      say('OK: ran std report');
    }
  } else {
    say('WARN: no source in registry for OSV');
  }
  await page.screenshot({ path: path.join(art, 'step4-std-osv.png'), fullPage: true });

  fs.writeFileSync(path.join(art, 'smoke-reports.log'), log.join('\n'));
  say('DONE');
} catch (e) {
  say('FAIL: ' + e.message);
  await page.screenshot({ path: path.join(art, 'smoke-fail.png'), fullPage: true }).catch(() => {});
  fs.writeFileSync(path.join(art, 'smoke-reports.log'), log.join('\n') + '\n' + (e.stack || ''));
  process.exitCode = 1;
} finally {
  await browser.close();
}
