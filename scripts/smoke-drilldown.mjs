import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';
const art = '/opt/cursor/artifacts';
fs.mkdirSync(art, { recursive: true });

const tpl = {
  id: 'tpl_smoke_51',
  name: 'Smoke ДС 51',
  group: 'Тест',
  comment: '',
  structure: {
    rows: [{ id: 'row_51', name: 'Счёт 51', accounts: ['51'], expandBy: '', level: 0 }],
    columns: [
      {
        id: 'col_jan',
        name: 'Январь 2024',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        filters: [],
      },
    ],
    rules: {
      row_51: {
        col_jan: {
          type: 'db',
          indicatorType: 'turnover',
          metricType: 'active_balance',
          expandAnalytic: 'no',
        },
      },
    },
  },
  version: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isDeleted: false,
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const log = [];
const say = (m) => {
  console.log(m);
  log.push(m);
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate((t) => {
    localStorage.setItem('turbohub_report_templates_v1', JSON.stringify([t]));
  }, tpl);
  await page.reload({ waitUntil: 'networkidle' });

  await page.getByRole('button', { name: 'Источники данных' }).click();
  await page.locator('input[type="file"]').first().setInputFiles('/tmp/turbohub-fixtures/provodki.csv');
  await page.waitForTimeout(900);
  say('header: ' + (await page.locator('header').innerText()).replace(/\s+/g, ' '));

  await page.getByRole('button', { name: 'Отчёты' }).click();
  await page.getByRole('button', { name: 'Сводный отчёт', exact: true }).click();
  await page.waitForTimeout(400);

  // Source select
  const selects = page.locator('select');
  // first select in universal is SourcePicker
  await selects.nth(0).selectOption({ index: 1 });
  // template select
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Smoke' }) }).selectOption({ label: 'Smoke ДС 51' });
  await page.getByRole('button', { name: /Сформировать сводный/ }).click();
  await page.waitForTimeout(600);

  const cell = page.locator('td.cursor-pointer').first();
  const cellText = (await cell.innerText()).trim();
  say('cell: ' + cellText);
  await cell.click();
  await page.waitForSelector('text=Расшифровка ячейки');
  await page.waitForTimeout(300);
  const modal = page.locator('[role="dialog"]');
  const modalText = await modal.innerText();
  say('modal footer area: ' + modalText.slice(-200).replace(/\s+/g, ' '));
  if (!/Итого \(проверка\)/.test(modalText)) throw new Error('No footer total');
  // cell "1 300,75" style vs footer
  const footerMatch = modalText.match(/Итого \(проверка\):\s*([^\n]+)/);
  say('footer total: ' + (footerMatch?.[1] || ''));
  await page.screenshot({ path: path.join(art, 'drilldown-modal.png'), fullPage: true });
  say('DONE');
  fs.writeFileSync(path.join(art, 'smoke-drilldown.log'), log.join('\n'));
} catch (e) {
  say('FAIL: ' + e.message);
  await page.screenshot({ path: path.join(art, 'drilldown-fail.png'), fullPage: true }).catch(() => {});
  fs.writeFileSync(path.join(art, 'smoke-drilldown.log'), log.join('\n') + '\n' + e.stack);
  process.exitCode = 1;
} finally {
  await browser.close();
}
