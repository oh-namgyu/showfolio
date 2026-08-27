import { test, expect } from '@playwright/test';
import {
  instrument, routeApi, routeSnapshot, repoFixture, snapshotFixture,
  fetchLog, apiLog, ready, cardNames, USER,
} from './helpers.mjs';

const SNAPSHOT_REPOS = [
  repoFixture('cc-anatomy', {
    pushed_at: '2026-08-26T08:46:00Z', topics: ['education', 'static-site'],
    summaryKo: '동작 원리를 단계별로 배우는 정적 웹앱입니다.',
  }),
  repoFixture('kids-coloring', {
    language: 'TypeScript', pushed_at: '2026-08-25T00:00:00Z',
    homepage: 'https://kids-coloring-demo.vercel.app', topics: ['pwa', 'kids'],
    summaryKo: '유아용 터치 색칠 PWA입니다.', stargazers_count: 12,
  }),
  repoFixture('taskdeck', {
    language: 'Python', pushed_at: '2026-08-24T00:00:00Z', topics: ['kanban'],
    summaryKo: '셀프호스트 칸반 보드입니다.',
  }),
  repoFixture('pipeline-anatomy', {
    pushed_at: '2026-08-27T02:33:16Z', topics: ['education'],
    summaryKo: '콘텐츠 자동화 파이프라인 케이스 스터디입니다.',
  }),
];

/** Snapshot on disk, live API returning the same set. */
async function openWithSnapshot(page, repos = SNAPSHOT_REPOS) {
  await instrument(page);
  await routeSnapshot(page, snapshotFixture(repos));
  const calls = await routeApi(page, { repos });
  await page.goto('/');
  await ready(page);
  return calls;
}

test('first paint comes from the snapshot with zero GitHub requests', async ({ page }) => {
  await openWithSnapshot(page);

  await expect(page.locator('body')).toHaveAttribute('data-source', 'snapshot');
  await expect(page.locator('[data-repo]')).toHaveCount(4);

  // The contract: every request is stamped with the first-paint flag as it is
  // made, so "zero third-party requests before first render" is checkable after
  // the fact instead of by racing a sample against the idle callback.
  await expect(page.locator('body[data-live="ok"]')).toBeAttached();

  const log = await fetchLog(page);
  const preRender = log.filter((entry) => !entry.ready);
  expect(preRender.map((entry) => entry.url), 'only same-origin fetches before first paint')
    .toEqual([expect.stringContaining('snapshot.json')]);

  const api = log.filter((entry) => entry.url.includes('api.github.com'));
  expect(api.length, 'the live call did happen — after the paint').toBeGreaterThan(0);
  expect(api.every((entry) => entry.ready), 'no GitHub request before first paint').toBe(true);
});

test('pinned repos lead, the rest follow newest push first', async ({ page }) => {
  await openWithSnapshot(page);

  // config.pinned order wins inside the pinned section, regardless of push date.
  const pinned = page.locator('[data-grid="pinned"] [data-repo]');
  await expect(pinned).toHaveCount(3);
  expect(await pinned.locator('[data-name]').allTextContents())
    .toEqual(['cc-anatomy', 'pipeline-anatomy', 'kids-coloring']);
  await expect(page.locator('[data-section="pinned"]')).toBeVisible();

  const rest = page.locator('[data-grid="all"] [data-repo] [data-name]');
  expect(await rest.allTextContents()).toEqual(['taskdeck']);
});

test('the grid groups repos under localised month headings', async ({ page }) => {
  await openWithSnapshot(page, [
    repoFixture('aug-a', { pushed_at: '2026-08-27T00:00:00Z' }),
    repoFixture('aug-b', { pushed_at: '2026-08-02T00:00:00Z' }),
    repoFixture('may-a', { pushed_at: '2026-05-05T00:00:00Z' }),
  ]);
  const heads = page.locator('[data-grid="all"] .group-head .group-title');
  expect(await heads.allTextContents()).toEqual(['August 2026', 'May 2026']);
  // Cards stay in one CSS grid; the heading rows carry no [data-repo].
  await expect(page.locator('[data-grid="all"] [data-repo]')).toHaveCount(3);

  await page.locator('[data-locale="ko"]').click();
  expect(await heads.allTextContents()).toEqual(['2026\ub144 8\uc6d4', '2026\ub144 5\uc6d4']);
});

test('unpinned repos sort by push date, newest first', async ({ page }) => {
  await openWithSnapshot(page, [
    repoFixture('oldest', { pushed_at: '2026-01-01T00:00:00Z' }),
    repoFixture('newest', { pushed_at: '2026-08-27T00:00:00Z' }),
    repoFixture('middle', { pushed_at: '2026-05-05T00:00:00Z' }),
  ]);
  await expect(page.locator('[data-section="pinned"]')).toBeHidden();
  expect(await cardNames(page)).toEqual(['newest', 'middle', 'oldest']);
});

test('the header shows the account, avatar host and profile link', async ({ page }) => {
  await openWithSnapshot(page);
  await expect(page.locator('[data-account-name]')).toHaveText(USER);
  await expect(page.locator('[data-profile]')).toHaveAttribute('href', `https://github.com/${USER}`);
  await expect(page.locator('[data-profile]')).toHaveAttribute('rel', 'noopener noreferrer');
  const avatar = page.locator('[data-avatar]');
  await expect(avatar).toHaveAttribute('src', /^https:\/\/avatars\.githubusercontent\.com\//);
  await expect(page.locator('.footer a')).toHaveAttribute('href', /showfolio/);
});

test('cards carry summary, language dot, stars, date and both buttons', async ({ page }) => {
  await openWithSnapshot(page);
  const card = page.locator('[data-repo="kids-coloring"]');

  await expect(card.locator('[data-summary]')).toHaveText('kids-coloring description');
  await expect(card.locator('[data-lang-name]')).toHaveText('TypeScript');
  await expect(card.locator('[data-stars]')).toHaveText('★ 12');
  await expect(card.locator('[data-updated]')).toContainText('2026');

  const demo = card.locator('[data-demo]');
  await expect(demo).toBeVisible();
  await expect(demo).toHaveAttribute('href', 'https://kids-coloring-demo.vercel.app/');
  await expect(demo).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(card.locator('[data-code]')).toHaveAttribute('href', `https://github.com/${USER}/kids-coloring`);

  // A repo without a homepage shows no Demo button at all.
  await expect(page.locator('[data-repo="taskdeck"] [data-demo]')).toBeHidden();
});

test('a non-http demo URL is rejected instead of being rendered', async ({ page }) => {
  await openWithSnapshot(page, [
    repoFixture('evil', { homepage: 'javascript:alert(1)' }),
    repoFixture('alsoevil', { homepage: 'data:text/html,<script>alert(1)</script>' }),
  ]);
  await expect(page.locator('[data-repo="evil"] [data-demo]')).toBeHidden();
  await expect(page.locator('[data-repo="alsoevil"] [data-demo]')).toBeHidden();
});

test('the summary is clamped to three lines', async ({ page }) => {
  await openWithSnapshot(page);
  const clamp = await page.locator('[data-repo="cc-anatomy"] [data-summary]')
    .evaluate((el) => getComputedStyle(el).webkitLineClamp);
  expect(clamp).toBe('3');
});

test('the EN/KO toggle swaps description for the Korean summary and persists', async ({ page }) => {
  await openWithSnapshot(page);
  const summary = page.locator('[data-repo="taskdeck"] [data-summary]');
  await expect(summary).toHaveText('taskdeck description');

  await page.locator('[data-locale="ko"]').click();
  await expect(summary).toHaveText('셀프호스트 칸반 보드입니다.');
  await expect(page.locator('[data-locale="ko"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-section="pinned"] .section-title')).toHaveText('고정');

  await page.reload();
  await ready(page);
  await expect(page.locator('[data-repo="taskdeck"] [data-summary]')).toHaveText('셀프호스트 칸반 보드입니다.');
});

test('a repo with no Korean summary falls back to its description in KO', async ({ page }) => {
  await openWithSnapshot(page, [repoFixture('bare', { summaryKo: null })]);
  await page.locator('[data-locale="ko"]').click();
  await expect(page.locator('[data-repo="bare"] [data-summary]')).toHaveText('bare description');
});

test('filter chips narrow the grid by language and by topic', async ({ page }) => {
  await openWithSnapshot(page);
  await expect(page.locator('[data-chip]').first()).toHaveText('All');

  await page.locator('[data-chip][data-kind="language"][data-value="Python"]').click();
  expect(await cardNames(page)).toEqual(['taskdeck']);
  await expect(page.locator('[data-chip][data-value="Python"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-chip][data-kind="topic"][data-value="education"]').click();
  expect((await cardNames(page)).sort()).toEqual(['cc-anatomy', 'pipeline-anatomy']);

  await page.locator('[data-chip][data-kind="all"]').click();
  await expect(page.locator('[data-repo]')).toHaveCount(4);
});

test('an account with no public repos shows a message, not a blank page', async ({ page }) => {
  await instrument(page);
  await routeSnapshot(page, null);
  await routeApi(page, { repos: [] });

  await page.goto('/');
  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  await expect(page.locator('[data-empty]')).toBeVisible();
  await expect(page.locator('[data-guidance]')).toBeHidden();
});

// --------------------------------------------- the snapshot is optional (3 paths)

test('no snapshot → skeleton first, then the live list', async ({ page }) => {
  await instrument(page);
  await routeSnapshot(page, null);
  await routeApi(page, { repos: [repoFixture('live-only')], delayMs: 400 });

  await page.goto('/');
  await ready(page);
  await expect(page.locator('body')).toHaveAttribute('data-source', 'skeleton');
  await expect(page.locator('[data-skeleton]').first()).toBeVisible();

  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  expect(await cardNames(page)).toEqual(['live-only']);
  await expect(page.locator('[data-skeleton]')).toHaveCount(0);
});

test('a snapshot belonging to another account is ignored', async ({ page }) => {
  await instrument(page);
  await routeSnapshot(page, snapshotFixture([repoFixture('someone-elses')], { username: 'not-me' }));
  await routeApi(page, { repos: [repoFixture('mine')], delayMs: 300 });

  await page.goto('/');
  await ready(page);
  await expect(page.locator('body')).toHaveAttribute('data-source', 'skeleton');
  expect(await cardNames(page)).toEqual([]);

  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  expect(await cardNames(page)).toEqual(['mine']);
});

test('a corrupt snapshot is ignored and the live list takes over', async ({ page }) => {
  await instrument(page);
  await routeSnapshot(page, '{"generated": "2026-08-27", "repos": [ truncated json');
  await routeApi(page, { repos: [repoFixture('recovered')] });

  await page.goto('/');
  await ready(page);
  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  expect(await cardNames(page)).toEqual(['recovered']);
});

test('a structurally invalid snapshot is ignored', async ({ page }) => {
  await instrument(page);
  await routeSnapshot(page, { username: USER, repos: 'not-an-array' });
  await routeApi(page, { repos: [repoFixture('recovered')] });

  await page.goto('/');
  await ready(page);
  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  expect(await cardNames(page)).toEqual(['recovered']);
});
