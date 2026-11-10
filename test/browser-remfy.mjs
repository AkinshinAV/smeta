/* Прогон реального PDF через выбор файла. Сам файл в репозиторий не входит. */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const pdfPath = process.env.SMETA_REMFY_PDF || '/home/ubuntu/.cursor/projects/agent-repos-smeta/uploads/smeta_10168180_v4_386d.pdf';
if (!fs.existsSync(pdfPath)) {
  console.log('SKIP нет приватного PDF, путь не в репозитории');
  process.exit(0);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const port = 8799;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 300));

async function setInputFiles(page, selector, file) {
  const input = await page.$(selector);
  await input.uploadFile(file);
}

const browser = await puppeteer.launch({ executablePath: '/usr/local/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [];
function ok(name, cond, detail) { results.push({ name, ok: !!cond, detail: detail || '' }); console.log(cond ? 'OK' : 'FAIL', name, detail || ''); }

try {
  const page = await browser.newPage();
  page.on('dialog', async d => { await d.accept(); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  const build = await page.$eval('#buildTag', el => el.textContent);
  ok('на странице видна сборка', build.includes('20261110i'), build);
  await setInputFiles(page, '#imp-pdf', pdfPath);
  await page.evaluate(() => importPdfFile(document.getElementById('imp-pdf')));
  await page.waitForFunction(() => pdfDraft && pdfDraft.rows && pdfDraft.rows.length > 20, { timeout: 20000 });
  const preview = await page.evaluate(() => {
    const body = [...document.querySelectorAll('#pdfRows tr')].slice(1);
    const prices = body.map(tr => Number([...tr.querySelectorAll('input')][4].value));
    const rooms = {};
    for (const r of pdfDraft.rows) rooms[r.room] = (rooms[r.room] || 0) + 1;
    const norm = s => String(s || '').toLowerCase().replace(/[«»"()\s]/g, '');
    let strict = 0;
    for (const r of pdfDraft.rows) {
      if (r.catalog && norm(r.sourceName) === norm(r.catalog.name)) strict++;
    }
    return {
      msg: document.getElementById('pdfMsg').textContent.slice(0, 24),
      rows: pdfDraft.rows.length,
      checked: pdfDraft.rows.filter(r => r.include).length,
      strict,
      max: Math.max(...prices.filter(n => Number.isFinite(n))),
      over994: prices.filter(n => n > 994).length,
      rooms
    };
  });
  ok('в таблице 112 строк, не 111', preview.rows === 112, String(preview.rows));
  ok('помещения 14/20/11/37/7/23', preview.rooms['Комната'] === 14 && preview.rooms['Кухня'] === 20 && preview.rooms['Коридор'] === 11 && preview.rooms['Ванная'] === 37 && preview.rooms['Балкон'] === 7 && preview.rooms['Электрика'] === 23, JSON.stringify(preview.rooms));
  ok('цены выше 994 доходят до поля', preview.max > 994 && preview.over994 >= 30, 'max ' + preview.max + ' above ' + preview.over994);
  ok('совпадение каталога не равно числу строк', preview.strict >= 60 && preview.strict < preview.rows && preview.checked < preview.rows && preview.checked > preview.strict, JSON.stringify({ strict: preview.strict, checked: preview.checked, rows: preview.rows }));
  ok('диалог показывает сборку', preview.msg.includes('20261110i'), preview.msg);
  const beforeApply = await page.evaluate(() => ({
    estimates: LIB.objects[0].estimates.length,
    included: pdfDraft.rows.filter(r => r.include).reduce((s, r) => s + Math.round(r.price * r.qty), 0)
  }));
  await page.click('button[onclick="applyPdf(\'new\')"]');
  await page.waitForFunction(() => document.getElementById('pdfBox').hidden);
  const applied = await page.evaluate(() => ({
    estimates: LIB.objects[0].estimates.length,
    works: S.rooms.reduce((n, r) => n + r.works.length, 0),
    sum: S.rooms.reduce((n, r) => n + r.works.reduce((s, w) => s + Math.round(Number(w.price) * Number(w.qty)), 0), 0)
  }));
  ok('новая смета добавлена и сумма совпала с отмеченными строками', applied.estimates === beforeApply.estimates + 1 && applied.sum === beforeApply.included && applied.sum > 100000, 'sum ' + applied.sum + ' works ' + applied.works);
  await page.reload({ waitUntil: 'networkidle0' });
  const reloaded = await page.evaluate(() => S.rooms.reduce((n, r) => n + r.works.reduce((s, w) => s + Math.round(Number(w.price) * Number(w.qty)), 0), 0));
  ok('после перезагрузки сумма на месте', reloaded === applied.sum, String(reloaded));
  const beforeCopy = await page.evaluate(() => S.rooms.length);
  await page.evaluate(() => { S.tab = 0; render(); copyRoom(0); });
  const copied = await page.evaluate(() => ({ n: S.rooms.length, name: S.rooms[1] && S.rooms[1].name, works: S.rooms[1] && S.rooms[1].works.length, src: S.rooms[0].works.length }));
  ok('копия помещения сохраняет позиции', copied.n === beforeCopy + 1 && copied.name.includes('копия') && copied.works === copied.src && copied.works > 0, JSON.stringify(copied));
  ok('без исключений страницы', errors.length === 0, errors.join(' | '));
  if (results.some(r => !r.ok)) process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
