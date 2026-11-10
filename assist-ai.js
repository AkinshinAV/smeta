/* Разбор текста и картинок через Yandex AI Studio.
   Браузер сам в Yandex не ходит: запрос принимает домашний сервер.
   Ключ передаёт страница из localStorage. В этот файл ключ не записывается. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SmetaAssistAi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const KEY_NAME = 'smeta-yandex-key';
  const FOLDER_NAME = 'smeta-yandex-folder';
  const TEXT_MODEL = 'yandexgpt-5.1';
  const VISION_MODEL = 'qwen3.5-35b';
  const MAX_BYTES = 10 * 1024 * 1024;
  const MAX_PDF_PAGES = 8;
  const MAX_IMAGES = 10;

  function norm(s) {
    return String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim();
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function numOrNull(v) {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? round2(n) : null;
  }

  function clip(s, n) {
    const t = String(s ?? '').replace(/[<>]/g, '').trim();
    return t.length > n ? t.slice(0, n) : t;
  }

  function sideOk(n) { return n != null && n > 0 && n <= 100; }
  function heightOk(n) { return n != null && n > 0 && n <= 8; }
  function areaOk(n) { return n != null && n >= 0 && n <= 5000; }

  function dimsFromModel(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const L = sideOk(numOrNull(src.L)) ? numOrNull(src.L) : null;
    const W = sideOk(numOrNull(src.W != null ? src.W : src.B)) ? numOrNull(src.W != null ? src.W : src.B) : null;
    const H = heightOk(numOrNull(src.H)) ? numOrNull(src.H) : null;
    const open = areaOk(numOrNull(src.open != null ? src.open : src.X)) ? numOrNull(src.open != null ? src.open : src.X) : null;
    const slopes = areaOk(numOrNull(src.slopes)) ? numOrNull(src.slopes) : null;
    const stated = areaOk(numOrNull(src.floor)) ? numOrNull(src.floor) : null;
    const dims = { L, W, H, floor: null, walls: null, perim: null, open, slopes, floorFromSides: false };
    const notes = [];
    if (L != null && W != null) {
      dims.floor = round2(L * W);
      dims.perim = round2(2 * (L + W));
      dims.floorFromSides = true;
      if (stated != null && Math.abs(stated - dims.floor) > 0.05) notes.push('Площадь пола взята как длина × ширина. Стороны под площадь не подгонялись.');
      if (H != null) dims.walls = round2(Math.max(0, dims.perim * H - (open || 0)));
    } else if (stated != null) {
      dims.floor = stated;
    }
    return { dims, notes };
  }

  function indexOf(proposal) {
    if (!proposal || proposal.i == null || proposal.i === '') return null;
    const raw = proposal.i;
    const i = typeof raw === 'number' ? raw : (/^\d+$/.test(String(raw)) ? Number(raw) : NaN);
    return Number.isInteger(i) ? i : null;
  }

  function findItem(catalog, proposal) {
    const list = catalog || [];
    if (proposal && proposal.i != null && proposal.i !== '') {
      const i = indexOf(proposal);
      const byIndex = i == null ? null : list.find(item => item && item.i === i);
      return { item: byIndex && byIndex.name ? byIndex : null };
    }
    const name = norm(proposal && (proposal.name || proposal.text));
    if (!name) return { item: null };
    const hits = list.filter(item => item && norm(item.name) === name);
    if (hits.length === 1) return { item: hits[0], byName: true };
    return { item: null };
  }

  function qtyOf(v) {
    const n = numOrNull(v);
    if (n == null || n < 0 || n > 100000) return null;
    return n;
  }

  function parseModelJson(raw) {
    let text = String(raw ?? '').trim();
    if (!text) throw new Error('пустой ответ');
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/g, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
    return JSON.parse(text);
  }

  function planFromModel(raw, catalog) {
    const data = typeof raw === 'string' ? parseModelJson(raw) : raw;
    const warnings = [];
    const unknown = [];
    if (data && Array.isArray(data.warnings)) {
      data.warnings.forEach(w => { const t = clip(w, 400); if (t) warnings.push(t); });
    }
    if (data && Array.isArray(data.unknown)) {
      data.unknown.slice(0, 30).forEach(u => {
        const text = clip(u && (u.text || u.name) || 'фраза', 240);
        const reason = clip(u && u.reason || 'Модель не нашла позицию в каталоге.', 240);
        if (text) unknown.push({ text, reason });
      });
    }
    const rooms = [];
    const srcRooms = data && Array.isArray(data.rooms) ? data.rooms.slice(0, 20) : [];
    srcRooms.forEach(src => {
      const name = clip(src && src.name || 'Помещение', 80) || 'Помещение';
      const noDims = norm(name) === 'электрика';
      const built = noDims ? { dims: { L: null, W: null, H: null, floor: null, walls: null, perim: null, open: null, slopes: null }, notes: [] } : dimsFromModel(src && src.dims);
      const questions = [];
      built.notes.forEach(n => questions.push(n));
      if (src && Array.isArray(src.questions)) src.questions.forEach(q => { const t = clip(q, 400); if (t) questions.push(t); });
      const proposals = [];
      const seen = new Set();
      const list = src && Array.isArray(src.proposals) ? src.proposals.slice(0, 40) : [];
      list.forEach(p => {
        const found = findItem(catalog, p);
        if (!found.item) {
          unknown.push({
            text: clip(p && (p.name || p.text) || (p && p.i != null ? 'i=' + p.i : 'позиция'), 240),
            reason: 'Нет такой позиции в каталоге — в смету не добавлено.'
          });
          return;
        }
        const item = {
          i: found.item.i, sec: found.item.sec, surf: found.item.surf, name: found.item.name,
          unit: found.item.unit, price: found.item.price == null ? null : found.item.price, base: found.item.base || 'manual'
        };
        const key = item.sec + '|' + item.name;
        const qty = qtyOf(p && p.qty);
        let include = !!(p && (p.include === true || p.include === 'true')) && qty != null;
        let note = clip(p && p.note, 300);
        if (seen.has(key)) {
          include = false;
          note = (note ? note + ' ' : '') + 'Повтор — второй раз не отмечен.';
        }
        seen.add(key);
        if ((p && p.qty != null && p.qty !== '') && qty == null) {
          include = false;
          note = (note ? note + ' ' : '') + 'Количество вне 0…100000 и не подставлено.';
        }
        proposals.push({
          source: clip(p && (p.text || p.name) || item.name, 240),
          kind: include ? 'match' : 'hint',
          include, item, options: [item], qty, note, absurd: false
        });
      });
      rooms.push({ name, noDims, dims: built.dims, questions, proposals });
    });
    if (!rooms.length && !warnings.length) warnings.push('Модель не вернула помещения.');
    return { empty: !rooms.length, warnings, unknown, rooms, matcher: 'ai' };
  }

  function systemPrompt(catalog, roomNames) {
    const brief = (catalog || []).map(item => ({
      i: item.i, sec: item.sec, surf: item.surf, name: item.name, unit: item.unit, base: item.base
    }));
    return [
      'Ты сметчик отделочных работ. По тексту заказчика и по приложенным изображениям (чертёж, планировка, дизайн) верни только JSON без пояснений вокруг.',
      'Сними с чертежа длину L, ширину W и высоту H в метрах, проёмы X в м² положи в open. Не подгоняй стороны под названную площадь.',
      'Площадь пола S = L×W, периметр P = 2×(L+W), стены Wстен = P×H − X. Если сторон нет, а площадь названа, положи её в floor и оставь L и W пустыми. Не выдумывай стороны.',
      'Позиции выбирай только индексом i из каталога ниже. Цену и единицу не придумывай: их возьмёт программа из каталога.',
      'Не выдумывай типозависимые цены и формулы с *H, *D, *R.',
      'Не добавляй потолки (ГКЛ, натяжные), двери, кондиционеры, светильники и вывоз мусора, если пользователь об этом не написал и на дизайне этого явно нет.',
      'Стяжку и наливной пол не ставь по умолчанию.',
      'Где неясно — questions и include:false. Дорогие варианты не угадывай.',
      'Электрику (помещение или работы) добавляй только если она названа в тексте или явно видна на дизайне.',
      'qty — число от 0 до 100000 или null, если количество неизвестно. Неизвестный индекс не маскируй: не включай такую строку, добавь её в unknown.',
      'Текущие помещения сметы: ' + ((roomNames && roomNames.length) ? roomNames.join(', ') : 'пока нет') + '.',
      'Каталог JSON: ' + JSON.stringify(brief),
      'Формат ответа: {"warnings":[""],"unknown":[{"text":"","reason":""}],"rooms":[{"name":"","noDims":false,"dims":{"L":null,"W":null,"H":null,"open":null,"slopes":null,"floor":null},"questions":[""],"proposals":[{"i":0,"name":"","include":false,"qty":null,"note":""}]}]}'
    ].join('\n');
  }

  function proxyBody(opts) {
    const images = (opts.images || []).slice(0, MAX_IMAGES).filter(image => image && image.data).map(image => ({
      mime: image.mime || 'image/jpeg',
      data: image.data
    }));
    return {
      folderId: String(opts.folderId || '').trim(),
      text: String(opts.text || '').slice(0, 20000),
      system: systemPrompt(opts.catalog, opts.rooms),
      images
    };
  }

  async function generatePlan(opts) {
    const key = String(opts && opts.key || '').trim();
    const folderId = String(opts && opts.folderId || '').trim();
    if (!key || !folderId) return { ok: false, code: 'no-key', message: 'Нужны ключ и ID каталога Yandex AI Studio. Разбор по правилам не запускался.' };
    const endpoint = opts && opts.endpoint;
    if (!endpoint) return { ok: false, code: 'no-server', message: 'Нужен вход на домашний сервер: из браузера Yandex Cloud не открывается. Разбор по правилам не запускался.' };
    const fetchFn = (opts && opts.fetch) || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (typeof fetchFn !== 'function') return { ok: false, code: 'no-fetch', message: 'В этом браузере нет запроса к серверу.' };
    const sent = proxyBody(opts);
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: opts.authorization || '',
        'X-Yandex-Api-Key': key
      },
      body: JSON.stringify(sent)
    });
    if (!response || !response.ok) {
      const status = response && response.status;
      return { ok: false, code: 'http', message: 'Yandex не разобрал запрос' + (status ? ' (' + status + ')' : '') + '. Разбор по правилам не запускался.' };
    }
    const payload = await response.json();
    const text = payload && (payload.text || '');
    if (!String(text).trim()) return { ok: false, code: 'empty', message: 'Yandex вернул пустой ответ. Разбор по правилам не запускался.' };
    try {
      return { ok: true, model: payload.model || (sent.images.length ? VISION_MODEL : TEXT_MODEL), plan: planFromModel(text, opts.catalog), sent };
    } catch (e) {
      return { ok: false, code: 'json', message: 'Ответ Yandex не разобран как смета. Разбор по правилам не запускался.' };
    }
  }

  function fileKind(file) {
    const name = String(file && file.name || '');
    const type = String(file && file.type || '').toLowerCase();
    if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
    if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp' || /\.(jpe?g|png|webp)$/i.test(name)) return 'image';
    return '';
  }

  function fileProblem(file) {
    if (!file) return 'Файл не выбран.';
    if (file.size > MAX_BYTES) return 'Файл больше 10 МБ и не прикреплён. Сожмите его или выберите страницу отдельно.';
    if (!fileKind(file)) return 'Нужен PDF, JPG, PNG или WEBP.';
    return '';
  }

  return {
    KEY_NAME, FOLDER_NAME, TEXT_MODEL, VISION_MODEL, MAX_BYTES, MAX_PDF_PAGES, MAX_IMAGES,
    planFromModel, generatePlan, systemPrompt, fileProblem, fileKind, proxyBody
  };
});
