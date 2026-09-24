'use strict';

(function expose(factory) {
  const runtime = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = runtime;
  if (typeof window !== 'undefined') window.XR_A2UI = runtime;
})(() => {
  const VERSION = 'v0.9.1';
  const BASIC_CATALOG = 'https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json';
  const XR_CATALOG = 'https://xr-shell.local/catalogs/spatial/v0_9_1';
  const COMPONENTS = new Set(['Card', 'Column', 'Row', 'Text', 'Button', 'Divider', 'Icon', 'TextField']);
  const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/;

  function createStore() {
    return { surfaces: new Map() };
  }

  function requireId(value, label) {
    if (!ID_PATTERN.test(String(value || ''))) throw new Error(`Invalid A2UI ${label}`);
    return String(value);
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function setPointer(root, pointer, value, remove = false) {
    if (!pointer || pointer === '/') return remove ? {} : clone(value);
    if (!pointer.startsWith('/')) throw new Error('A2UI data path must be a JSON Pointer');
    const parts = pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
    const output = root && typeof root === 'object' ? clone(root) : {};
    let target = output;
    for (let index = 0; index < parts.length - 1; index++) {
      const part = parts[index];
      if (['__proto__', 'prototype', 'constructor'].includes(part)) throw new Error('Unsafe A2UI data path');
      if (!target[part] || typeof target[part] !== 'object') target[part] = {};
      target = target[part];
    }
    const key = parts.at(-1);
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe A2UI data path');
    if (remove) delete target[key]; else target[key] = clone(value);
    return output;
  }

  function valueAt(root, pointer) {
    if (!pointer || pointer === '/') return root;
    if (typeof pointer !== 'string' || !pointer.startsWith('/')) return undefined;
    return pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
      .reduce((value, key) => value == null ? undefined : value[key], root);
  }

  function resolveValue(value, model) {
    if (value && typeof value === 'object' && typeof value.path === 'string') return valueAt(model, value.path);
    return value;
  }

  function applyMessages(store, rawMessages, options = {}) {
    const messages = Array.isArray(rawMessages) ? rawMessages : [rawMessages];
    if (!messages.length || messages.length > 64) throw new Error('A2UI update must contain 1–64 messages');
    if (JSON.stringify(messages).length > 256000) throw new Error('A2UI update exceeds 256 KB');
    const changed = new Set();
    const deleted = new Set();
    for (const message of messages) {
      if (!message || message.version !== VERSION) throw new Error(`XR Shell supports A2UI ${VERSION}`);
      const envelopes = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'].filter((key) => message[key]);
      if (envelopes.length !== 1) throw new Error('A2UI message must contain exactly one envelope');
      const type = envelopes[0];
      const payload = message[type];
      const surfaceId = requireId(payload.surfaceId, 'surfaceId');
      if (type === 'createSurface') {
        if (store.surfaces.has(surfaceId)) throw new Error(`A2UI surface already exists: ${surfaceId}`);
        if (![BASIC_CATALOG, XR_CATALOG].includes(payload.catalogId)) throw new Error('Unsupported A2UI catalog');
        store.surfaces.set(surfaceId, {
          surfaceId,
          catalogId: payload.catalogId,
          theme: clone(payload.theme || {}),
          sendDataModel: Boolean(payload.sendDataModel),
          components: new Map(),
          data: {},
          placement: clone(options.placement || {}),
          createdAt: Date.now()
        });
        changed.add(surfaceId);
        continue;
      }
      if (type === 'deleteSurface') {
        store.surfaces.delete(surfaceId);
        deleted.add(surfaceId);
        changed.delete(surfaceId);
        continue;
      }
      const surface = store.surfaces.get(surfaceId);
      if (!surface) throw new Error(`Unknown A2UI surface: ${surfaceId}`);
      if (type === 'updateComponents') {
        if (!Array.isArray(payload.components) || payload.components.length > 200) throw new Error('A2UI components must be an array of at most 200 items');
        for (const raw of payload.components) {
          const component = clone(raw);
          component.id = requireId(component.id, 'component id');
          if (!COMPONENTS.has(component.component)) throw new Error(`Unsupported A2UI component: ${component.component}`);
          surface.components.set(component.id, component);
        }
      } else {
        surface.data = setPointer(surface.data, payload.path || '/', payload.value, !Object.hasOwn(payload, 'value'));
      }
      changed.add(surfaceId);
    }
    for (const surfaceId of changed) {
      const surface = store.surfaces.get(surfaceId);
      if (surface.components.size && !surface.components.has('root')) throw new Error(`A2UI surface ${surfaceId} has no root component`);
    }
    return { changed: [...changed], deleted: [...deleted] };
  }

  function summarize(store) {
    return [...store.surfaces.values()].map((surface) => ({
      surfaceId: surface.surfaceId,
      catalogId: surface.catalogId,
      componentCount: surface.components.size,
      placement: clone(surface.placement)
    }));
  }

  return { VERSION, BASIC_CATALOG, XR_CATALOG, COMPONENTS: [...COMPONENTS], createStore, applyMessages, resolveValue, setPointer, summarize };
});
