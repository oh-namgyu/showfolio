import { test, expect } from '@playwright/test';
import {
  instrument, routeApi, routeSnapshot, repoFixture, snapshotFixture,
  ready, cardNames, USER,
} from './helpers.mjs';

const PLAIN = [
  repoFixture('alpha', { pushed_at: '2026-08-20T00:00:00Z', topics: ['cli', 'shared'] }),
  repoFixture('beta', { pushed_at: '2026-08-19T00:00:00Z', language: 'Python', topics: ['shared'] }),
  repoFixture('cc-anatomy', { pushed_at: '2026-08-18T00:00:00Z' }),
];

async function open(page, repos = PLAIN) {
  await instrument(page);
  await routeSnapshot(page, snapshotFixture(repos));
  await routeApi(page, { repos });
  await page.goto('/');
  await ready(page);
}

// ------------------------------------------------------------------ responsive

for (const [label, width] of [['320px', 320], ['768px', 768], ['1440px', 1440]]) {
  test(`the layout fits ${label} with no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);

    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      view: document.documentElement.clientWidth,
    }));
    expect(overflow.doc, `no sideways scroll at ${label}`).toBeLessThanOrEqual(overflow.view);

    const card = await page.locator('[data-repo]').first().boundingBox();
    expect(card.width).toBeGreaterThan(0);
    expect(card.width).toBeLessThanOrEqual(width);
  });
}

test('the grid uses auto-fill columns and stacks to one column when narrow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await open(page);
  const columns = await page.locator('[data-grid="all"]')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(1);

  await page.setViewportSize({ width: 1440, height: 900 });
  const wide = await page.locator('[data-grid="all"]')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(wide).toBeGreaterThan(1);
});

// ------------------------------------------------------------------------ a11y

test('reduced motion switches the skeleton shimmer and card lift off', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await open(page);

  const timings = await page.locator('[data-repo]').first().locator('.card')
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return { transition: style.transitionDuration, animation: style.animationDuration };
    });
  expect(parseFloat(timings.transition)).toBeLessThan(0.01);
  expect(parseFloat(timings.animation)).toBeLessThan(0.01);
  await context.close();
});

test('keyboard tabbing reaches the skip link, the toggle, the chips and the cards', async ({ page }) => {
  await open(page);
  const focused = async () => page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el.tagName, text: (el.textContent ?? '').trim().slice(0, 24), outline: getComputedStyle(el).outlineWidth };
  });

  await page.keyboard.press('Tab');
  let current = await focused();
  expect(current.text).toBe('Skip to repositories');
  expect(parseFloat(current.outline), 'focus ring is visible').toBeGreaterThan(0);

  const seen = [];
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    current = await focused();
    seen.push(current.text);
  }
  expect(seen).toContain('EN');
  expect(seen).toContain('KO');
  expect(seen).toContain('All');
  expect(seen.some((text) => text === 'GitHub')).toBe(true);
});

test('the skip link jumps focus to the repository grid', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.location.hash)).toBe('#grid');
});

test('interactive controls and images carry accessible names', async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-avatar]')).toHaveAttribute('alt', `${USER}’s avatar`);
  await expect(page.locator('.locale')).toHaveAttribute('aria-label', 'Language');
  await expect(page.locator('[data-chips]')).toHaveAttribute('aria-label', 'Filter repositories');
  await expect(page.locator('[data-status]')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('[data-repo="alpha"] [data-code]'))
    .toHaveAttribute('aria-label', 'alpha on GitHub');
  await expect(page.locator('[data-dot]').first()).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('[data-grid="all"]')).toHaveAttribute('aria-busy', 'false');
});

test('the grid announces itself as busy while the skeleton is up', async ({ page }) => {
  await instrument(page);
  await routeSnapshot(page, null);
  await routeApi(page, { repos: PLAIN, delayMs: 500 });
  await page.goto('/');
  await ready(page);
  await expect(page.locator('[data-grid="all"]')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  await expect(page.locator('[data-grid="all"]')).toHaveAttribute('aria-busy', 'false');
});

test('the star count is readable, not just a glyph', async ({ page }) => {
  await open(page, [repoFixture('starred', { stargazers_count: 3 })]);
  await expect(page.locator('[data-repo="starred"] [data-stars]'))
    .toHaveAttribute('aria-label', '3 stars');
});

// ------------------------------------------------------------------- XSS probe

const XSS = '<script>window.__pwned = true; alert(1)</script>';
const XSS_ATTR = '"><img src=x onerror="window.__pwned=true">';

test('script payloads in repo data render as literal text and never execute', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });

  await instrument(page);
  const hostile = [
    {
      ...repoFixture('safe-name'),
      description: `desc ${XSS}`,
      summaryKo: `요약 ${XSS_ATTR}`,
      language: `Lang${XSS_ATTR}`,
    },
    { ...repoFixture(`evil${XSS}`), description: 'plain', summaryKo: 'plain' },
  ];
  await routeSnapshot(page, snapshotFixture(hostile));
  await routeApi(page, { repos: hostile });

  await page.goto('/');
  await ready(page);

  const names = await cardNames(page);
  expect(names.some((name) => name.includes('<script>')), 'the tag is text, not markup').toBe(true);
  await expect(page.locator('[data-summary]').first()).toHaveText(`desc ${XSS}`);

  // Switch to KO so the injected summary is rendered too.
  await page.locator('[data-locale="ko"]').click();
  await expect(page.locator('[data-summary]').first()).toHaveText(`요약 ${XSS_ATTR}`);

  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.locator('script:not([type="module"])').count(), 'no injected <script> element').toBe(0);
  expect(await page.locator('img[src="x"]').count(), 'no injected <img> element').toBe(0);
  expect(dialogs, 'no alert fired').toEqual([]);
});

test('a hostile payload arriving from the live list is equally inert', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });

  await instrument(page);
  await routeSnapshot(page, null);
  await routeApi(page, {
    repos: [{ ...repoFixture('live-evil'), description: XSS, homepage: 'javascript:alert(1)' }],
  });

  await page.goto('/');
  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  await expect(page.locator('[data-repo="live-evil"] [data-summary]')).toHaveText(XSS);
  await expect(page.locator('[data-repo="live-evil"] [data-demo]')).toBeHidden();
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(dialogs).toEqual([]);
});

test('a hostile Korean summary fetched from a README stays inert', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });

  await instrument(page);
  await page.addInitScript(() => window.localStorage.setItem('showfolio:locale', 'ko'));
  await routeSnapshot(page, null);
  await routeApi(page, {
    repos: [repoFixture('readme-evil')],
    readme: () => `> **한글 요약** — 위험 ${XSS_ATTR}\n`,
  });

  await page.goto('/');
  await expect(page.locator('[data-repo="readme-evil"] [data-summary]'))
    .toContainText('위험');
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(dialogs).toEqual([]);
});

// ------------------------------------------------------- config portability

/** Serve a rewritten js/config.js — the fork-and-edit path, without editing it. */
async function overrideConfig(page, overrides) {
  await page.route('**/js/config.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    body: `export const config = ${JSON.stringify(overrides)};\nexport default config;\n`,
  }));
}

test('changing only config.js switches the showcase to another account', async ({ page }) => {
  await instrument(page);
  await overrideConfig(page, {
    username: 'other-dev', exclude: [], pinned: ['their-pin'], demoOverrides: {},
  });
  // The committed snapshot belongs to someone else, so it must be ignored.
  await routeSnapshot(page, snapshotFixture(PLAIN));
  const calls = await routeApi(page, {
    repos: [
      repoFixture('their-repo', { pushed_at: '2026-08-10T00:00:00Z' }),
      repoFixture('their-pin', { pushed_at: '2026-01-10T00:00:00Z' }),
    ],
  });

  await page.goto('/');
  await ready(page);
  await expect(page.locator('body')).toHaveAttribute('data-source', 'skeleton');

  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  await expect(page.locator('[data-account-name]')).toHaveText('other-dev');
  await expect(page.locator('[data-profile]')).toHaveAttribute('href', 'https://github.com/other-dev');
  await expect(page.locator('[data-avatar]')).toHaveAttribute('src', /avatars\.githubusercontent\.com\/other-dev/);
  expect(calls.urls[0]).toContain('/users/other-dev/repos');
  expect(await cardNames(page)).toEqual(['their-pin', 'their-repo']);
  await expect(page.locator('[data-grid="pinned"] [data-name]')).toHaveText('their-pin');
});

test('config.exclude hides repos from both the snapshot and the live list', async ({ page }) => {
  await instrument(page);
  await overrideConfig(page, {
    username: USER, exclude: ['Beta'], pinned: [], demoOverrides: {},
  });
  await routeSnapshot(page, null);
  await routeApi(page, { repos: PLAIN });

  await page.goto('/');
  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  expect(await cardNames(page)).toEqual(['alpha', 'cc-anatomy']);
});

test('config.demoOverrides adds a Demo button to a repo with no homepage', async ({ page }) => {
  await instrument(page);
  await overrideConfig(page, {
    username: USER, exclude: [], pinned: [], demoOverrides: { alpha: 'https://override.example' },
  });
  await routeSnapshot(page, null);
  await routeApi(page, { repos: PLAIN });

  await page.goto('/');
  await expect(page.locator('body[data-live="ok"]')).toBeAttached();
  await expect(page.locator('[data-repo="alpha"] [data-demo]'))
    .toHaveAttribute('href', 'https://override.example/');
  await expect(page.locator('[data-repo="beta"] [data-demo]')).toBeHidden();
});
