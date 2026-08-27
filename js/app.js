// app.js — boot order is the contract.
//
//   1. load the same-origin snapshot and render the grid COMPLETELY
//   2. only then schedule the live GitHub fetch
//
// Step 2 never starts before step 1 has finished, so the first paint costs zero
// third-party requests. `document.body.dataset.ready` flips to "true" at the
// end of step 1, which is what the e2e request log asserts against.

import { config } from './config.js';
import { createClient, validateSnapshot, RateLimitedError, BudgetExceededError } from './github.js';
import { createCache, listKey, readmeKey } from './cache.js';
import { extractKoreanSummary } from './summary.js';
import { orderRepos, facets, matchesFilter, renderGrid, renderSkeleton, renderChips } from './cards.js';
import { TEXT, readLocale, writeLocale } from './i18n.js';

const $ = (selector) => document.querySelector(selector);

const dom = {
  avatar: $('[data-avatar]'), profile: $('[data-profile]'), accountName: $('[data-account-name]'),
  accountSub: $('.account-sub'), locale: $('.locale'), status: $('[data-status]'),
  badge: $('[data-badge]'), caption: $('[data-caption]'), chips: $('[data-chips]'),
  pinnedSection: $('[data-section="pinned"]'), pinnedTitle: $('[data-section="pinned"] .section-title'),
  pinnedGrid: $('[data-grid="pinned"]'), allTitle: $('[data-all-title]'), allGrid: $('[data-grid="all"]'),
  empty: $('[data-empty]'), guidance: $('[data-guidance]'), guidanceText: $('[data-guidance-text]'),
  guidanceLink: $('[data-guidance-link]'),
  tplCard: $('#tpl-card'), tplSkeleton: $('#tpl-skeleton'), tplChip: $('#tpl-chip'),
};

const client = createClient();
const cache = createCache();

const state = { repos: [], locale: 'en', filter: null, added: 0, truncated: false };

const t = () => TEXT[state.locale];

// ------------------------------------------------------------------ rendering

function paint() {
  const ctx = { template: dom.tplCard, locale: state.locale, overrides: config.demoOverrides ?? {} };
  const visible = state.repos.filter((repo) => matchesFilter(repo, state.filter));
  const { pinned, rest } = orderRepos(visible, config.pinned ?? []);

  dom.pinnedSection.hidden = pinned.length === 0;
  dom.pinnedTitle.textContent = t().pinned;
  renderGrid(dom.pinnedGrid, pinned, ctx);

  dom.allTitle.textContent = t().repos;
  renderGrid(dom.allGrid, rest, ctx);

  dom.allGrid.setAttribute('aria-busy', 'false');
  renderChips(dom.chips, facets(state.repos), state.filter, dom.tplChip, t().all);
  dom.empty.hidden = visible.length > 0;
  dom.empty.textContent = t().empty;
  dom.accountSub.textContent = t().sub;
  document.documentElement.lang = state.locale;

  // Double failure — no local copy and the live call failed. Never a blank page.
  if (state.repos.length === 0 && document.body.dataset.live === 'error') {
    showGuidance(t().blocked(config.username));
  } else {
    dom.guidance.hidden = true;
  }
}

let lastStatus = null;

function setStatus(make) {
  // `make` is a function of the locale table so a locale switch can re-render it.
  lastStatus = typeof make === 'function' ? make : () => make ?? {};
  const { badge = '', caption = '' } = lastStatus(t());
  dom.badge.hidden = !badge;
  dom.badge.textContent = badge;
  dom.caption.textContent = caption;
  dom.status.hidden = !badge && !caption;
}

function restateStatus() {
  if (lastStatus) setStatus(lastStatus);
}

function showGuidance(message) {
  dom.allGrid.setAttribute('aria-busy', 'false');
  dom.guidanceText.textContent = message;
  dom.guidance.hidden = false;
  dom.pinnedSection.hidden = true;
  dom.allGrid.replaceChildren();
  dom.empty.hidden = true;
}

function renderHeader() {
  const user = config.username;
  dom.accountName.textContent = user;
  dom.profile.href = `https://github.com/${encodeURIComponent(user)}`;
  dom.guidanceLink.href = dom.profile.href;
  dom.avatar.src = `https://avatars.githubusercontent.com/${encodeURIComponent(user)}?size=96`;
  dom.avatar.alt = `${user}’s avatar`;
  dom.avatar.hidden = false;
  dom.avatar.addEventListener('error', () => { dom.avatar.hidden = true; }, { once: true });
  document.title = `${user} — showfolio`;
}

// --------------------------------------------------------------- data sources

/** Read the committed snapshot. Optional: missing, corrupt or foreign → null. */
async function loadSnapshot() {
  try {
    const response = await fetch('data/snapshot.json', { cache: 'no-cache' });
    if (!response.ok) return null;
    const snapshot = await response.json();
    if (!validateSnapshot(snapshot)) return null;
    if (snapshot.username !== config.username) return null; // a forked snapshot
    return snapshot.repos;
  } catch {
    return null; // absent file or unparseable JSON — fall through to live
  }
}

/** Fill in summaries already sitting in the on-device README cache. */
function withCachedSummaries(repos) {
  return repos.map((repo) => ({
    ...repo,
    summaryKo: repo.summaryKo ?? cache.get(readmeKey(repo.name)) ?? null,
  }));
}

/** Carry known Korean summaries over onto a freshly fetched list. */
function mergeSummaries(fresh) {
  const known = new Map(state.repos.map((repo) => [repo.name, repo.summaryKo]));
  return withCachedSummaries(fresh.map((repo) => ({ ...repo, summaryKo: known.get(repo.name) ?? null })));
}

function countAdded(fresh) {
  const before = new Set(state.repos.map((repo) => repo.name));
  return fresh.filter((repo) => !before.has(repo.name)).length;
}

// --------------------------------------------------------------- live refresh

async function refresh() {
  document.body.dataset.live = 'pending';
  try {
    const { repos, truncated } = await client.listRepos(config.username, { exclude: config.exclude ?? [] });
    const merged = mergeSummaries(repos);
    // "new since the snapshot" only means something when there was a baseline.
    state.added = state.repos.length > 0 ? countAdded(merged) : 0;
    state.truncated = truncated;
    state.repos = merged;
    cache.set(listKey(config.username), merged);
    document.body.dataset.live = 'ok';
    paint();
    setStatus((txt) => ({
      badge: txt.live,
      caption: [state.added > 0 ? txt.added(state.added) : '', truncated ? txt.truncated : '']
        .filter(Boolean).join(' · '),
    }));
    lazyReadmes();
  } catch (error) {
    onRefreshFailure(error);
  }
}

function onRefreshFailure(error) {
  const limited = error instanceof RateLimitedError || error instanceof BudgetExceededError;
  const haveLocalCopy = state.repos.length > 0;
  document.body.dataset.live = haveLocalCopy ? 'stale' : 'error';
  setStatus((txt) => ({ caption: limited ? txt.ratelimited : txt.offline }));
  // Snapshot or cache already on screen? Keep it. Otherwise explain, don't blank.
  if (!haveLocalCopy) showGuidance(t().blocked(config.username));
}

// ------------------------------------------------- lazy README (KO mode only)

let observer = null;

function lazyReadmes() {
  observer?.disconnect();
  if (state.locale !== 'ko' || typeof IntersectionObserver !== 'function') return;

  const pending = new Set(
    state.repos.filter((repo) => !repo.summaryKo).map((repo) => repo.name),
  );
  if (pending.size === 0) return;

  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const name = entry.target.dataset.repo;
      observer.unobserve(entry.target);
      if (pending.delete(name)) void hydrateSummary(name);
    }
  }, { rootMargin: '120px' });

  for (const card of document.querySelectorAll('[data-repo]')) {
    if (pending.has(card.dataset.repo)) observer.observe(card);
  }
}

async function hydrateSummary(name) {
  if (client.remaining().readme <= 0) return; // budget spent — stay silent
  let summary = null;
  try {
    summary = extractKoreanSummary(await client.fetchReadme(config.username, name));
  } catch {
    return; // rate limit or network: the description fallback already shows
  }
  if (!summary) return;
  cache.set(readmeKey(name), summary);
  const repo = state.repos.find((item) => item.name === name);
  if (!repo) return;
  repo.summaryKo = summary;
  const card = document.querySelector(`[data-repo="${CSS.escape(name)}"] [data-summary]`);
  if (card) {
    card.textContent = summary;
    card.classList.remove('is-muted');
  }
}

// ------------------------------------------------------------------ listeners

dom.locale.addEventListener('click', (event) => {
  const button = event.target.closest('[data-locale]');
  if (!button) return;
  state.locale = button.dataset.locale === 'ko' ? 'ko' : 'en';
  writeLocale(state.locale);
  for (const btn of dom.locale.querySelectorAll('[data-locale]')) {
    btn.setAttribute('aria-pressed', btn.dataset.locale === state.locale ? 'true' : 'false');
  }
  paint();
  restateStatus();
  lazyReadmes();
});

dom.chips.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-chip]');
  if (!chip) return;
  state.filter = chip.dataset.kind === 'all' ? null : { kind: chip.dataset.kind, value: chip.dataset.value };
  paint();
});

// ----------------------------------------------------------------------- boot

/** Run `fn` strictly after the browser has painted the current DOM. */
function afterPaint(fn) {
  const idle = globalThis.requestIdleCallback ?? ((cb) => setTimeout(cb, 0));
  requestAnimationFrame(() => idle(() => fn(), { timeout: 800 }));
}

async function boot() {
  state.locale = readLocale();
  for (const btn of dom.locale.querySelectorAll('[data-locale]')) {
    btn.setAttribute('aria-pressed', btn.dataset.locale === state.locale ? 'true' : 'false');
  }
  renderHeader();

  // Local sources only — both are same-origin or on-device.
  const cached = cache.get(listKey(config.username));
  const fromCache = Array.isArray(cached) && cached.length > 0;
  const repos = fromCache ? cached : await loadSnapshot();

  if (repos && repos.length > 0) {
    state.repos = withCachedSummaries(repos);
    document.body.dataset.source = fromCache ? 'cache' : 'snapshot';
    paint();
  } else {
    document.body.dataset.source = 'skeleton';
    dom.allGrid.setAttribute('aria-busy', 'true');
    renderSkeleton(dom.allGrid, dom.tplSkeleton);
  }

  document.body.dataset.live = 'idle';
  document.body.dataset.ready = 'true'; // first paint complete — nothing external yet

  if (fromCache) {
    // The cached list is still inside its TTL: spend no budget on a re-fetch.
    document.body.dataset.live = 'cached';
    setStatus((txt) => ({ badge: txt.cached }));
    afterPaint(lazyReadmes);
    return;
  }
  afterPaint(refresh);
}

boot();
