import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
const art = '/opt/cursor/artifacts';
fs.mkdirSync(art, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const log = [];
const say = (m) => { console.log(m); log.push(m); };
try {
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Источники данных' }).click();
  await page.locator('input[type="file"]').first().setInputFiles('/tmp/turbohub-fixtures/provodki.csv');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Отчёты' }).click();
  await page.waitForSelector('text=Стандартные отчёты 1С');
  // no constructor tabs
  if (await page.getByRole('button', { name: 'Сводный отчёт', exact: true }).count()) throw new Error('pivot tab still present');
  if (await page.getByRole('button', { name: 'Шаблоны формул' }).count()) throw new Error('formulas tab still present');
  say('OK: only std reports UI');
  await page.locator('select').nth(0).selectOption({ index: 1 });
  await page.locator('input[type="date"]').nth(0).fill('2024-01-01');
  await page.locator('input[type="date"]').nth(1).fill('2024-01-31');
  await page.getByRole('button', { name: /Сформировать/ }).click();
  await page.waitForTimeout(500);
  const main = await page.locator('main').innerText();
  say(main.slice(0, 500).replace(/\s+/g, ' '));
  if (!/Сальдо нач/.test(main)) throw new Error('missing opening cols');
  if (!/Итого/.test(main)) throw new Error('missing totals');
  await page.screenshot({ path: path.join(art, 'std-osv-rewrite.png'), fullPage: true });
  // card
  await page.locator('select').nth(2).selectOption({ label: 'Карточка счёта' });
  await page.waitForTimeout(200);
  const accountSelect = page.locator('select').filter({ has: page.locator('option', { hasText: '51' }) }).last();
  await accountSelect.selectOption({ label: '51' });
  await page.getByRole('button', { name: /Сформировать/ }).click();
  await page.waitForTimeout(400);
  const card = await page.locator('main').innerText();
  if (!/Входящий остаток/.test(card)) throw new Error('no opening row in card');
  if (!/Исходящий остаток/.test(card)) throw new Error('no closing row in card');
  say('OK: account card');
  await page.screenshot({ path: path.join(art, 'std-card-rewrite.png'), fullPage: true });
  fs.writeFileSync(path.join(art, 'smoke-std-reports.log'), log.join('\n'));
  say('DONE');
} catch (e) {
  say('FAIL: ' + e.message);
  await page.screenshot({ path: path.join(art, 'std-fail.png'), fullPage: true }).catch(()=>{});
  fs.writeFileSync(path.join(art, 'smoke-std-reports.log'), log.join('\n')+'\n'+e.stack);
  process.exitCode = 1;
} finally { await browser.close(); }
