/* Домашнее хранилище смет. Слушает только тот адрес, который задан при запуске.
   По умолчанию 127.0.0.1 — с других компьютеров недоступен, пока это явно не изменят. */
import './quiet.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Lib = require('../library.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_USERS = 10;
const MAX_BODY = 1_500_000;
const TOKEN_DAYS = 30;

function cleanYandexImages(list) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > 10) return null;
  const out = [];
  for (const image of list) {
    if (!image || typeof image.data !== 'string') return null;
    const mime = image.mime === 'image/png' || image.mime === 'image/webp' ? image.mime : (image.mime === 'image/jpeg' ? 'image/jpeg' : null);
    if (!mime) return null;
    const data = image.data.replace(/\s/g, '');
    if (!data || data.length > 1_500_000 || !/^[A-Za-z0-9+/=]+$/.test(data)) return null;
    out.push({ mime, data });
  }
  return out;
}

function scryptHash(password, salt = crypto.randomBytes(16)) {
  const N = 16384, r = 8, p = 1;
  const hash = crypto.scryptSync(password, salt, 32, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 32, { N: Number(n), r: Number(r), p: Number(p) });
  const a = Buffer.from(hashHex, 'hex');
  if (a.length !== hash.length) return false;
  return crypto.timingSafeEqual(a, hash);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newId(prefix) {
  return prefix + crypto.randomBytes(9).toString('hex');
}

function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS objects (
      id TEXT PRIMARY KEY,
      rev INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      addr TEXT NOT NULL DEFAULT '',
      client TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS estimates (
      id TEXT PRIMARY KEY,
      object_id TEXT NOT NULL,
      rev INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      FOREIGN KEY(object_id) REFERENCES objects(id)
    );
  `);
  return db;
}

function str(v, max) {
  const s = typeof v === 'string' ? v : '';
  if (s.length > max) return null;
  return s;
}

function bool(v) { return v === true || v === 1; }

function revOf(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null;
}

function publicUser(row) {
  return { id: row.id, username: row.username, role: row.role };
}

function objectRow(row) {
  return {
    id: row.id,
    rev: row.rev,
    archived: !!row.archived,
    name: row.name,
    addr: row.addr,
    client: row.client,
    phone: row.phone,
    email: row.email,
    note: row.note,
    updatedAt: row.updated_at
  };
}

function estimateRow(row) {
  let body = {};
  try { body = JSON.parse(row.body); } catch (e) { body = {}; }
  return { id: row.id, objectId: row.object_id, rev: row.rev, archived: !!row.archived, updatedAt: row.updated_at, body };
}

function snapshot(db) {
  const objects = db.prepare('SELECT * FROM objects ORDER BY updated_at, id').all().map(objectRow);
  const estimates = db.prepare('SELECT * FROM estimates ORDER BY updated_at, id').all().map(estimateRow);
  for (const obj of objects) obj.estimates = estimates.filter(e => e.objectId === obj.id);
  return { objects };
}

function createUser(db, username, password, role) {
  const name = String(username || '').trim();
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(name)) return { ok: false, status: 400, error: 'Логин: 3–32 символа, латиница, цифры, точка, _ или -' };
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) return { ok: false, status: 400, error: 'Пароль не короче 10 символов' };
  if (role !== 'admin' && role !== 'user') return { ok: false, status: 400, error: 'Роль: admin или user' };
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count >= MAX_USERS) return { ok: false, status: 400, error: 'Уже 10 пользователей — это предел хранилища' };
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(name);
  if (exists) return { ok: false, status: 409, error: 'Такой логин уже есть' };
  const id = newId('usr_');
  db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, scryptHash(password), role, new Date().toISOString());
  return { ok: true, user: { id, username: name, role } };
}

function ensureAdmin(db, env) {
  const username = env.SMETA_ADMIN_USER;
  const password = env.SMETA_ADMIN_PASSWORD;
  if (!username && !password) return;
  if (!username || !password) {
    console.error('Задайте оба значения: SMETA_ADMIN_USER и SMETA_ADMIN_PASSWORD. Пароль в код и в git не записывается.');
    return;
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(String(username).trim());
  if (exists) return;
  const res = createUser(db, username, password, 'admin');
  if (!res.ok) console.error(res.error);
  else console.log('Создан администратор ' + res.user.username + '. Пароль в журнале не печатается.');
}

export function start(opts = {}) {
  const env = opts.env || process.env;
  const dbFile = opts.dbPath || path.join(HERE, 'data', 'smeta.sqlite');
  const db = openDb(dbFile);
  ensureAdmin(db, env);
  const origins = String(env.SMETA_ORIGINS || 'https://akinshinav.github.io').split(',').map(s => s.trim()).filter(Boolean);
  const dummyHash = scryptHash('not-a-real-password');
  const failures = new Map();

  function cors(req, res) {
    const origin = req.headers.origin;
    if (origin && origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Yandex-Api-Key');
      res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
    }
  }

  function send(req, res, status, body) {
    cors(req, res);
    const json = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(json);
  }

  function readBody(req, max = MAX_BODY) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > max) {
          reject(Object.assign(new Error('too big'), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve(null);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(Object.assign(new Error('bad json'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }

  function clientKey(req) {
    return String(req.socket.remoteAddress || 'local');
  }

  function loginKey(req, username) {
    const name = String(username || '').trim().toLowerCase();
    if (/^[a-z0-9._-]{1,32}$/.test(name)) return 'user:' + name;
    return 'ip:' + clientKey(req);
  }

  function tooMany(req, username) {
    const row = failures.get(loginKey(req, username));
    return !!(row && row.count >= 8 && Date.now() < row.reset);
  }

  function failLogin(req, username) {
    const key = loginKey(req, username);
    const row = failures.get(key);
    const now = Date.now();
    if (!row || now > row.reset) failures.set(key, { count: 1, reset: now + 15 * 60 * 1000 });
    else row.count += 1;
  }

  function clearLogin(req, username) { failures.delete(loginKey(req, username)); }

  function authUser(req) {
    const header = String(req.headers.authorization || '');
    const m = header.match(/^Bearer\s+([A-Za-z0-9_-]{20,200})$/);
    if (!m) return null;
    const row = db.prepare(`
      SELECT users.id, users.username, users.role, tokens.expires_at
      FROM tokens JOIN users ON users.id = tokens.user_id
      WHERE tokens.token_hash = ?
    `).get(tokenHash(m[1]));
    if (!row) return null;
    if (row.expires_at < new Date().toISOString()) {
      db.prepare('DELETE FROM tokens WHERE token_hash = ?').run(tokenHash(m[1]));
      return null;
    }
    return row;
  }

  function backupFile() {
    const dir = path.join(path.dirname(dbFile), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(dir, 'smeta-' + stamp + '.sqlite');
    const sqlPath = dest.replaceAll('\\', '/').replaceAll("'", "''");
    db.exec(`VACUUM INTO '${sqlPath}'`);
    return dest;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'OPTIONS') {
      cors(req, res);
      res.writeHead(204);
      res.end();
      return;
    }
    const user = authUser(req);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      send(req, res, 200, { ok: true, storage: 'sqlite' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readBody(req);
      const username = body && typeof body.username === 'string' ? body.username.trim() : '';
      const password = body && typeof body.password === 'string' ? body.password : '';
      if (tooMany(req, username)) return send(req, res, 429, { error: 'Слишком много попыток для этого логина. Подождите 15 минут.' });
      db.prepare('DELETE FROM tokens WHERE expires_at < ?').run(new Date().toISOString());
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      const hash = row ? row.password_hash : dummyHash;
      const match = verifyPassword(password, hash) && !!row;
      if (!match) {
        failLogin(req, username);
        return send(req, res, 401, { error: 'Неверный логин или пароль' });
      }
      clearLogin(req, username);
      const token = crypto.randomBytes(32).toString('base64url');
      const expires = new Date(Date.now() + TOKEN_DAYS * 86400000).toISOString();
      db.prepare('INSERT INTO tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), row.id, expires);
      return send(req, res, 200, { token, user: publicUser(row), expiresAt: expires });
    }
    if (!user) return send(req, res, 401, { error: 'Нужен вход' });
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const header = String(req.headers.authorization || '');
      const m = header.match(/^Bearer\s+([A-Za-z0-9_-]{20,200})$/);
      if (m) db.prepare('DELETE FROM tokens WHERE token_hash = ?').run(tokenHash(m[1]));
      return send(req, res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/me') return send(req, res, 200, { user: publicUser(user) });
    if (req.method === 'GET' && url.pathname === '/api/snapshot') return send(req, res, 200, snapshot(db));
    if (req.method === 'GET' && url.pathname === '/api/admin/users') {
      if (user.role !== 'admin') return send(req, res, 403, { error: 'Только администратор' });
      const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username').all();
      return send(req, res, 200, { users });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/users') {
      if (user.role !== 'admin') return send(req, res, 403, { error: 'Только администратор' });
      const body = await readBody(req);
      const resUser = createUser(db, body && body.username, body && body.password, (body && body.role) || 'user');
      if (!resUser.ok) return send(req, res, resUser.status, { error: resUser.error });
      return send(req, res, 201, { user: resUser.user });
    }
    if (req.method === 'POST' && url.pathname === '/api/ai/yandex') {
      const apiKey = String(req.headers['x-yandex-api-key'] || '').trim();
      const body = await readBody(req, 8_000_000);
      const folderId = body && typeof body.folderId === 'string' ? body.folderId.trim() : '';
      const text = body && typeof body.text === 'string' ? body.text : '';
      const system = body && typeof body.system === 'string' ? body.system : '';
      if (!apiKey || apiKey.length > 400) return send(req, res, 400, { error: 'Нужен ключ Yandex' });
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(folderId)) return send(req, res, 400, { error: 'Нужен ID каталога Yandex' });
      if (text.length > 20000 || system.length > 120000) return send(req, res, 400, { error: 'Слишком длинный запрос' });
      const images = cleanYandexImages(body && body.images);
      if (!images) return send(req, res, 400, { error: 'Картинки не подходят' });
      const model = 'gpt://' + folderId + '/' + (images.length ? 'qwen3.5-35b' : 'yandexgpt-5.1');
      const content = [{ type: 'text', text: text || 'Разбери приложенный дизайн.' }];
      images.forEach(image => content.push({ type: 'image_url', image_url: { url: 'data:' + image.mime + ';base64,' + image.data } }));
      let yandex;
      try {
        yandex = await (opts.yandexFetch || fetch)('https://ai.api.cloud.yandex.net/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Api-Key ' + apiKey, 'x-folder-id': folderId },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 4000,
            messages: [{ role: 'system', content: system }, { role: 'user', content }]
          })
        });
      } catch (e) {
        return send(req, res, 502, { error: 'Домашний сервер не достучался до Yandex' });
      }
      const raw = await yandex.text();
      const safe = raw.split(apiKey).join('');
      if (!yandex.ok) return send(req, res, 502, { error: 'Yandex не разобрал запрос (' + yandex.status + ')' });
      let data = null;
      try { data = JSON.parse(safe); } catch (e) { return send(req, res, 502, { error: 'Yandex вернул не JSON' }); }
      const message = data && data.choices && data.choices[0] && data.choices[0].message;
      const answer = message && message.content;
      const reply = typeof answer === 'string' ? answer : (Array.isArray(answer) ? answer.map(part => part && (part.text || part.content) || '').join('') : '');
      if (!reply.trim()) return send(req, res, 502, { error: 'Yandex вернул пустой ответ' });
      return send(req, res, 200, { text: reply, model });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/backup') {
      if (user.role !== 'admin') return send(req, res, 403, { error: 'Только администратор' });
      const file = backupFile();
      return send(req, res, 200, { ok: true, file: path.basename(file), snapshot: snapshot(db) });
    }

    const objMatch = url.pathname.match(/^\/api\/objects\/([A-Za-z0-9_-]{1,80})$/);
    if (req.method === 'PUT' && objMatch) {
      if (!Lib.validId(objMatch[1])) return send(req, res, 400, { error: 'Некорректный id' });
      const body = await readBody(req);
      const rev = revOf(body && body.rev);
      if (rev == null) return send(req, res, 400, { error: 'Нужна целая версия rev' });
      const fields = {};
      for (const [key, max] of [['name', 300], ['addr', 300], ['client', 200], ['phone', 40], ['email', 120], ['note', 4000]]) {
        if (body[key] != null && typeof body[key] !== 'string') return send(req, res, 400, { error: 'Поле ' + key + ' должно быть текстом' });
        const value = str(body[key] == null ? '' : body[key], max);
        if (value == null) return send(req, res, 400, { error: 'Слишком длинное поле ' + key });
        fields[key] = value;
      }
      if (body.archived != null && typeof body.archived !== 'boolean') return send(req, res, 400, { error: 'archived должен быть да или нет' });
      const archived = bool(body.archived) ? 1 : 0;
      const current = db.prepare('SELECT * FROM objects WHERE id = ?').get(objMatch[1]);
      if (!current) {
        if (rev !== 0) return send(req, res, 409, { error: 'Записи нет на сервере', server: null });
        const now = new Date().toISOString();
        db.prepare('INSERT INTO objects (id, rev, archived, name, addr, client, phone, email, note, updated_at, updated_by) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(objMatch[1], archived, fields.name, fields.addr, fields.client, fields.phone, fields.email, fields.note, now, user.id);
        return send(req, res, 200, { object: objectRow(db.prepare('SELECT * FROM objects WHERE id = ?').get(objMatch[1])) });
      }
      if (current.rev !== rev) return send(req, res, 409, { error: 'На сервере более новая версия', server: objectRow(current) });
      const now = new Date().toISOString();
      db.prepare('UPDATE objects SET rev = ?, archived = ?, name = ?, addr = ?, client = ?, phone = ?, email = ?, note = ?, updated_at = ?, updated_by = ? WHERE id = ? AND rev = ?').run(rev + 1, archived, fields.name, fields.addr, fields.client, fields.phone, fields.email, fields.note, now, user.id, objMatch[1], rev);
      return send(req, res, 200, { object: objectRow(db.prepare('SELECT * FROM objects WHERE id = ?').get(objMatch[1])) });
    }

    const estMatch = url.pathname.match(/^\/api\/estimates\/([A-Za-z0-9_-]{1,80})$/);
    if (req.method === 'PUT' && estMatch) {
      if (!Lib.validId(estMatch[1])) return send(req, res, 400, { error: 'Некорректный id' });
      const body = await readBody(req);
      const rev = revOf(body && body.rev);
      if (rev == null) return send(req, res, 400, { error: 'Нужна целая версия rev' });
      const objectId = body && typeof body.objectId === 'string' ? body.objectId : '';
      if (!Lib.validId(objectId)) return send(req, res, 400, { error: 'Нужен objectId' });
      if (!Lib.validEstimate(body && body.body)) return send(req, res, 400, { error: 'Смета не проходит проверку' });
      if (body.archived != null && typeof body.archived !== 'boolean') return send(req, res, 400, { error: 'archived должен быть да или нет' });
      const parent = db.prepare('SELECT id FROM objects WHERE id = ?').get(objectId);
      if (!parent) return send(req, res, 400, { error: 'Сначала отправьте карточку объекта' });
      const archived = bool(body.archived) ? 1 : 0;
      const payload = JSON.stringify(body.body);
      const current = db.prepare('SELECT * FROM estimates WHERE id = ?').get(estMatch[1]);
      if (!current) {
        if (rev !== 0) return send(req, res, 409, { error: 'Сметы нет на сервере', server: null });
        const now = new Date().toISOString();
        db.prepare('INSERT INTO estimates (id, object_id, rev, archived, body, updated_at, updated_by) VALUES (?, ?, 1, ?, ?, ?, ?)').run(estMatch[1], objectId, archived, payload, now, user.id);
        return send(req, res, 200, { estimate: estimateRow(db.prepare('SELECT * FROM estimates WHERE id = ?').get(estMatch[1])) });
      }
      if (current.rev !== rev) return send(req, res, 409, { error: 'На сервере более новая версия сметы', server: estimateRow(current) });
      const now = new Date().toISOString();
      db.prepare('UPDATE estimates SET object_id = ?, rev = ?, archived = ?, body = ?, updated_at = ?, updated_by = ? WHERE id = ? AND rev = ?').run(objectId, rev + 1, archived, payload, now, user.id, estMatch[1], rev);
      return send(req, res, 200, { estimate: estimateRow(db.prepare('SELECT * FROM estimates WHERE id = ?').get(estMatch[1])) });
    }
    send(req, res, 404, { error: 'Нет такого запроса' });
  }

  const host = opts.host || env.SMETA_HOST || '127.0.0.1';
  const port = Number(opts.port != null ? opts.port : (env.SMETA_PORT || 8787));
  const server = http.createServer((req, res) => {
    handle(req, res).catch(err => {
      const status = err && err.status ? err.status : 500;
      if (status === 500) console.error('request failed', err && err.message);
      if (!res.headersSent) send(req, res, status, { error: status === 413 ? 'Слишком большой запрос' : status === 400 ? 'Некорректный JSON' : 'Ошибка сервера' });
    });
  });
  return new Promise(resolve => {
    server.listen(port, host, () => {
      const address = server.address();
      resolve({ server, db, dbFile, host, port: address.port, close: () => new Promise(r => server.close(() => { db.close(); r(); })) });
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  start().then(({ host, port }) => {
    console.log('Хранилище смет слушает http://' + host + ':' + port);
    console.log('С других устройств этот адрес сам не откроется. Проброс портов и туннель — отдельный шаг, см. server/INSTALL.md');
    if (host === '0.0.0.0' || host === '::') console.log('Внимание: сервер слушает все сетевые интерфейсы этого компьютера.');
  });
}
