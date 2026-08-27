// cache.js — a tiny TTL cache over localStorage.
//
// Its whole job is to keep a revisit from spending the anonymous API budget
// again. Every read is defensive: a corrupt entry, a stale schema version, an
// expired timestamp or a storage backend that throws (private mode, quota) all
// degrade to "cache miss" rather than an exception.

export const SCHEMA_VERSION = 1;
export const TTL_MS = 60 * 60 * 1000; // 1 hour
export const PREFIX = 'showfolio:';

/** In-memory stand-in used when localStorage is unavailable. */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    key: (index) => Array.from(map.keys())[index] ?? null,
    get length() { return map.size; },
  };
}

function defaultStorage() {
  try {
    const probe = globalThis.localStorage;
    if (!probe) return memoryStorage();
    probe.setItem(`${PREFIX}probe`, '1');
    probe.removeItem(`${PREFIX}probe`);
    return probe;
  } catch {
    return memoryStorage();
  }
}

/**
 * @param {{storage?: Storage, now?: () => number, ttlMs?: number, prefix?: string}} [options]
 */
export function createCache(options = {}) {
  const storage = options.storage ?? defaultStorage();
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? TTL_MS;
  const prefix = options.prefix ?? PREFIX;

  const full = (key) => `${prefix}${key}`;

  function get(key) {
    let raw;
    try {
      raw = storage.getItem(full(key));
    } catch {
      return null;
    }
    if (typeof raw !== 'string') return null;

    let entry;
    try {
      entry = JSON.parse(raw);
    } catch {
      remove(key); // corrupt JSON — evict so it cannot rot forever
      return null;
    }
    if (!entry || typeof entry !== 'object') { remove(key); return null; }
    if (entry.v !== SCHEMA_VERSION) { remove(key); return null; }
    if (!Number.isFinite(entry.t)) { remove(key); return null; }
    if (now() - entry.t > ttlMs) { remove(key); return null; }
    return entry.d;
  }

  function set(key, data) {
    try {
      storage.setItem(full(key), JSON.stringify({ v: SCHEMA_VERSION, t: now(), d: data }));
      return true;
    } catch {
      return false; // quota or disabled storage — caching is best-effort
    }
  }

  function remove(key) {
    try {
      storage.removeItem(full(key));
    } catch {
      /* ignore */
    }
  }

  function clear() {
    const keys = [];
    try {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (typeof key === 'string' && key.startsWith(prefix)) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  return { get, set, remove, clear, ttlMs };
}

/** Cache key for a user's repo list. */
export const listKey = (username) => `list:${username}`;

/** Cache key for one repo's README-derived summary. */
export const readmeKey = (repo) => `readme:${repo}`;

export default createCache;
