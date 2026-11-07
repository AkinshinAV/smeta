/* Список объектов в браузере. Не пишет в чужие ключи: страница передаёт только свои. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SmetaLib = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function safeParse(raw) {
    if (raw == null || raw === '') return { ok: false, empty: true };
    try { return { ok: true, value: JSON.parse(raw) }; }
    catch (e) { return { ok: false, corrupt: true }; }
  }

  function validEstimate(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
    if (!Array.isArray(d.rooms)) return false;
    for (const r of d.rooms) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
      if (!Array.isArray(r.works)) return false;
      for (const w of r.works) {
        if (!w || typeof w !== 'object' || Array.isArray(w)) return false;
      }
    }
    if (d.price != null && !Array.isArray(d.price)) return false;
    return true;
  }

  function isLibrary(v) {
    return !!(v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.items));
  }

  function makeItem(estimate, id, now) {
    const ts = now || new Date().toISOString();
    return { id: id, created: ts, updated: ts, archived: false, estimate: estimate };
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function planLoad(opts) {
    const blank = opts.blank;
    const check = opts.validEstimate || validEstimate;
    const idFactory = opts.idFactory || (() => 'obj_' + Math.random().toString(36).slice(2, 10));
    const now = opts.now || (() => new Date().toISOString());
    const writes = [];
    const warnings = [];
    if (opts.backupRaw == null && opts.legacyRaw != null) writes.push({ slot: 'legacyBackup', value: opts.legacyRaw });
    if (opts.priceBackupRaw == null && opts.priceRaw != null) writes.push({ slot: 'priceBackup', value: opts.priceRaw });
    if (opts.coBackupRaw == null && opts.coRaw != null) writes.push({ slot: 'coBackup', value: opts.coRaw });

    let lib = null;
    const parsedLib = safeParse(opts.libRaw);
    if (parsedLib.ok && isLibrary(parsedLib.value)) lib = parsedLib.value;
    else if (parsedLib.corrupt) {
      warnings.push('Список объектов повреждён. Исходная запись не стёрта, сделана отдельная копия.');
      writes.push({ slot: 'libDamaged', value: opts.libRaw });
    }

    if (!lib) {
      lib = { v: 1, activeId: '', items: [] };
      const leg = safeParse(opts.legacyRaw);
      if (leg.ok && check(leg.value)) {
        const est = clone(leg.value);
        if (!Array.isArray(est.price)) {
          const price = safeParse(opts.priceRaw);
          if (price.ok && Array.isArray(price.value) && price.value.length) est.price = clone(price.value);
        }
        const item = makeItem(est, idFactory(), now());
        lib.items.push(item);
        lib.activeId = item.id;
        warnings.push('Подхвачена смета, которая уже была сохранена в этом браузере.');
      } else if (leg.corrupt) {
        warnings.push('Прежняя смета повреждена и не затёрта. Открыт пустой объект.');
        writes.push({ slot: 'legacyDamaged', value: opts.legacyRaw });
      }
      if (!lib.items.length) {
        const item = makeItem(clone(blank), idFactory(), now());
        lib.items.push(item);
        lib.activeId = item.id;
      }
      writes.push({ slot: 'library', value: lib });
    }

    if (!lib.activeId || !lib.items.some(i => i.id === lib.activeId)) {
      const live = lib.items.find(i => !i.archived) || lib.items[0];
      lib.activeId = live ? live.id : '';
    }
    return { lib, writes, warnings };
  }

  function applyWrites(storage, slots, writes) {
    const done = [];
    for (const w of writes) {
      const key = slots[w.slot];
      if (!key) return { ok: false, message: 'Не сохранилось: внутренняя ошибка ключа.', done };
      const val = typeof w.value === 'string' ? w.value : JSON.stringify(w.value);
      try {
        storage.setItem(key, val);
        done.push(key);
      } catch (e) {
        const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
        return {
          ok: false,
          quota: !!quota,
          message: quota
            ? 'Не сохранилось: память браузера заполнена. Скачайте резервную копию, данные в памяти ещё на экране.'
            : 'Не сохранилось: браузер не записал данные.',
          done
        };
      }
    }
    return { ok: true, done };
  }

  function activeItem(lib) {
    return (lib.items || []).find(i => i.id === lib.activeId) || null;
  }

  function capture(lib, estimate, now) {
    const item = activeItem(lib);
    if (!item) return lib;
    item.estimate = estimate;
    item.updated = now || new Date().toISOString();
    return lib;
  }

  function activate(lib, id) {
    const item = (lib.items || []).find(i => i.id === id);
    if (!item) return null;
    item.estimate = clone(item.estimate);
    lib.activeId = id;
    return item.estimate;
  }

  function addItem(lib, estimate, idFactory, now) {
    const item = makeItem(clone(estimate), (idFactory || (() => 'obj_' + Math.random().toString(36).slice(2, 10)))(), (now || (() => new Date().toISOString()))());
    lib.items.push(item);
    lib.activeId = item.id;
    return item;
  }

  function duplicateItem(lib, id, idFactory, now) {
    const src = (lib.items || []).find(i => i.id === id);
    if (!src) return null;
    const est = clone(src.estimate || {});
    const base = est.objectName || est.addr || 'Смета';
    est.objectName = base + ' (копия)';
    const item = makeItem(est, (idFactory || (() => 'obj_' + Math.random().toString(36).slice(2, 10)))(), (now || (() => new Date().toISOString()))());
    lib.items.push(item);
    return item;
  }

  function archiveItem(lib, id, blank, idFactory, now) {
    const item = (lib.items || []).find(i => i.id === id);
    if (!item) return null;
    item.archived = true;
    item.updated = (now || (() => new Date().toISOString()))();
    if (lib.activeId === id) {
      const next = lib.items.find(i => !i.archived);
      if (next) return activate(lib, next.id);
      const created = addItem(lib, blank, idFactory, now);
      return created.estimate;
    }
    return null;
  }

  function restoreItem(lib, id, now) {
    const item = (lib.items || []).find(i => i.id === id);
    if (!item) return null;
    item.archived = false;
    item.updated = (now || (() => new Date().toISOString()))();
    return item;
  }

  function classifyImport(data, check) {
    const valid = check || validEstimate;
    if (data && data.kind === 'smeta-library' && Array.isArray(data.items)) return { type: 'library', items: data.items.filter(i => i && valid(i.estimate)) };
    if (isLibrary(data) && data.items.every(i => i && valid(i.estimate))) return { type: 'library', items: data.items };
    if (valid(data)) return { type: 'estimate', items: [data] };
    return { type: 'bad', items: [] };
  }

  function applyImport(lib, data, mode, check, idFactory, now) {
    const found = classifyImport(data, check);
    if (found.type === 'bad') return { ok: false, message: 'Файл не подходит' };
    const factory = idFactory || (() => 'obj_' + Math.random().toString(36).slice(2, 10));
    const stamp = now || (() => new Date().toISOString());
    const incoming = found.items.map(entry => {
      const est = found.type === 'estimate' ? entry : entry.estimate;
      const item = makeItem(clone(est), factory(), stamp());
      if (found.type === 'library' && entry.archived) item.archived = true;
      return item;
    });
    if (!incoming.length) return { ok: false, message: 'В файле нет смет' };
    if (mode === 'replace') {
      lib.items = incoming;
      const live = incoming.find(i => !i.archived) || incoming[0];
      lib.activeId = live.id;
      return { ok: true, estimate: activate(lib, live.id), added: incoming.length, replaced: true };
    }
    const ids = new Set(lib.items.map(i => i.id));
    incoming.forEach(item => { if (ids.has(item.id)) item.id = factory(); lib.items.push(item); });
    return { ok: true, added: incoming.length, replaced: false };
  }

  function queryItems(items, q) {
    const s = String(q || '').trim().toLowerCase().replace(/ё/g, 'е');
    if (!s) return items.slice();
    return items.filter(item => {
      const e = item.estimate || {};
      const k = e.k || {};
      const blob = [e.objectName, e.addr, e.client, e.num, e.date, k.fio].join(' ').toLowerCase().replace(/ё/g, 'е');
      return blob.includes(s);
    });
  }

  return {
    safeParse, validEstimate, isLibrary, makeItem, planLoad, applyWrites, activeItem, capture,
    activate, addItem, duplicateItem, archiveItem, restoreItem, classifyImport, applyImport, queryItems, clone
  };
});
