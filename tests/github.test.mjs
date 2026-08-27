import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createClient,
  mapRepo,
  filterRepos,
  nextPageUrl,
  validateSnapshot,
  BudgetExceededError,
  RateLimitedError,
  GitHubError,
  BUDGET,
  REPO_FIELDS,
  API_ROOT,
} from '../js/github.js';

const rawRepo = (over = {}) => ({
  name: 'demo',
  description: 'a demo repo',
  language: 'JavaScript',
  stargazers_count: 7,
  pushed_at: '2026-08-27T02:45:33Z',
  homepage: 'https://demo.example',
  topics: ['a', 'b'],
  fork: false,
  archived: false,
  html_url: 'https://github.com/u/demo',
  // Noise the whitelist must drop:
  owner: { login: 'u', avatar_url: 'https://x' },
  clone_url: 'https://github.com/u/demo.git',
  default_branch: 'main',
  size: 1234,
  ...over,
});

/** Build a stub Response. */
function res(body, { status = 200, headers = {}, text } = {}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower.get(String(name).toLowerCase()) ?? null },
    json: async () => body,
    text: async () => text ?? '',
  };
}

// --------------------------------------------------------------- field mapping

test('mapRepo keeps exactly the whitelisted fields and drops everything else', () => {
  const mapped = mapRepo(rawRepo());
  assert.deepEqual(Object.keys(mapped).sort(), [...REPO_FIELDS].sort());
  assert.equal(mapped.owner, undefined);
  assert.equal(mapped.clone_url, undefined);
  assert.equal(mapped.size, undefined);
});

test('mapRepo coerces missing or wrong-typed values', () => {
  const mapped = mapRepo(rawRepo({
    description: null,
    language: undefined,
    stargazers_count: 'nope',
    homepage: '',
    topics: 'not-an-array',
    fork: 'yes',
  }));
  assert.equal(mapped.description, null);
  assert.equal(mapped.language, null);
  assert.equal(mapped.stargazers_count, 0);
  assert.equal(mapped.homepage, '');
  assert.deepEqual(mapped.topics, []);
  assert.equal(mapped.fork, false); // only a real boolean true counts
});

test('mapRepo rejects payloads without a name', () => {
  assert.equal(mapRepo(null), null);
  assert.equal(mapRepo({}), null);
  assert.equal(mapRepo('string'), null);
});

test('filterRepos drops forks, archived repos and configured exclusions', () => {
  const repos = [
    { name: 'keep', fork: false, archived: false },
    { name: 'forked', fork: true, archived: false },
    { name: 'old', fork: false, archived: true },
    { name: 'Hidden', fork: false, archived: false },
  ];
  const kept = filterRepos(repos, ['hidden']);
  assert.deepEqual(kept.map((r) => r.name), ['keep']);
});

// ------------------------------------------------------------------ pagination

test('nextPageUrl reads rel="next" out of a Link header', () => {
  const link = '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=9>; rel="last"';
  assert.equal(nextPageUrl(link), 'https://api.github.com/x?page=2');
  assert.equal(nextPageUrl('<https://api.github.com/x?page=1>; rel="prev"'), null);
  assert.equal(nextPageUrl(null), null);
});

test('pagination follows Link: next but never exceeds 2 list calls', async () => {
  const calls = [];
  const client = createClient({
    fetch: async (url) => {
      calls.push(url);
      // Every page advertises another page — the budget has to stop us.
      return res([rawRepo({ name: `r${calls.length}` })], {
        headers: { Link: `<${API_ROOT}/next?page=${calls.length + 1}>; rel="next"` },
      });
    },
  });

  const { repos, truncated } = await client.listRepos('u');
  assert.equal(calls.length, 2, 'exactly two list calls');
  assert.equal(repos.length, 2);
  assert.equal(truncated, true, 'flags "showing first 200"');
  assert.equal(client.usage().list, 2);
  assert.match(calls[0], /per_page=100/);
  assert.match(calls[0], /sort=pushed/);
});

test('a single page does not flag truncation', async () => {
  const client = createClient({ fetch: async () => res([rawRepo()]) });
  const { repos, truncated } = await client.listRepos('u');
  assert.equal(repos.length, 1);
  assert.equal(truncated, false);
  assert.equal(client.usage().list, 1);
});

// ---------------------------------------------------------------- README calls

test('fetchReadme uses the readme endpoint with Accept: raw (not raw.githubusercontent)', async () => {
  let seen;
  const client = createClient({
    fetch: async (url, init) => {
      seen = { url, init };
      return res(null, { text: '# hi' });
    },
  });
  const body = await client.fetchReadme('oh-namgyu', 'cc-anatomy');
  assert.equal(body, '# hi');
  assert.equal(seen.url, 'https://api.github.com/repos/oh-namgyu/cc-anatomy/readme');
  assert.equal(seen.init.headers.Accept, 'application/vnd.github.raw');
  assert.doesNotMatch(seen.url, /raw\.githubusercontent/);
});

test('a repo without a README resolves to null, not an error', async () => {
  const client = createClient({ fetch: async () => res(null, { status: 404 }) });
  assert.equal(await client.fetchReadme('u', 'r'), null);
});

// --------------------------------------------------------------- budget caps

test('the 21st README call is refused locally, without a request', async () => {
  let requests = 0;
  const client = createClient({
    fetch: async () => { requests += 1; return res(null, { text: 'ok' }); },
  });

  for (let i = 0; i < BUDGET.readme; i += 1) {
    await client.fetchReadme('u', `r${i}`);
  }
  assert.equal(requests, 20);

  await assert.rejects(
    () => client.fetchReadme('u', 'r20'),
    (error) => error instanceof BudgetExceededError && error.kind === 'readme',
  );
  assert.equal(requests, 20, 'no network call was made for the refused request');
  assert.equal(client.remaining().readme, 0);
});

test('a third list call is refused locally', async () => {
  const client = createClient({ fetch: async () => res([rawRepo()]) });
  await client.listRepos('u');
  await client.listRepos('u');
  await assert.rejects(
    () => client.listRepos('u'),
    (error) => error instanceof BudgetExceededError && error.kind === 'list',
  );
  assert.equal(client.usage().list, 2);
});

test('the session total caps at 22 calls even when a sub-budget has room', async () => {
  let requests = 0;
  const client = createClient({
    fetch: async (url) => {
      requests += 1;
      return url.includes('/readme') ? res(null, { text: 'x' }) : res([rawRepo()]);
    },
  });
  await client.listRepos('u');
  await client.listRepos('u');
  for (let i = 0; i < 20; i += 1) await client.fetchReadme('u', `r${i}`);
  assert.equal(requests, BUDGET.total);
  assert.equal(client.usage().total, 22);
  await assert.rejects(() => client.fetchReadme('u', 'x'), BudgetExceededError);
  assert.equal(requests, 22);
});

// ------------------------------------------------------------ error classification

test('403 with X-RateLimit-Remaining: 0 is a RateLimitedError', async () => {
  const client = createClient({
    fetch: async () => res(null, {
      status: 403,
      headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1787809324' },
    }),
  });
  await assert.rejects(
    () => client.listRepos('u'),
    (error) => error instanceof RateLimitedError && error.resetAt === '1787809324',
  );
});

test('403 with requests remaining is a generic GitHubError', async () => {
  const client = createClient({
    fetch: async () => res(null, { status: 403, headers: { 'X-RateLimit-Remaining': '41' } }),
  });
  await assert.rejects(
    () => client.listRepos('u'),
    (error) => error instanceof GitHubError && !(error instanceof RateLimitedError) && error.status === 403,
  );
});

test('403 without rate-limit headers is a generic GitHubError', async () => {
  const client = createClient({ fetch: async () => res(null, { status: 403 }) });
  await assert.rejects(() => client.listRepos('u'), (e) => e.name === 'GitHubError');
});

test('429 is treated as rate limiting', async () => {
  const client = createClient({ fetch: async () => res(null, { status: 429 }) });
  await assert.rejects(() => client.listRepos('u'), RateLimitedError);
});

test('404 and 500 on the list are generic errors', async () => {
  for (const status of [404, 500]) {
    const client = createClient({ fetch: async () => res(null, { status }) });
    await assert.rejects(() => client.listRepos('u'), (e) => e.name === 'GitHubError' && e.status === status);
  }
});

// ------------------------------------------------------------- snapshot schema

test('validateSnapshot accepts a well-formed snapshot', () => {
  assert.equal(validateSnapshot({
    generated: '2026-08-27T04:00:00.000Z',
    username: 'oh-namgyu',
    repos: [{ name: 'demo', summaryKo: null }],
  }), true);
  assert.equal(validateSnapshot({ generated: new Date().toISOString(), username: 'u', repos: [] }), true);
});

test('validateSnapshot rejects malformed payloads', () => {
  const bad = [
    null,
    'a string',
    [],
    { username: 'u', repos: [] },                                   // no generated
    { generated: 'not-a-date', username: 'u', repos: [] },          // unparseable
    { generated: new Date().toISOString(), repos: [] },             // no username
    { generated: new Date().toISOString(), username: '', repos: [] },
    { generated: new Date().toISOString(), username: 'u' },         // no repos
    { generated: new Date().toISOString(), username: 'u', repos: {} },
    { generated: new Date().toISOString(), username: 'u', repos: [{ nome: 'typo' }] },
  ];
  for (const value of bad) assert.equal(validateSnapshot(value), false, JSON.stringify(value));
});
