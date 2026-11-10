import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = process.env.ARTIFACTS || '/tmp/smeta-params';
fs.mkdirSync(outDir, { recursive: true });
const port = 8794;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 300));
const browser = await puppeteer.launch({ executablePath: '/usr/local/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [];
function ok(name, cond, detail) { results.push({ name, ok: !!cond, detail: detail || '' }); console.log(cond ? 'OK' : 'FAIL', name, detail || ''); }

try {
  const page = await browser.newPage();
  page.on('dialog', async d => { await d.accept(); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });

  await page.evaluate(() => {
    S.objectName = 'Демо-дом';
    S.addr = 'ул. Пример, 1';
    S.client = 'Демо заказчик';
    S.num = '1';
    S.rooms = [{ name: 'Комната', L: '4', W: '5', H: '2.7', open: '', slopes: '', works: [{ sec: 'Малярные работы', name: 'Покраска', price: 100, qty: 2 }] }];
    save();
    const extra = SmetaLib.addEstimate(LIB, LIB.activeObjectId, blank());
    extra.estimate.num = '2';
    extra.estimate.rooms = [{ name: 'Кухня', works: [{ sec: 'Малярные работы', name: 'Плитка', price: 50, qty: 1 }] }];
    const other = SmetaLib.addObject(LIB, { name: 'Второй дом', client: 'Другой', addr: 'ул. Вторая, 2' }, blank());
    other.estimates[0].estimate.num = '9';
    other.estimates[0].estimate.rooms = [{ name: 'Комната', works: [{ sec: 'Малярные работы', name: 'Б', price: 10, qty: 1 }] }];
    const home = LIB.objects.find(o => o.name === 'Демо-дом');
    LIB.activeObjectId = home.id;
    LIB.activeEstimateId = home.estimates[0].id;
    persistLib();
    adopt(home.estimates[0].estimate);
    showLib();
  });

  const workBefore = await page.evaluate(() => document.getElementById('libView').innerText);
  ok('рабочий список показывает оба объекта и обе сметы', workBefore.includes('Демо-дом') && workBefore.includes('Второй дом') && workBefore.includes('Смета № 1') && workBefore.includes('Смета № 2') && !workBefore.includes('Архив объектов'), workBefore.slice(0, 400));
  const serverClosed = await page.evaluate(() => {
    const det = [...document.querySelectorAll('#libView details')].find(d => (d.querySelector('summary') || {}).textContent.includes('Подключение сервера'));
    const url = document.getElementById('srvUrl');
    const display = url ? getComputedStyle(url).display : '';
    const box = url ? url.getBoundingClientRect() : { height: -1 };
    return { open: det ? det.open : null, display, height: box.height };
  });
  ok('поля сервера свёрнуты', serverClosed.open === false && serverClosed.height === 0, JSON.stringify(serverClosed));
  await page.screenshot({ path: path.join(outDir, 'objects-work.png'), fullPage: true });

  await page.evaluate(() => {
    const obj = LIB.objects.find(o => o.name === 'Демо-дом');
    const est = obj.estimates.find(e => e.estimate.num === '2');
    archiveEst(obj.id, est.id);
  });
  const afterEst = await page.evaluate(() => {
    const text = document.getElementById('libView').innerText;
    const obj = LIB.objects.find(o => o.name === 'Демо-дом');
    const est = obj.estimates.find(e => e.estimate.num === '2');
    return { text, archived: est.archived, stillThere: text.includes('Смета № 2') };
  });
  ok('смета после «В архив» исчезает из рабочего списка и не удаляется', afterEst.archived === true && afterEst.stillThere === false && afterEst.text.includes('Смета № 1'), afterEst.text.slice(0, 300));

  await page.evaluate(() => {
    const obj = LIB.objects.find(o => o.name === 'Второй дом');
    archiveObj(obj.id);
  });
  const afterObj = await page.evaluate(() => {
    const text = document.getElementById('libView').innerText;
    const obj = LIB.objects.find(o => o.name === 'Второй дом');
    return { text, archived: obj.archived, shown: text.includes('Второй дом') };
  });
  ok('объект после «Объект в архив» уходит с рабочего экрана', afterObj.archived === true && afterObj.shown === false, afterObj.text.slice(0, 300));

  await page.evaluate(() => setLibMode('archive'));
  const archiveView = await page.evaluate(() => document.getElementById('libView').innerText);
  ok('архив — короткие строки с возвратом', archiveView.includes('Второй дом') && archiveView.includes('Смета № 2') && archiveView.includes('Вернуть') && !archiveView.includes('Править карточку') && !archiveView.includes('Дублировать'), archiveView.slice(0, 500));
  await page.screenshot({ path: path.join(outDir, 'objects-archive.png'), fullPage: true });

  await page.evaluate(() => {
    const obj = LIB.objects.find(o => o.name === 'Второй дом');
    restoreObj(obj.id);
    const home = LIB.objects.find(o => o.name === 'Демо-дом');
    const est = home.estimates.find(e => e.estimate.num === '2');
    restoreEst(home.id, est.id);
    setLibMode('work');
  });
  const restored = await page.evaluate(() => {
    const text = document.getElementById('libView').innerText;
    return { text, home: !LIB.objects.find(o => o.name === 'Демо-дом').estimates.find(e => e.estimate.num === '2').archived, other: !LIB.objects.find(o => o.name === 'Второй дом').archived };
  });
  ok('возврат из архива снова показывает записи в рабочем списке', restored.home && restored.other && restored.text.includes('Второй дом') && restored.text.includes('Смета № 2'), restored.text.slice(0, 300));

  await page.evaluate(() => {
    hideLib();
    S.tab = 'p';
    S.rooms = [];
    render();
    addRoom('Комната');
    addRoom('Кухня');
    addRoom('Электрика', true);
  });
  const stayed = await page.evaluate(() => ({
    tab: S.tab,
    names: S.rooms.map(r => r.name),
    catalog: document.getElementById('rooms').innerHTML.length,
    table: document.querySelector('#measure table') ? document.querySelector('#measure table').innerText : ''
  }));
  ok('добавление помещений с параметров оставляет вкладку замера', stayed.tab === 'p' && stayed.names.join(',') === 'Комната,Кухня,Электрика' && stayed.catalog === 0 && stayed.table.includes('Помещение') && stayed.table.includes('без размеров'), JSON.stringify(stayed.names) + ' ' + stayed.table.slice(0, 180));

  await page.evaluate(() => {
    const set = (k, v) => {
      const el = document.querySelector(`#measure input[data-r="0"][data-k="${k}"]`);
      el.value = v;
      el.dispatchEvent(new Event('change'));
    };
    set('L', '3.43');
    set('W', '5.53');
    set('H', '2.64');
    set('open', '5.25');
    set('slopes', '6.5');
  });
  const geoRow = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#measure tr')].find(tr => tr.innerText.includes('Комната'));
    const g = geo(S.rooms[0]);
    return { tab: S.tab, text: cells ? cells.innerText : '', floor: g.floor, perim: g.perim, walls: g.walls };
  });
  ok('3.43 / 5.53 / 2.64 / X=5.25 дают S=18.97, P=17.92, W=42.06 и вкладка не уходит', geoRow.tab === 'p' && geoRow.floor === 18.97 && geoRow.perim === 17.92 && geoRow.walls === 42.06 && geoRow.text.includes('18.97') && geoRow.text.includes('17.92') && geoRow.text.includes('42.06'), JSON.stringify(geoRow));
  await page.screenshot({ path: path.join(outDir, 'measure.png'), fullPage: true });

  await page.evaluate(() => { S.tab = 's'; render(); });
  const summary = await page.evaluate(() => ({
    tab: S.tab,
    text: document.getElementById('summary').innerText,
    tabs: document.getElementById('tabs').innerText
  }));
  ok('сводная оставляет вкладки и показывает стоимости помещений', summary.tab === 's' && summary.tabs.includes('Параметры замера') && summary.tabs.includes('Комната') && summary.text.includes('18.97') && summary.text.includes('Итого'), summary.text.slice(0, 240));
  await page.screenshot({ path: path.join(outDir, 'summary.png'), fullPage: true });

  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => { S.tab = 'p'; render(); });
  const narrow = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    table: !!document.querySelector('#measure table')
  }));
  ok('узкий экран параметров не разъезжается по горизонтали', narrow.table && !narrow.overflow, JSON.stringify(narrow));
  await page.screenshot({ path: path.join(outDir, 'measure-narrow.png'), fullPage: true });
  const beforeBug = await page.evaluate(() => ({ n: LIB.objects.length, arch: SmetaLib.archiveList(LIB.objects).length, ids: SmetaLib.workList(LIB.objects).map(row => row.id) }));
  await page.evaluate(ids => { showLib(); ids.forEach(id => archiveObj(id)); }, beforeBug.ids);
  const bug = await page.evaluate(() => {
    const text = document.getElementById('libView').innerText;
    return {
      n: LIB.objects.length,
      work: SmetaLib.workList(LIB.objects).length,
      arch: SmetaLib.archiveList(LIB.objects).length,
      blank: LIB.objects.some(o => !o.archived && !(o.name || '').trim()),
      text: text.includes('Без названия') || text.includes('Демо-дом') || text.includes('Второй дом'),
      archMode: text.includes('Архив')
    };
  });
  ok('архив всех рабочих объектов не оставляет пустышку и увеличивает счётчик', bug.n === beforeBug.n && bug.work === 0 && bug.arch > beforeBug.arch && bug.blank === false && bug.text === false, JSON.stringify({ beforeBug, bug }));
  const backId = await page.evaluate(() => {
    const row = SmetaLib.archiveList(LIB.objects).find(r => r.type === 'object');
    restoreObj(row.id);
    setLibMode('work');
    return row.id;
  });
  const back = await page.evaluate(id => {
    const obj = LIB.objects.find(o => o.id === id);
    return { archived: obj.archived, shown: document.getElementById('libView').innerText.includes(obj.name || '') };
  }, backId);
  ok('объект возвращается из архива в рабочий список', back.archived === false && back.shown === true, JSON.stringify(back));
  ok('страница без исключений', errors.length === 0, errors.join(' | '));
  const failed = results.filter(r => !r.ok);
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  if (failed.length) process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
