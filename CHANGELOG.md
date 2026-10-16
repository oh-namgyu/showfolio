# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-10-16

### Added

- The repository grid is grouped under push-month headings, localised to the
  selected language.

## [0.1.0] - 2026-08-27

Initial public release.

### Added

- A static, zero-build portfolio page for one GitHub account, configured by a
  single `username` in `js/config.js`, with optional `exclude`, `pinned` and
  `demoOverrides`. Forks and archived repositories are dropped automatically.
- Cards with name, description, language, stars, last push, a Demo button
  when the repository has a homepage URL, and a link to the code.
- Boot order: a same-origin `data/snapshot.json` paints the full grid first,
  then a live refresh from the GitHub API replaces it with an "updated live"
  badge. `npm run snapshot` regenerates the snapshot, and a snapshot for a
  different username is ignored.
- English and Korean cards. Korean text comes from the "한글 요약" summary
  blockquote parsed out of each repository's README, fetched lazily and capped
  at 500 characters, with the GitHub description as the fallback.
- A hard budget of 22 anonymous GitHub API requests per session (2 for the
  repository list, 20 for READMEs), refused locally once spent, and a one-hour
  `localStorage` cache.
- Fallbacks for rate limits, network failures and missing or corrupt
  snapshots, so the page never renders empty.
- Hardening: a `default-src 'self'` Content Security Policy with only
  `api.github.com` and the avatar host as exceptions, `textContent`-only
  rendering, field-by-field whitelisting of API responses and
  `http(s)`-only links.
- Unit and end-to-end suites that mock the GitHub API completely.
