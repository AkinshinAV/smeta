import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start } from '../server/server.mjs';

const estimate = { objectName: 'Дом', addr: 'Адрес', client: 'Анна', num: '1', date: '2026-11-09', disc: 0, rooms: [{ name: 'Комната', works: [{ sec: 'Малярные работы', name: 'Работа', price: 10, qty: 2 }] }], usePriceList: false };

async function boot(extra = {}) {
  const { yandexFetch, ...envExtra } = extra;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smeta-srv-'));
  const started = await start({
    dbPath: path.join(dir, 'smeta.sqlite'),
    host: '127.0.0.1',
    port: 0,
    yandexFetch,
    env: Object.assign({
      SMETA_ORIGINS: 'https://akinshinav.github.io',
      SMETA_ADMIN_USER: 'admin',
      SMETA_ADMIN_PASSWORD: 'long-password-1'
    }, envExtra)
  });
  return Object.assign(started, { dir });
}

async function send(port, method, urlPath, { token, body, origin, headers: extra } = {}) {
  const headers = Object.assign({}, extra);
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (origin) headers.Origin = origin;
  const res = await fetch('http://127.0.0.1:' + port + urlPath, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  return { status: res.status, data, text, cors: res.headers.get('access-control-allow-origin') };
}

test('вход, роли, CORS, снимок, конфликт версий, битая смета и резервная копия', async () => {
  const srv = await boot();
  try {
    const healthEvil = await send(srv.port, 'GET', '/api/health', { origin: 'https://evil.example' });
    assert.equal(healthEvil.status, 200);
    assert.equal(healthEvil.cors, null);
    const healthOk = await send(srv.port, 'GET', '/api/health', { origin: 'https://akinshinav.github.io' });
    assert.equal(healthOk.cors, 'https://akinshinav.github.io');

    const anon = await send(srv.port, 'GET', '/api/snapshot');
    assert.equal(anon.status, 401);

    const bad = await send(srv.port, 'POST', '/api/login', { body: { username: 'admin', password: 'wrong-password' } });
    assert.equal(bad.status, 401);
    const session = await send(srv.port, 'POST', '/api/login', { body: { username: 'admin', password: 'long-password-1' } });
    assert.equal(session.status, 200);
    assert.ok(session.data.token);
    const rawDb = fs.readFileSync(srv.dbFile);
    assert.equal(rawDb.includes(Buffer.from('long-password-1')), false);
    assert.equal(rawDb.includes(Buffer.from(session.data.token)), false);

    const created = await send(srv.port, 'POST', '/api/admin/users', { token: session.data.token, body: { username: 'estimator', password: 'user-password-1', role: 'user' } });
    assert.equal(created.status, 201);
    const userLogin = await send(srv.port, 'POST', '/api/login', { body: { username: 'estimator', password: 'user-password-1' } });
    assert.equal(userLogin.status, 200);
    const forbidden = await send(srv.port, 'GET', '/api/admin/users', { token: userLogin.data.token });
    assert.equal(forbidden.status, 403);
    const users = await send(srv.port, 'GET', '/api/admin/users', { token: session.data.token });
    assert.equal(users.status, 200);
    assert.equal(JSON.stringify(users.data).includes('password'), false);
    assert.equal(JSON.stringify(users.data).includes('scrypt'), false);

    const put = await send(srv.port, 'PUT', '/api/objects/obj1', { token: userLogin.data.token, body: { rev: 0, name: 'Дом', addr: 'Адрес', client: 'Анна', phone: '1', email: 'a@b.c', note: '', archived: false } });
    assert.equal(put.status, 200);
    assert.equal(put.data.object.rev, 1);
    const est = await send(srv.port, 'PUT', '/api/estimates/est1', { token: userLogin.data.token, body: { rev: 0, objectId: 'obj1', archived: false, body: estimate } });
    assert.equal(est.status, 200);
    const second = await send(srv.port, 'PUT', '/api/estimates/est2', { token: session.data.token, body: { rev: 0, objectId: 'obj1', archived: false, body: Object.assign({}, estimate, { num: '2', client: 'Анна' }) } });
    assert.equal(second.status, 200);
    const broken = await send(srv.port, 'PUT', '/api/estimates/est3', { token: userLogin.data.token, body: { rev: 0, objectId: 'obj1', archived: false, body: { rooms: 'нет' } } });
    assert.equal(broken.status, 400);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS c FROM estimates').get().c, 2);

    const seen = await send(srv.port, 'GET', '/api/snapshot', { token: session.data.token });
    assert.equal(seen.data.objects.length, 1);
    assert.equal(seen.data.objects[0].estimates.length, 2);
    assert.equal(seen.data.objects[0].client, 'Анна');

    const okWrite = await send(srv.port, 'PUT', '/api/objects/obj1', { token: session.data.token, body: { rev: 1, name: 'Дом А', addr: 'Адрес', client: 'Анна', phone: '1', email: 'a@b.c', note: '', archived: false } });
    assert.equal(okWrite.status, 200);
    assert.equal(okWrite.data.object.rev, 2);
    const clash = await send(srv.port, 'PUT', '/api/objects/obj1', { token: userLogin.data.token, body: { rev: 1, name: 'Чужая затирка', addr: 'Адрес', client: 'Анна', phone: '1', email: 'a@b.c', note: '', archived: false } });
    assert.equal(clash.status, 409);
    assert.equal(clash.data.server.name, 'Дом А');
    assert.equal(srv.db.prepare('SELECT name, rev FROM objects WHERE id = ?').get('obj1').name, 'Дом А');

    const noBackup = await send(srv.port, 'POST', '/api/admin/backup', { token: userLogin.data.token });
    assert.equal(noBackup.status, 403);
    const backup = await send(srv.port, 'POST', '/api/admin/backup', { token: session.data.token });
    assert.equal(backup.status, 200);
    assert.equal(backup.text.includes('long-password-1'), false);
    assert.equal(backup.text.includes('scrypt'), false);
    assert.equal(backup.data.snapshot.objects[0].name, 'Дом А');
    const backupPath = path.join(srv.dir, 'backups', backup.data.file);
    assert.equal(fs.existsSync(backupPath), true);

    await send(srv.port, 'POST', '/api/logout', { token: userLogin.data.token });
    const after = await send(srv.port, 'GET', '/api/snapshot', { token: userLogin.data.token });
    assert.equal(after.status, 401);
  } finally {
    await srv.close();
  }
});

test('прокси Yandex не пишет ключ в базу и берёт модель по наличию картинки', async () => {
  const calls = [];
  const secret = 'test-yandex-key-not-stored';
  const srv = await boot({
    yandexFetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization, folder: init.headers['x-folder-id'] });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"rooms":[]}' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });
  try {
    const anon = await send(srv.port, 'POST', '/api/ai/yandex', { headers: { 'X-Yandex-Api-Key': secret }, body: { folderId: 'b1gfolder', text: 'комната', system: 'json', images: [] } });
    assert.equal(anon.status, 401);
    const session = await send(srv.port, 'POST', '/api/login', { body: { username: 'admin', password: 'long-password-1' } });
    const textOnly = await send(srv.port, 'POST', '/api/ai/yandex', {
      token: session.data.token,
      headers: { 'X-Yandex-Api-Key': secret },
      body: { folderId: 'b1gfolder', text: 'комната', system: 'верни json', images: [] }
    });
    assert.equal(textOnly.status, 200);
    assert.equal(textOnly.data.text, '{"rooms":[]}');
    assert.equal(textOnly.data.model, 'gpt://b1gfolder/yandexgpt-5.1');
    assert.equal(JSON.stringify(textOnly.data).includes(secret), false);
    const withImage = await send(srv.port, 'POST', '/api/ai/yandex', {
      token: session.data.token,
      headers: { 'X-Yandex-Api-Key': secret },
      body: { folderId: 'b1gfolder', text: '', system: 'верни json', images: [{ mime: 'image/jpeg', data: 'abcd' }] }
    });
    assert.equal(withImage.status, 200);
    assert.equal(withImage.data.model, 'gpt://b1gfolder/qwen3.5-35b');
    assert.equal(calls[1].body.model, 'gpt://b1gfolder/qwen3.5-35b');
    assert.equal(calls[1].auth, 'Api-Key ' + secret);
    assert.ok(calls[1].body.messages[1].content.some(part => part.type === 'image_url' && part.image_url.url.includes('abcd')));
    const dbText = fs.readFileSync(path.join(srv.dir, 'smeta.sqlite'));
    assert.equal(dbText.includes(Buffer.from(secret)), false);
  } finally {
    await srv.close();
  }
});
