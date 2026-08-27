# Contributing to showfolio

Thanks for your interest. This is a small project with a deliberately small
surface, so the most useful contributions are usually **bug fixes**, **failure
paths nobody thought of**, and **making it work for accounts that do not look
like the author's**.

Before opening a PR, read [the three rules](#three-rules-that-are-not-negotiable)
below. Everything else here is ordinary.

## Development setup

No build step, no runtime dependencies.

```bash
npm ci                              # installs @playwright/test, the only dev dep
npm run serve                       # python3 static server on 6186

npm test                            # node --test — the fast gate
npx playwright install chromium     # once
npx playwright test                 # e2e (boots its own static server)
```

`index.html` cannot be opened as a `file://` URL — it loads ES modules, which
browsers refuse over that scheme. Use the server.

Two scripts exist for maintenance rather than for the app:

```bash
npm run snapshot                    # regenerate data/snapshot.json (hits the live API)
node scripts/shots.mjs              # regenerate docs/shots/*.png
```

## Three rules that are not negotiable

### 1. Tests never touch the network

Both suites are fully mocked, and that is a property to preserve, not an
accident to work around.

- **Unit tests** inject a fake `fetch` into `createClient({ fetch })`. If you
  add a module that fetches, give it the same injection point.
- **E2E tests** intercept `api.github.com` with `page.route()` and answer from
  fixtures in `e2e/helpers.mjs`.

Two reasons this matters. First, CI runs on a shared GitHub Actions IP with a
60-requests-per-hour anonymous budget — a live suite would be flaky in a way
that has nothing to do with your change. Second, half of what is worth testing
is failure: you cannot ask GitHub for a 403 with `X-RateLimit-Remaining: 0`, or
for a truncated `Link` header, or for a corrupt payload, but you can mock all
three.

A PR that makes any test reach `api.github.com` will be asked to change.

### 2. No `innerHTML`, no inline styles, no third-party hosts

- **Every string that came off the network is written with `textContent`.** The
  project currently contains zero assignments to `innerHTML` and zero calls to
  `insertAdjacentHTML`, and the e2e XSS probe depends on that staying true.
- **Every URL that came off the network goes through `safeUrl()`** before it
  becomes an `href`. No exceptions, including for URLs that "obviously" come
  from GitHub.
- **No `style="…"` attributes and no per-component stylesheets.** Every style is
  a reusable class in the global `css/style.css`. The one dynamic value — the
  language dot colour — is set as a CSS custom property from a hard-coded table,
  never from a network string.
- **Nothing loads from a host other than the two documented CSP exceptions**
  (`api.github.com`, `avatars.githubusercontent.com`). No CDN, no web font, no
  analytics. If a change needs a third host, it needs a design discussion first,
  because the exception list is the security story.

If you change the CSP, change it in **both** places — the `<meta>` tag in
`index.html` and the header in `vercel.json` — and update the rationale in
[SECURITY.md](SECURITY.md). Two policies that disagree are worse than one that
is wrong.

### 3. The request budget is a contract

`js/github.js` caps a session at 2 list calls + 20 README calls = 22 total, and
refuses the next request locally rather than sending it. A visitor's 60/hour is
shared with every other tab they have open, so this cap protects them, not us.

Raising a cap is a real change with a real argument behind it, not a convenient
fix for a test that ran out of budget. Both the cap and the refusal behaviour
are unit-tested; if you change them, change the tests deliberately and say why
in the PR.

## Where things live

```
index.html            the shell, the CSP meta tag, and three <template>s
css/style.css         every style, globally, as reusable classes
js/config.js          THE file a user edits: username, exclude, pinned, demoOverrides
js/github.js          API access, the request budget, field whitelist, error classes
js/summary.js         the Korean-summary blockquote parser
js/cache.js           localStorage TTL cache, defensive on every read
js/cards.js           repo record → DOM, filter facets, URL scheme checks
js/i18n.js            every user-facing string, in both locales
js/app.js             boot order, live refresh, lazy README hydration
data/snapshot.json    the committed offline first paint
scripts/snapshot.mjs  regenerates it (live API, maintainer's machine)
scripts/shots.mjs     regenerates the README screenshots
scripts/set-homepages.mjs   maintainer utility, dry-run by default
tests/  e2e/          node --test  ·  Playwright, chromium
docs/SIMILAR-TOOLS.md the honest comparison; keep it dated and sourced
```

**UI text belongs in `js/i18n.js`, in both locales.** A string added to one
locale only is an incomplete change. Repo names, descriptions and Korean
summaries are *data*, not UI text — they come from the API and are never
translated.

## Adding a language

The EN/KO pair is not hard-coded as deeply as it looks:

1. Add a locale object to `TEXT` in `js/i18n.js` with every key the existing two
   have, and widen `normalizeLocale()`.
2. Add a button to the `.locale` group in `index.html`.
3. If the new locale should read summaries out of READMEs, adjust the `HEADING`
   regular expression in `js/summary.js` — it is one pattern, and the
   surrounding parser (continuation lines, trailing parenthetical, 500-character
   cap) is language-agnostic.
4. Add fixtures under `tests/fixtures/` for the new summary format, and a test.

The one place with a genuine two-locale assumption is date formatting in
`js/cards.js`, which picks between `ko-KR` and `en-GB`. A third locale wants
that to become a map.

## Code conventions

- **Keep files small.** A source file over ~300 lines, or a function over ~50,
  wants splitting.
- **Comment the *why*, not the *what*.** The existing headers explain why the
  budget exists, why the READMEs come from the REST endpoint, why the boot order
  is what it is. That is the standard.
- **JSDoc on exported functions**, with types. There is no TypeScript here, so
  the annotations are the type information.
- **Add or update tests** in `tests/` or `e2e/` for every behaviour change.
- **Do not commit `data/snapshot.json` for an account other than the
  repository's** unless the change is *about* the snapshot. It is data, and a
  regenerated snapshot in an unrelated PR is noise in the diff.

## Pull requests

Keep PRs focused on one change. Say what changed and how you verified it, and
make sure `npm test` and `npx playwright test` are both green before opening.
CI runs the unit suite and the Playwright suite on Node 22 and chromium; both
must pass.

If your change affects something a user reads — the config shape, the boot
order, the budget, the CSP — update the README **and** README_KOR in the same
PR. The two are kept faithful to each other, and a README that describes an
older version of the behaviour is a bug report waiting to happen.

## Reporting a security issue

Not here. See [SECURITY.md](SECURITY.md) — private advisories, not public
issues.
