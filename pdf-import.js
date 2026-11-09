/* Разбор текста сметы в черновик. PDF сюда не читается и никуда не отправляется. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SmetaPdf = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_BYTES = 8 * 1024 * 1024;
  const MAX_PAGES = 30;
  const STOP = new Set('в во на и с со по для из до от под без не а то же это работы работа'.split(' '));

  function norm(s) {
    return String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function stemRu(w) {
    w = norm(w);
    const suf = ['циями', 'ями', 'ами', 'иями', 'ов', 'ев', 'ей', 'ой', 'ий', 'ый', 'ая', 'ое', 'ые', 'ие', 'ью', 'ием', 'ем', 'ом', 'ам', 'ям', 'ах', 'ях', 'ую', 'юю', 'ы', 'и', 'а', 'я', 'у', 'ю', 'о', 'е', 'ь'];
    for (const s of suf) {
      if (w.length > s.length + 2 && w.endsWith(s)) return w.slice(0, -s.length);
    }
    return w;
  }

  function tokens(s) {
    return norm(s).split(/[^a-zа-я0-9]+/i).filter(Boolean);
  }

  function sigTokens(s) {
    return tokens(s).map(stemRu).filter(t => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
  }

  function tokenHit(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
    return false;
  }

  function numTok(s) {
    let t = String(s ?? '').replace(/[\s\u00a0]/g, '');
    if (/^\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, '');
    else t = t.replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  function repairSplitThousands(line) {
  return String(line || '').replace(/(\d(?:,\d)?(?:\s+\d+){1,4})(?=\s*р\.?)/g, chunk => {
    const compact = chunk.replace(/\s+/g, '');
    if (/^\d{1,3}(,\d{3})+$/.test(compact)) return compact;
    const digits = chunk.replace(/\D/g, '');
    if (digits.length >= 3 && digits.length <= 7 && chunk.includes(',')) return digits;
    return chunk;
  });
}

  function normUnit(s) {
    const u = norm(s).replace(/\s+/g, '');
    if (u === 'м2' || u === 'м²' || u === 'кв.м' || u === 'кв.м.' || u === 'квм') return 'м2';
    if (u === 'м/п' || u === 'м.п' || u === 'м.п.' || u === 'мп') return 'м/п';
    if (u === 'шт' || u === 'шт.') return 'шт';
    return '';
  }

  function linesFromItems(items, yTol) {
    const tol = yTol == null ? 2.5 : yTol;
    const rows = [];
    const list = (items || []).filter(it => it && String(it.str || '').trim()).map(it => ({
      str: String(it.str).replace(/\u00a0/g, ' '),
      x: Number(it.x) || 0,
      y: Number(it.y) || 0
    }));
    list.sort((a, b) => b.y - a.y || a.x - b.x);
    for (const it of list) {
      let row = null;
      for (const candidate of rows) {
        if (Math.abs(candidate.y - it.y) <= tol) { row = candidate; break; }
      }
      if (!row) {
        row = { y: it.y, items: [] };
        rows.push(row);
      }
      row.items.push(it);
    }
    return rows.map(row => row.items.sort((a, b) => a.x - b.x).map(it => it.str).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  function repairSpacedLetters(line) {
  return String(line || '').replace(/(^|[\s(])([A-Za-zА-ЯЁ])\s+(?=[A-Za-zА-ЯЁа-яё])/g, '$1$2');
}

function noise(line) {
    const s = norm(line);
    if (!s) return true;
    if (/^итого\b/.test(s)) return true;
    if (/ндс/.test(s)) return true;
    if (/^сводная\b/.test(s)) return true;
    if (/^приложение\b/.test(s)) return true;
    if (/^к договору\b/.test(s)) return true;
    if (/^смета\b/.test(s)) return true;
    if (/^составил\b/.test(s)) return true;
    if (/^заказчик\b/.test(s)) return true;
    if (/^уважаемые\b/.test(s)) return true;
    if (/^вид помещения\b/.test(s)) return true;
    if (/^(адрес|id|ред\.?|от|помещение|цена|кол-во|количество|сумма)$/.test(s)) return true;
    if (/^(площадь|проемы|проёмы|стены|длина|периметр|ширина|откосы|высота|полы)\b/.test(s) && !/(м2|м²|м\/п|шт)/.test(s.replace(/\s/g, ''))) return true;
    if (/^(площадь|проемы|проёмы|стены|длина|периметр|ширина|откосы|высота|полы),/.test(s)) return true;
    if (/^стоимость работ\b/.test(s)) return true;
    if (/^скидка\b/.test(s)) return true;
    return false;
  }

  function roomFromTotal(line) {
    const m = norm(line).match(/^итого по помещению\s*[-–—]\s*(.+)$/);
    if (!m) return '';
    const name = m[1].replace(/\s+\d[\d\s,]*(?:[.,]\d+)?\s*р\.?$/i, '').trim();
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
  }

  function sectionOf(line, sections) {
    const s = norm(line).replace(/[:.]+$/, '');
    let found = '';
    for (const sec of sections || []) {
      const name = norm(sec);
      if ((s === name || s.startsWith(name + ' ')) && name.length > found.length) found = sec;
    }
    return found;
  }

  const SURF = new Set('стены полы потолки откосы сантехника прочее окна двери'.split(' '));

  function splitSurf(name) {
    const parts = String(name || '').trim().split(/\s+/);
    if (parts.length && SURF.has(norm(parts[0]))) return { surf: parts[0], name: parts.slice(1).join(' ') };
    return { surf: '', name: String(name || '').trim() };
  }

  function parseWorkLine(line) {
    if (noise(line)) return null;
    const s = repairSplitThousands(String(line).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim());
    const re = /^(.+?)\s+(\d[\d ]*(?:[.,]\d+)?)\s*р\.?\s+(\d[\d ]*(?:[.,]\d+)?)\s*(м2|м²|кв\.?\s*м\.?|м\s*\/\s*п\.?|м\.п\.?|шт)\.?\s+(\d[\d ]*(?:[.,]\d+)?)?\s*р?\.?\s*$/i;
    const m = s.match(re);
    if (!m) return null;
    const price = numTok(m[2]);
    const qty = numTok(m[3]);
    const unit = normUnit(m[4]);
    const sum = m[5] ? numTok(m[5]) : null;
    const split = splitSurf(m[1]);
    if (price == null || qty == null || !unit) return null;
    if (!split.name && !split.surf) return null;
    if (qty < 0 || price < 0 || qty > 100000 || price > 10000000) return null;
    return { name: split.name, surf: split.surf, price, qty, unit, sum };
  }

  function matchCatalog(name, unit, catalog, price) {
    const list = catalog || [];
    const query = sigTokens(name);
    const ranked = [];
    for (const item of list) {
      const same = norm(item.name) === norm(name);
      let score = 0;
      if (same) score = 1;
      else {
        const theirs = sigTokens(item.name);
        if (!query.length || !theirs.length) continue;
        let hit = 0;
        for (const t of query) if (theirs.some(u => tokenHit(t, u))) hit++;
        if (!hit) continue;
        score = hit / query.length * 0.7 + hit / theirs.length * 0.3;
      }
      if (score > 0) ranked.push({ item, score });
    }
    ranked.sort((a, b) => b.score - a.score);
    if (!ranked.length || (query.length < 2 && ranked[0].score < 1)) return { confident: false, item: null, score: 0 };
    const best = ranked[0];
    const second = ranked[1] ? ranked[1].score : 0;
    const unitOk = !unit || normUnit(best.item.unit) === unit;
    const priceHits = ranked.filter(row => row.score >= 0.55 && row.item.price != null && Number(row.item.price) === Number(price) && (!unit || normUnit(row.item.unit) === unit));
    if (price != null && priceHits.length === 1) {
      return { confident: true, item: priceHits[0].item, score: Math.round(priceHits[0].score * 100) / 100 };
    }
    const confident = unitOk && (best.score === 1 || (best.score >= 0.75 && best.score - second >= 0.2 && query.some(t => t.length >= 4)));
    const useful = confident || best.score >= 0.72;
    return { confident, item: useful ? best.item : null, score: Math.round(best.score * 100) / 100 };
  }

  function pageSignature(rows) {
    return rows.map(r => [norm(r.room), norm(r.sourceName), r.qty, r.price, r.unit].join('|')).join('\n');
  }

  function parsePages(pages, catalog) {
    const sections = [];
    (catalog || []).forEach(item => { if (item.sec && !sections.includes(item.sec)) sections.push(item.sec); });
    const rows = [];
    const warnings = [];
    let seenSummary = false;
    let prevSig = '';
    (pages || []).forEach((page, pageIndex) => {
      if (pageIndex >= MAX_PAGES) return;
      const lines = Array.isArray(page) ? page : String(page || '').split(/\r?\n/);
      const joined = lines.map(line => norm(repairSpacedLetters(line))).join('\n');
      if (/сводная по всем помещениям/.test(joined)) {
        seenSummary = true;
        return;
      }
      let room = '';
      let pendingRoom = false;
      let section = '';
      let prevTitle = '';
      const pageRows = [];
      for (const raw of lines) {
        const line = repairSplitThousands(repairSpacedLetters(String(raw || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()));
        if (!line) continue;
        if (norm(line) === 'помещение') { pendingRoom = true; prevTitle = ''; continue; }
        const totalRoom = roomFromTotal(line);
        if (totalRoom) {
          room = totalRoom;
          pageRows.forEach(r => { if (!r.room) r.room = room; });
          prevTitle = '';
          continue;
        }
        let work = parseWorkLine(line);
        if (work && !work.name && prevTitle) work.name = prevTitle;
        if (work && !work.name) work = null;
        if (!work) {
          const sec = sectionOf(line, sections);
          if (sec) { section = sec; pendingRoom = false; prevTitle = ''; continue; }
          if (pendingRoom && !noise(line) && line.length <= 40 && !/\d/.test(line)) {
            room = line.charAt(0).toUpperCase() + line.slice(1);
            pendingRoom = false;
          } else if (!noise(line) && line.length >= 12) prevTitle = line;
          continue;
        }
        pendingRoom = false;
        prevTitle = '';
        const found = matchCatalog(work.name, work.unit, catalog, work.price);
        pageRows.push({
          room: room,
          section: section,
          sourceName: work.name,
          name: found.confident ? found.item.name : work.name,
          surf: work.surf,
          unit: work.unit,
          qty: work.qty,
          price: work.price,
          sum: work.sum,
          include: found.confident,
          useCatalog: found.confident,
          catalog: found.item,
          score: found.score,
          confident: found.confident
        });
      }
      const sig = pageSignature(pageRows);
      if (sig && sig === prevSig) {
        warnings.push('Страница ' + (pageIndex + 1) + ' повторяет предыдущую и не добавлена.');
        return;
      }
      prevSig = sig || prevSig;
      pageRows.forEach(row => rows.push(row));
    });
    const deduped = [];
    const seen = new Set();
    for (const row of rows) {
      const key = [norm(row.room), norm(row.sourceName), row.qty, row.price, row.unit].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
    }
    if (seenSummary) warnings.push('Страница сводной пропущена: это итог, не позиции.');
    if ((pages || []).length > MAX_PAGES) warnings.push('Разобраны только первые ' + MAX_PAGES + ' страниц.');
    return { rows: deduped, warnings };
  }

  function roomsFromRows(rows) {
    const map = new Map();
    for (const row of rows || []) {
      if (!row || !row.include) continue;
      const name = String(row.name || '').trim();
      if (!name) continue;
      const room = String(row.room || 'Импорт').trim() || 'Импорт';
      if (!map.has(room)) map.set(room, []);
      const cat = row.useCatalog && row.catalog ? row.catalog : null;
      const qty = row.qty == null ? '' : row.qty;
      const price = row.price == null ? '' : row.price;
      map.get(room).push({
        sec: cat ? cat.sec : (row.section || 'Импорт PDF'),
        surf: cat ? cat.surf : (row.surf || ''),
        name: name,
        unit: cat ? cat.unit : (row.unit || 'шт'),
        price: price,
        qty: qty,
        base: 'manual',
        auto: false,
        ci: cat && Number.isInteger(cat.i) ? cat.i : -1
      });
    }
    return [...map.entries()].map(([name, works]) => ({
      name,
      L: '', W: '', H: '', open: '', slopes: '', floor: '',
      noDims: norm(name) === 'электрика',
      works
    }));
  }

  function fileProblem(file) {
    if (!file) return '';
    const name = String(file.name || '');
    if (name && !/\.pdf$/i.test(name)) return 'Нужен файл PDF.';
    if (file.size > MAX_BYTES) return 'PDF больше 8 МБ и не разбирается. Сожмите файл или вставьте текст сметы.';
    return '';
  }

  function explainExtract(code) {
    if (code === 'missing') return 'Не удалось загрузить чтение PDF (PDF.js). Файл никуда не отправлялся. Вставьте текст сметы вручную.';
    if (code === 'password') return 'PDF закрыт паролем. Текст не прочитан и никуда не отправлялся.';
    if (code === 'broken') return 'Файл PDF не читается. Он не изменён и никуда не отправлялся.';
    if (code === 'empty') return 'В файле нет текстового слоя. Это похоже на скан: распознавание с картинки не делается. Вставьте текст сметы вручную.';
    if (code === 'big') return 'PDF больше 8 МБ и не разбирается.';
    return 'PDF не разобран. Вставьте текст сметы вручную.';
  }

  return {
    MAX_BYTES, MAX_PAGES, norm, linesFromItems, parseWorkLine, matchCatalog, parsePages, roomsFromRows,
    fileProblem, explainExtract, noise
  };
});
