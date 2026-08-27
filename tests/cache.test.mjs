import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCache,
  memoryStorage,
  listKey,
  readmeKey,
  SCHEMA_VERSION,
  TTL_MS,
  PREFIX,
} from '../js/cache.js';

/** A clock the test drives by hand. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('a value round-trips within the TTL', () => {
  const cache = createCache({ storage: memoryStorage() });
  cache.set(listKey('u'), [{ name: 'demo' }]);
  assert.deepEqual(cache.get(listKey('u')), [{ name: 'demo' }]);
});

test('the default TTL is one hour and entries expire on the far side of it', () => {
  assert.equal(TTL_MS, 60 * 60 * 1000);
  const time = clock();
  const storage = memoryStorage();
  const cache = createCache({ storage, now: time.now });

  cache.set(listKey('u'), ['fresh']);
  time.advance(TTL_MS - 1);
  assert.deepEqual(cache.get(listKey('u')), ['fresh'], 'still fresh just before the TTL');

  time.advance(2);
  assert.equal(cache.get(listKey('u')), null, 'expired just after the TTL');
  assert.equal(storage.getItem(`${PREFIX}${listKey('u')}`), null, 'expired entries are evicted');
});

test('list and README entries live under separate keys', () => {
  const storage = memoryStorage();
  const cache = createCache({ storage });
  cache.set(listKey('u'), ['list']);
  cache.set(readmeKey('demo'), 'readme body');
  assert.deepEqual(cache.get(listKey('u')), ['list']);
  assert.equal(cache.get(readmeKey('demo')), 'readme body');
  assert.ok(storage.getItem(`${PREFIX}list:u`));
  assert.ok(storage.getItem(`${PREFIX}readme:demo`));
  assert.notEqual(listKey('u'), readmeKey('u'));
});

test('a corrupt entry reads as a miss and is evicted', () => {
  const storage = memoryStorage();
  storage.setItem(`${PREFIX}list:u`, '{not json at all');
  const cache = createCache({ storage });
  assert.equal(cache.get(listKey('u')), null);
  assert.equal(storage.getItem(`${PREFIX}list:u`), null);
});

test('entries written by an older schema version are discarded', () => {
  const storage = memoryStorage();
  storage.setItem(`${PREFIX}list:u`, JSON.stringify({ v: SCHEMA_VERSION - 1, t: Date.now(), d: ['old'] }));
  const cache = createCache({ storage });
  assert.equal(cache.get(listKey('u')), null);
});

test('entries with a broken timestamp are discarded', () => {
  const storage = memoryStorage();
  storage.setItem(`${PREFIX}list:u`, JSON.stringify({ v: SCHEMA_VERSION, t: 'yesterday', d: ['x'] }));
  assert.equal(createCache({ storage }).get(listKey('u')), null);
});

test('a non-object payload reads as a miss', () => {
  const storage = memoryStorage();
  storage.setItem(`${PREFIX}list:u`, '"just a string"');
  assert.equal(createCache({ storage }).get(listKey('u')), null);
});

test('a storage backend that throws degrades to a miss instead of crashing', () => {
  const hostile = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('nope'); },
    key() { throw new Error('nope'); },
    get length() { throw new Error('nope'); },
  };
  const cache = createCache({ storage: hostile });
  assert.equal(cache.set(listKey('u'), ['x']), false);
  assert.equal(cache.get(listKey('u')), null);
  assert.doesNotThrow(() => cache.remove(listKey('u')));
  assert.doesNotThrow(() => cache.clear());
});

test('clear removes only showfolio-prefixed keys', () => {
  const storage = memoryStorage();
  storage.setItem('unrelated', 'keep me');
  const cache = createCache({ storage });
  cache.set(listKey('u'), ['a']);
  cache.set(readmeKey('b'), 'b');
  cache.clear();
  assert.equal(cache.get(listKey('u')), null);
  assert.equal(storage.getItem('unrelated'), 'keep me');
});

test('a missing key is a plain miss', () => {
  assert.equal(createCache({ storage: memoryStorage() }).get('never-written'), null);
});
