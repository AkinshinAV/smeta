const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../smeta-calc.js');

test('геометрия прямоугольника и ручная площадь пола', () => {
  const g = C.geo({ L: '3.43', W: '5.53', H: '2.64', open: '5.25', slopes: '6.5' });
  assert.equal(g.floor, 18.97);
  assert.equal(g.perim, 17.92);
  assert.equal(g.walls, 42.06);
  assert.equal(g.slopes, 6.5);
  const manual = C.geo({ L: '2.65', W: '2.32', H: '2.5', open: '7.7', floor: '5.45' });
  assert.equal(manual.perim, 9.94);
  assert.equal(manual.walls, 17.15);
  assert.equal(manual.floor, 5.45);
  assert.equal(manual.floorManual, true);
  const auto = C.geo({ L: '2.12', W: '0.85', H: '2.5', open: '7.3' });
  assert.equal(auto.floor, 1.8);
  assert.equal(auto.walls, 7.55);
  assert.equal(C.geo({ noDims: true, L: 5, W: 5 }).floor, 0);
  assert.equal(C.geo({ L: 3, W: 4, H: 2.5, open: 100 }).walls, 0);
});

test('строки округляются до рубля как в оригинале, отрицательные не вычитаются', () => {
  const row = (price, qty) => C.lineSum({ price, qty });
  assert.equal(row(468, 5.45), 2551);
  assert.equal(row(131, 10.9), 1428);
  assert.equal(row(4811, 1.5), 7217);
  assert.equal(row(770, 5.45), 4197);
  assert.equal(row(87, 5.45), 474);
  assert.equal(row(76, 8.34), 634);
  assert.equal(row(279, 14.65), 4087);
  assert.equal(row('1,5', '2,5'), 4);
  assert.equal(row(-10, 5), 0);
  assert.equal(row(10, -2), 0);
  assert.equal(C.num('1 234,5'), 1234.5);
  assert.equal(C.parseUserNum('-3', 0, 100).bad, true);
  assert.equal(C.parseUserNum('-3', 0, 100).n, 0);
  assert.equal(C.parseUserNum('abc', 0, 10).bad, true);
});

test('скидка считается по помещениям и сходится с итогами оригинальной сметы', () => {
  const gross = [151809, 86231, 35046, 88874, 146998, 72251, 121806, 168793];
  const expectNet = [121447, 68985, 28037, 71099, 117598, 57801, 97445, 135034];
  const rooms = gross.map(g => ({ works: [{ sec: 'Малярные работы', price: g, qty: 1 }] }));
  rooms.forEach((r, i) => assert.equal(C.roomFin(r, 20, false), expectNet[i]));
  assert.equal(C.objFin(rooms, 20, false), 697446);
  assert.equal(C.objBase(rooms), 871808);
  const elec = { works: [{ sec: 'Электромонтажные работы', price: 24950, qty: 1 }] };
  const common = { works: [{ sec: 'Малярные работы', price: 100, qty: 1 }] };
  assert.equal(C.roomFin(elec, 20, false), 24950);
  assert.equal(C.roomFin(elec, 20, true), 19960);
  assert.equal(C.roomFin(common, 20, false), 80);
  assert.equal(C.discOf(50), 20);
  assert.equal(C.discOf(-5), 0);
  const a = { works: [{ sec: 'Малярные работы', price: 3, qty: 1 }] };
  const b = { works: [{ sec: 'Малярные работы', price: 3, qty: 1 }] };
  assert.equal(C.objFin([a, b], 20, false), 4);
  assert.equal(Math.round(6 * 0.8), 5);
});

test('НДС 5/105 и предоплата как в договоре', () => {
  const fin = 1214073;
  assert.equal(C.prepay(fin, ''), 61000);
  assert.equal(C.refund(fin, ''), 36000);
  assert.deepEqual(C.vatParts(fin), { rub: 57813, kop: 0, value: 57813 });
  assert.deepEqual(C.vatParts(61000), { rub: 2904, kop: 76, value: 2904.76 });
  assert.deepEqual(C.vatParts(36000), { rub: 1714, kop: 29, value: 1714.29 });
  assert.deepEqual(C.vatParts(697446), { rub: 33211, kop: 71, value: 33211.71 });
  assert.deepEqual(C.vatParts(1517591), { rub: 72266, kop: 24, value: 72266.24 });
  assert.deepEqual(C.vatParts(303518), { rub: 14453, kop: 24, value: 14453.24 });
  assert.equal(C.prepay(fin, '1000'), 1000);
  assert.equal(C.rkVat(697446), '33\u00a0211 р. 71 коп.');
});

test('сумма прописью', () => {
  assert.equal(C.rubWords(1214073), 'один миллион двести четырнадцать тысяч семьдесят три рубля 00 копеек');
  assert.equal(C.rubWords(1517591), 'один миллион пятьсот семнадцать тысяч пятьсот девяносто один рубль 00 копеек');
  assert.equal(C.rubWords(303518), 'триста три тысячи пятьсот восемнадцать рублей 00 копеек');
  assert.equal(C.rubWordsKop(61000, 0), 'шестьдесят одна тысяча рублей 00 копеек');
  assert.equal(C.rubWordsKop(36000, 0), 'тридцать шесть тысяч рублей 00 копеек');
  assert.equal(C.rubWordsKop(2904, 76), 'две тысячи девятьсот четыре рубля 76 копеек');
  assert.equal(C.rubWordsKop(1714, 29), 'одна тысяча семьсот четырнадцать рублей 29 копеек');
  assert.equal(C.words(0), 'ноль');
  assert.equal(C.words(11), 'одиннадцать');
  assert.equal(C.words(21), 'двадцать один');
});

test('имя заказчика не может сломать стиль печати', () => {
  const safe = C.cssSafe('");}@page{margin:0} <img onerror=alert(1)>\\\nНикита');
  assert.equal(safe.includes('}'), false);
  assert.equal(safe.includes('<'), false);
  assert.equal(safe.includes('"'), false);
  assert.ok(safe.includes('Никита'));
});
