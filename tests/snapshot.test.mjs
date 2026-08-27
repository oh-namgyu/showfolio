import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSnapshot, REPO_FIELDS } from '../js/github.js';
import { config } from '../js/config.js';
import { SUMMARY_MAX_LENGTH } from '../js/summary.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const snapshot = JSON.parse(readFileSync(resolve(HERE, '..', 'data', 'snapshot.json'), 'utf8'));

const ALLOWED = new Set([...REPO_FIELDS, 'summaryKo']);

test('the committed snapshot passes the shared validator', () => {
  assert.equal(validateSnapshot(snapshot), true);
});

test('the snapshot belongs to the configured account', () => {
  assert.equal(snapshot.username, config.username);
});

test('every snapshot repo carries exactly the whitelisted fields plus summaryKo', () => {
  assert.ok(snapshot.repos.length > 0, 'snapshot is not empty');
  for (const repo of snapshot.repos) {
    for (const key of Object.keys(repo)) {
      assert.ok(ALLOWED.has(key), `unexpected field "${key}" on ${repo.name}`);
    }
    for (const field of REPO_FIELDS) {
      assert.ok(field in repo, `${repo.name} is missing "${field}"`);
    }
    assert.ok('summaryKo' in repo, `${repo.name} is missing "summaryKo"`);
  }
});

test('no fork, archived or excluded repo survived into the snapshot', () => {
  const excluded = new Set(config.exclude.map((n) => n.toLowerCase()));
  for (const repo of snapshot.repos) {
    assert.equal(repo.fork, false, `${repo.name} is a fork`);
    assert.equal(repo.archived, false, `${repo.name} is archived`);
    assert.equal(excluded.has(repo.name.toLowerCase()), false, `${repo.name} is excluded`);
  }
});

test('summaries are either null or capped plain strings', () => {
  for (const repo of snapshot.repos) {
    if (repo.summaryKo === null) continue;
    assert.equal(typeof repo.summaryKo, 'string');
    assert.ok(repo.summaryKo.length <= SUMMARY_MAX_LENGTH, `${repo.name} summary too long`);
    assert.doesNotMatch(repo.summaryKo, /\n/, `${repo.name} summary has newlines`);
    assert.doesNotMatch(repo.summaryKo, /전체 한국어 문서/, `${repo.name} kept the trailing aside`);
  }
});

test('repo names are unique and sorted by push date, newest first', () => {
  const names = snapshot.repos.map((r) => r.name);
  assert.equal(new Set(names).size, names.length, 'duplicate repo names');
  const dates = snapshot.repos.map((r) => Date.parse(r.pushed_at));
  const sorted = [...dates].sort((a, b) => b - a);
  assert.deepEqual(dates, sorted);
});

test('every pinned repo that exists is present in the snapshot', () => {
  const names = new Set(snapshot.repos.map((r) => r.name));
  const missing = config.pinned.filter((name) => !names.has(name));
  assert.deepEqual(missing, [], `pinned repos absent from the snapshot: ${missing.join(', ')}`);
});
