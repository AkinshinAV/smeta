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

test('мок Gemini даёт план, который applyPlan кладёт в смету ценой каталога', async () => {
  const model = {
    warnings: ['Высота взята с подписи на плане.'],
    unknown: [],
    rooms: [{
      name: 'Комната',
      dims: { L: 3.43, W: 5.53, H: 2.64, open: 5.25, floor: 99 },
      proposals: [{ i: 4, include: true, qty: 42.06, note: 'стены' }]
    }]
  };
  let calls = [];
  const out = await AI.generatePlan({
    key: 'test-not-a-real-key',
    text: 'Комната, снять обои',
    catalog,
    rooms: ['Комната'],
    fetch: async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(model) }] } }] }) };
    }
  });
  assert.equal(out.ok, true);
  assert.equal(out.plan.matcher, 'ai');
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
  assert.ok(calls[0].includes('gemini-2.5-flash'));
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

test('без ключа нет запроса и нет отката к parseWorks', async () => {
  let called = false;
  const out = await AI.generatePlan({
    key: '   ',
    text: 'Кухня 12 м2, снять обои',
    catalog,
    fetch: async () => { called = true; return { ok: false, status: 500, json: async () => ({}) }; }
  });
  assert.equal(called, false);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'no-key');
  assert.match(out.message, /не запускался/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('async function runAssistAi');
  const end = html.indexOf('function clearAssist');
  assert.ok(start > 0 && end > start);
  const fn = html.slice(start, end);
  assert.equal(fn.includes('parseWorks'), false);
  assert.match(fn, /no-key|Нужен ключ/);
});

test('404 первой модели повторяет запрос на gemini-2.0-flash', async () => {
  const urls = [];
  const out = await AI.generatePlan({
    key: 'test-not-a-real-key',
    text: 'комната',
    catalog,
    fetch: async (url) => {
      urls.push(url);
      if (urls.length === 1) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"rooms":[]}' }] } }] }) };
    }
  });
  assert.equal(out.ok, true);
  assert.equal(urls.length, 2);
  assert.ok(urls[1].includes('gemini-2.0-flash'));
});

test('количество вне диапазона не отмечается', () => {
  const plan = AI.planFromModel({
    rooms: [{ name: 'Комната', proposals: [{ i: 4, include: true, qty: 1000000 }] }]
  }, catalog);
  assert.equal(plan.rooms[0].proposals[0].include, false);
  assert.equal(plan.rooms[0].proposals[0].qty, null);
  assert.match(plan.rooms[0].proposals[0].note, /100000/);
});
