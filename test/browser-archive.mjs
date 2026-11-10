import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = process.env.ARTIFACTS || '/tmp/smeta-archive';
fs.mkdirSync(outDir, { recursive: true });
const port = 8793;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 300));
const browser = await puppeteer.launch({ executablePath: '/usr/local/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [];
function ok(name, cond, detail) { results.push({ name, ok: !!cond, detail: detail || '' }); console.log(cond ? 'OK' : 'FAIL', name, detail || ''); }

const legacy = { addr: 'Старый адрес', client: 'Старый заказчик', objectName: 'Старый объект', num: '9', date: '2026-01-02', disc: 0, rooms: [{ name: 'Комната', works: [{ sec: 'Малярные работы', name: 'Работа', price: 10, qty: 1 }] }], usePriceList: false };

async function boot(page, url, seed) {
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(s => {
    localStorage.clear();
    if (s.v1) localStorage.setItem('smeta_v1', s.v1);
    if (s.v2) localStorage.setItem('smeta_v2', s.v2);
    if (s.price) localStorage.setItem('smeta_price', s.price);
    if (s.co) localStorage.setItem('smeta_co', s.co);
  }, seed || {});
  await page.reload({ waitUntil: 'networkidle0' });
}

try {
  const page = await browser.newPage();
  page.on('dialog', async d => { await d.accept(); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewport({ width: 1100, height: 900 });

  await boot(page, `http://127.0.0.1:${port}/index.html`, { v1: JSON.stringify(legacy), price: '[{"name":"x","p":1}]', co: '{"city":"г. Москва"}' });
  const rootMig = await page.evaluate(() => ({
    addr: document.getElementById('o_addr').value,
    client: document.getElementById('o_client').value,
    v1: localStorage.getItem('smeta_v1'),
    backup: localStorage.getItem('smeta_v1_backup'),
    price: localStorage.getItem('smeta_price'),
    lib: localStorage.getItem('smeta_v1_library') ? 1 : 0
  }));
  ok('старая смета не стёрта и не подмешана в новый список', rootMig.v1 === JSON.stringify(legacy) && rootMig.backup === JSON.stringify(legacy) && rootMig.price === '[{"name":"x","p":1}]' && rootMig.lib === 1 && rootMig.client === '' && rootMig.addr === '', JSON.stringify(rootMig));

  await page.evaluate(() => {
    S.objectName = 'Объект A'; S.client = 'Альфа'; S.addr = 'Адрес А';
    S.rooms = [{ name: 'Комната', L: '2', W: '3', H: '2.5', open: '', slopes: '', works: [{ sec: 'Малярные работы', name: 'А', price: 100, qty: 2 }] }];
    save();
    const second = SmetaLib.addEstimate(LIB, LIB.activeObjectId, blank());
    adopt(second.estimate);
    S.num = '2';
    S.rooms = [{ name: 'Комната', works: [{ sec: 'Малярные работы', name: 'А2', price: 10, qty: 1 }] }];
    save();
    const obj = SmetaLib.addObject(LIB, { name: 'Объект B', client: 'Бета', addr: 'Адрес Б' }, blank());
    adopt(obj.estimates[0].estimate);
    S.objectName = 'Объект B'; S.client = 'Бета'; S.addr = 'Адрес Б';
    S.rooms = [{ name: 'Комната', works: [{ sec: 'Малярные работы', name: 'Б', price: 50, qty: 1 }] }];
    save();
    const extra = SmetaLib.addEstimate(LIB, LIB.activeObjectId, blank());
    adopt(extra.estimate);
    S.rooms = [{ name: 'Комната', works: [{ sec: 'Малярные работы', name: 'Б2', price: 7, qty: 3 }] }];
    save();
  });
  await page.reload({ waitUntil: 'networkidle0' });
  const afterReload = await page.evaluate(() => ({ client: document.getElementById('o_client').value, counts: LIB.objects.map(o => o.estimates.length) }));
  ok('после перезагрузки открыта последняя смета и оба объекта на месте', afterReload.client === 'Бета' && afterReload.counts.length === 2 && afterReload.counts.every(n => n === 2), JSON.stringify(afterReload));
  await page.evaluate(() => showLib());
  await page.screenshot({ path: path.join(outDir, 'objects-list.png') });
  const statusText = await page.$eval('#saveState', el => el.textContent);
  ok('без сервера нет ложной надписи о сохранении на сервере', statusText.includes('этом устройстве') && !statusText.includes('Сохранено на сервере'), statusText);
  await page.evaluate(() => { const obj = LIB.objects.find(o => o.client === 'Альфа'); openEst(obj.id, obj.estimates[0].id); });
  const backA = await page.evaluate(() => ({ client: S.client, sum: estSum(S), name: S.objectName }));
  ok('возврат к A сохраняет заказчика и сумму', backA.client === 'Альфа' && backA.sum === 200, JSON.stringify(backA));
  await page.screenshot({ path: path.join(outDir, 'object-card.png') });

  await page.evaluate(() => { S.tab = 0; render(); });
  await page.click('#rooms .sech');
  const rowResult = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#rooms .wr')].find(el => !el.querySelector('input[type=checkbox]').checked);
    const cb = row.querySelector('input[type=checkbox]');
    row.querySelector(':scope > div').click();
    const live = document.querySelector('#rooms .wr.on input[type=checkbox]');
    return { now: !!(live && live.checked) };
  });
  ok('клик по строке переключает один раз', rowResult.now === true, JSON.stringify(rowResult));
  await page.click('#rooms .wr input[data-k="qty"]');
  const stayed = await page.$eval('#rooms .wr input[type=checkbox]', el => el.checked);
  ok('клик по количеству не снимает галочку', stayed === true);
  await page.click('#rooms .wr input[type=checkbox]');
  const off = await page.$eval('#rooms .wr input[type=checkbox]', el => el.checked);
  ok('сам квадратик снимает галочку один раз', off === false);

  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.evaluate(() => { const d = document.querySelector('.more'); if (d) d.open = true; });
  await page.click('button[onclick="doPrint(\'sm\')"]');
  const printed = await page.evaluate(() => ({ n: window.__printed, preview: document.body.classList.contains('print-preview'), text: document.getElementById('print').innerText.includes('Альфа') || document.getElementById('print').innerText.includes('Адрес А'), bar: !document.getElementById('printBar').hidden }));
  ok('печать текущего объекта без setTimeout', printed.n === 1 && printed.preview && printed.text && printed.bar, JSON.stringify(printed));
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(outDir, 'mobile-print.png'), fullPage: false });
  await page.click('#printBar button[onclick="window.print()"]');
  const second = await page.evaluate(() => window.__printed);
  ok('повторная печать из просмотра', second === 2, String(second));
  await page.evaluate(() => closePrintPreview());

  const corrupt = await page.evaluate(() => {
    const raw = '{';
    localStorage.setItem('smeta_v1_library', raw);
    return raw;
  });
  await page.reload({ waitUntil: 'networkidle0' });
  const damaged = await page.evaluate(() => localStorage.getItem('smeta_v1_library_damaged'));
  ok('повреждённый архив сохранён копией', damaged === corrupt, damaged);

  await boot(page, `http://127.0.0.1:${port}/preview-v2/index.html`, { v1: JSON.stringify(legacy), v2: JSON.stringify(Object.assign({}, legacy, { client: 'Только v2', addr: 'Адрес v2' })) });
  const prev = await page.evaluate(() => ({
    client: document.getElementById('o_client').value,
    v1: localStorage.getItem('smeta_v1'),
    banner: document.querySelector('.preview-banner')?.innerText || '',
    bath: catP(CAT.findIndex(c => c[2] === 'Грунтовка пола (за 1 слой)'), 'Ванная')
  }));
  ok('preview читает только v2', prev.client === 'Только v2' && prev.v1 === JSON.stringify(legacy), JSON.stringify(prev));
  ok('preview сохранил свою цену ванной', prev.bath === 99, String(prev.bath));
  ok('у preview есть пометка тестовой версии', prev.banner.includes('Тестовая версия'));
  await page.evaluate(() => { addRoom('Комната'); S.tab = S.rooms.length - 1; render(); });
  await page.click('#rooms .sech');
  const prevOn = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#rooms .wr')].find(el => !el.querySelector('input[type=checkbox]').checked);
    const cb = row.querySelector('input[type=checkbox]');
    row.querySelector(':scope > div').click();
    const live = document.querySelector('#rooms .wr.on input[type=checkbox]');
    return !!(live && live.checked);
  });
  await page.click('#rooms .wr.on input[data-k="qty"]');
  const prevStay = await page.$eval('#rooms .wr.on input[type=checkbox]', el => el.checked);
  ok('preview: клик по строке один раз и поле количества не мешает', prevOn === true && prevStay === true);
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.click('button[onclick="doPrint(\'dog\')"]');
  const dog = await page.evaluate(() => ({ n: window.__printed, has: document.getElementById('print').innerText.includes('ДОГОВОР'), banner: document.getElementById('print').innerText.includes('Тестовая версия') }));
  ok('договор preview печатается и без тестовой полосы', dog.n === 1 && dog.has && !dog.banner, JSON.stringify(dog));

  async function guardLibrary(url, key) {
    const secret = JSON.stringify({ items: 'broken', valuableData: 'SECRET-' + key });
    const second = JSON.stringify({ items: null, valuableData: 'SECOND-' + key });
    const third = JSON.stringify({ items: [{ id: 'x', estimate: { rooms: 'нет' } }], valuableData: 'THIRD-' + key });
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.evaluate((k, raw) => { localStorage.clear(); localStorage.setItem(k, raw); }, key, secret);
    await page.reload({ waitUntil: 'networkidle0' });
    const first = await page.evaluate(k => ({ damaged: localStorage.getItem(k + '_damaged'), current: localStorage.getItem(k) }), key);
    const kept = first.damaged === secret && first.current !== secret && !String(first.current).includes('SECRET');
    await page.evaluate((k, raw) => {
      localStorage.setItem(k + '_damaged', 'KEEP-' + k);
      localStorage.setItem(k, raw);
    }, key, second);
    await page.reload({ waitUntil: 'networkidle0' });
    const next = await page.evaluate(k => ({ keep: localStorage.getItem(k + '_damaged'), alt: localStorage.getItem(k + '_damaged_2') }), key);
    const rotated = next.keep === 'KEEP-' + key && next.alt === second;
    await page.evaluate((k, raw) => {
      for (let i = 1; i <= 20; i++) localStorage.setItem(k + '_damaged' + (i === 1 ? '' : '_' + i), 'OTHER-' + i);
      localStorage.setItem(k, raw);
    }, key, third);
    await page.reload({ waitUntil: 'networkidle0' });
    const stopped = await page.evaluate((k, raw) => {
      const same = [];
      for (let i = 1; i <= 20; i++) same.push(localStorage.getItem(k + '_damaged' + (i === 1 ? '' : '_' + i)) === 'OTHER-' + i);
      const before = localStorage.getItem(k);
      save();
      showLib();
      return { unchanged: before === raw && localStorage.getItem(k) === raw, copies: same.every(Boolean), readOnly: saveState.readOnly, held: saveState.heldRaw === raw, button: !!document.querySelector('button[onclick="downloadHeld()"]') };
    }, key, third);
    return kept && rotated && stopped.unchanged && stopped.copies && stopped.readOnly && stopped.held && stopped.button;
    return kept && rotated && stopped.unchanged && stopped.copies && stopped.readOnly;
  }
  ok('корень не затирает битую библиотеку', await guardLibrary(`http://127.0.0.1:${port}/index.html`, 'smeta_v1_library'));
  ok('preview не затирает битую библиотеку', await guardLibrary(`http://127.0.0.1:${port}/preview-v2/index.html`, 'smeta_v2_library'));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  const rootPrice = await page.evaluate(() => catP(CAT.findIndex(c => c[2] === 'Грунтовка пола (за 1 слой)')));
  ok('корень не получил цену ванной из preview', rootPrice === 79, String(rootPrice));
  ok('страницы без исключений', errors.length === 0, errors.join(' | '));

  const failed = results.filter(r => !r.ok);
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  if (failed.length) process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
