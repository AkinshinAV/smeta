/* Раскрытие раздела в комнате: Chromium и, если установлен, WebKit как на iPhone. */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const port = 8788;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 300));
const url = `http://127.0.0.1:${port}/index.html`;
const results = [];
function ok(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
  console.log(cond ? 'OK' : 'FAIL', name, detail || '');
}

async function exercise(page, label) {
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  const seeded = await page.evaluate(() => {
    S.rooms = [{ name: 'Кухня', L: '4', W: '3', H: '2.7', open: '', slopes: '', works: [
      { sec: 'Старый раздел', surf: 'Стены', name: 'Работа не из прайса', unit: 'шт', price: 10, qty: 1, base: 'manual', auto: false, ci: -1 }
    ] }];
    S.tab = 0;
    render();
    return {
      heads: [...document.querySelectorAll('#rooms .sech')].map(el => el.getAttribute('data-sec')),
      badge: document.body.innerText.includes('спецмонтаж')
    };
  });
  ok(label + ': разделы как в прайсе, без бейджа', seeded.heads[0] === 'Демонтажные работы' && seeded.heads.at(-2) === 'Спецмонтажные работы' && seeded.heads.at(-1) === 'Свои работы' && seeded.heads.includes('звукоизоляция') && !seeded.heads.includes('Возведение стен') && seeded.badge === false, seeded.heads.join(' | '));
  const head = page.locator ? page.locator('#rooms .sech').first() : null;
  if (head) {
    await head.tap();
  } else {
    await page.tap('#rooms .sech');
  }
  const opened = await page.evaluate(() => {
    const sec = document.querySelector('#rooms .catsec');
    return { open: sec.querySelector('.secbody').dataset.open, rows: sec.querySelectorAll('.wr').length, mark: sec.innerText.includes('▾') };
  });
  ok(label + ': тап раскрывает раздел', opened.open === '1' && opened.rows > 10 && opened.mark, JSON.stringify(opened));
  const box = page.locator ? page.locator('#rooms .catsec .wr input[type=checkbox]').first() : null;
  if (box) await box.tap();
  else await page.tap('#rooms .catsec .wr input[type=checkbox]');
  const checked = await page.evaluate(() => !!document.querySelector('#rooms .wr.on input[type=checkbox]:checked'));
  ok(label + ': галочка ставится', checked);
  if (head) await page.locator('#rooms .sech').first().tap();
  else await page.tap('#rooms .sech');
  const closed = await page.evaluate(() => {
    const sec = document.querySelector('#rooms .catsec');
    return { open: sec.querySelector('.secbody').dataset.open, rows: sec.querySelectorAll('.wr').length };
  });
  ok(label + ': повторный тап сворачивает', closed.open === '0' && closed.rows === 0, JSON.stringify(closed));
}

try {
  const chrome = await puppeteer.launch({ executablePath: '/usr/local/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await chrome.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.tap = (sel) => page.click(sel);
  page.locator = null;
  await exercise(page, 'chromium 1280');
  await chrome.close();

  let webkit;
  try { ({ webkit } = await import('playwright')); } catch { webkit = null; }
  if (!webkit) console.log('SKIP webkit iPhone: пакет playwright не установлен');
  else {
    const wb = await webkit.launch();
    const wp = await wb.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    await exercise(wp, 'webkit iPhone');
    await wb.close();
  }
} finally {
  server.kill();
}
const failed = results.filter(r => !r.ok);
if (failed.length) process.exitCode = 1;
