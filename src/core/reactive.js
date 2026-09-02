/**
 * Afterglow 2.0 - Core Reactive Engine (src/core/reactive.js)
 * Fine-grained reactive signals, stores, and targeted DOM bindings.
 * Zero-dependency, lightweight, high-performance.
 */

(function (factory) {
  'use strict';
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exports = factory();
    if (typeof globalThis !== 'undefined') {
      globalThis.ReactiveCore = exports;
      globalThis.AfterglowReactive = exports;
      if (globalThis.window) {
        globalThis.window.ReactiveCore = exports;
        globalThis.window.AfterglowReactive = exports;
      }
    }
    if (typeof window !== 'undefined') {
      window.ReactiveCore = exports;
      window.AfterglowReactive = exports;
    }
  }
})(function () {
  'use strict';

  let activeEffect = null;
  let isBatching = false;
  const pendingEffects = new Set();

  /**
   * Run a function while batching reactive updates (synchronous execution only).
   * All effects triggered during fn() will execute once after fn() completes.
   */
  function batch(fn) {
    if (isBatching) return fn();
    isBatching = true;
    try {
      return fn();
    } finally {
      isBatching = false;
      const effects = Array.from(pendingEffects);
      pendingEffects.clear();
      for (const eff of effects) {
        eff.run();
      }
    }
  }

  /**
   * Creates a reactive signal.
   * @param {*} initialValue
   * @returns {[getter: function, setter: function]}
   */
  function createSignal(initialValue) {
    let value = initialValue;
    const subscribers = new Set();

    function get() {
      if (activeEffect) {
        subscribers.add(activeEffect);
        activeEffect.dependencies.add(subscribers);
      }
      return value;
    }

    function set(nextValue) {
      const resolved = typeof nextValue === 'function' ? nextValue(value) : nextValue;
      if (Object.is(value, resolved)) return;
      value = resolved;
      notify();
    }

    function notify() {
      const subs = Array.from(subscribers);
      for (const sub of subs) {
        if (isBatching) {
          pendingEffects.add(sub);
        } else {
          sub.run();
        }
      }
    }

    // Convenience properties
    get.get = get;
    get.set = set;
    Object.defineProperty(get, 'value', {
      get() { return get(); },
      set(v) { set(v); }
    });

    return [get, set];
  }

  /**
   * Runs an effect function reactively whenever its signal dependencies change.
   * @param {function} fn
   * @returns {function} cleanup / dispose function
   */
  function createEffect(fn) {
    let cleanup = null;

    const effectRecord = {
      dependencies: new Set(),
      run() {
        // Clean up previous dependencies
        this.cleanup();

        const prevEffect = activeEffect;
        activeEffect = this;
        try {
          cleanup = fn();
        } finally {
          activeEffect = prevEffect;
        }
      },
      cleanup() {
        if (typeof cleanup === 'function') {
          try { cleanup(); } catch (e) { console.error('Effect cleanup error:', e); }
          cleanup = null;
        }
        for (const dep of this.dependencies) {
          dep.delete(this);
        }
        this.dependencies.clear();
      }
    };

    // Run synchronously on initial registration
    effectRecord.run();

    return function dispose() {
      effectRecord.cleanup();
      pendingEffects.delete(effectRecord);
    };
  }

  /**
   * Creates a derived computed signal.
   * Memoizes its value and only recalculates when dependency signals change.
   * @param {function} fn
   * @returns {function} getter function
   */
  function createComputed(fn) {
    let value;
    let dirty = true;
    const subscribers = new Set();

    const effectRecord = {
      dependencies: new Set(),
      run() {
        if (!dirty) {
          dirty = true;
          const subs = Array.from(subscribers);
          for (const sub of subs) {
            if (isBatching) {
              pendingEffects.add(sub);
            } else {
              sub.run();
            }
          }
        }
      },
      cleanup() {
        for (const dep of this.dependencies) {
          dep.delete(this);
        }
        this.dependencies.clear();
      }
    };

    function get() {
      if (dirty) {
        effectRecord.cleanup();
        const prevEffect = activeEffect;
        activeEffect = effectRecord;
        try {
          value = fn();
          dirty = false;
        } finally {
          activeEffect = prevEffect;
        }
      }

      if (activeEffect) {
        subscribers.add(activeEffect);
        activeEffect.dependencies.add(subscribers);
      }

      return value;
    }

    get.get = get;
    Object.defineProperty(get, 'value', {
      get() { return get(); }
    });

    return get;
  }

  /**
   * Creates an observable reactive proxy store.
   * @param {object} target
   * @returns {Proxy}
   */
  function createStore(target = {}) {
    const propertySignals = new Map();

    function getPropSignal(prop) {
      let s = propertySignals.get(prop);
      if (!s) {
        s = createSignal(target[prop]);
        propertySignals.set(prop, s);
      }
      return s;
    }

    const proxy = new Proxy(target, {
      get(obj, prop, receiver) {
        if (prop === '__isStore') return true;
        if (prop === '__target') return obj;
        if (typeof prop === 'symbol' || prop in Object.prototype) {
          return Reflect.get(obj, prop, receiver);
        }
        const val = obj[prop];
        if (val !== null && typeof val === 'object' && !val.__isStore) {
          // Wrap nested object in store and synchronize property signal
          const wrapped = createStore(val);
          obj[prop] = wrapped;
          const s = getPropSignal(prop);
          s[1](wrapped);
          s[0](); // track dependency
          return wrapped;
        }
        const s = getPropSignal(prop);
        s[0](); // track dependency
        return val;
      },
      set(obj, prop, value, receiver) {
        const old = obj[prop];
        if (Object.is(old, value)) return true;
        obj[prop] = value;
        const s = getPropSignal(prop);
        s[1](value); // notify subscribers
        return true;
      },
      deleteProperty(obj, prop) {
        if (prop in obj) {
          delete obj[prop];
          const s = getPropSignal(prop);
          s[1](undefined);
        }
        return true;
      }
    });

    return proxy;
  }

  // ── DOM Binding Utilities ──────────────────────────────────────────────────

  /**
   * Binds textContent of an element to a getter.
   * Updates element.textContent in-place only when the value changes.
   */
  function bindText(node, getter) {
    if (!node) return () => {};
    let lastVal = undefined;
    return createEffect(() => {
      const val = getter();
      const str = val === null || val === undefined ? '' : String(val);
      if (lastVal !== str) {
        lastVal = str;
        if (node.textContent !== str) {
          node.textContent = str;
        }
      }
    });
  }

  /**
   * Binds an attribute or property of an element to a getter.
   */
  function bindAttr(node, attr, getter) {
    if (!node) return () => {};
    let lastVal = undefined;
    return createEffect(() => {
      const val = getter();
      if (lastVal !== val) {
        lastVal = val;
        if (attr === 'disabled') {
          node.disabled = Boolean(val);
          if (val) node.setAttribute('disabled', '');
          else node.removeAttribute('disabled');
        } else if (attr === 'checked') {
          node.checked = Boolean(val);
        } else if (attr === 'value') {
          if (node.value !== String(val || '')) {
            node.value = String(val || '');
          }
        } else if (attr === 'className' || attr === 'class') {
          node.className = String(val || '');
        } else if (val === null || val === undefined || val === false) {
          node.removeAttribute(attr);
        } else {
          node.setAttribute(attr, String(val));
        }
      }
    });
  }

  /**
   * Keyed List Reconciliation Engine:
   * Updates children of a container by key.
   * Existing DOM nodes are preserved across ticks and updated in-place without destruction.
   */
  function bindKeyedList(container, getItems, getKey, createNode, updateNode) {
    if (!container) return () => {};
    const nodeMap = new Map(); // key -> { node, data }

    return createEffect(() => {
      const items = getItems() || [];
      const seenKeys = new Set();

      items.forEach((item, index) => {
        const key = getKey(item, index);
        seenKeys.add(key);
        let entry = nodeMap.get(key);

        if (!entry) {
          const node = createNode(item, index);
          if (node) {
            if (typeof node.setAttribute === 'function') {
              node.setAttribute('data-key', String(key));
            }
            container.appendChild(node);
            entry = { node, key };
            nodeMap.set(key, entry);
          }
        }

        if (entry && updateNode) {
          updateNode(entry.node, item, index);
        }
      });

      // Remove nodes no longer in items
      for (const [key, entry] of nodeMap.entries()) {
        if (!seenKeys.has(key)) {
          if (entry.node && (entry.node.parentNode === container || (container.childNodes && Array.from(container.childNodes).includes(entry.node)))) {
            container.removeChild(entry.node);
          }
          nodeMap.delete(key);
        }
      }

      // Reconcile child node order in container
      items.forEach((item, index) => {
        const key = getKey(item, index);
        const entry = nodeMap.get(key);
        if (entry && entry.node) {
          const expectedChild = container.childNodes ? container.childNodes[index] : null;
          if (expectedChild !== entry.node) {
            container.insertBefore(entry.node, expectedChild || null);
          }
        }
      });
    });
  }

  return {
    createSignal,
    signal: createSignal,
    createEffect,
    effect: createEffect,
    createComputed,
    computed: createComputed,
    createStore,
    store: createStore,
    batch,
    bindText,
    bindAttr,
    bindKeyedList
  };
});
