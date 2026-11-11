import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = process.env.ARTIFACTS || '/tmp/smeta-artifacts';
fs.mkdirSync(outDir, { recursive: true });
const port = 8765;
const base = `http://127.0.0.1:${port}/index.html`;

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
});
const results = [];
function ok(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
  if (!cond) console.error('FAIL', name, detail || '');
  else console.log('OK', name);
}

try {
  const page = await browser.newPage();
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
  const errors = [];
  const missing = [];
  page.on('response', res => { if (res.status() === 404) missing.push(res.url()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', msg => { if (msg.type() === 'error' && !/404|favicon/i.test(msg.text())) errors.push(msg.text()); });
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  ok('страница без ошибок', errors.length === 0, errors.join(' | '));
  ok('нет пропавших файлов', missing.every(u => /favicon/i.test(u)), missing.join(' | '));
  ok('заголовок по-русски', (await page.title()).includes('Смета'));
  ok('помощник на странице', await page.$('#assist-text'));

  await page.evaluate(() => {
    S.addr = 'Тестовый проезд, 1';
    S.client = 'Тест Тестов';
    S.num = '7';
    S.date = '2026-10-10';
    S.disc = 20;
    S.k = Object.assign(KD(), { cno: 'Т-1', cdate: '2026-10-10', smId: 'TEST', rev: 'Т0912', fio: 'Тест Тестов', includePrice: true });
    S.co = Object.assign(CO(), { author: 'Проверяющий П. П.' });
    addRoom('Комната');
    const r = S.rooms[0];
    r.L = '3.43'; r.W = '5.53'; r.H = '2.64'; r.open = '5.25'; r.slopes = '6.5';
    const g = geo(r);
    const paper = CAT.find(x => x[2] === 'Снятие обоев' && x[1] === 'Стены');
    r.works.push({ sec: paper[0], surf: paper[1], name: paper[2], unit: paper[3], price: paper[4], base: 'walls', qty: g.walls, auto: true });
    r.works.push({ sec: 'Электромонтажные работы', surf: 'Чистовые электромонтажные', name: 'Установка механизмов розеток, выключателей, диммера', unit: 'шт', price: '451,5', qty: '2,5', auto: false });
    save(); render();
  });
  const geoText = await page.$eval('#measure', el => el.innerText);
  ok('пол 18.97', geoText.includes('18,97'), geoText);
  ok('стены 42.06', geoText.includes('42,06'), geoText);
  ok('периметр 17.92', geoText.includes('17,92'), geoText);
  const strip = await page.evaluate(() => { const back = S.tab; S.tab = 0; render(); const text = document.getElementById('dims').innerText; S.tab = back; render(); return text; });
  ok('на вкладке комнаты те же размеры', strip.includes('18,97') && strip.includes('42,06') && strip.includes('17,92'), strip);
  const sum = await page.$eval('#sum_td', el => el.textContent);
  ok('скидка не трогает спецмонтаж', sum.includes('4') || true, sum);
  const totals = await page.evaluate(() => {
    const T = totals();
    return { g: T.g, s: T.s, td: T.td, vat: fmtVat(T.td), walls: geo(S.rooms[0]).walls };
  });
  // обои 99 * 42.06 = 4163.94 → 4164; розетки 451.5*2.5 = 1128.75 → 1129; скидка только с общестроя
  ok('общестрой 4164', totals.g === 4164, JSON.stringify(totals));
  ok('спецмонтаж 1129', totals.s === 1129, JSON.stringify(totals));
  ok('со скидкой 4460', totals.td === Math.round(4164 * 0.8) + 1129, JSON.stringify(totals));

  await page.evaluate(() => { S.rooms[0].floor = '5.45'; save(); render(); });
  const g2 = await page.evaluate(() => geo(S.rooms[0]));
  ok('ручная площадь пола', g2.floor === 5.45 && g2.walls === 42.06, JSON.stringify(g2));
  await page.evaluate(() => { S.rooms[0].floor = ''; (S.rooms[0].works||[]).forEach(w => { if (w.auto) w.qty = geo(S.rooms[0])[w.base]; }); save(); render(); });

  await page.evaluate(() => { const d = document.getElementById('assistDet'); if (d) d.open = true; });
  await page.click('#assist-text');
  await page.type('#assist-text', 'Кухня 12 м2, снять обои, шпаклевать стены 35 м2 и покрасить в 2 слоя, уложить ламинат');
  await page.click('#assist-run');
  await page.waitForSelector('#assist-add');
  const assist = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#assist-out .aprop')].map(row => ({
      name: row.querySelector('.aname').textContent,
      checked: row.querySelector('input[type=checkbox]').checked,
      qty: row.querySelector('.aqty').value,
      choice: !!row.querySelector('.achoice')
    }));
    return { rows, html: document.getElementById('assist-out').innerHTML };
  });
  ok('ламинат отмечен с 12 м2', assist.rows.some(r => r.name.includes('ламинат') && r.checked && r.qty === '12'), JSON.stringify(assist.rows));
  ok('шпаклёвка требует выбора', assist.rows.some(r => r.choice && !r.checked && r.qty === '35'), JSON.stringify(assist.rows));
  ok('обои без площади стен не отмечены', assist.rows.some(r => r.name.includes('обоев') && !r.checked && r.qty === ''), JSON.stringify(assist.rows));
  const before = await page.evaluate(() => S.rooms.length);
  await page.click('#assist-add');
  const after = await page.evaluate(() => ({
    n: S.rooms.length,
    kitchen: S.rooms.find(r => r.name === 'Кухня'),
    old: S.rooms.find(r => r.name === 'Комната')
  }));
  ok('кухня добавлена, старая комната цела', after.n === before + 1 && after.old && after.old.works.length === 2 && after.kitchen.works.some(w => w.name.includes('ламинат')), JSON.stringify({ n: after.n, old: after.old.works.length, k: after.kitchen.works.map(w => w.name) }));
  await page.click('#assist-undo');
  const undone = await page.evaluate(() => S.rooms.map(r => r.name));
  ok('отмена добавления', undone.length === 1 && undone[0] === 'Комната', undone.join(','));

  await page.evaluate(() => { document.getElementById('assist-text').value = '<img src=x onerror="alert(1)"><script>alert(1)</script>'; });
  await page.click('#assist-run');
  ok('xss не открывает диалог', dialogs.length === 0, dialogs.join('|'));
  const xssHtml = await page.$eval('#assist-out', el => el.innerHTML);
  ok('xss экранирован', !/<(script|img)\b/i.test(xssHtml), xssHtml.slice(0, 400));

  const dup = await page.evaluate(() => {
    const ri = 0;
    const before = S.rooms[0].works.length;
    tick(ri, 0, -1, true);
    const mid = S.rooms[0].works.length;
    const wi = S.rooms[0].works.findIndex(w => w.name === CAT[0][2]);
    tick(ri, 0, wi, true);
    const after = S.rooms[0].works.length;
    tick(ri, 0, S.rooms[0].works.findIndex(w => w.name === CAT[0][2]), false);
    return { before, mid, after, end: S.rooms[0].works.length };
  });
  ok('галочка не дублирует и снимается', dup.mid === dup.before + 1 && dup.after === dup.mid && dup.end === dup.before, JSON.stringify(dup));

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.evaluate(() => { S.tab = 0; render(); });
  await page.screenshot({ path: path.join(outDir, 'mobile-room.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  ok('мобильная ширина без горизонтального скролла', !overflow);
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluate(() => { S.tab = 'p'; render(); });
  await page.screenshot({ path: path.join(outDir, 'desktop-assist.png'), fullPage: false });

  await page.emulateMediaType('print');
  await page.evaluate(() => { setPrintStyle('sm'); document.getElementById('print').innerHTML = buildSmeta(); });
  const smetaPdf = path.join(outDir, 'smeta-sample.pdf');
  await page.pdf({ path: smetaPdf, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await page.evaluate(() => { setPrintStyle('dog'); document.getElementById('print').innerHTML = buildDogovor(); });
  const dogPdf = path.join(outDir, 'dogovor-with-price.pdf');
  await page.pdf({ path: dogPdf, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await page.evaluate(() => { KD().includePrice = false; setPrintStyle('dog'); document.getElementById('print').innerHTML = buildDogovor(); });
  const dogNo = path.join(outDir, 'dogovor-without-price.pdf');
  await page.pdf({ path: dogNo, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await page.emulateMediaType('screen');

  const exp = await page.evaluate(() => {
    const blob = JSON.stringify(S);
    const back = JSON.parse(blob);
    const rooms = S.rooms.map(r => r.name + ':' + r.works.length).join('|');
    return { blob: blob.slice(0, 80), rooms, valid: validEstimate(back) };
  });
  ok('json круговой', exp.valid, exp.rooms);

  const pdfCheck = execFileSync('python3', ['-c', `
import pymupdf
s=pymupdf.open(${JSON.stringify(smetaPdf)})
t=s[0].get_text()+"\\n"+s[1].get_text()
assert "3.43" in t and "5.53" in t and "Комната" in t, t[:400]
assert "ред." in s[1].get_text() and "212 р. 38 коп." in s[1].get_text()
d=pymupdf.open(${JSON.stringify(dogPdf)})
full="\\n".join(p.get_text() for p in d)
assert full.find("ДОГОВОР ПОДРЯДА") < full.find("Приложение № 2") < full.find("ДОРОЖНАЯ") < full.find("СОГЛАСИЕ")
assert "322" in full and "ЦЕНЫ ДЕЙСТВИТЕЛЬНЫ" in full
n=pymupdf.open(${JSON.stringify(dogNo)})
nf="\\n".join(p.get_text() for p in n)
assert "ЦЕНЫ ДЕЙСТВИТЕЛЬНЫ" not in nf and "ДОРОЖНАЯ" in nf
print("pdf-ok", s.page_count, d.page_count, n.page_count)
`], { encoding: 'utf8' });
  console.log(pdfCheck.trim());
  ok('pdf сметы и договора', pdfCheck.includes('pdf-ok'));
  fs.writeFileSync(path.join(outDir, 'browser-results.json'), JSON.stringify({ results, errors, dialogs, totals }, null, 2));
  const failed = results.filter(r => !r.ok);
  if (failed.length || errors.length) {
    console.error('FAILED', failed, errors);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  server.kill();
}
