import test from 'node:test';
import assert from 'node:assert/strict';

import {
  safeUrl, demoUrl, orderRepos, facets, matchesFilter, languageColor, FACET_LIMITS,
} from '../js/cards.js';

const repo = (name, over = {}) => ({
  name, language: 'JavaScript', topics: [], pushed_at: '2026-01-01T00:00:00Z', homepage: null, ...over,
});

test('safeUrl accepts only absolute http(s) URLs', () => {
  assert.equal(safeUrl('https://example.dev/a'), 'https://example.dev/a');
  assert.equal(safeUrl('http://example.dev'), 'http://example.dev/');
  assert.equal(safeUrl('  https://example.dev  '), 'https://example.dev/');
});

test('safeUrl rejects dangerous and relative URLs', () => {
  for (const value of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '/relative/path',
    'example.dev',
    '',
    '   ',
    null,
    undefined,
    42,
    { href: 'https://example.dev' },
  ]) {
    assert.equal(safeUrl(value), null, `should reject ${String(value)}`);
  }
});

test('demoOverrides win over the GitHub homepage field', () => {
  const r = repo('demo', { homepage: 'https://from-github.dev' });
  assert.equal(demoUrl(r, {}), 'https://from-github.dev/');
  assert.equal(demoUrl(r, { demo: 'https://from-config.dev' }), 'https://from-config.dev/');
  // An unusable override falls back to homepage rather than dropping the button.
  assert.equal(demoUrl(r, { demo: 'javascript:alert(1)' }), 'https://from-github.dev/');
});

test('orderRepos puts pinned repos first in config order, rest newest first', () => {
  const repos = [
    repo('a', { pushed_at: '2026-01-01T00:00:00Z' }),
    repo('b', { pushed_at: '2026-08-01T00:00:00Z' }),
    repo('c', { pushed_at: '2026-04-01T00:00:00Z' }),
  ];
  const { pinned, rest } = orderRepos(repos, ['c', 'a']);
  assert.deepEqual(pinned.map((r) => r.name), ['c', 'a']);
  assert.deepEqual(rest.map((r) => r.name), ['b']);
});

test('a pinned name that does not exist is ignored', () => {
  const { pinned, rest } = orderRepos([repo('a')], ['ghost', 'a']);
  assert.deepEqual(pinned.map((r) => r.name), ['a']);
  assert.deepEqual(rest, []);
});

test('facets list every language but only topics that group repos', () => {
  const repos = [
    repo('a', { language: 'Python', topics: ['shared', 'lonely'] }),
    repo('b', { language: 'Python', topics: ['shared'] }),
    repo('c', { language: 'Go', topics: ['solo'] }),
    repo('d', { language: null, topics: [] }),
  ];
  const chips = facets(repos);
  assert.deepEqual(
    chips.filter((c) => c.kind === 'language'),
    [{ kind: 'language', value: 'Python', count: 2 }, { kind: 'language', value: 'Go', count: 1 }],
  );
  assert.deepEqual(chips.filter((c) => c.kind === 'topic').map((c) => c.value), ['shared']);
});

test('the topic chip list is capped', () => {
  const topics = Array.from({ length: 30 }, (_, i) => `t${i}`);
  const repos = [repo('a', { topics }), repo('b', { topics })];
  const chips = facets(repos).filter((c) => c.kind === 'topic');
  assert.equal(chips.length, FACET_LIMITS.maxTopics);
});

test('matchesFilter handles languages, topics and the null "all" filter', () => {
  const r = repo('a', { language: 'Go', topics: ['cli'] });
  assert.equal(matchesFilter(r, null), true);
  assert.equal(matchesFilter(r, { kind: 'language', value: 'Go' }), true);
  assert.equal(matchesFilter(r, { kind: 'language', value: 'Rust' }), false);
  assert.equal(matchesFilter(r, { kind: 'topic', value: 'cli' }), true);
  assert.equal(matchesFilter(r, { kind: 'topic', value: 'web' }), false);
  assert.equal(matchesFilter(repo('b', { topics: undefined }), { kind: 'topic', value: 'x' }), false);
});

test('languageColor is a fixed palette with a neutral default', () => {
  assert.equal(languageColor('JavaScript'), '#f1e05a');
  assert.equal(languageColor('Brainfuck'), '#9aa0a6');
  assert.equal(languageColor(null), '#9aa0a6');
});
