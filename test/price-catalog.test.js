const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function priceList() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const raw = html.slice(html.indexOf('const PRICE_DEF=') + 'const PRICE_DEF='.length, html.indexOf('const PRICE_NOTES=')).trim().replace(/;$/, '');
  return JSON.parse(raw);
}

test('прайс М0912 совпадает с разобранным PDF по числу, номеру 12.19, пустой 18.9 и чистой опрессовке', () => {
  const price = priceList();
  assert.equal(price.length, 744);
  const mesh = price.find(item => item.n === '12.19');
  assert.equal(mesh.name, 'Укладка малярной сетки/"серпянки"');
  assert.equal(mesh.un, 'м2');
  assert.equal(mesh.p, 234);
  const underlay = price.find(item => item.n === '18.9');
  assert.equal(underlay.name, 'Укладка подложки с проклейкой стыков');
  assert.equal(underlay.p, null);
  const press = price.find(item => item.n === '24.43');
  assert.equal(press.name, 'Опрессовка (азот) Бытовая серия');
  assert.equal(press.s, 'Спецмонтажные работы');
  assert.equal(press.u, 'Кондиционирование');
  assert.equal(press.p, 5125);
  assert.equal(price.some(item => item.name.includes('Цены актуальны')), false);
  assert.equal(price.some(item => item.sn === '11' || item.sn === '14' || item.sn === '16' || item.sn === '22'), false);
  assert.equal(price.filter(item => item.sn === '24').length > 50, true);
  const iso = price.find(item => item.n === '0.1');
  assert.equal(iso.p, 760);
});
