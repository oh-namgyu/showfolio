// summary.js — extract the Korean summary blockquote from a README.
//
// House convention (the format this parser targets):
//
//   > **한글 요약** — 한 문단 소개. *(전체 한국어 문서: [README_KOR.md](README_KOR.md))*
//
// Tolerated variants: `__한글 요약__` / plain `한글 요약`, `—` / `–` / `-` / `:`
// separators, a missing separator, extra blockquote continuation lines, and a
// missing trailing "full Korean doc" parenthetical. Anything else → null, and
// the caller falls back to the repo description.

export const SUMMARY_MAX_LENGTH = 500;

// `> **한글 요약** — rest`. The bold markers and the separator are optional.
const HEADING = /^\s*>\s*(?:\*\*|__)?\s*한글\s*요약\s*(?:\*\*|__)?\s*(?:[—–:-]+\s*)?(.*)$/;

// A blockquote continuation line: `> more text` (a bare `>` ends the quote).
const QUOTE_LINE = /^\s*>\s?(.*)$/;

// Trailing italic parenthetical, e.g. `*(전체 한국어 문서: [README_KOR.md](…))*`.
// The inner text may itself contain `)`, so match to the last `)*`.
const TRAILING_ASIDE = /\s*\*\([\s\S]*\)\*\s*$/;

const MD_LINK = /\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g;
const MD_IMAGE = /!\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g;
const MD_EMPHASIS = /(\*\*|__|`)/g;

/**
 * Strip markdown decoration down to readable plain text.
 * @param {string} text
 * @returns {string}
 */
function stripMarkdown(text) {
  return text
    .replace(MD_IMAGE, '$1')
    .replace(MD_LINK, '$1')
    .replace(MD_EMPHASIS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cap the summary at SUMMARY_MAX_LENGTH characters, ellipsis included.
 * @param {string} text
 * @returns {string}
 */
function cap(text) {
  if (text.length <= SUMMARY_MAX_LENGTH) return text;
  return `${text.slice(0, SUMMARY_MAX_LENGTH - 1).trimEnd()}…`;
}

/**
 * Extract the first `> **한글 요약** — …` blockquote from a README body.
 * @param {string|null|undefined} markdown raw README text
 * @returns {string|null} plain-text summary, or null when absent
 */
export function extractKoreanSummary(markdown) {
  if (typeof markdown !== 'string' || markdown.length === 0) return null;

  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => HEADING.test(line));
  if (start === -1) return null;

  const parts = [];
  const first = lines[start].match(HEADING)[1].trim();
  if (first) parts.push(first);

  // Absorb continuation lines until the blockquote ends.
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = lines[i].match(QUOTE_LINE);
    if (!match) break;
    const body = match[1].trim();
    if (!body) break;
    parts.push(body);
  }

  const joined = parts.join(' ').replace(TRAILING_ASIDE, '');
  const text = cap(stripMarkdown(joined));
  return text.length > 0 ? text : null;
}

/**
 * Pick the text a card shows for a given locale.
 * @param {{description?: string|null, summaryKo?: string|null}} repo
 * @param {'en'|'ko'} locale
 * @returns {string} possibly empty, never null
 */
export function summaryFor(repo, locale) {
  const description = typeof repo?.description === 'string' ? repo.description : '';
  if (locale !== 'ko') return description;
  const ko = typeof repo?.summaryKo === 'string' ? repo.summaryKo.trim() : '';
  return ko || description;
}

export default extractKoreanSummary;
