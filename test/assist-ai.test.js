const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AI = require('../assist-ai.js');
const Assist = require('../assist.js');

const catalog = [
  { i: 4, sec: 'Демонтажные работы', surf: 'Стены', name: 'Снятие обоев', unit: 'м2', price: 99, base: 'walls' },
  { i: 20, sec: 'Финишная отделка полов', surf: 'Полы', name: 'Укладка ламината с подложкой', unit: 'м2', price: 962, base: 'floor' }
];

function rowsOf(plan) {
  return (plan.rooms || []).flatMap(room => (room.proposals || []).map(p => ({
    include: p.include, item: p.item, roomName: room.name, noDims: room.noDims, dims: room.dims, qty: p.qty
  })));
}

test('мок Yandex даёт план, который applyPlan кладёт в смету ценой каталога', async () => {
  const model = {
    warnings: ['Высота взята с подписи на плане.'],
    unknown: [],
    rooms: [{
      name: 'Комната',
      dims: { L: 3.43, W: 5.53, H: 2.64, open: 5.25, floor: 99 },
      proposals: [{ i: 4, include: true, qty: 42.06, note: 'стены' }]
    }]
  };
  let call = null;
  const out = await AI.generatePlan({
    key: 'test-not-a-real-key',
    folderId: 'b1gtestfolder',
    endpoint: 'http://127.0.0.1:8787/api/ai/yandex',
    text: 'Комната, снять обои',
    images: [{ mime: 'image/jpeg', data: 'abc' }],
    catalog,
    rooms: ['Комната'],
    fetch: async (url, init) => {
      call = { url, init, body: JSON.parse(init.body) };
      return { ok: true, status: 200, json: async () => ({ text: JSON.stringify(model), model: 'gpt://b1gtestfolder/qwen3.5-35b' }) };
    }
  });
  assert.equal(out.ok, true);
  assert.equal(out.plan.matcher, 'ai');
  assert.equal(call.url, 'http://127.0.0.1:8787/api/ai/yandex');
  assert.equal(call.init.headers['X-Yandex-Api-Key'], 'test-not-a-real-key');
  assert.equal(call.body.folderId, 'b1gtestfolder');
  assert.equal(call.body.images[0].data, 'abc');
  assert.equal(JSON.stringify(call.body).includes('test-not-a-real-key'), false);
  assert.equal(out.plan.rooms[0].dims.floor, 18.97);
  assert.equal(out.plan.rooms[0].dims.perim, 17.92);
  assert.equal(out.plan.rooms[0].dims.walls, 42.06);
  assert.equal(out.plan.rooms[0].dims.floorFromSides, true);
  const proposal = out.plan.rooms[0].proposals[0];
  assert.equal(proposal.item.name, 'Снятие обоев');
  assert.equal(proposal.item.price, 99);
  assert.equal(proposal.item.unit, 'м2');
  const applied = Assist.applyPlan([], rowsOf(out.plan));
  assert.equal(applied.added.length, 1);
  assert.equal(applied.added[0].price, 99);
  assert.equal(applied.added[0].qty, 42.06);
  assert.equal(applied.rooms[0].works[0].price, 99);
});

test('неверный i не попадает в смету', () => {
  const plan = AI.planFromModel({
    rooms: [{
      name: 'Кухня',
      dims: { L: 3, W: 4, H: 2.7 },
      proposals: [
        { i: 999, name: 'Люстра хрустальная', include: true, qty: 1 },
        { i: 20, include: true, qty: 12 }
      ]
    }]
  }, catalog);
  assert.equal(plan.matcher, 'ai');
  assert.equal(plan.unknown.length, 1);
  assert.match(plan.unknown[0].text, /Люстра/);
  assert.equal(plan.rooms[0].proposals.length, 1);
  assert.equal(plan.rooms[0].proposals[0].item.i, 20);
  assert.equal(plan.rooms[0].proposals[0].item.price, 962);
  const applied = Assist.applyPlan([], rowsOf(plan));
  assert.deepEqual(applied.added.map(row => row.name), ['Укладка ламината с подложкой']);
});

test('без ключа или каталога нет запроса и нет отката к parseWorks', async () => {
  let called = false;
  const fetch = async () => { called = true; return { ok: false, status: 500, json: async () => ({}) }; };
  const noKey = await AI.generatePlan({ key: '   ', folderId: 'b1g', endpoint: 'http://server/api/ai/yandex', text: 'Кухня 12 м2, снять обои', catalog, fetch });
  const noFolder = await AI.generatePlan({ key: 'secret', folderId: '', endpoint: 'http://server/api/ai/yandex', text: 'Кухня', catalog, fetch });
  assert.equal(called, false);
  assert.equal(noKey.ok, false);
  assert.equal(noKey.code, 'no-key');
  assert.equal(noFolder.code, 'no-key');
  assert.match(noKey.message, /не запускался/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('async function runAssistAi');
  const end = html.indexOf('function clearAssist');
  assert.ok(start > 0 && end > start);
  const fn = html.slice(start, end);
  assert.equal(fn.includes('parseWorks'), false);
  assert.match(fn, /no-key|Нужен ключ/);
});

test('без адреса сервера Yandex из браузера не вызывается', async () => {
  let called = false;
  const out = await AI.generatePlan({
    key: 'secret',
    folderId: 'b1g',
    text: 'комната',
    catalog,
    fetch: async () => { called = true; return { ok: true, status: 200, json: async () => ({ text: '{}' }) }; }
  });
  assert.equal(called, false);
  assert.equal(out.code, 'no-server');
  assert.match(out.message, /не запускался/);
});

test('количество вне диапазона не отмечается', () => {
  const plan = AI.planFromModel({
    rooms: [{ name: 'Комната', proposals: [{ i: 4, include: true, qty: 1000000 }] }]
  }, catalog);
  assert.equal(plan.rooms[0].proposals[0].include, false);
  assert.equal(plan.rooms[0].proposals[0].qty, null);
  assert.match(plan.rooms[0].proposals[0].note, /100000/);
});
