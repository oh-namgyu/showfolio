import { test, expect } from '@playwright/test';
import {
  instrument, routeApi, routeSnapshot, repoFixture, snapshotFixture,
  seedStorage, cacheEntry, settled, ready, cardNames, USER,
} from './helpers.mjs';

const BASE = [
  repoFixture('alpha', { pushed_at: '2026-08-20T00:00:00Z' }),
  repoFixture('beta', { pushed_at: '2026-08-19T00:00:00Z' }),
];

const LIST_KEY = `showfolio:list:${USER}`;
const RATE_LIMITED = { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1787809324' };

// ------------------------------------------------------------ the happy path

test('a repo published after the snapshot is picked up with no redeploy', async ({ page }) => {
  await instrument(page);
  await routeSnapshot(page, snapshotFixture(BASE));
  await routeApi(page, {
    delayMs: 400, // hold the live answer so the snapshot-only state is observable
    repos: [...BASE, repoFixture('brand-new', { pushed_at: '2026-08-27T00:00:00Z' })],
  });

  await page.goto('/');
  await ready(page);
  expect(await cardNames(page), 'the snapshot set paints first').toEqual(['alpha', 'beta']);

  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  expect(await cardNames(page)).toEqual(['brand-new', 'alpha', 'beta']);
  await expect(page.locator('[data-badge]')).toHaveText('updated live');
  await expect(page.locator('[data-caption]')).toHaveText('1 new repo since the snapshot');
});

test('a live refresh also corrects changed fields on existing cards', async ({ page }) => {
  await instrument(page);
  await routeSnapshot(page, snapshotFixture([repoFixture('alpha', { stargazers_count: 0, description: 'old text' })]));
  await routeApi(page, {
    delayMs: 400,
    repos: [repoFixture('alpha', { stargazers_count: 42, description: 'new text', language: 'Rust' })],
  });

  await page.goto('/');
  await ready(page);
  await expect(page.locator('[data-repo="alpha"] [data-summary]')).toHaveText('old text');

  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  await expect(page.locator('[data-repo="alpha"] [data-summary]')).toHaveText('new text');
  await expect(page.locator('[data-repo="alpha"] [data-stars]')).toHaveText('★ 42');
  await expect(page.locator('[data-repo="alpha"] [data-lang-name]')).toHaveText('Rust');
  await expect(page.locator('[data-caption]')).toHaveText(''); // nothing new — no count
});

test('forks, archived repos and exclusions never reach the grid from the live list', async ({ page }) => {
  await instrument(page);
  await routeSnapshot(page, null);
  await routeApi(page, {
    repos: [
      repoFixture('kept'),
      repoFixture('a-fork', { fork: true }),
      repoFixture('retired', { archived: true }),
    ],
  });
  await page.goto('/');
  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  expect(await cardNames(page)).toEqual(['kept']);
});

// ------------------------------------------------------------ failure paths

test('a 403 rate limit keeps the snapshot on screen and explains why', async ({ page }) => {
  await instrument(page);
  await routeSnapshot(page, snapshotFixture(BASE));
  await routeApi(page, { listStatus: 403, listHeaders: RATE_LIMITED });

  await page.goto('/');
  await ready(page);
  await expect(page.locator('body[data-live="stale"]')).toBeAttached();

  expect(await cardNames(page)).toEqual(['alpha', 'beta']);
  await expect(page.locator('[data-caption]')).toContainText('hourly limit');
  await expect(page.locator('[data-guidance]')).toBeHidden();
});

test('a 403 that is not a rate limit gets the generic message', async ({ page }) => {
  await instrument(page);
  await routeSnapshot(page, snapshotFixture(BASE));
  await routeApi(page, { listStatus: 403, listHeaders: { 'X-RateLimit-Remaining': '41' } });

  await page.goto('/');
  await expect(page.locator('body[data-live="stale"]')).toBeAttached();
  expect(await cardNames(page)).toEqual(['alpha', 'beta']);
  await expect(page.locator('[data-caption]')).toContainText('Could not reach GitHub');
});

test('a network failure keeps the snapshot on screen', async ({ page }) => {
  await instrument(page);
  await routeSnapshot(page, snapshotFixture(BASE));
  await routeApi(page, { abort: true });

  await page.goto('/');
  await expect(page.locator('body[data-live="stale"]')).toBeAttached();
  expect(await cardNames(page)).toEqual(['alpha', 'beta']);
  await expect(page.locator('[data-caption]')).toContainText('Could not reach GitHub');
  await expect(page.locator('[data-badge]')).toBeHidden();
});

test('no snapshot plus a rate-limited API gives guidance, never a blank page', async ({ page }) => {
  await instrument(page);
  await routeSnapshot(page, null);
  await routeApi(page, { listStatus: 403, listHeaders: RATE_LIMITED });

  await page.goto('/');
  await expect(page.locator('body[data-live="error"]')).toBeAttached();

  const guidance = page.locator('[data-guidance]');
  await expect(guidance).toBeVisible();
  await expect(guidance.locator('[data-guidance-text]')).toContainText(USER);
  await expect(guidance.locator('[data-guidance-text]')).toContainText('60 requests an hour');
  await expect(guidance.locator('[data-guidance-link]')).toHaveAttribute('href', `https://github.com/${USER}`);
  await expect(page.locator('[data-skeleton]')).toHaveCount(0);
  await expect(page.locator('[data-caption]')).toContainText('hourly limit');
});

test('the guidance screen follows the locale toggle', async ({ page }) => {
  await instrument(page);
  await routeSnapshot(page, null);
  await routeApi(page, { listStatus: 403, listHeaders: RATE_LIMITED });

  await page.goto('/');
  await expect(page.locator('body[data-live="error"]')).toBeAttached();
  await page.locator('[data-locale="ko"]').click();
  await expect(page.locator('[data-guidance-text]')).toContainText('저장소 목록을 불러오지 못했고');
});

// -------------------------------------------------------------- cache / TTL

test('a cache entry inside its TTL paints without spending a single API call', async ({ page }) => {
  await instrument(page);
  await seedStorage(page, { [LIST_KEY]: cacheEntry([repoFixture('from-cache')], 5 * 60 * 1000) });
  await routeSnapshot(page, snapshotFixture(BASE));
  const calls = await routeApi(page, { repos: BASE });

  await page.goto('/');
  await ready(page);
  await expect(page.locator('body')).toHaveAttribute('data-source', 'cache');
  expect(await cardNames(page)).toEqual(['from-cache']);
  await expect(page.locator('[data-badge]')).toHaveText('from cache');

  expect(await settled(() => calls.list), 'a fresh cache spends no budget').toBe(0);
});

test('an expired cache entry is ignored and the live list refreshes the grid', async ({ page }) => {
  await instrument(page);
  // Two hours old — past the one-hour TTL.
  await seedStorage(page, { [LIST_KEY]: cacheEntry([repoFixture('stale-cache')], 2 * 60 * 60 * 1000) });
  await routeSnapshot(page, null);
  const calls = await routeApi(page, { repos: [repoFixture('alpha'), repoFixture('refreshed')] });

  await page.goto('/');
  await ready(page);
  await expect(page.locator('body')).toHaveAttribute('data-source', 'skeleton');

  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  expect((await cardNames(page)).sort()).toEqual(['alpha', 'refreshed']);
  expect(calls.list).toBe(1);
});

test('a live refresh writes the list back to the cache', async ({ page }) => {
  await instrument(page);
  await routeSnapshot(page, null);
  await routeApi(page, { repos: [repoFixture('cached-later')] });

  await page.goto('/');
  await expect(page.locator('body[data-live="ok"]')).toBeAttached();

  const stored = await page.evaluate((key) => window.localStorage.getItem(key), LIST_KEY);
  const entry = JSON.parse(stored);
  expect(entry.v).toBe(1);
  expect(entry.d.map((repo) => repo.name)).toEqual(['cached-later']);
});

// ------------------------------------------------------- lazy README loading

test('KO mode lazily fetches a missing Korean summary and swaps it in', async ({ page }) => {
  await instrument(page);
  await seedStorage(page, { 'showfolio:locale': 'ko' });
  await routeSnapshot(page, null);
  const calls = await routeApi(page, {
    repos: [repoFixture('alpha')],
    readme: (name) => `# ${name}\n\n> **한글 요약** — 지연 로딩으로 받아온 요약입니다.\n`,
  });

  await page.goto('/');
  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  await expect(page.locator('[data-repo="alpha"] [data-summary]'))
    .toHaveText('지연 로딩으로 받아온 요약입니다.');
  expect(calls.readme).toBe(1);
});

test('EN mode never spends the README budget', async ({ page }) => {
  await instrument(page);
  await routeSnapshot(page, null);
  const calls = await routeApi(page, { repos: [repoFixture('alpha')], readme: () => '# x' });

  await page.goto('/');
  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  expect(await settled(() => calls.readme)).toBe(0);
});

test('the README budget stops at 20 — there is no 21st request', async ({ page }) => {
  await instrument(page);
  await seedStorage(page, { 'showfolio:locale': 'ko' });
  await page.setViewportSize({ width: 1280, height: 2400 });
  await routeSnapshot(page, null);

  const repos = Array.from({ length: 25 }, (_, i) =>
    repoFixture(`repo-${String(i).padStart(2, '0')}`, { pushed_at: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00Z` }));
  const calls = await routeApi(page, { repos, readme: (name) => `> **한글 요약** — ${name} 요약\n` });

  await page.goto('/');
  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  await expect(page.locator('[data-repo]')).toHaveCount(25);

  // Walk every card past the viewport so the observer fires for all 25.
  for (const handle of await page.locator('[data-repo]').elementHandles()) {
    await handle.scrollIntoViewIfNeeded();
  }

  const readmeCalls = await settled(() => calls.readme, 600);
  expect(readmeCalls, 'hard cap of 20 README calls per session').toBe(20);
  expect(calls.list + readmeCalls, 'session total stays within 22').toBeLessThanOrEqual(22);
});

test('a lazily fetched summary is cached for the next visit', async ({ page }) => {
  await instrument(page);
  await seedStorage(page, { 'showfolio:locale': 'ko' });
  await routeSnapshot(page, null);
  const calls = await routeApi(page, {
    repos: [repoFixture('alpha')],
    readme: () => '> **한글 요약** — 캐시될 요약입니다.\n',
  });

  await page.goto('/');
  await expect(page.locator('[data-repo="alpha"] [data-summary]')).toHaveText('캐시될 요약입니다.');
  expect(calls.readme).toBe(1);

  const cached = await page.evaluate(() => window.localStorage.getItem('showfolio:readme:alpha'));
  expect(JSON.parse(cached).d).toBe('캐시될 요약입니다.');

  // Second visit: the list cache is warm, so nothing is re-fetched at all.
  await page.reload();
  await ready(page);
  await expect(page.locator('[data-repo="alpha"] [data-summary]')).toHaveText('캐시될 요약입니다.');
  expect(await settled(() => calls.readme)).toBe(1);
});

test('a rate-limited README leaves the description fallback in place', async ({ page }) => {
  await instrument(page);
  await seedStorage(page, { 'showfolio:locale': 'ko' });
  await routeSnapshot(page, null);
  await page.route('https://api.github.com/repos/**/readme', (route) =>
    route.fulfill({ status: 403, headers: RATE_LIMITED, body: '{}' }));
  await routeApi(page, { repos: [repoFixture('alpha')] });

  await page.goto('/');
  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  await expect(page.locator('[data-repo="alpha"] [data-summary]')).toHaveText('alpha description');
  await expect(page.locator('[data-guidance]')).toBeHidden();
});
