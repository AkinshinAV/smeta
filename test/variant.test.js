const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../smeta-calc.js');

test('цены по типу помещения только там, где они есть в PDF-наблюдении', () => {
  assert.equal(C.priceForRoom('Грунтовка пола (за 1 слой)', 'Комната', 79), 79);
  assert.equal(C.priceForRoom('Грунтовка пола (за 1 слой)', 'Кухня', 79), 79);
  assert.equal(C.priceForRoom('Грунтовка пола (за 1 слой)', 'Ванная', 79), 99);
  assert.equal(C.priceForRoom('Грунтовка пола (за 1 слой)', 'Балкон', 79), 99);
  assert.equal(C.priceForRoom('Устройство самонивелирующей стяжки до 10 мм', 'Ванная', 1901), 2376);
  assert.equal(C.priceForRoom('Устройство самонивелирующей стяжки до 10 мм', 'Балкон', 1901), 1901);
  assert.equal(C.priceForRoom('Снятие обоев', 'Ванная', 99), 99);
  assert.equal(C.roomKind('Санузел'), 'bath');
  assert.equal(C.roomKind('Лоджия'), 'balcony');
});

test('формула количества не исполняет произвольный код', () => {
  const ctx = { L: 3.43, B: 5.53, H: 2.64, S: 18.97, P: 17.92, W: 42.06, X: 5.25, O: 6.5 };
  assert.equal(C.evalQtyFormula('=S', ctx).n, 18.97);
  assert.equal(C.evalQtyFormula('=W', ctx).n, 42.06);
  assert.equal(C.evalQtyFormula('=P-1.6', ctx).n, 16.32);
  assert.equal(C.evalQtyFormula('=H*4', ctx).n, 10.56);
  assert.equal(C.evalQtyFormula('=L*B', ctx).n, 18.97);
  assert.equal(C.evalQtyFormula('alert(1)', ctx).ok, false);
  assert.equal(C.evalQtyFormula('=constructor', ctx).ok, false);
  assert.equal(C.evalQtyFormula('=W*1,1', ctx).n, 46.27);
});

test('скидка по-прежнему считается от итога помещения, а не зашита в цену', () => {
  const room = { works: [{ sec: 'Малярные работы', price: 100, qty: 1 }] };
  assert.equal(C.roomFin(room, 20, false), 80);
  assert.equal(C.lineSum({ price: 100, qty: 1 }), 100);
});

test('контекст формулы берёт стены из геометрии, а не из уже введённого количества', () => {
  const room = { L: '3.43', W: '5.53', H: '2.64', open: '5.25', slopes: '6.5', works: [{ qty: 1 }] };
  const ctx = C.qtyContext(room);
  assert.equal(ctx.S, 18.97);
  assert.equal(ctx.W, 42.06);
  assert.equal(ctx.P, 17.92);
  assert.equal(ctx.X, 5.25);
  assert.equal(ctx.O, 6.5);
});
