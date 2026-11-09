/* Сверка локальной копии со снимком сервера. Сеть здесь не вызывается. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SmetaSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function objectsOf(lib) { return (lib && lib.objects) || []; }

  function findObject(lib, id) { return objectsOf(lib).find(o => o.id === id) || null; }

  function findEstimate(obj, id) { return ((obj && obj.estimates) || []).find(e => e.id === id) || null; }

  function hasConflict(lib) {
    return objectsOf(lib).some(o => o.syncConflict || (o.estimates || []).some(e => e.syncConflict));
  }

  function hasPending(lib) {
    return objectsOf(lib).some(o => (o.dirty && !o.syncConflict) || (o.estimates || []).some(e => e.dirty && !e.syncConflict));
  }

  function isPlaceholder(lib) {
    const list = objectsOf(lib);
    if (list.length !== 1) return false;
    const obj = list[0];
    if (obj.dirty || obj.rev || obj.syncConflict || obj.archived) return false;
    if (obj.name || obj.addr || obj.client || obj.phone || obj.email || obj.note) return false;
    if (!obj.estimates || obj.estimates.length !== 1) return false;
    const est = obj.estimates[0];
    if (est.dirty || est.rev || est.syncConflict || est.archived) return false;
    const body = est.estimate || {};
    if ((body.rooms || []).length) return false;
    if (body.objectName || body.addr || body.client || body.price) return false;
    return true;
  }

  function cardOf(server) {
    return {
      id: server.id,
      rev: server.rev,
      archived: !!server.archived,
      name: server.name || '',
      addr: server.addr || '',
      client: server.client || '',
      phone: server.phone || '',
      email: server.email || '',
      note: server.note || '',
      updatedAt: server.updatedAt || ''
    };
  }

  function plan(local, snapshot) {
    const serverObjects = new Map(((snapshot && snapshot.objects) || []).map(o => [o.id, o]));
    if (isPlaceholder(local) && serverObjects.size) return [{ op: 'replace-all', snapshot }];
    const actions = [];
    const seen = new Set();
    for (const obj of objectsOf(local)) {
      seen.add(obj.id);
      const srv = serverObjects.get(obj.id);
      if (!srv) {
        if (obj.dirty || obj.rev > 0) actions.push({ op: 'put-object', id: obj.id });
      } else if (obj.syncConflict) {
        /* ждём решение человека */
      } else if (obj.dirty && srv.rev !== obj.rev) {
        actions.push({ op: 'conflict-object', id: obj.id, server: cardOf(srv) });
      } else if (!obj.dirty && srv.rev !== obj.rev) {
        actions.push({ op: 'pull-object', id: obj.id, server: cardOf(srv) });
      } else if (obj.dirty) {
        actions.push({ op: 'put-object', id: obj.id });
      }
      const srvEst = new Map(((srv && srv.estimates) || []).map(e => [e.id, e]));
      const seenEst = new Set();
      for (const est of obj.estimates || []) {
        seenEst.add(est.id);
        const remote = srv ? srvEst.get(est.id) : null;
        if (!remote) {
          if (est.dirty || est.rev > 0) actions.push({ op: 'put-estimate', objectId: obj.id, id: est.id });
        } else if (est.syncConflict) {
          /* ждём решение */
        } else if (est.dirty && remote.rev !== est.rev) {
          actions.push({ op: 'conflict-estimate', objectId: obj.id, id: est.id, server: remote });
        } else if (!est.dirty && remote.rev !== est.rev) {
          actions.push({ op: 'pull-estimate', objectId: obj.id, id: est.id, server: remote });
        } else if (est.dirty) {
          actions.push({ op: 'put-estimate', objectId: obj.id, id: est.id });
        }
      }
      if (srv) {
        for (const remote of srv.estimates || []) {
          if (!seenEst.has(remote.id)) actions.push({ op: 'insert-estimate', objectId: obj.id, server: remote });
        }
      }
    }
    for (const srv of serverObjects.values()) {
      if (!seen.has(srv.id)) actions.push({ op: 'insert-object', server: srv });
    }
    return actions;
  }

  function materializeObject(server) {
    const estimates = (server.estimates || []).map(materializeEstimate);
    return {
      id: server.id,
      created: server.updatedAt || '',
      updated: server.updatedAt || '',
      archived: !!server.archived,
      rev: server.rev,
      dirty: false,
      syncConflict: false,
      name: server.name || '',
      addr: server.addr || '',
      client: server.client || '',
      phone: server.phone || '',
      email: server.email || '',
      note: server.note || '',
      estimates
    };
  }

  function materializeEstimate(server) {
    return {
      id: server.id,
      created: server.updatedAt || '',
      updated: server.updatedAt || '',
      archived: !!server.archived,
      rev: server.rev,
      dirty: false,
      syncConflict: false,
      estimate: clone(server.body || {})
    };
  }

  function applyCard(obj, card) {
    obj.rev = card.rev;
    obj.archived = !!card.archived;
    obj.name = card.name || '';
    obj.addr = card.addr || '';
    obj.client = card.client || '';
    obj.phone = card.phone || '';
    obj.email = card.email || '';
    obj.note = card.note || '';
    obj.updated = card.updatedAt || obj.updated;
    obj.dirty = false;
    obj.syncConflict = false;
    delete obj.conflictServer;
  }

  function applyActions(lib, actions) {
    for (const action of actions || []) {
      if (action.op === 'replace-all') {
        lib.objects = (action.snapshot.objects || []).map(materializeObject);
        lib.v = 2;
        if (!lib.objects.some(o => o.id === lib.activeObjectId)) {
          const first = lib.objects.find(o => !o.archived) || lib.objects[0];
          lib.activeObjectId = first ? first.id : '';
          const est = first && ((first.estimates || []).find(e => !e.archived) || first.estimates[0]);
          lib.activeEstimateId = est ? est.id : '';
        }
      } else if (action.op === 'pull-object') {
        const obj = findObject(lib, action.id);
        if (obj && !obj.dirty && !obj.syncConflict) applyCard(obj, action.server);
      } else if (action.op === 'conflict-object') {
        const obj = findObject(lib, action.id);
        if (!obj) continue;
        obj.syncConflict = true;
        obj.conflictServer = clone(action.server);
      } else if (action.op === 'insert-object') {
        if (!findObject(lib, action.server.id)) lib.objects.push(materializeObject(action.server));
      } else if (action.op === 'pull-estimate') {
        const obj = findObject(lib, action.objectId);
        const est = obj && findEstimate(obj, action.id);
        if (est && !est.dirty && !est.syncConflict) {
          est.rev = action.server.rev;
          est.archived = !!action.server.archived;
          est.estimate = clone(action.server.body || {});
          est.dirty = false;
          est.syncConflict = false;
          delete est.conflictServer;
          est.updated = action.server.updatedAt || est.updated;
        }
      } else if (action.op === 'conflict-estimate') {
        const obj = findObject(lib, action.objectId);
        const est = obj && findEstimate(obj, action.id);
        if (!est) continue;
        est.syncConflict = true;
        est.conflictServer = clone(action.server);
      } else if (action.op === 'insert-estimate') {
        const obj = findObject(lib, action.objectId);
        if (obj && !findEstimate(obj, action.server.id)) obj.estimates.push(materializeEstimate(action.server));
      }
    }
    return lib;
  }

  function ackObject(lib, server) {
    const obj = findObject(lib, server.id);
    if (!obj) return null;
    obj.rev = server.rev;
    obj.dirty = false;
    obj.syncConflict = false;
    delete obj.conflictServer;
    obj.updated = server.updatedAt || obj.updated;
    return obj;
  }

  function ackEstimate(lib, server) {
    for (const obj of objectsOf(lib)) {
      const est = findEstimate(obj, server.id);
      if (!est) continue;
      est.rev = server.rev;
      est.dirty = false;
      est.syncConflict = false;
      delete est.conflictServer;
      est.updated = server.updatedAt || est.updated;
      return est;
    }
    return null;
  }

  function markConflict(lib, kind, id, server) {
    if (kind === 'object') {
      const obj = findObject(lib, id);
      if (!obj) return null;
      obj.syncConflict = true;
      obj.conflictServer = server ? cardOf(server) : { id, rev: obj.rev, missing: true, name: obj.name || '' };
      return obj;
    }
    for (const obj of objectsOf(lib)) {
      const est = findEstimate(obj, id);
      if (!est) continue;
      est.syncConflict = true;
      est.conflictServer = server ? clone(server) : { id, rev: est.rev, missing: true, body: est.estimate };
      return est;
    }
    return null;
  }

  function forkObject(lib, id, idFactory, nowFn) {
    const obj = findObject(lib, id);
    if (!obj) return null;
    const ts = (nowFn || (() => new Date().toISOString()))();
    const wasActive = lib.activeObjectId === id;
    const activeEstimateId = lib.activeEstimateId;
    obj.id = idFactory();
    obj.rev = 0;
    obj.dirty = true;
    obj.syncConflict = false;
    delete obj.conflictServer;
    obj.updated = ts;
    obj.name = (obj.name || 'Объект') + ' (моя копия)';
    let nextEstimateId = '';
    (obj.estimates || []).forEach(est => {
      const was = est.id === activeEstimateId;
      est.id = idFactory();
      if (was) nextEstimateId = est.id;
      est.rev = 0;
      est.dirty = true;
      est.syncConflict = false;
      delete est.conflictServer;
      est.updated = ts;
      if (est.estimate) est.estimate.objectName = obj.name;
    });
    if (wasActive) {
      lib.activeObjectId = obj.id;
      if (nextEstimateId) lib.activeEstimateId = nextEstimateId;
    }
    return obj;
  }

  function takeServerObject(lib, id) {
    const obj = findObject(lib, id);
    const server = obj && obj.conflictServer;
    if (!server) return null;
    applyCard(obj, server);
    return obj;
  }

  function forkEstimate(lib, objectId, estimateId, idFactory, nowFn) {
    const obj = findObject(lib, objectId);
    const est = obj && findEstimate(obj, estimateId);
    if (!est) return null;
    const ts = (nowFn || (() => new Date().toISOString()))();
    const wasActive = lib.activeObjectId === objectId && lib.activeEstimateId === estimateId;
    est.id = idFactory();
    est.rev = 0;
    est.dirty = true;
    est.syncConflict = false;
    delete est.conflictServer;
    est.updated = ts;
    if (est.estimate) est.estimate.num = String(est.estimate.num || '1') + '-моя';
    obj.dirty = true;
    obj.updated = ts;
    if (wasActive) lib.activeEstimateId = est.id;
    return est;
  }

  function takeServerEstimate(lib, objectId, estimateId) {
    const obj = findObject(lib, objectId);
    const est = obj && findEstimate(obj, estimateId);
    const server = est && est.conflictServer;
    if (!server) return null;
    est.rev = server.rev;
    est.archived = !!server.archived;
    est.estimate = clone(server.body || {});
    est.dirty = false;
    est.syncConflict = false;
    delete est.conflictServer;
    est.updated = server.updatedAt || est.updated;
    return est;
  }

  function statusOf(lib, opts) {
    const o = opts || {};
    if (hasConflict(lib)) return { level: 'conflict', detail: 'Конфликт: на сервере другая версия. Местная копия не затёрта.' };
    if (!o.serverConfigured) return { level: 'device', detail: '' };
    if (!o.loggedIn) return { level: 'device', detail: 'Вход на сервер не выполнен, отправка не начата.' };
    if (o.transportError) return { level: 'pending', detail: o.transportError };
    if (hasPending(lib)) return { level: 'pending', detail: '' };
    return { level: 'server', detail: '' };
  }

  function pushBodyObject(obj) {
    return {
      rev: obj.rev || 0,
      archived: !!obj.archived,
      name: obj.name || '',
      addr: obj.addr || '',
      client: obj.client || '',
      phone: obj.phone || '',
      email: obj.email || '',
      note: obj.note || ''
    };
  }

  function pushBodyEstimate(est, objectId) {
    return { rev: est.rev || 0, objectId, archived: !!est.archived, body: est.estimate };
  }

  return {
    clone, hasConflict, hasPending, isPlaceholder, plan, applyActions,
    ackObject, ackEstimate, markConflict, forkObject, takeServerObject,
    forkEstimate, takeServerEstimate, statusOf, pushBodyObject, pushBodyEstimate, cardOf
  };
});
