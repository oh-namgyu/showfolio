#!/usr/bin/env node
/**
 * set-homepages.mjs — point each repo's GitHub `homepage` field at its live demo.
 *
 *   node scripts/set-homepages.mjs                 # dry run (default) — prints the plan
 *   node scripts/set-homepages.mjs --apply         # back up current values, then PATCH
 *   node scripts/set-homepages.mjs --restore       # put the backed-up values back
 *
 * A maintainer utility, not part of the app. showfolio's Demo button reads the
 * repo's `homepage` field, so setting it once per repo is what makes the button
 * appear — for every visitor, and for anyone else who forks this and points it
 * at the same account. Doing it by hand across a dozen repos is where the wrong
 * URL ends up on the wrong card.
 *
 * Requires the `gh` CLI, authenticated with a token carrying `repo` scope
 * (`gh auth status` to check). No token is read or stored by this script; `gh`
 * holds it.
 *
 * SAFETY
 *   - Dry run is the default. Nothing is written without --apply.
 *   - --apply writes data/homepage-backup.json (gitignored) with every repo's
 *     CURRENT homepage value BEFORE the first PATCH, and refuses to overwrite
 *     an existing backup unless --force is given. That file is the undo.
 *   - Entries marked `placeholder` are skipped unless --include-placeholders is
 *     passed, so a URL that has not been deployed yet cannot be published by
 *     accident.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../js/config.js';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP = resolve(HERE, '..', 'data', 'homepage-backup.json');

/**
 * repo name → the URL its Demo button should point at.
 * `placeholder: false` means "not deployed yet" — skipped unless asked for.
 */
const DEMOS = {
  'cc-anatomy': { url: 'https://cc-anatomy.vercel.app' },
  'pipeline-anatomy': { url: 'https://pipeline-anatomy.vercel.app' },
  'kids-coloring': { url: 'https://kids-coloring-demo.vercel.app' },
  showfolio: { url: 'https://showfolio-nine.vercel.app', placeholder: false },
};

const argv = new Set(process.argv.slice(2));
const flags = {
  apply: argv.has('--apply'),
  restore: argv.has('--restore'),
  force: argv.has('--force'),
  placeholders: argv.has('--include-placeholders'),
};

const owner = config.username;

async function gh(args) {
  const { stdout } = await run('gh', args, { encoding: 'utf8' });
  return stdout;
}

/** Current homepage value for one repo, or undefined if the repo is gone. */
async function currentHomepage(repo) {
  try {
    const out = await gh(['api', `repos/${owner}/${repo}`, '--jq', '.homepage']);
    const value = out.trim();
    return value === 'null' ? '' : value;
  } catch (error) {
    console.warn(`  ! ${repo}: could not read (${error.message.trim().split('\n')[0]})`);
    return undefined;
  }
}

async function setHomepage(repo, url) {
  await gh(['api', '--method', 'PATCH', `repos/${owner}/${repo}`, '-f', `homepage=${url}`]);
}

const exists = (path) => access(path).then(() => true, () => false);

/** The repos this run will touch, with their target URLs. */
function targets() {
  return Object.entries(DEMOS)
    .filter(([, entry]) => flags.placeholders || !entry.placeholder)
    .map(([repo, entry]) => ({ repo, url: entry.url, placeholder: Boolean(entry.placeholder) }));
}

async function restore() {
  if (!(await exists(BACKUP))) {
    throw new Error(`no backup at ${BACKUP} — nothing to restore`);
  }
  const saved = JSON.parse(await readFile(BACKUP, 'utf8'));
  for (const [repo, url] of Object.entries(saved.homepages)) {
    console.log(`  ${repo} → ${url || '(empty)'}`);
    if (flags.apply) await setHomepage(repo, url);
  }
  console.log(flags.apply ? '\nrestored.' : '\nDRY RUN — add --apply to write these back.');
}

async function main() {
  console.log(`set-homepages — account ${owner}\n`);

  if (flags.restore) return restore();

  const plan = targets();
  if (plan.length === 0) {
    console.log('nothing to do (every entry is a placeholder; --include-placeholders to force)');
    return;
  }

  const homepages = {};
  for (const { repo, url, placeholder } of plan) {
    const before = await currentHomepage(repo);
    if (before === undefined) continue;
    homepages[repo] = before;
    const mark = before === url ? '=' : '→';
    console.log(`  ${repo}: ${before || '(empty)'} ${mark} ${url}${placeholder ? '  [placeholder]' : ''}`);
  }

  if (!flags.apply) {
    console.log('\nDRY RUN — nothing was written. Add --apply to back up and PATCH.');
    return;
  }

  if ((await exists(BACKUP)) && !flags.force) {
    throw new Error(`${BACKUP} already exists — restore or move it first, or pass --force`);
  }
  await writeFile(BACKUP, `${JSON.stringify({ owner, saved: new Date().toISOString(), homepages }, null, 2)}\n`, 'utf8');
  console.log(`\nbacked up current values to ${BACKUP}`);

  let failed = 0;
  for (const { repo, url } of plan) {
    if (!(repo in homepages)) continue;
    if (homepages[repo] === url) { console.log(`  = ${repo} (already set)`); continue; }
    try {
      await setHomepage(repo, url);
      console.log(`  ✓ ${repo}`);
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${repo}: ${error.message.trim().split('\n')[0]}`);
    }
  }

  console.log(failed === 0
    ? '\ndone. Undo with --restore --apply.'
    : `\n${failed} failed — the backup is intact; fix and re-run, or --restore --apply.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
