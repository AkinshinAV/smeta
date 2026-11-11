const test = require('node:test');
const assert = require('node:assert/strict');
const Sync = require('../sync.js');

function libWith(obj) {
  return { v: 2, activeObjectId: obj.id, activeEstimateId: obj.estimates[0].id, objects: [obj] };
}

function object(patch) {
  return Object.assign({
    id: 'obj1', rev: 1, dirty: false, syncConflict: false, archived: false,
    name: 'Дом', addr: 'Адрес', client: 'Анна', phone: '', email: '', note: '',
    estimates: [{
      id: 'est1', rev: 1, dirty: false, syncConflict: false, archived: false,
      estimate: { objectName: 'Дом', addr: 'Адрес', client: 'Анна', num: '1', date: '2026-11-09', disc: 0, rooms: [], usePriceList: false }
    }]
  }, patch);
}

test('конфликт не затирает местную правку и сохраняет серверную копию', () => {
  const local = libWith(object({ dirty: true, name: 'Моя правка', rev: 1 }));
  local.objects[0].estimates[0].dirty = true;
  const snapshot = {
    objects: [{
      id: 'obj1', rev: 2, name: 'Сервер', addr: 'Адрес', client: 'Анна', phone: '', email: '', note: '', archived: false,
      estimates: [{ id: 'est1', rev: 4, archived: false, body: { objectName: 'Сервер', addr: 'Адрес', client: 'Пётр', num: '1', date: '2026-11-09', disc: 0, rooms: [], usePriceList: false } }]
    }]
  };
  const actions = Sync.plan(local, snapshot);
  assert.ok(actions.some(a => a.op === 'conflict-object'));
  assert.ok(actions.some(a => a.op === 'conflict-estimate'));
  assert.ok(!actions.some(a => String(a.op).startsWith('put')));
  Sync.applyActions(local, actions);
  assert.equal(local.objects[0].name, 'Моя правка');
  assert.equal(local.objects[0].conflictServer.name, 'Сервер');
  assert.equal(local.objects[0].estimates[0].estimate.client, 'Анна');
  assert.equal(local.objects[0].estimates[0].conflictServer.body.client, 'Пётр');
  assert.equal(Sync.statusOf(local, { serverConfigured: true, loggedIn: true }).level, 'conflict');
});

test('чистая локальная копия принимает более новую серверную версию', () => {
  const local = libWith(object({}));
  const snapshot = {
    objects: [{
      id: 'obj1', rev: 3, name: 'С сервера', addr: 'Новый', client: 'Анна', phone: '1', email: '', note: '', archived: false,
      estimates: [{ id: 'est1', rev: 3, archived: false, body: { objectName: 'С сервера', addr: 'Новый', client: 'Анна', num: '1', date: '2026-11-09', disc: 5, rooms: [], usePriceList: false } }]
    }]
  };
  Sync.applyActions(local, Sync.plan(local, snapshot));
  assert.equal(local.objects[0].name, 'С сервера');
  assert.equal(local.objects[0].rev, 3);
  assert.equal(local.objects[0].dirty, false);
  assert.equal(local.objects[0].estimates[0].estimate.disc, 5);
});

test('развилка конфликта оставляет обе версии, принятие сервера заменяет только выбранную', () => {
  const local = libWith(object({ dirty: true, name: 'Моя' }));
  local.objects[0].syncConflict = true;
  local.objects[0].conflictServer = { id: 'obj1', rev: 5, name: 'Сервер', addr: 'Адрес', client: 'Анна', phone: '', email: '', note: '', archived: false };
  let i = 0;
  Sync.forkObject(local, 'obj1', () => 'new' + (++i));
  assert.equal(local.objects[0].id, 'new1');
  assert.equal(local.objects[0].rev, 0);
  assert.equal(local.objects[0].dirty, true);
  assert.equal(local.objects[0].syncConflict, false);
  assert.equal(local.activeObjectId, 'new1');
  const other = libWith(object({ name: 'Моя' }));
  other.objects[0].syncConflict = true;
  other.objects[0].conflictServer = { id: 'obj1', rev: 5, name: 'Сервер', addr: 'Ул', client: 'Оля', phone: '', email: '', note: '', archived: false };
  Sync.takeServerObject(other, 'obj1');
  assert.equal(other.objects[0].name, 'Сервер');
  assert.equal(other.objects[0].rev, 5);
  assert.equal(other.objects[0].dirty, false);
  assert.equal(other.objects[0].estimates[0].estimate.client, 'Анна');
});

test('пустой черновик заменяется снимком сервера, грязный черновик не затирается', () => {
  const empty = libWith(object({ rev: 0, name: '', addr: '', client: '' }));
  empty.objects[0].estimates[0].rev = 0;
  empty.objects[0].estimates[0].estimate = { objectName: '', addr: '', client: '', num: '1', date: '2026-11-09', disc: 0, rooms: [], usePriceList: false };
  const snapshot = { objects: [{ id: 'srv', rev: 2, name: 'Серверный', addr: '', client: 'Ира', phone: '', email: '', note: '', archived: false, estimates: [{ id: 'e', rev: 2, archived: false, body: { objectName: 'Серверный', addr: '', client: 'Ира', num: '1', date: '2026-11-09', disc: 0, rooms: [{ name: 'Комната', works: [] }], usePriceList: false } }] }] };
  const replaced = Sync.plan(empty, snapshot);
  assert.equal(replaced[0].op, 'replace-all');
  Sync.applyActions(empty, replaced);
  assert.equal(empty.objects.length, 1);
  assert.equal(empty.objects[0].id, 'srv');
  const dirty = libWith(object({ rev: 0, dirty: true, name: 'Офлайн' }));
  dirty.objects[0].estimates[0].rev = 0;
  dirty.objects[0].estimates[0].dirty = true;
  const kept = Sync.plan(dirty, snapshot);
  assert.ok(kept.some(a => a.op === 'put-object'));
  assert.ok(kept.some(a => a.op === 'insert-object'));
  assert.equal(Sync.statusOf(dirty, { serverConfigured: true, loggedIn: true }).level, 'pending');
  assert.equal(Sync.statusOf(dirty, { serverConfigured: false, loggedIn: false }).level, 'device');
  assert.equal(Sync.statusOf(dirty, { serverConfigured: true, loggedIn: true, transportError: 'сервер не отвечает' }).level, 'pending');
});

test('снимок из одних архивных объектов не возвращает их в работу и не создаёт пустышку', () => {
  const archived = {
    id: 'obj1', rev: 3, name: 'Дом', addr: 'Лесная, 4', client: 'Анна', phone: '', email: '', note: '', archived: true,
    estimates: [{ id: 'est1', rev: 3, archived: false, body: { objectName: 'Дом', addr: 'Лесная, 4', client: 'Анна', num: '7', date: '2026-11-09', disc: 0, rooms: [{ name: 'Комната', works: [] }], usePriceList: false } }]
  };
  const fresh = libWith(object({ id: 'draft', rev: 0, dirty: false, name: '', addr: '', client: '', phone: '', email: '', note: '' }));
  fresh.objects[0].estimates[0].rev = 0;
  fresh.objects[0].estimates[0].estimate = { objectName: '', addr: '', client: '', num: '1', date: '2026-11-09', disc: 0, rooms: [], usePriceList: false };
  const actions = Sync.plan(fresh, { objects: [archived] });
  assert.equal(actions[0].op, 'replace-all');
  Sync.applyActions(fresh, actions);
  assert.equal(fresh.objects.length, 1);
  assert.equal(fresh.objects[0].id, 'obj1');
  assert.equal(fresh.objects[0].archived, true);
  assert.equal(fresh.objects[0].name, 'Дом');
  assert.equal(fresh.objects[0].estimates.length, 1);
  assert.equal(fresh.activeObjectId, '');
  assert.equal(fresh.activeEstimateId, '');

  const mixed = libWith(object({ id: 'keep', name: 'Живой' }));
  const snap = { objects: [archived, { id: 'keep', rev: 4, name: 'Живой', addr: 'Адрес', client: 'Анна', phone: '', email: '', note: '', archived: false, estimates: [{ id: 'est1', rev: 4, archived: false, body: { objectName: 'Живой', addr: 'Адрес', client: 'Анна', num: '1', date: '2026-11-09', disc: 0, rooms: [], usePriceList: false } }] }] };
  Sync.applyActions(mixed, [{ op: 'replace-all', snapshot: snap }]);
  assert.equal(mixed.activeObjectId, 'keep');
  assert.equal(mixed.objects.find(o => o.id === 'obj1').archived, true);

  const local = libWith(object({ id: 'obj1', name: 'Дом', archived: true, dirty: true, rev: 2 }));
  local.activeObjectId = '';
  local.activeEstimateId = '';
  const pending = Sync.plan(local, { objects: [{ id: 'obj1', rev: 2, name: 'Дом', addr: 'Адрес', client: 'Анна', phone: '', email: '', note: '', archived: false, estimates: [] }] });
  assert.ok(pending.some(a => a.op === 'put-object' && a.id === 'obj1'));
  assert.equal(Sync.pushBodyObject(local.objects[0]).archived, true);
  assert.equal(local.objects.some(o => !(o.name || '').trim()), false);
});
