const test = require('node:test');
const assert = require('node:assert/strict');
const Lib = require('../library.js');

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

test('поиск находит заказчика и не смешивает чужие поля', () => {
  const items = [
    { id: '1', estimate: est('Кухня', 'Альфа', 1) },
    { id: '2', estimate: est('Ванная', 'Бета', 1) }
  ];
  assert.deepEqual(Lib.queryItems(items, 'бета').map(i => i.id), ['2']);
  assert.equal(Lib.queryItems(items, '').length, 2);
});
