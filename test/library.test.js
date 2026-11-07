const test = require('node:test');
const assert = require('node:assert/strict');
const Lib = require('../library.js');
const PreviewLib = require('../preview-v2/library.js');

const blank = { objectName: '', addr: '', client: '', num: '1', date: '2026-11-07', disc: 0, rooms: [], usePriceList: false };
let n = 0;
const ids = () => 'id' + (++n);
const now = () => '2026-11-07T00:00:00.000Z';

function est(name, client, sumPrice) {
  return { objectName: name, addr: name, client, num: '1', date: '2026-11-07', disc: 0, rooms: [{ name: 'Комната', works: [{ sec: 'Малярные работы', name: 'Работа', price: sumPrice, qty: 1 }] }], usePriceList: false };
}

test('миграция подхватывает старую смету и не стирает исходную запись', () => {
  const legacy = JSON.stringify(est('Старая', 'Иван', 10));
  const plan = Lib.planLoad({ legacyRaw: legacy, priceRaw: '[{"p":1}]', coRaw: '{"city":"Москва"}', blank, idFactory: ids, now });
  assert.equal(plan.lib.items.length, 1);
  assert.equal(plan.lib.items[0].estimate.client, 'Иван');
  assert.equal(plan.lib.items[0].estimate.price[0].p, 1);
  assert.ok(plan.writes.some(w => w.slot === 'legacyBackup' && w.value === legacy));
  assert.ok(!plan.writes.some(w => w.slot === 'legacy'));
  const again = Lib.planLoad({ libRaw: JSON.stringify(plan.lib), legacyRaw: legacy, backupRaw: legacy, blank, idFactory: ids, now });
  assert.equal(again.lib.items.length, 1);
  assert.equal(again.writes.length, 0);
});

test('повреждённый архив и пустое хранилище не затирают прежние байты', () => {
  const broken = '{';
  const plan = Lib.planLoad({ libRaw: broken, legacyRaw: null, blank, idFactory: ids, now });
  assert.equal(plan.lib.items[0].estimate.client, '');
  assert.equal(plan.writes.find(w => w.slot === 'libDamaged').value, broken);
  const legacyBroken = Lib.planLoad({ legacyRaw: '{bad', blank, idFactory: ids, now });
  assert.equal(legacyBroken.writes.find(w => w.slot === 'legacyDamaged').value, '{bad');
  assert.equal(legacyBroken.lib.items.length, 1);
});

test('три объекта изолированы, импорт без спроса не заменяет список', () => {
  n = 0;
  const plan = Lib.planLoad({ blank, idFactory: ids, now });
  const lib = plan.lib;
  lib.items[0].estimate = est('A', 'Альфа', 100);
  const b = Lib.addItem(lib, est('B', 'Бета', 200), ids, now);
  const c = Lib.addItem(lib, est('C', 'Гамма', 300), ids, now);
  assert.equal(lib.activeId, c.id);
  const back = Lib.activate(lib, lib.items[0].id);
  assert.equal(back.client, 'Альфа');
  assert.equal(lib.items[1].estimate.client, 'Бета');
  assert.equal(lib.items[2].estimate.client, 'Гамма');
  const before = lib.items.length;
  const added = Lib.applyImport(lib, est('D', 'Дельта', 1), 'add', Lib.validEstimate, ids, now);
  assert.equal(added.replaced, false);
  assert.equal(lib.items.length, before + 1);
  assert.equal(lib.items[0].estimate.client, 'Альфа');
  const replaced = Lib.applyImport(lib, { kind: 'smeta-library', v: 1, items: [{ estimate: est('Z', 'Зет', 5) }] }, 'replace', Lib.validEstimate, ids, now);
  assert.equal(replaced.replaced, true);
  assert.equal(lib.items.length, 1);
  assert.equal(replaced.estimate.client, 'Зет');
});

test('архив обратим, дубль не стирает источник', () => {
  n = 0;
  const { lib } = Lib.planLoad({ blank, idFactory: ids, now });
  lib.items[0].estimate = est('A', 'Альфа', 1);
  const copy = Lib.duplicateItem(lib, lib.items[0].id, ids, now);
  assert.equal(copy.estimate.client, 'Альфа');
  assert.match(copy.estimate.objectName, /копия/);
  assert.equal(lib.items.length, 2);
  const next = Lib.archiveItem(lib, lib.items[0].id, blank, ids, now);
  assert.equal(lib.items[0].archived, true);
  assert.equal(next.client, 'Альфа');
  Lib.restoreItem(lib, lib.items[0].id, now);
  assert.equal(lib.items[0].archived, false);
});

test('ошибка квоты останавливает запись и не притворяется успехом', () => {
  const storage = { setItem() { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } };
  const res = Lib.applyWrites(storage, { library: 'smeta_v1_library' }, [{ slot: 'library', value: { v: 1, items: [] } }]);
  assert.equal(res.ok, false);
  assert.equal(res.quota, true);
});

test('корректный JSON с неверной структурой сохраняется побайтно до замены', () => {
  const raw = JSON.stringify({ items: 'broken', valuableData: 'SECRET-1' });
  const plan = Lib.planLoad({ libRaw: raw, legacyRaw: null, blank, idFactory: ids, now });
  const copy = plan.writes.find(w => w.slot === 'libDamaged');
  const replaced = plan.writes.find(w => w.slot === 'library');
  assert.equal(copy.value, raw);
  assert.ok(plan.writes.indexOf(copy) < plan.writes.indexOf(replaced));
  assert.equal(JSON.parse(copy.value).valuableData, 'SECRET-1');
  assert.equal(plan.blocked, false);
});

test('null, строка и битые элементы не используются и не роняют загрузку', () => {
  const cases = [
    JSON.stringify({ items: null, valuableData: 'N' }),
    JSON.stringify({ items: 'broken', valuableData: 'S' }),
    JSON.stringify({ items: [null, 1, { id: 'bad id', estimate: est('X', 'Икс', 1) }], valuableData: 'E' }),
    JSON.stringify({ items: [{ id: 'ok', estimate: { rooms: 'нет' } }, { id: 'good', estimate: est('Целая', 'Цел', 4) }], valuableData: 'P' })
  ];
  for (const raw of cases) {
    const plan = Lib.planLoad({ libRaw: raw, legacyRaw: null, blank, idFactory: ids, now });
    assert.equal(plan.writes.find(w => w.slot === 'libDamaged').value, raw);
    assert.equal(plan.blocked, false);
    assert.ok(plan.lib.items.every(item => Lib.validEstimate(item.estimate)));
  }
  const partial = Lib.planLoad({ libRaw: cases[3], legacyRaw: null, blank, idFactory: ids, now });
  assert.equal(partial.lib.items.length, 1);
  assert.equal(partial.lib.items[0].estimate.client, 'Цел');
});

test('отказ копии не перезаписывает исходную, повтор не затирает чужие копии', () => {
  const first = JSON.stringify({ items: 'broken', valuableData: 'FIRST' });
  const second = JSON.stringify({ items: null, valuableData: 'SECOND' });
  const third = JSON.stringify({ items: [{ nope: true }], valuableData: 'THIRD' });
  const slots = [{ key: 'smeta_v1_library_damaged', raw: 'KEEP-OTHER' }];
  const blocked = Lib.planLoad({ libRaw: first, damagedSlots: slots, legacyRaw: null, blank, idFactory: ids, now });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.heldRaw, first);
  assert.ok(!blocked.writes.some(w => w.slot === 'library' || w.slot === 'libDamaged'));
  const storage = {
    data: { smeta_v1_library: first, smeta_v1_library_damaged: 'KEEP-OTHER' },
    setItem(k, v) { if (k.endsWith('_damaged')) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } this.data[k] = v; }
  };
  const failing = Lib.applyWrites(storage, { library: 'smeta_v1_library', libDamaged: 'smeta_v1_library_damaged' }, blocked.writes.concat([{ slot: 'libDamaged', value: first }, { slot: 'library', value: { v: 1, items: [] } }]));
  assert.equal(failing.ok, false);
  assert.equal(storage.data.smeta_v1_library, first);
  const nextSlots = [
    { key: 'smeta_v1_library_damaged', raw: first },
    { key: 'smeta_v1_library_damaged_2', raw: null }
  ];
  const again = Lib.planLoad({ libRaw: second, damagedSlots: nextSlots, legacyRaw: null, blank, idFactory: ids, now });
  assert.equal(again.writes.find(w => w.key === 'smeta_v1_library_damaged_2').value, second);
  assert.ok(!again.writes.some(w => w.key === 'smeta_v1_library_damaged'));
  const same = Lib.planLoad({ libRaw: first, damagedSlots: [{ key: 'smeta_v1_library_damaged', raw: first }], legacyRaw: null, blank, idFactory: ids, now });
  assert.equal(same.blocked, false);
  assert.ok(!same.writes.some(w => w.key === 'smeta_v1_library_damaged'));
  assert.ok(same.writes.some(w => w.slot === 'library'));
  const full = [];
  for (let i = 1; i <= 3; i++) full.push({ key: 'k' + i, raw: 'other-' + i });
  const stop = Lib.planLoad({ libRaw: third, damagedSlots: full, legacyRaw: null, blank, idFactory: ids, now });
  assert.equal(stop.blocked, true);
  assert.equal(stop.heldRaw, third);
  assert.ok(!stop.writes.some(w => w.slot === 'library'));
});

test('preview использует ту же защиту структуры', () => {
  const raw = JSON.stringify({ items: 'broken', valuableData: 'PREVIEW' });
  const slots = [{ key: 'smeta_v2_library_damaged', raw: 'OCCUPIED' }];
  const plan = PreviewLib.planLoad({ libRaw: raw, damagedSlots: slots, legacyRaw: null, blank, idFactory: ids, now });
  assert.equal(plan.blocked, true);
  assert.equal(plan.heldRaw, raw);
  assert.ok(!plan.writes.some(w => w.slot === 'library'));
  const free = PreviewLib.planLoad({ libRaw: raw, legacyRaw: null, blank, idFactory: ids, now });
  assert.equal(free.writes.find(w => w.slot === 'libDamaged').value, raw);
});

test('поиск находит заказчика и не смешивает чужие поля', () => {
  const items = [
    { id: '1', estimate: est('Кухня', 'Альфа', 1) },
    { id: '2', estimate: est('Ванная', 'Бета', 1) }
  ];
  assert.deepEqual(Lib.queryItems(items, 'бета').map(i => i.id), ['2']);
  assert.equal(Lib.queryItems(items, '').length, 2);
});
