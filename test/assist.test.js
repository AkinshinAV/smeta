const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const A = require('../assist.js');

function loadCat() {
  const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const i = html.indexOf('const PRICE_DEF=');
  const j = html.indexOf('const SECTIONS=');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(html.slice(i, j) + '\nthis.CAT=CAT;', ctx);
  return ctx.CAT.map((c, n) => ({ i: n, sec: c[0], surf: c[1], name: c[2], unit: c[3], price: c[4], base: c[5], n: c[6] }));
}
const CAT = loadCat();
const parse = text => A.parseWorks(text, { catalog: CAT });

function flat(res) {
  return res.rooms.flatMap(r => r.proposals.map(p => ({ room: r.name, ...p })));
}

test('пример про кухню: каталог, объёмы, неоднозначная шпаклёвка', () => {
  const res = parse('Кухня 12 м2, снять обои, шпаклевать стены 35 м2 и покрасить в 2 слоя, уложить ламинат');
  assert.equal(res.matcher, 'catalog');
  assert.equal(res.rooms.length, 1);
  assert.equal(res.rooms[0].name, 'Кухня');
  assert.equal(res.rooms[0].dims.floor, 12);
  const by = Object.fromEntries(flat(res).map(p => [p.source, p]));
  const oboi = flat(res).find(p => p.item && p.item.name === 'Снятие обоев');
  assert.ok(oboi);
  assert.equal(oboi.include, false);
  assert.equal(oboi.qty, null);
  assert.match(oboi.note, /стен/);
  const lam = flat(res).find(p => p.item && p.item.name === 'Укладка ламината с подложкой');
  assert.equal(lam.include, true);
  assert.equal(lam.qty, 12);
  assert.equal(lam.item.price, 962);
  assert.equal(lam.item.unit, 'м2');
  const paint = flat(res).find(p => p.item && p.item.name === 'Окраска стен в 2 слоя');
  assert.ok(paint);
  assert.equal(paint.qty, null);
  assert.equal(paint.include, false);
  const putty = flat(res).find(p => p.kind === 'choice' && /шпакл/i.test(p.source));
  assert.ok(putty);
  assert.equal(putty.include, false);
  assert.equal(putty.qty, 35);
  assert.ok(putty.options.some(o => o.name === 'Базовая шпатлевка в 1 слой'));
  assert.ok(!flat(res).some(p => p.include && !p.item));
});

test('несколько помещений, запятая в дроби, синонимы и окончания', () => {
  const res = parse('Ванная 1,5 на 1,36 высота 2,5\nдемонтаж ванны\nплитка на пол\n\nТуалет 1.5х0.72 высота 2.5, снятие обоев');
  const bath = res.rooms.find(r => r.name === 'Ванная');
  const wc = res.rooms.find(r => r.name === 'Туалет');
  assert.ok(bath && wc);
  assert.equal(bath.dims.L, 1.5);
  assert.equal(bath.dims.W, 1.36);
  assert.equal(bath.dims.H, 2.5);
  assert.equal(bath.dims.floor, 2.04);
  const tile = bath.proposals.find(p => p.item && p.item.name === 'Облицовка пола керамической плиткой');
  assert.equal(tile.qty, 2.04);
  assert.equal(tile.include, true);
  const demo = bath.proposals.find(p => p.item && /ванн/i.test(p.item.name));
  assert.equal(demo.item.name, 'Демонтаж ванны (без сохранения)');
  assert.equal(demo.qty, null);
  const oboi = wc.proposals.find(p => p.item && p.item.name === 'Снятие обоев');
  assert.equal(oboi.qty, Math.round((2 * (1.5 + 0.72) * 2.5) * 100) / 100);
  assert.equal(oboi.include, true);
  const alt = parse('Поклеить обои без подбора, постелить ламинат 10 м2, покрасить стены');
  const names = flat(alt).map(p => p.item && p.item.name);
  assert.ok(alt.unknown.some(u => /обои/i.test(u.text)));
  assert.ok(names.includes('Укладка ламината с подложкой'));
  assert.ok(names.includes('Окраска стен в 2 слоя'));
});

test('не выдумывает цену, количество и лишние работы', () => {
  const res = parse('Кухня, натяжной потолок 9 м2, поставить люстру');
  assert.ok(res.unknown.some(u => /потолок/i.test(u.text)));
  assert.equal(flat(res).some(p => p.item && /натяжн/i.test(p.item.name) && p.include), false);
  const lamp = flat(res).find(p => p.item && /люстр/i.test(p.item.name));
  assert.equal(lamp.item.name, 'Установка люстры** (без сборки) до 5000,00 руб.');
  assert.equal(lamp.qty, null);
  assert.equal(flat(res).filter(p => p.include).length, 0);
  const none = parse('ошкурить стены и сделать красиво');
  assert.equal(flat(none).filter(p => p.include).length, 0);
  assert.ok(none.unknown.length >= 1);
});

test('пустой ввод, отрицательные и абсурдные значения, неизвестная работа', () => {
  assert.equal(parse('   ').empty, true);
  assert.equal(parse(',,,\n').empty, true);
  const neg = parse('Кухня -5 м2, ламинат -3 м2');
  assert.ok(neg.rooms[0].questions.some(q => /трицательн/.test(q)) || flat(neg).some(p => p.absurd));
  assert.equal(flat(neg).filter(p => p.include).length, 0);
  const big = parse('Склад 400 на 10, уложить ламинат');
  assert.ok(big.rooms[0].questions.some(q => /одозрительн/.test(q)));
  assert.equal(flat(big).every(p => !p.include), true);
  const miss = parse('Кухня, позолотить лепнину 4 м2');
  assert.ok(miss.unknown.some(u => /лепнин/.test(u.text)));
  assert.equal(flat(miss).length, 0);
  const one = parse('покрасить стены в 1 слой');
  const hint = flat(one)[0];
  assert.equal(hint.kind, 'hint');
  assert.equal(hint.include, false);
  assert.match(hint.note, /1 слой/);
});

test('применение не стирает смету и не дублирует', () => {
  const existing = [{
    name: 'Кухня', L: '3', W: '4', H: '2.7', floor: '', open: '', slopes: '', noDims: false,
    works: [{ sec: 'Финишная отделка полов', surf: 'Полы', name: 'Укладка ламината с подложкой', unit: 'м2', price: 962, qty: 12, base: 'floor', auto: false }]
  }];
  const res = parse('Кухня 12 м2, уложить ламинат, снять обои 20 м2');
  const rows = flat(res).map(p => ({
    include: true, item: p.item, roomName: p.room, noDims: false, dims: res.rooms[0].dims,
    qty: p.item && p.item.name.startsWith('Снятие') ? 20 : p.qty
  }));
  const plan = A.applyPlan(existing, rows);
  assert.equal(existing[0].works.length, 1);
  assert.equal(plan.rooms.length, 1);
  assert.equal(plan.rooms[0].works.length, 2);
  assert.equal(plan.rooms[0].L, '3');
  assert.ok(plan.skipped.some(s => /уже есть/.test(s.reason)));
  assert.ok(plan.added.some(a => a.name === 'Снятие обоев' && a.qty === 20));
  const again = A.applyPlan(plan.rooms, rows);
  assert.equal(again.added.length, 0);
  assert.equal(again.rooms[0].works.length, 2);
});

test('XSS-текст остаётся текстом и не становится работой', () => {
  const raw = '<script>alert(1)</script> <img src=x onerror="alert(1)"> Кухня, снять обои 10 м2';
  const res = parse(raw);
  assert.ok(res.warnings.length);
  const dumped = JSON.stringify(res);
  assert.equal(dumped.includes('<script>'), true);
  const oboi = flat(res).find(p => p.item && p.item.name === 'Снятие обоев');
  assert.ok(oboi);
  assert.equal(oboi.qty, 10);
  assert.ok(!flat(res).some(p => p.item && /script|onerror/i.test(p.item.name)));
});

test('электрику и несколько строк можно набрать отдельно', () => {
  const res = parse('Электрика:\nустановить 10 розеток\nштробление пеноблока 12 м/п\n\nГостиная 4х5 высота 2.7, грунтовка стен и пола');
  const el = res.rooms.find(r => r.name === 'Электрика');
  assert.equal(el.noDims, true);
  const sock = el.proposals.find(p => p.item && /розеток/.test(p.item.name));
  assert.equal(sock.qty, 10);
  assert.equal(sock.include, true);
  assert.equal(sock.item.price, 451);
  const sht = el.proposals.find(p => p.item && p.item.name === 'Штробление стен из пеноблока, ПГП под кабель 16-20мм.');
  assert.equal(sht.qty, 12);
  const guest = res.rooms.find(r => r.name === 'Гостиная');
  const names = guest.proposals.map(p => p.item && p.item.name);
  assert.ok(names.includes('Грунтовка стен(за 1 слой)'));
  assert.ok(names.includes('Грунтовка пола(за 1 слой)'));
});
