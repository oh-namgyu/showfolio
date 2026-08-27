// Shared e2e plumbing. Every GitHub call is intercepted — the suite never
// touches the live API, so CI spends zero of the anonymous rate budget.

export const API_GLOB = 'https://api.github.com/**';
export const USER = 'oh-namgyu';

/** A raw-ish repo payload; extra fields exercise the whitelist mapping. */
export function repoFixture(name, over = {}) {
  return {
    name,
    description: `${name} description`,
    language: 'JavaScript',
    stargazers_count: 0,
    pushed_at: '2026-08-20T00:00:00Z',
    homepage: null,
    topics: [],
    fork: false,
    archived: false,
    html_url: `https://github.com/${USER}/${name}`,
    // noise the client must drop:
    owner: { login: USER },
    clone_url: `https://github.com/${USER}/${name}.git`,
    ...over,
  };
}

export function snapshotFixture(repos, over = {}) {
  return { generated: '2026-08-27T00:00:00.000Z', username: USER, repos, ...over };
}

/** Log every window.fetch with the first-paint flag at the time it was made. */
export async function instrument(page) {
  await page.addInitScript(() => {
    window.__sfLog = [];
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input?.url ?? String(input));
      window.__sfLog.push({ url, ready: document.body?.dataset?.ready === 'true' });
      return original(input, init);
    };
  });
}

export const fetchLog = (page) => page.evaluate(() => window.__sfLog ?? []);

export const apiLog = async (page) =>
  (await fetchLog(page)).filter((entry) => entry.url.includes('api.github.com'));

/**
 * Serve data/snapshot.json.
 *   object → JSON body · string → raw body (corruption tests) · null → 404
 */
export async function routeSnapshot(page, body) {
  await page.route('**/data/snapshot.json', (route) => {
    if (body === null) return route.fulfill({ status: 404, body: 'not found' });
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: payload });
  });
}

/**
 * Intercept api.github.com.
 * @param {import('@playwright/test').Page} page
 * @param {{repos?: object[], listStatus?: number, listHeaders?: object,
 *          readme?: (name: string) => string|null, abort?: boolean, delayMs?: number}} options
 * @returns {{list: number, readme: number, urls: string[]}} live counters
 */
export async function routeApi(page, options = {}) {
  const calls = { list: 0, readme: 0, urls: [] };

  // GitHub exposes these to cross-origin readers; without the same header the
  // browser hides them from fetch and the client cannot tell a rate limit from
  // any other 403. Mirroring it keeps the mock honest.
  const expose = {
    'Access-Control-Expose-Headers': 'Link, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
  };

  await page.route(API_GLOB, async (route) => {
    const url = route.request().url();
    calls.urls.push(url);
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    if (options.abort) return route.abort('failed');

    if (url.includes('/readme')) {
      calls.readme += 1;
      const name = url.match(/\/repos\/[^/]+\/([^/]+)\/readme/)?.[1] ?? '';
      const body = options.readme ? options.readme(name) : null;
      if (body == null) return route.fulfill({ status: 404, headers: expose, body: '' });
      return route.fulfill({ status: 200, headers: expose, contentType: 'text/plain; charset=utf-8', body });
    }

    calls.list += 1;
    const headers = { ...expose, ...(options.listHeaders ?? {}) };
    const status = options.listStatus ?? 200;
    if (status !== 200) {
      return route.fulfill({ status, headers, contentType: 'application/json', body: '{"message":"nope"}' });
    }
    return route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify(options.repos ?? []),
    });
  });

  return calls;
}

/**
 * Pre-seed localStorage before the app boots.
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, unknown>} entries raw values, keyed without the prefix
 */
export async function seedStorage(page, entries) {
  await page.addInitScript((seed) => {
    for (const [key, value] of Object.entries(seed)) {
      window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  }, entries);
}

/** A cache entry as js/cache.js writes them. `ageMs` back-dates it. */
export const cacheEntry = (data, ageMs = 0) => ({ v: 1, t: Date.now() - ageMs, d: data });

/** Poll a counter until it stops moving, then return it. */
export async function settled(read, quietMs = 400, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let last = read();
  let lastChange = Date.now();
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 80));
    const now = read();
    if (now !== last) { last = now; lastChange = Date.now(); }
    else if (Date.now() - lastChange >= quietMs) return last;
  }
  return last;
}

/** Wait for the first paint to be complete. */
export async function ready(page) {
  await page.waitForSelector('body[data-ready="true"]', { state: 'attached' });
}

/** All rendered card names, pinned section first. */
export const cardNames = (page) => page.locator('[data-repo] [data-name]').allTextContents();
