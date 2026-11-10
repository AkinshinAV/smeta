import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start } from '../server/server.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const port = 8794;
const origin = `http://127.0.0.1:${port}`;
const staticServer = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 300));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smeta-ui-'));
const dbPath = path.join(dir, 'smeta.sqlite');
const env = {
  SMETA_ORIGINS: origin,
  SMETA_ADMIN_USER: 'admin',
  SMETA_ADMIN_PASSWORD: 'long-password-1'
};
let api = await start({ dbPath, host: '127.0.0.1', port: 8795, env });
const browser = await puppeteer.launch({ executablePath: '/usr/local/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [];
function ok(name, cond, detail) { results.push({ name, ok: !!cond, detail: detail || '' }); console.log(cond ? 'OK' : 'FAIL', name, detail || ''); }

try {
  const page = await browser.newPage();
  page.on('dialog', async d => { await d.accept(); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(origin + '/index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(base => {
    S.objectName = 'Дом на сервере';
    S.client = 'Анна';
    S.addr = 'Улица 1';
    S.rooms = [{ name: 'Комната', works: [{ sec: 'Малярные работы', name: 'Работа', price: 100, qty: 2 }] }];
    save();
    localStorage.setItem('smeta_v1_server_url', base);
  }, 'http://127.0.0.1:8795');
  await page.evaluate(() => { showLib(); const det = [...document.querySelectorAll('#libView details')].find(d => d.querySelector('#srvUrl')); if (det) det.open = true; });
  await page.type('#srvUser', 'admin');
  await page.type('#srvPass', 'long-password-1');
  await page.click('button[onclick="loginServer()"]');
  await page.waitForFunction(() => document.getElementById('saveState').textContent.includes('Сохранено на сервере'), { timeout: 10000 });
  const snap = await fetch('http://127.0.0.1:8795/api/snapshot', { headers: { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('smeta_v1_token')) } });
  const body = await snap.json();
  ok('после входа объект дошёл до сервера', snap.status === 200 && body.objects.some(o => o.client === 'Анна' && o.estimates.length === 1), JSON.stringify(body.objects.map(o => o.client)));

  await api.close();
  await page.evaluate(() => { S.client = 'Анна офлайн'; save(); });
  await page.waitForFunction(() => {
    const t = document.getElementById('saveState').textContent;
    return t.includes('ожидает отправки') && !t.includes('Сохранено на сервере');
  }, { timeout: 5000 });
  ok('выключенный сервер не называется сохранением на сервере', true);

  api = await start({ dbPath, host: '127.0.0.1', port: 8795, env });
  await page.evaluate(() => flushSync());
  await page.waitForFunction(() => document.getElementById('saveState').textContent.includes('Сохранено на сервере'), { timeout: 10000 });
  const token = await page.evaluate(() => localStorage.getItem('smeta_v1_token'));
  const again = await (await fetch('http://127.0.0.1:8795/api/snapshot', { headers: { Authorization: 'Bearer ' + token } })).json();
  ok('после включения компьютера правка дошла до сервера', again.objects.some(o => o.client === 'Анна офлайн'), JSON.stringify(again.objects.map(o => [o.client, o.rev])));

  const other = await browser.newPage();
  other.on('dialog', async d => { await d.accept(); });
  await other.goto(origin + '/index.html', { waitUntil: 'networkidle0' });
  await other.evaluate((base, tok) => {
    localStorage.clear();
    localStorage.setItem('smeta_v1_server_url', base);
    localStorage.setItem('smeta_v1_token', tok);
  }, 'http://127.0.0.1:8795', token);
  await other.reload({ waitUntil: 'networkidle0' });
  await other.waitForFunction(() => document.getElementById('o_client').value === 'Анна офлайн', { timeout: 10000 });
  ok('второе устройство получает карточку с сервера', true);

  await page.evaluate(() => { S.client = 'С первого'; save(); });
  let seenFirst = false;
  for (let i = 0; i < 20; i++) {
    const snap = await (await fetch('http://127.0.0.1:8795/api/snapshot', { headers: { Authorization: 'Bearer ' + token } })).json();
    if (snap.objects.some(o => o.client === 'С первого')) { seenFirst = true; break; }
    await new Promise(r => setTimeout(r, 250));
  }
  ok('первая правка подтверждена сервером до второй', seenFirst);
  await other.evaluate(() => { S.client = 'Со второго'; save(); });
  await other.waitForFunction(() => {
    const t = document.getElementById('saveState').textContent;
    return t.includes('Конфликт') || t.includes('конфликт');
  }, { timeout: 10000 });
  const serverNow = await (await fetch('http://127.0.0.1:8795/api/snapshot', { headers: { Authorization: 'Bearer ' + token } })).json();
  const localOther = await other.evaluate(() => ({ client: S.client, conflict: SmetaSync.hasConflict(LIB) }));
  ok('конфликт не затирает ни сервер, ни второе устройство', serverNow.objects.some(o => o.client === 'С первого') && localOther.client === 'Со второго' && localOther.conflict, JSON.stringify({ server: serverNow.objects.map(o => o.client), localOther }));
  ok('страница синхронизации без исключений', errors.length === 0, errors.join(' | '));
  const failed = results.filter(r => !r.ok);
  if (failed.length) process.exitCode = 1;
} finally {
  await browser.close();
  await api.close();
  staticServer.kill();
}
