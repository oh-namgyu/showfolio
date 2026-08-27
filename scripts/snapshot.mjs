#!/usr/bin/env node
// snapshot.mjs — build data/snapshot.json, the offline first-paint payload.
//
//   node scripts/snapshot.mjs [username]
//
// Runs on your machine, not in the browser, so it is free to fetch a README for
// every repo: the committed snapshot then carries a Korean summary for each
// card and the page needs zero third-party requests to paint. The browser's
// ≤20-README runtime budget is only ever spent on refreshing or on repos that
// appeared after the snapshot was taken.
//
// Set GITHUB_TOKEN to raise the anonymous 60/hour limit on big accounts.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../js/config.js';
import { mapRepo, filterRepos, nextPageUrl, API_ROOT } from '../js/github.js';
import { extractKoreanSummary } from '../js/summary.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'data', 'snapshot.json');

const token = process.env.GITHUB_TOKEN;
const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

async function api(url, accept) {
  const response = await fetch(url, { headers: { Accept: accept, ...authHeaders } });
  return response;
}

async function listAll(username) {
  let url = `${API_ROOT}/users/${encodeURIComponent(username)}/repos?per_page=100&sort=pushed`;
  const repos = [];
  while (url) {
    const response = await api(url, 'application/vnd.github+json');
    if (!response.ok) throw new Error(`list failed: HTTP ${response.status}`);
    const page = await response.json();
    for (const raw of page) {
      const mapped = mapRepo(raw);
      if (mapped) repos.push(mapped);
    }
    url = nextPageUrl(response.headers.get('Link'));
  }
  return repos;
}

async function readmeFor(username, repo) {
  const url = `${API_ROOT}/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo)}/readme`;
  const response = await api(url, 'application/vnd.github.raw');
  if (response.status === 404) return null;
  if (!response.ok) {
    console.warn(`  ! ${repo}: README HTTP ${response.status}`);
    return null;
  }
  return response.text();
}

async function main() {
  const username = process.argv[2] || config.username;
  console.log(`showfolio snapshot — ${username}`);

  const all = await listAll(username);
  const repos = filterRepos(all, config.exclude);
  console.log(`  ${all.length} repos, ${repos.length} after fork/archived/exclude filters`);

  let found = 0;
  for (const repo of repos) {
    const readme = await readmeFor(username, repo.name);
    repo.summaryKo = extractKoreanSummary(readme);
    if (repo.summaryKo) found += 1;
    console.log(`  ${repo.summaryKo ? '✓' : '·'} ${repo.name}`);
  }

  const snapshot = {
    generated: new Date().toISOString(),
    username,
    repos,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`\nwrote ${OUT}`);
  console.log(`  ${repos.length} repos · ${found} Korean summaries`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
