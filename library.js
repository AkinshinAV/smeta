/* Список объектов и смет в браузере. Не пишет в чужие ключи: страница передаёт только свои.
   Схема v2: объект (карточка) отдельно от смет. Старые записи v1 в работу не берутся:
   непустой неподходящий текст сохраняется побайтно и не затирается без копии. */
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

  function validId(id) {
    return typeof id === 'string' && !!id && id.length <= 80 && !/[<>"'\\\s]/.test(id);
  }

  function validEstimateItem(item, check) {
    try {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      if (!validId(item.id)) return false;
      if (item.archived != null && typeof item.archived !== 'boolean') return false;
      return check(item.estimate);
    } catch (e) {
      return false;
    }
  }

  function str(v) { return typeof v === 'string' ? v : ''; }

  function normRev(v) {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : 0;
  }

  function normConflict(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    try {
      const s = JSON.stringify(v);
      if (s.length > 500000) return null;
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }

  function normEstimateItem(item) {
    const out = {
      id: item.id,
      created: str(item.created),
      updated: str(item.updated),
      archived: item.archived === true,
      rev: normRev(item.rev),
      dirty: item.dirty === true,
      syncConflict: item.syncConflict === true,
      estimate: item.estimate
    };
    const conflict = normConflict(item.conflictServer);
    if (conflict) out.conflictServer = conflict;
    return out;
  }

  function cleanObject(obj, check) {
    try {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
      if (!validId(obj.id)) return null;
      if (obj.archived != null && typeof obj.archived !== 'boolean') return null;
      if (!Array.isArray(obj.estimates)) return null;
      for (const key of ['name', 'addr', 'client', 'phone', 'email', 'note']) {
        if (obj[key] != null && typeof obj[key] !== 'string') return null;
      }
      const estimates = [];
      let bad = 0;
      for (const item of obj.estimates) {
        if (validEstimateItem(item, check)) estimates.push(normEstimateItem(item));
        else bad++;
      }
      if (!estimates.length) return null;
      return {
        bad,
        obj: {
          id: obj.id,
          created: str(obj.created),
          updated: str(obj.updated),
          archived: obj.archived === true,
          rev: normRev(obj.rev),
          dirty: obj.dirty === true,
          syncConflict: obj.syncConflict === true,
          conflictServer: normConflict(obj.conflictServer) || undefined,
          name: str(obj.name),
          addr: str(obj.addr),
          client: str(obj.client),
          phone: str(obj.phone),
          email: str(obj.email),
          note: str(obj.note),
          estimates
        }
      };
    } catch (e) {
      return null;
    }
  }

  function assessLibrary(value, check) {
    try {
      if (value == null) return { state: 'empty' };
      if (typeof value !== 'object' || Array.isArray(value) || value.v !== 2 || !Array.isArray(value.objects)) return { state: 'invalid' };
      const objects = [];
      let bad = 0;
      for (const obj of value.objects) {
        const cleaned = cleanObject(obj, check);
        if (!cleaned) bad++;
        else {
          bad += cleaned.bad;
          objects.push(cleaned.obj);
        }
      }
      if (!objects.length) return { state: 'invalid' };
      const activeObjectId = typeof value.activeObjectId === 'string' ? value.activeObjectId : '';
      const activeEstimateId = typeof value.activeEstimateId === 'string' ? value.activeEstimateId : '';
      if (bad === 0) return { state: 'ok', objects, activeObjectId, activeEstimateId };
      return { state: 'partial', objects, bad, activeObjectId, activeEstimateId };
    } catch (e) {
      return { state: 'invalid' };
    }
  }

  function isLibrary(v) {
    return assessLibrary(v, validEstimate).state === 'ok';
  }

  function reserveDamaged(raw, slots) {
    const list = Array.isArray(slots) && slots.length ? slots : [{ key: null, raw: null }];
    for (const s of list) {
      if (s && s.raw === raw) return { already: true, key: s.key };
    }
    for (const s of list) {
      if (s && (s.raw == null || s.raw === '')) return { key: s.key, primary: !s.key };
    }
    return { blocked: true };
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function makeEstimate(estimate, id, ts) {
    return { id, created: ts, updated: ts, archived: false, rev: 0, dirty: false, syncConflict: false, estimate };
  }

  function makeObject(card, estimates, id, ts) {
    const c = card || {};
    return {
      id, created: ts, updated: ts, archived: false, rev: 0, dirty: false, syncConflict: false,
      name: str(c.name), addr: str(c.addr), client: str(c.client),
      phone: str(c.phone), email: str(c.email), note: str(c.note),
      estimates
    };
  }

  function findObject(lib, id) {
    return (lib && lib.objects || []).find(o => o.id === id) || null;
  }

  function findEstimate(obj, id) {
    return (obj && obj.estimates || []).find(e => e.id === id) || null;
  }

  function activePair(lib) {
    const obj = findObject(lib, lib && lib.activeObjectId);
    if (!obj) return null;
    const est = findEstimate(obj, lib.activeEstimateId);
    if (!est) return null;
    return { obj, est };
  }

  function ensureActive(lib) {
    const objects = lib.objects || [];
    let obj = findObject(lib, lib.activeObjectId);
    if (!obj || obj.archived) obj = objects.find(o => !o.archived) || null;
    let est = obj && findEstimate(obj, lib.activeEstimateId);
    if ((!est || est.archived) && obj) est = (obj.estimates || []).find(e => !e.archived) || null;
    lib.activeObjectId = obj ? obj.id : '';
    lib.activeEstimateId = est ? est.id : '';
    return lib;
  }

  function stamp(obj, estimate) {
    if (!estimate || typeof estimate !== 'object') return estimate;
    estimate.objectName = obj.name || '';
    estimate.addr = obj.addr || '';
    estimate.client = obj.client || '';
    if (!estimate.k || typeof estimate.k !== 'object' || Array.isArray(estimate.k)) estimate.k = {};
    estimate.k.phone = obj.phone || '';
    estimate.k.email = obj.email || '';
    return estimate;
  }

  function pullCard(obj, estimate) {
    if (!obj || !estimate) return obj;
    obj.name = str(estimate.objectName);
    obj.addr = str(estimate.addr);
    obj.client = str(estimate.client);
    const k = estimate.k;
    if (k && typeof k === 'object' && !Array.isArray(k)) {
      if (k.phone != null) obj.phone = String(k.phone);
      if (k.email != null) obj.email = String(k.email);
    }
    return obj;
  }

  function blankLib(blank, idFactory, ts) {
    const est = makeEstimate(clone(blank), idFactory(), ts);
    const obj = makeObject({}, [est], idFactory(), ts);
    return { v: 2, activeObjectId: obj.id, activeEstimateId: est.id, objects: [obj] };
  }

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

    const rawNonEmpty = opts.libRaw != null && opts.libRaw !== '';
    const parsedLib = safeParse(opts.libRaw);
    const assessment = !rawNonEmpty ? { state: 'empty' } : (parsedLib.ok ? assessLibrary(parsedLib.value, check) : { state: 'invalid' });
    const usable = assessment.state === 'ok';
    let heldRaw = null;
    let blocked = false;
    if (rawNonEmpty && !usable) {
      heldRaw = opts.libRaw;
      const reserved = reserveDamaged(opts.libRaw, opts.damagedSlots);
      if (reserved.blocked) {
        blocked = true;
        warnings.push('Повреждённый список некуда скопировать: прежние копии заняты другими данными и не перезаписаны. Исходная запись оставлена без изменений. Скачайте её. Новые правки не записываются поверх неё.');
      } else if (!reserved.already) {
        const entry = { slot: 'libDamaged', value: opts.libRaw };
        if (reserved.key) entry.key = reserved.key;
        writes.push(entry);
        warnings.push(assessment.state === 'partial'
          ? 'В списке были неподходящие объекты или сметы. Полная запись сохранена отдельно, в работу взяты только целые.'
          : 'Запись списка не подошла или повреждена. Полная копия сохранена отдельно, исходные байты не затёрты без неё. Открыт новый пустой объект.');
      } else {
        warnings.push('Такая повреждённая запись уже сохранена отдельной копией и не перезаписывалась.');
      }
    }

    let lib = null;
    if (usable || (!blocked && assessment.state === 'partial' && assessment.objects && assessment.objects.length)) {
      lib = {
        v: 2,
        activeObjectId: assessment.activeObjectId || '',
        activeEstimateId: assessment.activeEstimateId || '',
        objects: assessment.objects.map(clone)
      };
      const prevO = lib.activeObjectId;
      const prevE = lib.activeEstimateId;
      ensureActive(lib);
      if (usable && (lib.activeObjectId !== prevO || lib.activeEstimateId !== prevE)) writes.push({ slot: 'library', value: lib });
    }
    if (!lib) {
      lib = blankLib(blank, idFactory, now());
      const leg = safeParse(opts.legacyRaw);
      if (leg.corrupt) {
        warnings.push('Прежняя смета повреждена и не затёрта. Открыт новый пустой объект.');
        writes.push({ slot: 'legacyDamaged', value: opts.legacyRaw });
      }
    }
    if (!usable && !blocked) writes.push({ slot: 'library', value: lib });
    if (blocked) return { lib: blankLib(blank, idFactory, now()), writes, warnings, blocked: true, heldRaw };
    return { lib, writes, warnings, blocked: false, heldRaw };
  }

  function applyWrites(storage, slots, writes) {
    const done = [];
    for (const w of writes) {
      const key = w.key || slots[w.slot];
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

  function capture(lib, estimate, nowTs) {
    const pair = activePair(lib);
    if (!pair) return lib;
    const prevEst = JSON.stringify(pair.est.estimate);
    const prevCard = JSON.stringify([pair.obj.name, pair.obj.addr, pair.obj.client, pair.obj.phone, pair.obj.email, pair.obj.note]);
    pair.est.estimate = estimate;
    pullCard(pair.obj, estimate);
    const nextCard = JSON.stringify([pair.obj.name, pair.obj.addr, pair.obj.client, pair.obj.phone, pair.obj.email, pair.obj.note]);
    if (prevEst === JSON.stringify(estimate) && prevCard === nextCard) return lib;
    const ts = nowTs || new Date().toISOString();
    pair.est.updated = ts;
    pair.est.dirty = true;
    pair.obj.dirty = true;
    pair.obj.updated = ts;
    return lib;
  }

  function activateEstimate(lib, objectId, estimateId) {
    const obj = findObject(lib, objectId);
    const est = obj && findEstimate(obj, estimateId);
    if (!est) return null;
    est.estimate = clone(est.estimate);
    stamp(obj, est.estimate);
    lib.activeObjectId = objectId;
    lib.activeEstimateId = estimateId;
    return est.estimate;
  }

  function addObject(lib, card, estimate, idFactory, nowFn) {
    const factory = idFactory || (() => 'obj_' + Math.random().toString(36).slice(2, 10));
    const ts = (nowFn || (() => new Date().toISOString()))();
    const est = makeEstimate(clone(estimate), factory(), ts);
    est.dirty = true;
    const obj = makeObject(card, [est], factory(), ts);
    obj.dirty = true;
    stamp(obj, est.estimate);
    lib.objects.push(obj);
    lib.activeObjectId = obj.id;
    lib.activeEstimateId = est.id;
    return obj;
  }

  function addEstimate(lib, objectId, estimate, idFactory, nowFn) {
    const obj = findObject(lib, objectId) || (lib.objects || []).find(o => !o.archived) || (lib.objects || [])[0];
    if (!obj) return null;
    const factory = idFactory || (() => 'obj_' + Math.random().toString(36).slice(2, 10));
    const ts = (nowFn || (() => new Date().toISOString()))();
    const est = makeEstimate(clone(estimate), factory(), ts);
    est.dirty = true;
    est.estimate.num = String((obj.estimates || []).length + 1);
    stamp(obj, est.estimate);
    obj.estimates.push(est);
    obj.dirty = true;
    obj.updated = ts;
    lib.activeObjectId = obj.id;
    lib.activeEstimateId = est.id;
    return est;
  }

  function duplicateObject(lib, id, idFactory, nowFn) {
    const src = findObject(lib, id);
    if (!src) return null;
    const factory = idFactory || (() => 'obj_' + Math.random().toString(36).slice(2, 10));
    const ts = (nowFn || (() => new Date().toISOString()))();
    const copy = clone(src);
    copy.id = factory();
    copy.created = ts;
    copy.updated = ts;
    copy.archived = false;
    copy.rev = 0;
    copy.dirty = true;
    copy.syncConflict = false;
    copy.name = (copy.name || copy.addr || 'Объект') + ' (копия)';
    copy.estimates = (copy.estimates || []).map(e => {
      e.id = factory();
      e.created = ts;
      e.updated = ts;
      e.archived = false;
      e.rev = 0;
      e.dirty = true;
      e.syncConflict = false;
      if (e.estimate) e.estimate.objectName = copy.name;
      return e;
    });
    lib.objects.push(copy);
    return copy;
  }

  function duplicateEstimate(lib, objectId, estimateId, idFactory, nowFn) {
    const obj = findObject(lib, objectId);
    const src = obj && findEstimate(obj, estimateId);
    if (!src) return null;
    const factory = idFactory || (() => 'obj_' + Math.random().toString(36).slice(2, 10));
    const ts = (nowFn || (() => new Date().toISOString()))();
    const copy = clone(src);
    copy.id = factory();
    copy.created = ts;
    copy.updated = ts;
    copy.archived = false;
    copy.rev = 0;
    copy.dirty = true;
    copy.syncConflict = false;
    if (copy.estimate) copy.estimate.num = String(copy.estimate.num || '1') + '-копия';
    obj.estimates.push(copy);
    obj.dirty = true;
    obj.updated = ts;
    return copy;
  }

  function archiveObject(lib, id, blank, idFactory, nowFn) {
    const obj = findObject(lib, id);
    if (!obj) return null;
    const ts = (nowFn || (() => new Date().toISOString()))();
    obj.archived = true;
    obj.dirty = true;
    obj.updated = ts;
    if (lib.activeObjectId !== id) return null;
    const next = (lib.objects || []).find(o => !o.archived);
    if (!next) {
      lib.activeObjectId = '';
      lib.activeEstimateId = '';
      return null;
    }
    const est = (next.estimates || []).find(e => !e.archived);
    if (!est) {
      lib.activeObjectId = next.id;
      lib.activeEstimateId = '';
      return null;
    }
    return activateEstimate(lib, next.id, est.id);
  }

  function restoreObject(lib, id, nowFn) {
    const obj = findObject(lib, id);
    if (!obj) return null;
    obj.archived = false;
    obj.dirty = true;
    obj.updated = (nowFn || (() => new Date().toISOString()))();
    return obj;
  }

  function archiveEstimate(lib, objectId, estimateId, blank, idFactory, nowFn) {
    const obj = findObject(lib, objectId);
    const est = obj && findEstimate(obj, estimateId);
    if (!est) return null;
    const ts = (nowFn || (() => new Date().toISOString()))();
    est.archived = true;
    est.dirty = true;
    est.updated = ts;
    obj.dirty = true;
    obj.updated = ts;
    if (lib.activeObjectId !== objectId || lib.activeEstimateId !== estimateId) return null;
    const next = (obj.estimates || []).find(e => !e.archived);
    if (!next) {
      lib.activeEstimateId = '';
      return null;
    }
    return activateEstimate(lib, objectId, next.id);
  }

  function restoreEstimate(lib, objectId, estimateId, nowFn) {
    const obj = findObject(lib, objectId);
    const est = obj && findEstimate(obj, estimateId);
    if (!est) return null;
    est.archived = false;
    est.dirty = true;
    est.updated = (nowFn || (() => new Date().toISOString()))();
    obj.dirty = true;
    obj.updated = est.updated;
    return est;
  }

  function patchObject(lib, id, patch, nowFn) {
    const obj = findObject(lib, id);
    if (!obj || !patch) return null;
    ['name', 'addr', 'client', 'phone', 'email', 'note'].forEach(key => {
      if (Object.prototype.hasOwnProperty.call(patch, key)) obj[key] = String(patch[key] ?? '');
    });
    obj.dirty = true;
    obj.updated = (nowFn || (() => new Date().toISOString()))();
    (obj.estimates || []).forEach(est => {
      stamp(obj, est.estimate);
      est.dirty = true;
      est.updated = obj.updated;
    });
    return obj;
  }

  function validObject(obj, check) {
    const cleaned = cleanObject(obj, check || validEstimate);
    return !!(cleaned && cleaned.bad === 0 && cleaned.obj);
  }

  function classifyImport(data, check) {
    const valid = check || validEstimate;
    if (data && data.kind === 'smeta-backup' && data.v === 2 && Array.isArray(data.objects)) {
      if (!data.objects.length || !data.objects.every(o => validObject(o, valid))) return { type: 'bad', objects: [], items: [] };
      return { type: 'backup', objects: data.objects, items: [] };
    }
    if (data && data.kind === 'smeta-library' && Array.isArray(data.items)) {
      if (!data.items.length || !data.items.every(i => i && valid(i.estimate))) return { type: 'bad', objects: [], items: [] };
      return { type: 'legacy-file', objects: [], items: data.items };
    }
    if (valid(data)) return { type: 'estimate', objects: [data], items: [] };
    return { type: 'bad', objects: [], items: [] };
  }

  function applyImport(lib, data, mode, check, idFactory, nowFn) {
    const found = classifyImport(data, check);
    if (found.type === 'bad') return { ok: false, message: 'Файл не подходит' };
    const factory = idFactory || (() => 'obj_' + Math.random().toString(36).slice(2, 10));
    const stampFn = nowFn || (() => new Date().toISOString());
    const ts = stampFn();
    let incoming = [];
    if (found.type === 'backup') {
      incoming = found.objects.map(obj => {
        const copy = clone(obj);
        copy.id = factory();
        copy.created = ts;
        copy.updated = ts;
        copy.rev = 0;
        copy.dirty = true;
        copy.syncConflict = false;
        copy.estimates = (copy.estimates || []).map(e => {
          e.id = factory();
          e.created = ts;
          e.updated = ts;
          e.rev = 0;
          e.dirty = true;
          e.syncConflict = false;
          return e;
        });
        return copy;
      });
    } else if (found.type === 'legacy-file') {
      incoming = found.items.map(item => {
        const est = clone(item.estimate);
        const obj = makeObject({
          name: str(est.objectName),
          addr: str(est.addr),
          client: str(est.client),
          phone: est.k && est.k.phone ? String(est.k.phone) : '',
          email: est.k && est.k.email ? String(est.k.email) : ''
        }, [makeEstimate(est, factory(), ts)], factory(), ts);
        obj.archived = item.archived === true;
        return obj;
      });
    } else {
      const est = clone(found.objects[0]);
      incoming = [makeObject({
        name: str(est.objectName), addr: str(est.addr), client: str(est.client),
        phone: est.k && est.k.phone ? String(est.k.phone) : '',
        email: est.k && est.k.email ? String(est.k.email) : ''
      }, [makeEstimate(est, factory(), ts)], factory(), ts)];
    }
    if (!incoming.length) return { ok: false, message: 'В файле нет смет' };
    if (mode === 'replace') {
      lib.objects = incoming;
      lib.activeObjectId = '';
      lib.activeEstimateId = '';
      ensureActive(lib);
      const pair = activePair(lib);
      const estimate = pair ? activateEstimate(lib, pair.obj.id, pair.est.id) : null;
      return { ok: true, estimate, added: incoming.length, replaced: true };
    }
    incoming.forEach(obj => lib.objects.push(obj));
    return { ok: true, added: incoming.length, replaced: false };
  }

  function bundle(lib) {
    return { kind: 'smeta-backup', v: 2, objects: clone(lib.objects || []) };
  }

  function workList(objects) {
    return (objects || []).filter(obj => !obj.archived).map(obj => ({
      id: obj.id,
      estimates: (obj.estimates || []).filter(est => !est.archived).map(est => est.id)
    }));
  }

  function archiveList(objects) {
    const rows = [];
    (objects || []).forEach(obj => {
      if (obj.archived) rows.push({ type: 'object', id: obj.id });
      else (obj.estimates || []).forEach(est => { if (est.archived) rows.push({ type: 'estimate', objectId: obj.id, id: est.id }); });
    });
    return rows;
  }

  function queryObjects(objects, q) {
    const s = String(q || '').trim().toLowerCase().replace(/ё/g, 'е');
    if (!s) return (objects || []).slice();
    return (objects || []).filter(obj => {
      const extra = (obj.estimates || []).map(e => {
        const est = e.estimate || {};
        return [est.num, est.date, est.objectName, est.client].join(' ');
      });
      const blob = [obj.name, obj.addr, obj.client, obj.phone, obj.email, obj.note].concat(extra).join(' ').toLowerCase().replace(/ё/g, 'е');
      return blob.includes(s);
    });
  }

  return {
    safeParse, validEstimate, validId, validEstimateItem, validObject, assessLibrary, isLibrary, reserveDamaged,
    makeEstimate, makeObject, planLoad, applyWrites, findObject, findEstimate, activePair, ensureActive,
    stamp, pullCard, capture, activateEstimate, addObject, addEstimate, duplicateObject, duplicateEstimate,
    archiveObject, restoreObject, archiveEstimate, restoreEstimate, patchObject, classifyImport, applyImport,
    bundle, queryObjects, workList, archiveList, clone
  };
});
