/**
 * Headless screenshots for docs/shots/ — `node scripts/shots.mjs`.
 *
 * The README images are committed, so they have to be reproducible: a manually
 * captured screenshot drifts from the app the moment either changes, and nobody
 * can tell which one is stale. This script serves the repository with python3's
 * stdlib server (the same one playwright.config.mjs uses), drives Chromium
 * through the UI a visitor sees, and writes the two images the README links.
 *
 * The GitHub API is intercepted rather than called:
 *
 *   - the repo-list endpoint is answered with the contents of the committed
 *     data/snapshot.json, so the shot shows the same public data every time and
 *     the run costs nothing against the anonymous 60/hour limit;
 *   - the README endpoint answers 404, because every repo in the snapshot
 *     already carries its Korean summary and a live README fetch would only add
 *     nondeterminism.
 *
 * The avatar is still loaded from avatars.githubusercontent.com; offline, the
 * page hides it and the rest of the shot is unaffected.
 *
 * No extra dependency: chromium comes from the dev-only @playwright/test install.
 */

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'shots');
const PORT = Number(process.env.SHOTS_PORT || 6187);
const BASE = `http://localhost:${PORT}`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function snapshotRepos() {
  const raw = await readFile(join(ROOT, 'data', 'snapshot.json'), 'utf8');
  return JSON.parse(raw).repos;
}

async function shoot() {
  await mkdir(OUT, { recursive: true });
  const repos = await snapshotRepos();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1320, height: 980 } });

  await page.route('https://api.github.com/users/**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(repos) }));
  await page.route('https://api.github.com/repos/**', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));

  await page.goto(BASE);
  await page.locator('body[data-live="ok"]').waitFor();
  await wait(300);
  await page.screenshot({ path: join(OUT, 'home.png') });

  // The same grid in Korean: every card swaps its GitHub description for the
  // summary parsed out of that repo's README.
  await page.locator('[data-locale="ko"]').click();
  await wait(300);
  await page.screenshot({ path: join(OUT, 'home-ko.png') });

  await browser.close();
}

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', 'localhost'], {
  cwd: ROOT,
  stdio: 'ignore',
});

try {
  await wait(900);
  await shoot();
  console.log(`wrote ${join(OUT, 'home.png')} and ${join(OUT, 'home-ko.png')}`);
} finally {
  server.kill();
}
