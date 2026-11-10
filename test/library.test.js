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

test('пустой запуск не подмешивает старую смету и не стирает её байты', () => {
  n = 0;
  const legacy = JSON.stringify(est('Старая', 'Иван', 10));
  const plan = Lib.planLoad({ legacyRaw: legacy, priceRaw: '[{"p":1}]', coRaw: '{"city":"Москва"}', blank, idFactory: ids, now });
  assert.equal(plan.lib.v, 2);
  assert.equal(plan.lib.objects.length, 1);
  assert.equal(plan.lib.objects[0].estimates.length, 1);
  assert.equal(plan.lib.objects[0].client, '');
  assert.equal(JSON.stringify(plan.lib).includes('Иван'), false);
  assert.ok(plan.writes.some(w => w.slot === 'legacyBackup' && w.value === legacy));
  assert.ok(!plan.writes.some(w => w.slot === 'legacy'));
  const again = Lib.planLoad({ libRaw: JSON.stringify(plan.lib), legacyRaw: legacy, backupRaw: legacy, blank, idFactory: ids, now });
  assert.equal(again.lib.objects.length, 1);
  assert.equal(again.writes.length, 0);
});

test('повреждённый архив и пустое хранилище не затирают прежние байты', () => {
  const broken = '{';
  const plan = Lib.planLoad({ libRaw: broken, legacyRaw: null, blank, idFactory: ids, now });
  assert.equal(plan.lib.objects[0].client, '');
  assert.equal(plan.writes.find(w => w.slot === 'libDamaged').value, broken);
  const legacyBroken = Lib.planLoad({ legacyRaw: '{bad', blank, idFactory: ids, now });
  assert.equal(legacyBroken.writes.find(w => w.slot === 'legacyDamaged').value, '{bad');
  assert.equal(legacyBroken.lib.objects.length, 1);
});

test('старая схема v1 сохраняется побайтно и не открывается как живой список', () => {
  const raw = JSON.stringify({ v: 1, items: [{ id: 'ok', estimate: est('Секрет', 'Иван', 10) }], valuableData: 'SECRET-V1' });
  const plan = Lib.planLoad({ libRaw: raw, legacyRaw: null, blank, idFactory: ids, now });
  const copy = plan.writes.find(w => w.slot === 'libDamaged');
  const replaced = plan.writes.find(w => w.slot === 'library');
  assert.equal(copy.value, raw);
  assert.ok(plan.writes.indexOf(copy) < plan.writes.indexOf(replaced));
  assert.equal(JSON.parse(copy.value).valuableData, 'SECRET-V1');
  assert.equal(JSON.stringify(plan.lib).includes('SECRET-V1'), false);
  assert.equal(JSON.stringify(plan.lib).includes('Иван'), false);
});

test('два объекта по две сметы: открытие, переименование, копия, архив и возврат', () => {
  n = 0;
  const { lib } = Lib.planLoad({ blank, idFactory: ids, now });
  lib.objects[0].name = 'Объект A';
  lib.objects[0].client = 'Альфа';
  lib.objects[0].estimates[0].estimate = est('Объект A', 'Альфа', 100);
  const a2 = Lib.addEstimate(lib, lib.objects[0].id, est('Объект A', 'Альфа', 50), ids, now);
  const b = Lib.addObject(lib, { name: 'Объект B', client: 'Бета', addr: 'Адрес Б' }, est('Объект B', 'Бета', 7), ids, now);
  Lib.addEstimate(lib, b.id, est('Объект B', 'Бета', 9), ids, now);
  assert.equal(lib.objects.length, 2);
  assert.equal(lib.objects[0].estimates.length, 2);
  assert.equal(lib.objects[1].estimates.length, 2);
  const opened = Lib.activateEstimate(lib, lib.objects[0].id, lib.objects[0].estimates[0].id);
  assert.equal(opened.client, 'Альфа');
  assert.equal(Lib.activePair(lib).est.id, lib.objects[0].estimates[0].id);
  Lib.patchObject(lib, b.id, { name: 'Объект B2', client: 'Бета-2' }, now);
  assert.equal(b.name, 'Объект B2');
  assert.equal(b.estimates[1].estimate.client, 'Бета-2');
  const copy = Lib.duplicateObject(lib, lib.objects[0].id, ids, now);
  assert.equal(copy.estimates.length, 2);
  assert.match(copy.name, /копия/);
  assert.notEqual(copy.id, lib.objects[0].id);
  assert.equal(lib.objects[0].client, 'Альфа');
  const estCopy = Lib.duplicateEstimate(lib, b.id, b.estimates[0].id, ids, now);
  assert.equal(b.estimates.length, 3);
  assert.match(estCopy.estimate.num, /копия/);
  Lib.activateEstimate(lib, lib.objects[0].id, lib.objects[0].estimates[0].id);
  const next = Lib.archiveObject(lib, lib.objects[0].id, blank, ids, now);
  assert.equal(lib.objects[0].archived, true);
  assert.equal(next.client, 'Бета-2');
  Lib.restoreObject(lib, lib.objects[0].id, now);
  assert.equal(lib.objects[0].archived, false);
  const archivedEst = Lib.archiveEstimate(lib, b.id, b.estimates[0].id, blank, ids, now);
  assert.equal(b.estimates[0].archived, true);
  assert.ok(archivedEst);
  Lib.restoreEstimate(lib, b.id, b.estimates[0].id, now);
  assert.equal(b.estimates[0].archived, false);
});

test('импорт roundtrip и повреждённый файл не меняют список', () => {
  n = 0;
  const { lib } = Lib.planLoad({ blank, idFactory: ids, now });
  lib.objects[0].name = 'Дом';
  lib.objects[0].estimates[0].estimate = est('Дом', 'Анна', 15);
  const file = Lib.bundle(lib);
  const again = Lib.planLoad({ blank, idFactory: ids, now }).lib;
  const before = JSON.stringify(again);
  const bad = Lib.applyImport(again, { kind: 'smeta-backup', v: 2, objects: [{ id: 'bad', estimates: [] }] }, 'replace', Lib.validEstimate, ids, now);
  assert.equal(bad.ok, false);
  assert.equal(JSON.stringify(again), before);
  const added = Lib.applyImport(again, file, 'add', Lib.validEstimate, ids, now);
  assert.equal(added.replaced, false);
  assert.equal(again.objects.length, 2);
  assert.equal(again.objects[1].name, 'Дом');
  assert.equal(again.objects[1].estimates[0].estimate.client, 'Анна');
  const replaced = Lib.applyImport(again, est('Новый', 'Борис', 3), 'replace', Lib.validEstimate, ids, now);
  assert.equal(replaced.replaced, true);
  assert.equal(again.objects.length, 1);
  assert.equal(replaced.estimate.client, 'Борис');
  const round = Lib.planLoad({ libRaw: JSON.stringify(again), blank, idFactory: ids, now });
  assert.equal(round.writes.length, 0);
  assert.equal(round.lib.objects[0].client, 'Борис');
});

test('ошибка квоты останавливает запись и не притворяется успехом', () => {
  const storage = { setItem() { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } };
  const res = Lib.applyWrites(storage, { library: 'smeta_v1_library' }, [{ slot: 'library', value: { v: 2, objects: [] } }]);
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
    JSON.stringify({ v: 2, objects: [null, { id: 'bad id', estimates: [] }] })
  ];
  for (const raw of cases) {
    const plan = Lib.planLoad({ libRaw: raw, legacyRaw: null, blank, idFactory: ids, now });
    assert.equal(plan.writes.find(w => w.slot === 'libDamaged').value, raw);
    assert.equal(plan.blocked, false);
    assert.ok(plan.lib.objects.every(obj => obj.estimates.every(item => Lib.validEstimate(item.estimate))));
  }
});

test('частично целая схема v2 берёт только целые сметы и хранит полный оригинал', () => {
  const raw = JSON.stringify({
    v: 2,
    objects: [
      { id: 'obj1', name: 'Целый', estimates: [{ id: 'est1', estimate: est('Целый', 'Цел', 4) }, { id: 'bad', estimate: { rooms: 'нет' } }] },
      { id: 'gone', estimates: [{ id: 'nope', estimate: null }] }
    ]
  });
  const plan = Lib.planLoad({ libRaw: raw, legacyRaw: null, blank, idFactory: ids, now });
  assert.equal(plan.writes.find(w => w.slot === 'libDamaged').value, raw);
  assert.equal(plan.lib.objects.length, 1);
  assert.equal(plan.lib.objects[0].name, 'Целый');
  assert.equal(plan.lib.objects[0].estimates.length, 1);
  assert.equal(plan.lib.objects[0].estimates[0].estimate.client, 'Цел');
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
  const failing = Lib.applyWrites(storage, { library: 'smeta_v1_library', libDamaged: 'smeta_v1_library_damaged' }, blocked.writes.concat([{ slot: 'libDamaged', value: first }, { slot: 'library', value: { v: 2, objects: [] } }]));
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

test('поиск находит заказчика объекта и не смешивает чужие поля', () => {
  const objects = [
    { id: '1', name: 'Кухня', client: 'Альфа', addr: '', phone: '', email: '', note: '', estimates: [] },
    { id: '2', name: 'Ванная', client: 'Бета', addr: '', phone: '', email: '', note: '', estimates: [] }
  ];
  assert.deepEqual(Lib.queryObjects(objects, 'бета').map(i => i.id), ['2']);
  assert.equal(Lib.queryObjects(objects, '').length, 2);
});

test('архив уходит из рабочего списка и возвращается', () => {
  n = 0;
  const { lib } = Lib.planLoad({ blank, idFactory: ids, now });
  lib.objects[0].name = 'Дом';
  lib.objects[0].estimates[0].estimate = est('Дом', 'Анна', 10);
  const extra = Lib.addEstimate(lib, lib.objects[0].id, est('Дом', 'Анна', 20), ids, now);
  assert.deepEqual(Lib.workList(lib.objects)[0].estimates.length, 2);
  Lib.archiveEstimate(lib, lib.objects[0].id, extra.id, blank, ids, now);
  const work = Lib.workList(lib.objects);
  assert.equal(work.length, 1);
  assert.equal(work[0].estimates.includes(extra.id), false);
  assert.deepEqual(Lib.archiveList(lib.objects), [{ type: 'estimate', objectId: lib.objects[0].id, id: extra.id }]);
  Lib.restoreEstimate(lib, lib.objects[0].id, extra.id, now);
  assert.equal(Lib.workList(lib.objects)[0].estimates.includes(extra.id), true);
  assert.equal(Lib.archiveList(lib.objects).length, 0);
  Lib.archiveObject(lib, lib.objects[0].id, blank, ids, now);
  assert.equal(Lib.workList(lib.objects).some(o => o.id === lib.objects[0].id), false);
  assert.equal(Lib.archiveList(lib.objects).some(row => row.type === 'object' && row.id === lib.objects[0].id), true);
  Lib.restoreObject(lib, lib.objects[0].id, now);
  assert.equal(Lib.workList(lib.objects).some(o => o.id === lib.objects[0].id), true);
});
