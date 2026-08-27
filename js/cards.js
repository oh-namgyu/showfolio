// cards.js — turn repo records into DOM. Every value that came off the network
// is written with textContent or a scheme-checked href; nothing is ever
// interpolated into HTML.

import { summaryFor } from './summary.js';

/** Language dot colours — the only chroma in the gallery-white theme. */
const LANGUAGE_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572a5', HTML: '#e34c26',
  CSS: '#563d7c', Shell: '#89e051', Go: '#00add8', Rust: '#dea584', Java: '#b07219',
  C: '#555555', 'C++': '#f34b7d', 'C#': '#178600', Ruby: '#701516', PHP: '#4f5d95',
  Swift: '#f05138', Kotlin: '#a97bff', Dart: '#00b4ab', Vue: '#41b883', Svelte: '#ff3e00',
  'Jupyter Notebook': '#da5b0b', Lua: '#000080', Haskell: '#5e5086', Elixir: '#6e4a7e',
  Scala: '#c22d40', R: '#198ce7', Perl: '#0298c3', Zig: '#ec915c', Nix: '#7e7eff',
  Makefile: '#427819', Dockerfile: '#384d54', SCSS: '#c6538c', Astro: '#ff5a03',
};
const DEFAULT_COLOR = '#9aa0a6';

export const languageColor = (language) => LANGUAGE_COLORS[language] ?? DEFAULT_COLOR;

/**
 * Accept only absolute http(s) URLs. Anything else — `javascript:`, `data:`,
 * a relative path, junk — becomes null and the button stays hidden.
 * @param {unknown} value
 * @returns {string|null}
 */
export function safeUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
}

/**
 * The live-demo URL for a repo: a config override wins over GitHub `homepage`.
 * @param {{name: string, homepage?: string|null}} repo
 * @param {Record<string, string>} overrides
 */
export function demoUrl(repo, overrides = {}) {
  return safeUrl(overrides[repo.name]) ?? safeUrl(repo.homepage);
}

/**
 * Split repos into the pinned section (config order) and the rest (newest push
 * first). Pinned names that do not exist are ignored.
 * @param {Array<Record<string, any>>} repos
 * @param {string[]} pinned
 */
export function orderRepos(repos, pinned = []) {
  const byName = new Map(repos.map((repo) => [repo.name, repo]));
  const featured = pinned.map((name) => byName.get(name)).filter(Boolean);
  const featuredNames = new Set(featured.map((repo) => repo.name));
  const rest = repos
    .filter((repo) => !featuredNames.has(repo.name))
    .sort((a, b) => Date.parse(b.pushed_at ?? 0) - Date.parse(a.pushed_at ?? 0));
  return { pinned: featured, rest };
}

// Accounts routinely carry 8 topics per repo, which would bury the grid under a
// hundred chips. Only topics shared by several repos actually group anything, so
// singletons are dropped and the tail is cut.
export const FACET_LIMITS = { minTopicCount: 2, maxTopics: 12 };

/**
 * Filter chips: every language, then the topics that group more than one repo.
 * @param {Array<Record<string, any>>} repos
 * @param {{minTopicCount?: number, maxTopics?: number}} [limits]
 * @returns {Array<{kind: 'language'|'topic', value: string, count: number}>}
 */
export function facets(repos, limits = FACET_LIMITS) {
  const { minTopicCount, maxTopics } = { ...FACET_LIMITS, ...limits };
  const languages = new Map();
  const topics = new Map();
  for (const repo of repos) {
    if (repo.language) languages.set(repo.language, (languages.get(repo.language) ?? 0) + 1);
    for (const topic of repo.topics ?? []) topics.set(topic, (topics.get(topic) ?? 0) + 1);
  }
  const toEntries = (map, kind) => [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ kind, value, count }));

  return [
    ...toEntries(languages, 'language'),
    ...toEntries(topics, 'topic').filter((e) => e.count >= minTopicCount).slice(0, maxTopics),
  ];
}

/** Does a repo match the active filter chip? */
export function matchesFilter(repo, filter) {
  if (!filter) return true;
  if (filter.kind === 'language') return repo.language === filter.value;
  return (repo.topics ?? []).includes(filter.value);
}

function formatDate(iso, locale) {
  const time = Date.parse(iso ?? '');
  if (Number.isNaN(time)) return '';
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-GB', {
    year: 'numeric', month: 'short', day: 'numeric',
  }).format(new Date(time));
}

/** Language dot, star count and updated date. */
function fillMeta(q, repo, locale) {
  if (repo.language) {
    q('[data-lang]').hidden = false;
    // A data value, not a style rule: every colour comes from LANGUAGE_COLORS,
    // never from the network. All actual styling lives in css/style.css.
    q('[data-dot]').style.setProperty('--dot', languageColor(repo.language));
    q('[data-lang-name]').textContent = repo.language;
  }

  const stars = q('[data-stars]');
  if (repo.stargazers_count > 0) {
    stars.hidden = false;
    stars.textContent = `★ ${repo.stargazers_count}`;
    stars.setAttribute('aria-label', `${repo.stargazers_count} stars`);
  }

  const updated = formatDate(repo.pushed_at, locale);
  if (updated) {
    q('[data-updated]').textContent = locale === 'ko' ? `${updated} 갱신` : `Updated ${updated}`;
  }
}

/** Demo and GitHub buttons, both scheme-checked. */
function fillActions(q, repo, ctx) {
  const demo = q('[data-demo]');
  const demoHref = demoUrl(repo, ctx.overrides);
  if (demoHref) {
    demo.hidden = false;
    demo.href = demoHref;
    demo.textContent = ctx.locale === 'ko' ? '데모' : 'Demo';
    demo.setAttribute('aria-label', `${repo.name} — live demo`);
  }

  const code = q('[data-code]');
  const codeHref = safeUrl(repo.html_url);
  if (codeHref) {
    code.href = codeHref;
    code.setAttribute('aria-label', `${repo.name} on GitHub`);
  } else {
    code.remove();
  }
}

/**
 * Build one card element.
 * @param {Record<string, any>} repo
 * @param {{template: HTMLTemplateElement, locale: string, overrides: Record<string, string>}} ctx
 */
export function buildCard(repo, ctx) {
  const node = ctx.template.content.firstElementChild.cloneNode(true);
  node.dataset.repo = repo.name;

  const q = (selector) => node.querySelector(selector);
  q('[data-name]').textContent = repo.name;

  const summary = summaryFor(repo, ctx.locale);
  const summaryEl = q('[data-summary]');
  summaryEl.textContent = summary || (ctx.locale === 'ko' ? '설명이 없습니다.' : 'No description.');
  summaryEl.classList.toggle('is-muted', !summary);

  fillMeta(q, repo, ctx.locale);
  fillActions(q, repo, ctx);
  return node;
}

/**
 * Replace a grid's contents with cards for `repos`.
 * @returns {number} how many cards were rendered
 */
export function renderGrid(grid, repos, ctx) {
  grid.replaceChildren(...repos.map((repo) => buildCard(repo, ctx)));
  return repos.length;
}

/**
 * Chunk an already-sorted repo list into push-month runs, newest first.
 * Repos without a parseable date share one trailing '' group.
 * @param {Array<Record<string, any>>} repos
 * @returns {Array<{key: string, repos: Array<Record<string, any>>}>}
 */
export function monthGroups(repos) {
  const dated = [];
  const undated = [];
  for (const repo of repos) {
    const time = Date.parse(repo.pushed_at ?? '');
    if (Number.isNaN(time)) { undated.push(repo); continue; }
    const key = new Date(time).toISOString().slice(0, 7); // YYYY-MM
    const last = dated[dated.length - 1];
    if (last && last.key === key) last.repos.push(repo);
    else dated.push({ key, repos: [repo] });
  }
  if (undated.length) dated.push({ key: '', repos: undated });
  return dated;
}

/** 'YYYY-MM' → 'August 2026' / '2026년 8월'. */
export function monthLabel(key, locale) {
  const time = Date.parse(`${key}-01T00:00:00Z`);
  if (Number.isNaN(time)) return '';
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-GB', {
    year: 'numeric', month: 'long', timeZone: 'UTC',
  }).format(new Date(time));
}

/**
 * Like renderGrid, but with a full-width month heading before each push-month
 * run. Headings are plain list items so the element keeps its single CSS grid
 * (the layout and every `[data-repo]` selector are unchanged).
 * @returns {number} how many cards were rendered
 */
export function renderGroupedGrid(grid, repos, ctx) {
  const nodes = [];
  for (const group of monthGroups(repos)) {
    const label = monthLabel(group.key, ctx.locale);
    if (label) {
      const head = document.createElement('li');
      head.className = 'group-head';
      head.dataset.month = group.key;
      const title = document.createElement('h3');
      title.className = 'group-title';
      title.textContent = label;
      head.append(title);
      nodes.push(head);
    }
    for (const repo of group.repos) nodes.push(buildCard(repo, ctx));
  }
  grid.replaceChildren(...nodes);
  return repos.length;
}

/** Fill a grid with placeholder cards while the live list is in flight. */
export function renderSkeleton(grid, template, count = 6) {
  const nodes = [];
  for (let i = 0; i < count; i += 1) nodes.push(template.content.firstElementChild.cloneNode(true));
  grid.replaceChildren(...nodes);
}

/**
 * Render the filter chips.
 * @param {HTMLElement} container
 * @param {ReturnType<typeof facets>} entries
 * @param {{kind: string, value: string}|null} active
 * @param {HTMLTemplateElement} template
 * @param {string} allLabel
 */
export function renderChips(container, entries, active, template, allLabel) {
  const make = (label, kind, value, pressed) => {
    const chip = template.content.firstElementChild.cloneNode(true);
    chip.textContent = label;
    chip.dataset.kind = kind;
    chip.dataset.value = value;
    chip.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    return chip;
  };
  const chips = [make(allLabel, 'all', '', !active)];
  for (const entry of entries) {
    const pressed = Boolean(active) && active.kind === entry.kind && active.value === entry.value;
    chips.push(make(entry.value, entry.kind, entry.value, pressed));
  }
  container.replaceChildren(...chips);
}
