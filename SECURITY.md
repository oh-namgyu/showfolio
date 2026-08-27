# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.x (latest on `main`) | :white_check_mark: |
| older commits          | :x:                |

showfolio is pre-1.0. Only the latest state of the default branch receives
fixes; a fix is a commit plus a redeploy of the static files.

## Reporting a vulnerability

Please report security issues **privately** through
[GitHub Security Advisories](https://github.com/oh-namgyu/showfolio/security/advisories/new)
on this repository. Do not open a public issue for a sensitive report. You can
expect an initial response within a few days.

Two kinds of report are especially welcome, because they are the two the design
depends on: **a way to get untrusted API data into the DOM as markup rather than
as text**, and **a way to make the page load from a host outside the two
documented CSP exceptions**.

## Threat model

showfolio is a **static site**. There is no server of ours, no backend, no
database, no account, no API key and no secret of any kind. Everything ships as
HTML, CSS and ES modules that run entirely in the visitor's browser.

That removes most of the usual surface and leaves two things worth writing down:

1. **The page renders data it does not control.** Repository descriptions, topic
   names, homepage URLs and README text all come from the GitHub API. They are
   public, but they are authored by whoever owns the account being displayed —
   and if you fork this for your own account, by anyone whose repo you list. The
   page treats all of it as hostile input.
2. **The page talks to a third party.** Two hosts, both `github.com`
   subdomains, both documented below. Everything else is blocked by policy.

## What the app does not do

- **No data collection.** No analytics, no telemetry, no cookies, no beacons, no
  error reporting service. Nothing about a visitor is transmitted anywhere —
  including to us. The only outbound requests are the GitHub API calls listed
  below, made by the visitor's browser directly to GitHub.
- **No server.** There is no endpoint to attack, no session, no authentication,
  no file upload, no user-supplied URL fetching.
- **No credentials.** The GitHub API is called **unauthenticated**. There is no
  token in the client, no token in the repository, and no place to put one. The
  optional `GITHUB_TOKEN` read by `scripts/snapshot.mjs` is an environment
  variable on the maintainer's own machine, used only to raise the rate limit
  while generating the snapshot; it is never written into any committed file.
- **No user accounts and no user content.** A visitor cannot author anything.
  The only input is which filter chip and which language they clicked.

## Content-Security-Policy — the two exceptions, and why

The base policy is:

```
default-src 'self'; base-uri 'none'; form-action 'none';
object-src 'none'; frame-ancestors 'none'
```

It ships **twice**: as a `<meta http-equiv>` tag in `index.html`, which covers
opening the folder on any static host that sends no headers, and as a real
response header in `vercel.json`, which is the one that actually counts on a
deploy. **The two must stay identical** — a change to one is a change to both,
and the comment in `index.html` says so.

Two hosts are allowed, no more:

### `connect-src https://api.github.com`

This is the entire point of the project: the repo list
(`/users/<user>/repos`) and the README bodies (`/repos/<user>/<repo>/readme`)
are fetched at runtime, which is what makes a newly published repo appear
without a redeploy.

**Why one host and not two.** A README can also be read from
`https://raw.githubusercontent.com/...`, and that is the more common approach.
showfolio deliberately uses the REST `/readme` endpoint with
`Accept: application/vnd.github.raw` instead, so the `connect-src` exception
covers **one** host rather than two. The REST endpoint has a second advantage:
it resolves whatever the README is actually called (`README.rst`,
`readme.markdown`, …) instead of guessing a filename.

**What the exception does not permit.** `api.github.com` serves only JSON and
raw text to these two endpoints. It cannot return a script that this policy
would execute: `script-src` is still `'self'`, so even a compromised response
body is inert data. The exception widens where the app may *read* from, never
what it may *run*.

### `img-src 'self' data: https://avatars.githubusercontent.com`

One image: the account avatar in the header, at a fixed URL derived from
`config.username`. If it fails to load, the `error` handler hides the element
and the page is otherwise unchanged. `data:` is present for the inline SVG
favicon.

Avatars are user-uploaded images, so the risk is the generic one for any remote
image — a malformed file exploiting an image decoder. It is bounded by
`object-src 'none'` and by the fact that an image cannot execute script under
this policy. Hosting the avatar yourself is a reasonable hardening step for a
fork: replace the `<img>` src in `js/app.js` with a local file and drop the
exception.

### What stays closed

`script-src` and `style-src` remain `'self'`. There is **no inline script and no
inline style** anywhere in the project — a rule enforced by convention and
relied on by the CSP, since neither `'unsafe-inline'` nor a nonce is present. No
CDN, no web font, no analytics domain, no frame. `base-uri 'none'` prevents a
`<base>` tag redirecting relative URLs; `form-action 'none'` because there are
no forms; `frame-ancestors 'none'` blocks clickjacking.

## Handling of external data

Everything the API returns is treated as hostile text:

- **Field whitelist.** `mapRepo()` in `js/github.js` copies exactly ten named
  fields off each API object and coerces their types. A field GitHub adds later
  — or an unexpected object shape — cannot reach the rest of the app, because
  nothing else is copied.
- **`textContent` only.** Repo names, descriptions, Korean summaries, topics and
  language names are written with `textContent`. **The project contains no
  assignment to `innerHTML` and no `insertAdjacentHTML`.** Markup in a
  description renders as the literal characters a visitor would see in a text
  editor; this is asserted by an end-to-end XSS probe that feeds a mocked
  response containing `<script>` and `<img onerror=…>` payloads.
- **URL scheme validation.** `safeUrl()` in `js/cards.js` parses every candidate
  link and returns it only for `http:` and `https:`. A repo whose `homepage` is
  `javascript:alert(1)` renders no Demo button at all — the value never becomes
  an `href`.
- **No dynamic style from data.** The one value derived from API data that
  touches CSS is the language dot colour, and it is a lookup into a hard-coded
  table in `js/cards.js`, never the network string itself.
- **`rel="noopener noreferrer"`** on every outbound link, all of which open in a
  new tab.

## Local storage

Three kinds of key, all prefixed `showfolio:`:

| Key | Contents | Lifetime |
| :--- | :--- | :--- |
| `showfolio:list:<username>` | The last fetched repo list | 1 hour TTL |
| `showfolio:readme:<repo>` | One parsed Korean summary | 1 hour TTL |
| `showfolio:locale` | `"en"` or `"ko"` | until cleared |

All of it is public data that was already on screen. Nothing personal is stored,
nothing is ever read by anything but the page itself, and clearing site data
removes it completely. Every read is defensive: corrupt JSON, a stale schema
version, an expired timestamp or a storage backend that throws (private mode,
quota exhausted) all degrade to a cache miss rather than an exception.

## Rate limiting as a safety property

The anonymous GitHub API allows 60 requests per hour **per IP**, shared with
every other site the visitor has open. A page that retries freely can exhaust
someone else's budget, so the client enforces a hard per-session cap of 22
requests (2 list + 20 README) and refuses the 23rd **locally, before opening a
connection**. This is a courtesy to the visitor rather than a defence of the
app, but it is the reason a bug in showfolio cannot turn into a burst of traffic
at GitHub or into a broken GitHub experience elsewhere in the visitor's browser.

## Supply chain

- **Runtime dependencies: none.** Nothing is bundled, vendored or fetched at
  runtime. What you read in `js/` is what the browser runs.
- **Development dependency: one** — `@playwright/test`, used by the e2e suite,
  the screenshot script and CI. It never reaches a visitor's browser.
- **CI makes no live GitHub API data calls.** Both suites are fully mocked, so a
  compromised or throttled API cannot make CI lie in either direction.
- Dependabot watches npm and GitHub Actions weekly. Auto-merge is limited to
  patch and minor updates; major updates stay manual.

## Known limitations

- **Deployment headers beyond the ones in `vercel.json` are the deployer's
  responsibility.** HSTS and anything else your host adds come from your hosting
  configuration.
- **The meta CSP is a fallback, not equal to the header.** `frame-ancestors` is
  ignored in a `<meta>` tag by specification. On a host that sends no CSP header
  the page is protected in every other respect but can be framed; deploy with
  the header (or the equivalent `X-Frame-Options`) if that matters to you.
- **The displayed data is only as trustworthy as the account displayed.**
  showfolio renders what GitHub returns for the configured username. It does not
  and cannot verify that a repo is what its description says it is, and the Demo
  button points wherever the repo's `homepage` field points. Set
  `demoOverrides` if you want to control that yourself.
- **A wrong-looking page is not a vulnerability.** A rendering bug, a stale
  snapshot or a mis-parsed summary is an issue, not an advisory. Report those
  publicly; they get fixed faster that way.
