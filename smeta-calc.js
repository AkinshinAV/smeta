/* Чистые расчёты сметы. Подключаются страницей и автотестами. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SmetaCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SPEC_DEF = ['Электромонтажные работы', 'Сантехнические работы'];

  function num(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const n = parseFloat(String(v).trim().replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }

  function parseUserNum(v, min, max) {
    const raw = String(v ?? '').trim();
    if (raw === '') return { n: 0, store: '', bad: false };
    let s = raw.replace(/\s/g, '').replace(',', '.');
    if (s.endsWith('.')) s = s.slice(0, -1);
    if (!/^-?\d+(\.\d+)?$/.test(s)) return { n: 0, store: '0', bad: true };
    let n = parseFloat(s);
    if (!Number.isFinite(n)) return { n: 0, store: '0', bad: true };
    let bad = false;
    if (min != null && n < min) { n = min; bad = true; }
    if (max != null && n > max) { n = max; bad = true; }
    return { n, store: bad ? String(n) : raw, bad };
  }

  const r2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
  const fl = x => Math.floor(Number(x) + 1e-9);

  function geo(r) {
    if (!r || r.noDims) return { floor: 0, walls: 0, perim: 0, slopes: 0, ceil: 0, open: 0 };
    const L = Math.max(0, num(r.L)), W = Math.max(0, num(r.W)), H = Math.max(0, num(r.H));
    const op = Math.max(0, num(r.open));
    const perim = r2(2 * (L + W));
    const autoFloor = r2(L * W);
    const manual = String(r.floor ?? '').trim() !== '';
    const floor = manual ? r2(Math.max(0, num(r.floor))) : autoFloor;
    return {
      floor,
      ceil: floor,
      perim,
      walls: r2(Math.max(0, perim * H - op)),
      slopes: r2(Math.max(0, num(r.slopes))),
      open: op,
      floorManual: manual
    };
  }

  function coefOf(v) {
    if (v == null || String(v).trim() === '') return 1;
    const n = num(v);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.round(n * 1000) / 1000;
  }

  function effPrice(base, coef) {
    const p = num(base);
    if (p < 0) return 0;
    return Math.round(p * coefOf(coef) * 100) / 100;
  }

  function lineSum(w, coef) {
    const p = effPrice(w && w.price, coef);
    const q = num(w && w.qty);
    if (q < 0) return 0;
    return Math.round(p * q);
  }

  function roomTot(r, spec, coef) {
    const sp = spec || SPEC_DEF;
    let g = 0, s = 0;
    ((r && r.works) || []).forEach(w => { (sp.includes(w.sec) ? s += lineSum(w, coef) : g += lineSum(w, coef)); });
    return { g, s, t: g + s };
  }

  function discOf(v) { return Math.min(20, Math.max(0, num(v))); }

  function roomFin(r, d, discSpec, spec, coef) {
    const t = roomTot(r, spec, coef);
    const k = discOf(d) / 100;
    return Math.round(t.g * (1 - k) + t.s * (discSpec ? (1 - k) : 1));
  }

  function objFin(rooms, d, discSpec, spec, coef) {
    return (rooms || []).reduce((a, r) => a + roomFin(r, d, discSpec, spec, coef), 0);
  }

  function objBase(rooms, spec, coef) {
    return (rooms || []).reduce((a, r) => a + roomTot(r, spec, coef).t, 0);
  }

  function smKey(sec, name) { return String(sec || '') + '\n' + String(name || ''); }

  function smKeysFromWorks(works) {
    const out = [];
    const seen = new Set();
    (works || []).forEach(w => {
      if (!w || !w.name) return;
      const key = smKey(w.sec, w.name);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(key);
    });
    return out;
  }

  function smVisible(sec, name, keys) {
    if (!keys) return true;
    return keys.indexOf(smKey(sec, name)) >= 0;
  }

  function money(x) { return fl(num(x)).toLocaleString('ru-RU') + ' р.'; }

  function sp(n) {
    return Math.floor(Math.abs(num(n))).toLocaleString('ru-RU');
  }

  function numStr(v) {
    const n = num(v);
    const r = Math.round(Math.abs(n) * 100) / 100;
    return String(r);
  }

  /** НДС 5/105 в целых копейках, чтобы не ловить ошибку двоичной дроби. */
  function vatParts(x) {
    const kops = Math.round(num(x) * 5 / 105 * 100);
    const a = Math.abs(kops);
    return { rub: Math.floor(a / 100), kop: a % 100, value: a / 100 };
  }

  function vatValue(x) { return vatParts(x).value; }

  function kopStrFromAmount(x) {
    const n = Math.round(Math.abs(num(x)) * 100);
    return String(n % 100).padStart(2, '0');
  }

  function fmtVat(n) {
    const p = vatParts(n);
    return p.rub.toLocaleString('ru-RU') + ' р. ' + String(p.kop).padStart(2, '0') + ' коп.';
  }

  function rkVat(x) {
    const p = vatParts(x);
    return sp(p.rub) + ' р. ' + String(p.kop).padStart(2, '0') + ' коп.';
  }

  function plural(n, f) {
    n = Math.abs(Math.trunc(num(n))) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return f[2];
    if (n1 > 1 && n1 < 5) return f[1];
    if (n1 === 1) return f[0];
    return f[2];
  }

  function words(n) {
    n = Math.floor(Math.abs(num(n)));
    if (n === 0) return 'ноль';
    const u = [
      ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
      ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
    ];
    const t10 = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
    const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
    const hund = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
    const groups = [[null, 0], [['тысяча', 'тысячи', 'тысяч'], 1], [['миллион', 'миллиона', 'миллионов'], 0], [['миллиард', 'миллиарда', 'миллиардов'], 0]];
    const out = [];
    let g = 0;
    while (n > 0 && g < groups.length) {
      const x = n % 1000;
      if (x) {
        const w = [];
        w.push(hund[Math.floor(x / 100)]);
        const r = x % 100;
        if (r >= 10 && r < 20) w.push(t10[r - 10]);
        else { w.push(tens[Math.floor(r / 10)]); w.push(u[groups[g][1]][r % 10]); }
        if (groups[g][0]) w.push(plural(x, groups[g][0]));
        out.unshift(w.filter(Boolean).join(' '));
      }
      n = Math.floor(n / 1000);
      g++;
    }
    return out.join(' ');
  }

  function rubWordsKop(rub, kop) {
    const r = Math.abs(Math.trunc(num(rub)));
    const k = Math.abs(Math.trunc(num(kop))) % 100;
    return words(r) + ' ' + plural(r, ['рубль', 'рубля', 'рублей']) + ' ' + String(k).padStart(2, '0') + ' ' + plural(k, ['копейка', 'копейки', 'копеек']);
  }

  function rubWords(x) {
    const n = Math.round(Math.abs(num(x)) * 100);
    return rubWordsKop(Math.floor(n / 100), n % 100);
  }

  function prepay(fin, override) {
    if (String(override ?? '').trim() !== '') return Math.round(num(override));
    return Math.round(num(fin) * 0.05 / 1000) * 1000;
  }

  function refund(fin, override) {
    if (String(override ?? '').trim() !== '') return Math.round(num(override));
    return Math.round(num(fin) * 0.03 / 1000) * 1000;
  }

  function cssSafe(s) {
    return String(s ?? '').replace(/[\u0000-\u001f{}\\"'<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  return {
    SPEC_DEF, num, parseUserNum, r2, fl, geo, coefOf, effPrice, lineSum, roomTot, discOf, roomFin, objFin, objBase,
    smKey, smKeysFromWorks, smVisible,
    money, sp, numStr, vatParts, vatValue, kopStrFromAmount, fmtVat, rkVat, plural, words,
    rubWords, rubWordsKop, prepay, refund, cssSafe
  };
});
