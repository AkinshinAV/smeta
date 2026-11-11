/* Подбор работ по тексту. Это поиск по каталогу сайта, не нейросеть и не внешний сервис. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SmetaAssist = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STOP = new Set('в во на и с со по для из до от под без не а то же это ну нужно надо сделать выполнить пожалуйста также ещё еще работу работы помещение помещения'.split(' '));

  function norm(s) {
    return String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
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

  function dec(raw) {
    return String(raw ?? '').replace(/(\d),(?=\d)/g, '$1.');
  }

  function toNum(s) {
    const n = parseFloat(String(s).replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  const ROOM_RE = /^(?:(?:в|во|для|по)\s+)?(кухн[а-я]*|ванн[а-я]*|туалет[а-я]*|сануз[а-я]*|прихож[а-я]*|коридор[а-я]*|балкон[а-я]*|лоджи[а-я]*|спальн[а-я]*|гостин[а-я]*|детск[а-я]*|кабинет[а-я]*|кладов[а-я]*|электрик[а-я]*|сантехник[а-я]*|комнат[а-я]*)(?=$|[\s,:.\-–—])\s*(.*)$/i;

  function roomInfo(word, rest) {
    const w = norm(word);
    const table = [
      [/кухн/, 'Кухня', false], [/ванн/, 'Ванная', false], [/туалет/, 'Туалет', false], [/сануз/, 'Санузел', false],
      [/прихож/, 'Прихожая', false], [/коридор/, 'Коридор', false], [/балкон/, 'Балкон', false], [/лоджи/, 'Лоджия', false],
      [/спальн/, 'Спальня', false], [/гостин/, 'Гостиная', false], [/детск/, 'Детская', false], [/кабинет/, 'Кабинет', false],
      [/кладов/, 'Кладовая', false], [/электрик/, 'Электрика', true], [/сантехник/, 'Сантехника', true]
    ];
    if (/комнат/.test(w)) {
      let name = 'Комната';
      const extra = norm(rest).match(/^(мал[а-я]*|больш[а-я]*|\d+)(?=$|\s)/);
      if (extra) {
        const map = { мал: 'малая', больш: 'большая' };
        const bit = /^\d+$/.test(extra[1]) ? extra[1] : (map[extra[1].slice(0, 4)] || extra[1]);
        name = 'Комната ' + bit;
        rest = rest.slice(rest.toLowerCase().indexOf(extra[1]) + extra[1].length);
      }
      return { name, noDims: false, rest: rest.trim() };
    }
    for (const [re, name, noDims] of table) {
      if (re.test(w))     return { name, noDims, rest: String(rest || '').trim() };
  }
  return null;
}

function clauseRoom(clause) {
  const m = norm(clause).match(/^([а-яa-z]{3,})\s+(.+)$/i);
  if (!m || ROOM_RE.test(norm(clause))) return null;
  if (!/^\d/.test(norm(m[2]))) return null;
  const dimmed = takeDims(m[2]);
  const has = ['L', 'W', 'H', 'floor', 'walls', 'open', 'slopes', 'perim'].some(k => dimmed.dims[k] != null) || dimmed.warnings.length;
  if (!has || norm(dimmed.rest)) return null;
  return { name: m[1].charAt(0).toUpperCase() + m[1].slice(1), dims: dimmed.dims, warnings: dimmed.warnings };
}

  function absurdDim(n, kind) {
    if (n == null || n < 0) return true;
    if (kind === 'H') return n > 8;
    if (kind === 'side') return n > 100;
    if (kind === 'area') return n > 5000;
    if (kind === 'qty') return n > 100000;
    return false;
  }

  /** Снимает размеры с начала фразы помещения. Возвращает dims и остаток текста. */
  function takeDims(text) {
    let s = ' ' + norm(dec(text)) + ' ';
    const dims = { L: null, W: null, H: null, floor: null, walls: null, perim: null, open: null, slopes: null };
    const warnings = [];
    if (/(?:^|\s)-\d/.test(s) || /−\d/.test(String(text))) {
      warnings.push('Отрицательный размер пропущен и в смету не подставлен.');
      s = s.replace(/(?:^|\s)-\d+(?:\.\d+)?/g, ' ');
    }
    const pull = (re, fn) => {
      const m = s.match(re);
      if (!m) return false;
      fn(m);
      s = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ');
      return true;
    };
    pull(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:x|х|×|\*|на)\s*(\d+(?:\.\d+)?)(?:\s*(?:м|метра|метров)?)?(?=\s|$)/i, m => {
      dims.L = toNum(m[1]); dims.W = toNum(m[2]);
    });
    pull(/(?:^|\s)высот[а-я]*\s*(\d+(?:\.\d+)?)/i, m => { dims.H = toNum(m[1]); });
    pull(/(?:^|\s)про[её]м[а-я]*\s*(\d+(?:\.\d+)?)/i, m => { dims.open = toNum(m[1]); });
    pull(/(?:^|\s)откос[а-я]*\s*(\d+(?:\.\d+)?)/i, m => { dims.slopes = toNum(m[1]); });
    pull(/(?:^|\s)периметр[а-я]*\s*(\d+(?:\.\d+)?)/i, m => { dims.perim = toNum(m[1]); });
    pull(/(?:^|\s)стен[а-я]*\s*(\d+(?:\.\d+)?)\s*(?:м2|м²|кв\.?\s*м)/i, m => { dims.walls = toNum(m[1]); });
    pull(/(?:^|\s)пол[а-я]*\s*(\d+(?:\.\d+)?)\s*(?:м2|м²|кв\.?\s*м)/i, m => { dims.floor = toNum(m[1]); });
    pull(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:м2|м²|кв\.?\s*м\.?)(?=\s|$)/i, m => {
      if (dims.floor == null) dims.floor = toNum(m[1]);
    });
    ['L', 'W', 'H', 'floor', 'walls', 'open', 'slopes', 'perim'].forEach(k => {
      const kind = k === 'H' ? 'H' : (k === 'L' || k === 'W' ? 'side' : 'area');
      if (dims[k] != null && absurdDim(dims[k], kind)) warnings.push('Подозрительный размер «' + dims[k] + '» — проверьте, в смету сам не подставится.');
    });
    if (dims.L != null && dims.W != null && dims.floor == null) {
      dims.floor = Math.round(dims.L * dims.W * 100) / 100;
      dims.floorFromSides = true;
    }
    if (dims.L != null && dims.W != null && dims.perim == null) dims.perim = Math.round(2 * (dims.L + dims.W) * 100) / 100;
    if (dims.walls == null && dims.perim != null && dims.H != null) {
      dims.walls = Math.round(Math.max(0, dims.perim * dims.H - (dims.open || 0)) * 100) / 100;
      dims.wallsFromSides = true;
    }
    return { dims, rest: s.trim(), warnings };
  }

  function splitClauses(raw) {
    const src = String(raw ?? '').replace(/\r/g, '').replace(/(\d),(?=\d)/g, '$1.');
    const lines = src.split(/\n+|;\s*/).map(s => s.trim()).filter(Boolean);
    const out = [];
    lines.forEach(line => {
      line.split(/,(?!\d)/).forEach(bit => {
        const pieces = bit.split(/\s+и\s+/i);
        for (let i = 0; i < pieces.length; i++) {
          let p = pieces[i].trim();
          if (!p) continue;
          if (i > 0 && /^(пол[а-я]*|стен[а-я]*|потоло?к[а-я]*|откос[а-я]*)$/i.test(p) && pieces[0]) {
            const verb = pieces[0].trim().split(/\s+/)[0];
            p = verb + ' ' + p;
          }
          out.push(p);
        }
      });
    });
    return out;
  }

  function findByName(catalog, name) {
    const n = norm(name);
    return catalog.find(it => norm(it.name) === n) || null;
  }

  function rulePick(clause, catalog) {
    const c = norm(clause);
    const has = re => re.test(c);
    const one = (name, note) => {
      const it = findByName(catalog, name);
      if (!it) return { type: 'unknown', reason: 'В каталоге нет позиции «' + name + '».' };
      return { type: 'match', items: [it], note: note || '' };
    };
    const ask = (names, note) => {
      const items = names.map(n => findByName(catalog, n)).filter(Boolean);
      if (!items.length) return { type: 'unknown', reason: 'В каталоге нет подходящей позиции.' };
      if (items.length === 1) return { type: 'match', items, note: note || '' };
      return { type: 'choice', items, note: note || 'В каталоге несколько похожих позиций — выберите одну.' };
    };
    const hint = (name, note) => {
      const it = findByName(catalog, name);
      if (!it) return { type: 'unknown', reason: note || 'Нет точного совпадения в каталоге.' };
      return { type: 'hint', items: [it], note };
    };

    if (has(/сним|снять|сняти|содрать|ободрать/) && has(/обо/)) return one('Снятие обоев');
    if (has(/поклей|покле|оклей|накле/) && has(/обо/)) {
      if (has(/без\s+подбор/)) return one('Оклейка стен обоями на флизелине без подбора');
      if (has(/с\s+подбор|подбор/)) return one('Оклейка стен обоями на флизелине с подбором');
      return ask(['Оклейка стен обоями на флизелине без подбора', 'Оклейка стен обоями на флизелине с подбором'], 'Уточните: обои с подбором рисунка или без.');
    }
    if (has(/ламинат/)) return one('Укладка ламината с подложкой');
    if (has(/кварц[\s-]*винил|кварцвинил|замков\w+\s+плитк/)) return one('Укладка кварцвиниловой плитки с замком(включая подложку)');

    if ((has(/демонтаж|снять|сняти/) && has(/плинтус/)) || has(/плинтус/) && has(/без\s+сохран/)) return one('Демонтаж плинтуса (без сохранения)');
    if (has(/плинтус/)) return one('Установка плинтусов пластиковых');

    if (has(/покрас|окрас|краск|покрасить|выкрас/) && has(/потоло?к/)) return one('Окраска потолков');
    if (has(/покрас|окрас|краск|покрасить/) && has(/откос/)) return one('Окраска откосов, углов');
    if (has(/покрас|окрас|краск|покрасить|выкрас/)) {
      if (has(/(^|[^\d])1\s*сло|один\s+сло|в\s+один\s+сло/)) {
        return hint('Окраска стен в 2 слоя', 'В каталоге нет окраски стен в 1 слой. Ближайшая позиция — в 2 слоя, она не отмечена.');
      }
      return one('Окраска стен в 2 слоя', has(/2\s*сло|два\s+сло|в\s+два/) ? '' : 'В каталоге одна окраска стен — в 2 слоя.');
    }

    if (has(/шпакл|шпатл|шпаклев|шпатлев/)) {
      if (has(/откос/)) return one('Шпатлевка откосов / колонн / пилонов под окраску (до 4-х слоев с ошкуриванием)');
      if (has(/q\s*3|кью\s*3/)) return one('Шпаклевка стен категории качества Q-3 (матовая краска,тонкие обои, дек.штук. с зерном менее 1 мм)');
      if (has(/под\s+покраск/)) return one('Комплекс работ "подготовка стен под покраску категории качества К3" (грунтовка / базовая шпаклевка 2 слоя с ошкуриванием / грунтовка / поклейка стеклохолста / финишная шпклевка до 3- слоев с ошкуриванием каждого слоя)');
      if (has(/флизелин|под\s+обо/)) return one('Комплекс работ "подготовка стен под флизелин категории качества К2" (грунтовка / базовая шпаклевка 2 слоя с ошкуриванием)');
      if (has(/базов/)) return one('Базовая шпатлевка в 1 слой');
      return ask([
        'Базовая шпатлевка в 1 слой',
        'Шпаклевка стен категории качества Q-3 (матовая краска,тонкие обои, дек.штук. с зерном менее 1 мм)',
        'Комплекс работ "подготовка стен под покраску категории качества К3" (грунтовка / базовая шпаклевка 2 слоя с ошкуриванием / грунтовка / поклейка стеклохолста / финишная шпклевка до 3- слоев с ошкуриванием каждого слоя)',
        'Комплекс работ "подготовка стен под флизелин категории качества К2" (грунтовка / базовая шпаклевка 2 слоя с ошкуриванием)'
      ], 'Уточните вид шпаклёвки — в каталоге несколько позиций.');
    }

    if (has(/грунтов/)) {
      if (has(/пол/) && has(/втор|последующ/)) return one('Грунтовка пола(второй и последующие слои)');
      if (has(/пол/)) return one('Грунтовка пола(за 1 слой)');
      if (has(/откос/)) return one('Грунтовка откосов, углов');
      if (has(/втор|последующ/)) return one('Грунтовка стен(второй и последующие слои)');
      if (has(/стен/)) return one('Грунтовка стен(за 1 слой)');
      return ask(['Грунтовка стен(за 1 слой)', 'Грунтовка пола(за 1 слой)', 'Грунтовка откосов, углов'], 'Уточните, что грунтовать: стены, пол или откосы.');
    }

    if (has(/штукатур/)) {
      if (has(/откос/)) return one('Штукатурка откосов до 40 см, углов');
      if (has(/цпс|цемент/)) return one('Комплексная работа "Штукатурка ЦПС до 2-х см" (грунтовка гл. проникновения / установка и демонтаж маяков / грунтовка и заделка рустов от маяков)');
      if (has(/гипс/)) return one('Комплексная работа "Штукатурка гипсовой смесью до 2-х см" (грунтовка гл. проникновения или бетоноконтакт / установка и демонтаж маяков / грунтовка и заделка рустов от маяков)');
      return ask(['Комплексная работа «Штукатурка гипсовой смесью до 2-х см»', 'Штукатурка ЦПС'], 'Уточните штукатурку: гипсовая смесь или ЦПС.');
    }

    if (has(/самонивел|наливн/)) return one('Устройство самонивелирующей стяжки до 10 мм');
    if (has(/стяжк/)) return ask(['Устройство самонивелирующей стяжки до 10 мм', 'Стяжка (по смете 17.10)'], 'Уточните вид стяжки.');

    if (has(/затирк/) && has(/плитк|шв/)) {
      if (has(/пол/)) return one('Затирка плитки (затиркой на цементной основе)*');
      if (has(/стен/)) return one('Затирка плитки (затиркой на цементной основе)*');
      return ask(['Затирка плитки пола (цементная)', 'Затирка плитки стен (цементная)'], 'Уточните затирку: пол или стены.');
    }
    if (has(/плитк|кафель|керамогранит/) && !has(/демонтаж|снять|сняти|затир/)) {
      if (has(/стен/)) return one('Облицовка керамогранитом (до 600 по одной грани)');
      if (has(/пол/)) return one('Облицовка пола керамической плиткой');
      return ask(['Облицовка пола керамической плиткой', 'Облицовка стен керамической плиткой (до 600 по одной грани)'], 'Уточните, куда класть плитку: на пол или на стены.');
    }

    if (has(/демонтаж|снять|сняти|разбор/)) {
      if (has(/паркет/) && has(/щитов/)) return { type: 'unknown', reason: 'В каталоге есть только «Демонтаж паркета штучного», щитового нет.' };
      if (has(/паркет/)) return one('Демонтаж паркета штучного', has(/штучн/) ? '' : 'В каталоге демонтаж паркета только штучного.');
      if (has(/линолеум|ковролин/)) return one('Демонтаж линолеума, ковролина');
      if (has(/плитк/) && has(/стен/)) return one('Демонтаж керамической плитки');
      if (has(/плитк/) && has(/пол/)) return one('Демонтаж плитки');
      if (has(/плитк/)) return ask(['Демонтаж плитки', 'Демонтаж керамической плитки'], 'Уточните демонтаж плитки: пол или стены.');
      if (has(/натяжн/)) return one('Демонтаж натяжного потолка (включая профиль)');
      if (has(/ванн/)) return one('Демонтаж ванны (без сохранения)');
      if (has(/раковин|мойк/)) return one('Демонтаж раковины');
      if (has(/унитаз/)) return one('Демонтаж унитаза');
      if (has(/люстр/)) return one('Демонтаж люстры');
      if (has(/светильник/)) return one('Демонтаж светильников');
      if (has(/розет|выключател/)) return one('Демонтаж панелей с механизмами розеток и выключателей');
      if (has(/обо/)) return one('Снятие обоев');
    }

    if (has(/подрозет/)) {
      if (has(/бетон|высверл/)) return one('Высверливание полости под подрозетник в бетоне Ф68');
      if (has(/установ|монтаж|поставить/)) return one('Установка подрозетника Ф68х40мм');
      return ask(['Установка подрозетника Ф68х40мм', 'Высверливание под подрозетник в бетоне'], 'Уточните работу с подрозетником.');
    }
    if (has(/розет|выключател|диммер/)) {
      if (has(/демонтаж|снять/)) return one('Демонтаж панелей с механизмами розеток и выключателей');
      if (has(/установ|поставить|монтаж|подключ/)) return one('Установка механизмов розеток, выключателей и диммира (в подрозетник)');
      return ask(['Установка механизмов розеток, выключателей и диммира (в подрозетник)', 'Демонтаж панелей с механизмами розеток и выключателей'], 'Уточните: розетки установить или снять.');
    }
    if (has(/люстр/)) {
      if (has(/демонтаж|снять/)) return one('Демонтаж люстры');
      return one('Установка люстры** (без сборки) до 5000,00 руб.');
    }
    if (has(/точечн\w*\s+светиль|светильник/)) return one('Установка светильников точечных');

    if (has(/штроб/)) {
      if (has(/задел/)) return one('Заделка штроб гипсовыми растворами (пол, стены) до 20мм.');
      if (has(/пеноблок|пенобетон|пгп|газоблок/)) return one('Штробление стен из пеноблока, ПГП под кабель 16-20мм.');
      if (has(/бетон/)) return one('Штробление бетонных стен под кабель 16-20мм.');
      return ask(['Штробление бетонных стен под кабель 16-20мм.', 'Штробление стен из пеноблока, ПГП под кабель 16-20мм.', 'Заделка штроб гипсовыми растворами (пол, стены) до 20мм.'], 'Уточните штробление: бетон, пеноблок или заделка.');
    }

    if (has(/раковин/) && has(/установ|монтаж|поставить|повесить/)) return one('Установка раковины');
    if (has(/унитаз/) && has(/установ|навес|монтаж|поставить/)) return one('Навес унитаза со сборкой клавиш');
    if (has(/смесител/)) return one('Установка смесителей');
    if (has(/ванн/) && has(/установ|монтаж|поставить/)) return one('Установка акриловой ванны');
    if (has(/полотенцесуш/)) return one('Установка полотенцесушителя');
    if (has(/инсталляц/)) return one('Установка каркаса металлической "инсталляции"');
    if (has(/стиральн/)) return one('Установка и подключение стиральной машины');

    if (has(/натяжн/) && has(/потоло?к/)) return one('Натяжной потолок');
    if (has(/тепл\w+\s+пол|тёпл\w+\s+пол/)) return one('Укладка теплого пола из карбоновых матов (кабель)');
    if (has(/пеноблок/) && has(/кладк|возвед|стен/)) return one('Возведение стен из пеноблока');
    if (has(/вывоз|мусор/)) return one('Вывоз мусора');
    if (has(/подоконник/)) return one('Установка подоконников ПВХ');
    if (has(/малярн\w+\s+угол/)) return one('Установка малярного уголка ПВХ');
    if (has(/гидроизол/) && has(/стен/)) return one('Гидроизоляция обмазочной гидроизоляцией 1 слой');
    if (has(/гидроизол/)) return one('Гидроизоляция обмазочной гидроизоляцией 1 слой');

    return null;
  }

  function fuzzy(clause, catalog) {
    const ct = sigTokens(clause).filter(t => !/^(м2|шт|слой|слоя|слоев)$/.test(t));
    if (!ct.length) return null;
    const ranked = [];
    catalog.forEach(it => {
      const nt = sigTokens(it.name);
      if (!nt.length) return;
      let hit = 0;
      ct.forEach(t => { if (nt.some(n => tokenHit(t, n))) hit++; });
      if (!hit) return;
      const extra = nt.filter(n => !ct.some(t => tokenHit(t, n))).length;
      const cover = hit / ct.length;
      if (cover < 1) return;
      if (ct.length === 1 && ct[0].length < 5) return;
      if (extra > 3 && hit < nt.length - 1) return;
      ranked.push({ it, hit, extra });
    });
    ranked.sort((a, b) => b.hit - a.hit || a.extra - b.extra);
    if (!ranked.length) return null;
    const top = ranked[0];
    const same = ranked.filter(x => x.hit === top.hit && x.extra <= top.extra + 1);
    if (same.length > 1) return { type: 'choice', items: same.map(x => x.it), note: 'Нашлось несколько позиций каталога — выберите одну.' };
    if (top.extra > 4) return null;
    return { type: 'match', items: [top.it], note: '' };
  }

  function qtyOf(clause, item, dims) {
    const c = norm(dec(clause));
    if (/(^|[^\d])-\d/.test(c) || /−\d/.test(clause)) {
      return { qty: null, note: 'Отрицательное количество пропущено.', absurd: true, source: 'bad' };
    }
    const unitRe = /(\d+(?:\.\d+)?)\s*(м2|м²|кв\.?\s*м\.?|м\/п|м\.п\.?|п\.м\.?|пог\.?\s*м\.?|шт\.?|штук[а-я]*|точ(?:ка|ки|ек)|ком|розет[а-я]*|выключател[а-я]*|люстр[а-я]*|светильник[а-я]*|подрозет[а-я]*|автомат[а-я]*)(?=$|[^а-яa-z0-9])/i;
    const m = c.match(unitRe);
    let qty = null, from = '';
    if (m) {
      const u = m[2];
      const n = toNum(m[1]);
      const piece = /шт|штук|точ|ком|розет|выключател|люстр|светильник|подрозет|автомат/.test(u);
      const linear = /м\/п|м\.п|п\.м|пог/.test(u);
      const area = /м2|м²|кв/.test(u);
      const iu = norm(item.unit);
      const itemArea = iu === 'м2';
      const itemLinear = iu === 'м/п' || iu === 'м.п.';
      const itemPiece = iu === 'шт' || iu === 'ком' || iu === 'точка';
      if ((area && itemArea) || (linear && itemLinear) || (piece && itemPiece)) {
        qty = n; from = 'из текста';
      } else if (area && !itemArea) {
        return { qty: null, note: 'В тексте площадь, а у позиции единица «' + item.unit + '». Количество не подставлено.', absurd: false, source: 'unit' };
      }
    }
    if (qty == null && !/сло/.test(c)) {
      if (item.base === 'floor' || item.base === 'ceil') {
        if (dims.floor != null && !dims.floorAbsurd) { qty = dims.floor; from = dims.floorFromSides ? 'посчитано как длина × ширина' : 'площадь пола из текста'; }
      } else if (item.base === 'walls') {
        if (dims.walls != null) { qty = dims.walls; from = dims.wallsFromSides ? 'посчитано по длине, ширине и высоте' : 'площадь стен из текста'; }
      } else if (item.base === 'perim' && dims.perim != null) {
        qty = dims.perim; from = 'периметр помещения';
      } else if (item.base === 'slopes' && dims.slopes != null) {
        qty = dims.slopes; from = 'откосы из текста';
      }
    }
    if (qty == null) {
      const why = (item.base === 'walls') ? 'Неизвестна площадь стен — укажите количество, м².'
        : (item.base === 'manual' ? 'Укажите количество, ' + item.unit + '.' : 'Количество не указано — впишите его вручную.');
      return { qty: null, note: why, absurd: false, source: 'ask' };
    }
    if (absurdDim(qty, 'qty') || qty < 0) return { qty: null, note: 'Количество «' + qty + '» выглядит неправдоподобно и не подставлено.', absurd: true, source: 'bad' };
    return { qty, note: from ? 'Количество ' + from + '.' : '', absurd: false, source: 'ok' };
  }

  function parseWorks(text, opts) {
    const catalog = (opts && opts.catalog) || [];
    const warnings = [];
    const unknown = [];
    const raw = String(text ?? '');
    if (!norm(raw)) return { empty: true, warnings: ['Напишите помещения и работы обычными словами.'], unknown: [], rooms: [], matcher: 'catalog' };
    if (/[<>]/.test(raw) || /script|onerror|javascript:/i.test(raw)) warnings.push('Служебные символы в тексте не исполняются и в смету как код не попадают.');
    const clauses = splitClauses(raw).filter(s => /[а-яa-z0-9]/i.test(s));
    if (!clauses.length) return { empty: true, warnings: ['Не разобрал ни одной фразы. Напишите, например: «Кухня 12 м2, снять обои, уложить ламинат».'], unknown: [], rooms: [], matcher: 'catalog' };

    const rooms = [];
    let current = null;
    function ensure(name, noDims) {
      let room = rooms.find(r => norm(r.name) === norm(name));
      if (!room) {
        room = { name, noDims: !!noDims, dims: { L: null, W: null, H: null, floor: null, walls: null, perim: null, open: null, slopes: null }, questions: [], proposals: [] };
        rooms.push(room);
      }
      current = room;
      return room;
    }

    clauses.forEach(clause => {
      const rm = norm(clause).match(ROOM_RE);
      let workText = clause;
      if (rm) {
        const info = roomInfo(rm[1], String(rm[2] || '').replace(/^[\s,:.\-–—]+/, ''));
        if (info) {
          const dimmed = takeDims(info.rest);
          const room = ensure(info.name, info.noDims);
          room.noDims = info.noDims || room.noDims;
          Object.keys(dimmed.dims).forEach(k => {
            if (dimmed.dims[k] != null && room.dims[k] == null) room.dims[k] = dimmed.dims[k];
          });
          if (dimmed.dims.floorFromSides) room.dims.floorFromSides = true;
          if (dimmed.dims.wallsFromSides) room.dims.wallsFromSides = true;
          dimmed.warnings.forEach(w => { if (!room.questions.includes(w)) room.questions.push(w); });
          workText = dimmed.rest;
          if (!norm(workText)) return;
        }
      } else {
        const named = clauseRoom(clause);
        if (named) {
          const room = ensure(named.name, false);
          Object.keys(named.dims).forEach(k => { if (named.dims[k] != null && room.dims[k] == null) room.dims[k] = named.dims[k]; });
          if (named.dims.floorFromSides) room.dims.floorFromSides = true;
          if (named.dims.wallsFromSides) room.dims.wallsFromSides = true;
          named.warnings.forEach(w => { if (!room.questions.includes(w)) room.questions.push(w); });
          return;
        }
      }
      if (!current) current = ensure((opts && opts.defaultRoom) || 'Помещение', false);
      const picked = rulePick(workText, catalog) || fuzzy(workText, catalog);
      if (!picked || picked.type === 'unknown') {
        unknown.push({ text: workText, reason: (picked && picked.reason) || 'Нет такой позиции в каталоге — ничего лишнего не добавлено.' });
        return;
      }
      const absurdRoom = ['L', 'W', 'H', 'floor', 'walls'].some(k => current.dims[k] != null && absurdDim(current.dims[k], k === 'H' ? 'H' : (k === 'L' || k === 'W' ? 'side' : 'area')));
      if (picked.type === 'choice') {
        const q0 = qtyOf(workText, picked.items[0], current.dims);
        current.proposals.push({
          source: workText, kind: 'choice', include: false, item: null, options: picked.items,
          qty: q0.absurd ? null : q0.qty, note: picked.note + (q0.note ? ' ' + q0.note : ''), absurd: q0.absurd || absurdRoom
        });
        return;
      }
      const item = picked.items[0];
      const q = qtyOf(workText, item, current.dims);
      const include = picked.type === 'match' && q.qty != null && !q.absurd && !absurdRoom;
      current.proposals.push({
        source: workText, kind: picked.type === 'hint' ? 'hint' : 'match', include, item, options: picked.items,
        qty: q.absurd ? null : q.qty, note: [picked.note, q.note].filter(Boolean).join(' '), absurd: q.absurd || absurdRoom
      });
    });

    rooms.forEach(room => {
      const seen = new Set();
      room.proposals.forEach(p => {
        const key = p.item ? p.item.sec + '|' + p.item.name : '';
        if (key && seen.has(key)) {
          p.include = false;
          p.note = (p.note ? p.note + ' ' : '') + 'Повтор в этом тексте — второй раз не отмечен.';
        }
        if (key) seen.add(key);
        if (p.include && (p.item.base === 'walls') && room.dims.walls == null && p.note && /Неизвестна площадь стен/.test(p.note)) {
          if (!room.questions.some(q => /площадь стен/.test(q))) room.questions.push('Для части работ не хватает площади стен.');
        }
      });
      if (!room.proposals.length) room.questions.push('Для помещения «' + room.name + '» не нашлось работ в каталоге.');
    });

    if (!rooms.length) warnings.push('Помещения и работы не распознаны.');
    return { empty: false, warnings, unknown, rooms, matcher: 'catalog' };
  }

  function normName(s) { return norm(s); }

  function applyPlan(rooms, rows) {
    const next = JSON.parse(JSON.stringify(rooms || []));
    const added = [];
    const skipped = [];
    (rows || []).forEach(row => {
      if (!row || row.include === false) {
        skipped.push({ name: row && row.item && row.item.name, room: row && row.roomName, reason: 'не отмечено' });
        return;
      }
      const item = row.item;
      if (!item || !item.name) {
        skipped.push({ name: '', room: row.roomName, reason: 'позиция не выбрана' });
        return;
      }
      const qty = row.qty;
      if (qty == null || !Number.isFinite(Number(qty)) || Number(qty) < 0) {
        skipped.push({ name: item.name, room: row.roomName, reason: 'нет корректного количества' });
        return;
      }
      if (Number(qty) > 100000) {
        skipped.push({ name: item.name, room: row.roomName, reason: 'слишком большое количество' });
        return;
      }
      let room = next.find(r => normName(r.name) === normName(row.roomName));
      if (!room) {
        const d = row.dims || {};
        room = {
          id: row.id || ('a' + next.length + '_' + Math.random().toString(16).slice(2)),
          name: row.roomName || 'Помещение',
          L: d.L != null ? String(d.L) : '',
          W: d.W != null ? String(d.W) : '',
          H: d.H != null ? String(d.H) : '',
          floor: d.floor != null && !d.floorFromSides ? String(d.floor) : '',
          open: d.open != null ? String(d.open) : '',
          slopes: d.slopes != null ? String(d.slopes) : '',
          noDims: !!row.noDims,
          works: []
        };
        next.push(room);
      } else if (row.dims) {
        ['L', 'W', 'H', 'open', 'slopes'].forEach(k => {
          if ((room[k] == null || String(room[k]).trim() === '') && row.dims[k] != null) room[k] = String(row.dims[k]);
        });
        if ((room.floor == null || String(room.floor).trim() === '') && row.dims.floor != null && !row.dims.floorFromSides) room.floor = String(row.dims.floor);
      }
      const dup = (room.works || []).some(w => normName(w.name) === normName(item.name) && w.sec === item.sec);
      if (dup) {
        skipped.push({ name: item.name, room: room.name, reason: 'уже есть в смете' });
        return;
      }
      if (!Array.isArray(room.works)) room.works = [];
      room.works.push({
        sec: item.sec, surf: item.surf, name: item.name, unit: item.unit,
        price: item.price == null ? '' : item.price,
        base: item.base || 'manual', qty: Number(qty), auto: false, ci: item.i
      });
      added.push({ name: item.name, room: room.name, qty: Number(qty), price: item.price });
    });
    return { rooms: next, added, skipped };
  }

  return { parseWorks, applyPlan, norm, stemRu, sigTokens };
});
