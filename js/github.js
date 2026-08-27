// github.js — unauthenticated GitHub REST access with a hard request budget.
//
// The anonymous API allows 60 requests per hour per IP, so every call this
// module makes is counted against a per-session budget and refused locally once
// the budget is spent. The caps mirror the plan's rate contract:
//
//   repo list  ≤ 2 calls (per_page=100 + one `Link: next` page)
//   README     ≤ 20 calls (lazy, viewport-driven, KO mode only)
//   session    ≤ 22 calls total
//
// READMEs come from the REST readme endpoint with `Accept: …raw`, never from
// raw.githubusercontent.com — that keeps the CSP `connect-src` exception down
// to a single host.

export const API_ROOT = 'https://api.github.com';

export const BUDGET = Object.freeze({ list: 2, readme: 20, total: 22 });

/** Fields copied off a raw API repo object. Everything else is discarded. */
export const REPO_FIELDS = Object.freeze([
  'name',
  'description',
  'language',
  'stargazers_count',
  'pushed_at',
  'homepage',
  'topics',
  'fork',
  'archived',
  'html_url',
]);

/** The session request budget is spent; nothing was sent over the network. */
export class BudgetExceededError extends Error {
  constructor(kind) {
    super(`showfolio request budget exhausted (${kind})`);
    this.name = 'BudgetExceededError';
    this.kind = kind;
  }
}

/** GitHub answered 403 with `X-RateLimit-Remaining: 0`. */
export class RateLimitedError extends Error {
  constructor(resetAt) {
    super('GitHub API rate limit reached for this IP');
    this.name = 'RateLimitedError';
    this.resetAt = resetAt ?? null;
  }
}

/** Any other non-OK response. */
export class GitHubError extends Error {
  constructor(status, message) {
    super(message || `GitHub API error ${status}`);
    this.name = 'GitHubError';
    this.status = status;
  }
}

const str = (value) => (typeof value === 'string' ? value : null);

/**
 * Copy only the whitelisted fields off a raw API repo, with coerced types.
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>|null}
 */
export function mapRepo(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string') return null;
  return {
    name: raw.name,
    description: str(raw.description),
    language: str(raw.language),
    stargazers_count: Number.isFinite(raw.stargazers_count) ? raw.stargazers_count : 0,
    pushed_at: str(raw.pushed_at),
    homepage: str(raw.homepage),
    topics: Array.isArray(raw.topics) ? raw.topics.filter((t) => typeof t === 'string') : [],
    fork: raw.fork === true,
    archived: raw.archived === true,
    html_url: str(raw.html_url),
  };
}

/**
 * Drop forks, archived repos and configured exclusions.
 * @param {Array<Record<string, unknown>>} repos mapped repos
 * @param {string[]} exclude repo names, matched case-insensitively
 */
export function filterRepos(repos, exclude = []) {
  const denied = new Set(exclude.map((name) => String(name).toLowerCase()));
  return repos.filter(
    (repo) => !repo.fork && !repo.archived && !denied.has(repo.name.toLowerCase()),
  );
}

/** Parse a `Link` header and return the `rel="next"` URL, if any. */
export function nextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

/** Shape check for a committed data/snapshot.json. */
export function validateSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.username !== 'string' || value.username.length === 0) return false;
  if (typeof value.generated !== 'string' || Number.isNaN(Date.parse(value.generated))) return false;
  if (!Array.isArray(value.repos)) return false;
  return value.repos.every((repo) => repo && typeof repo === 'object' && typeof repo.name === 'string');
}

function classify(response) {
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers?.get?.('X-RateLimit-Remaining');
    if (remaining === '0' || response.status === 429) {
      return new RateLimitedError(response.headers?.get?.('X-RateLimit-Reset'));
    }
  }
  return new GitHubError(response.status);
}

/**
 * Build a budgeted GitHub client. `fetch` is injectable so tests never touch
 * the network.
 * @param {{fetch?: typeof globalThis.fetch, budget?: typeof BUDGET}} [options]
 */
export function createClient(options = {}) {
  const doFetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const budget = { ...BUDGET, ...(options.budget ?? {}) };
  const used = { list: 0, readme: 0, total: 0 };

  function spend(kind) {
    if (used[kind] >= budget[kind] || used.total >= budget.total) {
      throw new BudgetExceededError(kind);
    }
    used[kind] += 1;
    used.total += 1;
  }

  async function request(url, headers) {
    const response = await doFetch(url, { headers });
    if (!response.ok) throw classify(response);
    return response;
  }

  /**
   * List a user's public repos, newest push first.
   * @returns {Promise<{repos: Array<Record<string, unknown>>, truncated: boolean}>}
   */
  async function listRepos(username, { exclude = [] } = {}) {
    const encoded = encodeURIComponent(username);
    let url = `${API_ROOT}/users/${encoded}/repos?per_page=100&sort=pushed`;
    const collected = [];
    let truncated = false;

    while (url) {
      spend('list');
      const response = await request(url, { Accept: 'application/vnd.github+json' });
      const page = await response.json();
      if (!Array.isArray(page)) throw new GitHubError(response.status, 'unexpected list payload');
      for (const raw of page) {
        const mapped = mapRepo(raw);
        if (mapped) collected.push(mapped);
      }
      const next = nextPageUrl(response.headers?.get?.('Link'));
      if (!next) break;
      if (used.list >= budget.list) {
        truncated = true; // "showing first 200" — the budget stops us here.
        break;
      }
      url = next;
    }

    return { repos: filterRepos(collected, exclude), truncated };
  }

  /**
   * Fetch a repo README as raw text. Returns null when the repo has none.
   * @returns {Promise<string|null>}
   */
  async function fetchReadme(username, repo) {
    spend('readme');
    const url = `${API_ROOT}/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo)}/readme`;
    const response = await doFetch(url, { headers: { Accept: 'application/vnd.github.raw' } });
    if (response.status === 404) return null;
    if (!response.ok) throw classify(response);
    return response.text();
  }

  return {
    listRepos,
    fetchReadme,
    budget,
    usage: () => ({ ...used }),
    remaining: () => ({
      list: Math.max(0, budget.list - used.list),
      readme: Math.max(0, Math.min(budget.readme - used.readme, budget.total - used.total)),
    }),
  };
}

export default createClient;
