import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractKoreanSummary, summaryFor, SUMMARY_MAX_LENGTH } from '../js/summary.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, 'fixtures', name), 'utf8');

test('variant 1: bold marker with a trailing "full Korean doc" aside', () => {
  const summary = extractKoreanSummary(fixture('readme-with-aside.md'));
  assert.ok(summary.startsWith('Claude Code의 동작 원리'));
  assert.ok(summary.endsWith('전환할 수 있습니다.'), summary);
  assert.doesNotMatch(summary, /전체 한국어 문서/);
  assert.doesNotMatch(summary, /README_KOR/);
});

test('variant 2: bold marker, no trailing aside', () => {
  const summary = extractKoreanSummary(fixture('readme-plain.md'));
  assert.equal(
    summary,
    '셀프호스트 칸반 TODO 보드입니다 — 코어는 외부 의존성 제로, 원하면 켜는(opt-in) AI 에이전트 러너를 붙일 수 있습니다.',
  );
});

test('variant 3: __underscore__ marker, colon separator, multiline continuation', () => {
  const summary = extractKoreanSummary(fixture('readme-multiline.md'));
  assert.ok(summary.startsWith('유아용 터치 색칠 PWA입니다'));
  assert.ok(summary.includes('올리면 됩니다.'), summary);
  assert.doesNotMatch(summary, /전체 한국어 문서/);
  // The second, unrelated blockquote must not bleed into the summary.
  assert.doesNotMatch(summary, /Live demo/);
  // Continuation lines are joined with a single space, never a newline.
  assert.doesNotMatch(summary, /\n/);
});

test('a README without the block yields null (description fallback)', () => {
  assert.equal(extractKoreanSummary(fixture('readme-none.md')), null);
});

test('empty, missing and non-string inputs yield null', () => {
  assert.equal(extractKoreanSummary(''), null);
  assert.equal(extractKoreanSummary(null), null);
  assert.equal(extractKoreanSummary(undefined), null);
  assert.equal(extractKoreanSummary(42), null);
});

test('markdown decoration is stripped to plain text', () => {
  const summary = extractKoreanSummary('> **한글 요약** — `code` and **bold** and [link](https://x.dev)');
  assert.equal(summary, 'code and bold and link');
});

test('a missing separator is tolerated', () => {
  assert.equal(extractKoreanSummary('> **한글 요약** 구분자 없음'), '구분자 없음');
});

test('only the first summary block is used', () => {
  const md = '> **한글 요약** — 첫 번째\n\nbody\n\n> **한글 요약** — 두 번째\n';
  assert.equal(extractKoreanSummary(md), '첫 번째');
});

test('the summary is capped at 500 characters', () => {
  const long = '가'.repeat(900);
  const summary = extractKoreanSummary(`> **한글 요약** — ${long}`);
  assert.equal(summary.length, SUMMARY_MAX_LENGTH);
  assert.ok(summary.endsWith('…'));
});

test('an empty summary body falls through to null', () => {
  assert.equal(extractKoreanSummary('> **한글 요약** —\n\ntext'), null);
});

test('summaryFor picks description in EN and summaryKo in KO', () => {
  const repo = { description: 'An English description', summaryKo: '한글 요약문' };
  assert.equal(summaryFor(repo, 'en'), 'An English description');
  assert.equal(summaryFor(repo, 'ko'), '한글 요약문');
});

test('summaryFor falls back to description when no Korean summary exists', () => {
  assert.equal(summaryFor({ description: 'only EN', summaryKo: null }, 'ko'), 'only EN');
  assert.equal(summaryFor({ description: 'only EN', summaryKo: '  ' }, 'ko'), 'only EN');
  assert.equal(summaryFor({ description: null, summaryKo: null }, 'ko'), '');
});
