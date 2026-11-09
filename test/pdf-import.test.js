const test = require('node:test');
const assert = require('node:assert/strict');
const Pdf = require('../pdf-import.js');

const catalog = [
  { i: 4, sec: 'Демонтажные работы', surf: 'Стены', name: 'Снятие обоев', unit: 'м2', price: 99 },
  { i: 40, sec: 'Финишная отделка полов', surf: 'Полы', name: 'Укладка ламината с подложкой', unit: 'м2', price: 962 },
  { i: 70, sec: 'Электромонтажные работы', surf: 'Чистовые электромонтажные', name: 'Установка механизмов розеток, выключателей, диммера', unit: 'шт', price: 451 }
];

const page = [
  'Приложение №1',
  'Помещение',
  'Кухня',
  'Площадь, кв.м. 18.97',
  'Длина, м. 3.43',
  'Демонтажные работы',
  'Цена',
  'Кол-во',
  'Сумма',
  'Стены Снятие обоев 99 р. 12 м2 1 188 р.',
  'Итого - Демонтажные работы 1 188 р.',
  'Электромонтажные работы',
  'Установка механизмов розеток, выключателей, диммера 451.5 р. 2 шт 903 р.',
  'Загадочная работа без каталога 10 р. 1 шт 10 р.',
  '<img src=x onerror=alert(1)> 15 р. 1 шт 15 р.',
  'Итого по помещению - Кухня 2 106 р.',
  'В том числе НДС 5% 100 р. 29 коп.'
];

test('печатный разрыв первой буквы не мешает каталогу и итогу', () => {
  const parsed = Pdf.parsePages([[
    'П омещение',
    'К омната',
    'Д емонтажные работы Ц ена К ол-во С умма',
    'С тены С нятие обоев 99 р. 42.06 м2 4 164 р.',
    'И того - Д емонтажные работы 4 164 р.',
    'И того по помещению - К омната 5 293 р.',
    'В том числе НДС 5% 212 р. 38 коп.'
  ]], catalog);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].name, 'Снятие обоев');
  assert.equal(parsed.rows[0].room, 'Комната');
  assert.equal(parsed.rows[0].confident, true);
  assert.equal(parsed.rows[0].include, true);
  assert.equal(parsed.rows[0].section, 'Демонтажные работы');
});

test('строка таблицы отделяет позицию от шапки и итога', () => {
  const row = Pdf.parseWorkLine('Стены Снятие обоев 99 р. 42,06 м2 4 164 р.');
  assert.equal(row.name, 'Снятие обоев');
  assert.equal(row.qty, 42.06);
  assert.equal(row.price, 99);
  assert.equal(row.unit, 'м2');
  assert.equal(row.sum, 4164);
  assert.equal(Pdf.parseWorkLine('Итого - Демонтажные работы 4 164 р.'), null);
  assert.equal(Pdf.parseWorkLine('Площадь, кв.м. 18.97'), null);
  assert.equal(Pdf.noise('В том числе НДС 5%'), true);
});

test('координаты собирают строку таблицы и не путают колонки', () => {
  const lines = Pdf.linesFromItems([
    { str: 'Снятие обоев', x: 80, y: 100 },
    { str: 'Стены', x: 10, y: 100.4 },
    { str: '99 р.', x: 280, y: 100 },
    { str: '12 м2', x: 360, y: 99 },
    { str: '1 188 р.', x: 440, y: 100 },
    { str: 'Итого - Демонтажные работы', x: 10, y: 70 },
    { str: '1 188 р.', x: 440, y: 70 }
  ]);
  assert.equal(lines[0], 'Стены Снятие обоев 99 р. 12 м2 1 188 р.');
  const parsed = Pdf.parsePages([lines], catalog);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].name, 'Снятие обоев');
  assert.equal(parsed.rows[0].confident, true);
});

test('черновик помечает каталог, сомнительные строки и не берёт сводную', () => {
  const summary = ['Сводная по всем помещениям', 'Кухня 17.92 42.06 5 293 р.', 'Итого 5 293 р.'];
  const parsed = Pdf.parsePages([page, page, summary], catalog);
  assert.equal(parsed.rows.filter(r => r.sourceName === 'Снятие обоев').length, 1);
  const wall = parsed.rows.find(r => r.sourceName === 'Снятие обоев');
  assert.equal(wall.room, 'Кухня');
  assert.equal(wall.include, true);
  assert.equal(wall.useCatalog, true);
  assert.equal(wall.catalog.sec, 'Демонтажные работы');
  const odd = parsed.rows.find(r => r.sourceName.startsWith('Загадочная'));
  assert.equal(odd.include, false);
  assert.equal(odd.confident, false);
  const nasty = parsed.rows.find(r => r.sourceName.includes('<img'));
  assert.ok(nasty);
  assert.equal(nasty.include, false);
  assert.ok(parsed.warnings.some(w => w.includes('повторяет')));
  assert.ok(parsed.warnings.some(w => w.includes('сводн')));
  const rooms = Pdf.roomsFromRows(parsed.rows);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].name, 'Кухня');
  assert.equal(rooms[0].works.length, 2);
  assert.ok(rooms[0].works.every(w => !String(w.name).includes('<')));
});

test('сообщения про пустой, большой и отсутствующий PDF не обещают распознавание скана', () => {
  assert.match(Pdf.explainExtract('empty'), /нет текстового слоя/);
  assert.match(Pdf.explainExtract('empty'), /не делается/);
  assert.match(Pdf.explainExtract('missing'), /PDF\.js/);
  assert.match(Pdf.explainExtract('password'), /парол/);
  assert.match(Pdf.explainExtract('broken'), /не читается/);
  assert.equal(Pdf.fileProblem({ name: 'a.pdf', size: Pdf.MAX_BYTES + 1 }), 'PDF больше 8 МБ и не разбирается. Сожмите файл или вставьте текст сметы.');
  assert.equal(Pdf.fileProblem({ name: 'a.txt', size: 10 }), 'Нужен файл PDF.');
  assert.equal(Pdf.fileProblem({ name: 'a.pdf', size: 100 }), '');
});
