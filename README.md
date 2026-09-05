# showfolio

[![CI](https://github.com/oh-namgyu/showfolio/actions/workflows/ci.yml/badge.svg)](https://github.com/oh-namgyu/showfolio/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![No build step](https://img.shields.io/badge/build-none-lightgrey.svg)](#development)

> **한글 요약** — GitHub 계정명 하나로 공개 repo 를 실시간으로 불러와 카드 그리드로 보여주는 정적 포트폴리오 쇼케이스입니다. 새 repo 를 공개하면 재배포 없이 자동으로 추가되고, 각 README 상단의 한글 요약 블록을 파싱해 한국어 카드 설명으로 씁니다. *(전체 한국어 문서: [README_KOR.md](README_KOR.md))*

A portfolio page for a GitHub account that you deploy once.

**Publish a new public repo and it is on the page — no rebuild, no redeploy, no
edit.** The grid is read from the GitHub API in the visitor's browser at the
moment they open it, so the page is never a stale copy of your account; it is a
view of it. The only thing you ever change is one config line with your
username.

Each card carries the repo's name, its description, language, stars, last push,
a **Demo** button when the repo has a homepage URL, and a link to the code.
Cards can be shown in two languages: English from the GitHub description, and
Korean from a summary block parsed out of the repo's own README (see
[the convention](#the-korean-summary-convention)).

It is a static site: no build step, no server, no API key, no account, no
runtime dependencies.

---

## Screenshots

| English — GitHub descriptions | Korean — summaries parsed from each README |
| :--- | :--- |
| ![Repository grid in English](docs/shots/home.png) | ![The same grid in Korean](docs/shots/home-ko.png) |

Both images come from `node scripts/shots.mjs`, which drives Chromium over the
committed snapshot data, so they can be regenerated instead of re-captured.

---

## Use it for your own account

Four steps, and only the second is required.

**1. Fork this repository** (or clone it — nothing here depends on the fork
relationship).

**2. Edit `js/config.js`.** It is the one file you touch, and `username` is the
one field you must set:

```js
export const config = {
  username: 'your-github-handle',   // required — everything else is optional
  exclude: ['dotfiles'],            // repo names to hide (forks and archived
                                    //   repos are dropped automatically)
  pinned: ['my-best-project'],      // featured above the grid, in this order
  demoOverrides: {},                // demo URLs for repos whose GitHub
                                    //   `homepage` field you cannot set
};
```

**3. Deal with the snapshot** — `data/snapshot.json`, the offline copy that
paints the first screen. It currently holds the original author's repos, which
are not yours. Two options:

```bash
npm run snapshot      # rewrites data/snapshot.json for your username — commit it
# or
rm data/snapshot.json # no snapshot: the page shows a skeleton and loads live
```

Either is correct. A foreign snapshot is not a third option, but it is also not
a failure mode: the app compares `snapshot.username` against `config.username`
and ignores a mismatch, so if you forget this step the page falls back to
loading live rather than showing someone else's repos.

**4. Deploy the folder** to any static host — Vercel, Netlify, GitHub Pages,
Cloudflare Pages, an S3 bucket, nginx. There is nothing to build. `vercel.json`
is included with the security headers already set; other hosts want the same
headers configured their own way.

---

## How it loads

The boot order is a contract, not an implementation detail, and the end-to-end
suite asserts it.

```
1. snapshot          data/snapshot.json  →  full grid rendered   (same-origin only)
2. live refresh      api.github.com      →  grid replaced, "updated live" badge
3. lazy READMEs      api.github.com      →  Korean summaries, viewport-driven
4. cache             localStorage, 1h    →  a revisit skips steps 2 and 3
```

**Step 1 finishes completely before step 2 begins.** The first paint therefore
costs zero third-party requests: the visitor sees the whole grid off a
same-origin JSON file, and only then does the page reach out to GitHub. This is
verified in the e2e suite from the browser's own request log, not from a code
comment.

**The request budget.** The GitHub API allows anonymous callers 60 requests per
hour per IP, shared across every site the visitor has open. showfolio therefore
caps itself, in code, at **22 requests per session**:

| | Cap | Why |
| :--- | :-- | :--- |
| Repo list | 2 | `per_page=100` plus one `Link: next` page — 200 repos |
| READMEs | 20 | Fetched lazily, only in Korean mode, only for cards you scroll to |
| **Session total** | **22** | Enforced by a counter that refuses the request locally |

Over budget, the client throws before opening a connection. It cannot be the
reason a visitor's limit is exhausted somewhere else.

**When it fails.** Every failure lands somewhere better than a blank page:

| Situation | What the visitor sees |
| :--- | :--- |
| Rate limited (403 with `X-RateLimit-Remaining: 0`) | The snapshot or cached grid, with a caption explaining the hourly limit |
| Network unreachable | The same, captioned "could not reach GitHub" |
| Snapshot missing, corrupt, or for a different username | Skipped silently; loads live with a skeleton |
| Both fail — no local copy *and* no live data | An explanation and a link to the GitHub profile, never an empty screen |
| A repo has no Korean summary | The English description, in both modes |

---

## The Korean-summary convention

This is a documented pattern, not a feature you have to adopt — but if you write
bilingual READMEs, it is worth knowing what showfolio looks for.

Put a blockquote near the top of a repo's `README.md`:

```markdown
> **한글 요약** — 한 문단 설명. *(전체 한국어 문서: [README_KOR.md](README_KOR.md))*
```

showfolio fetches the README through GitHub's `/readme` endpoint (which finds
the file whatever it is called), extracts the first such blockquote, strips the
markdown and the trailing "full Korean document" parenthetical, caps it at 500
characters, and uses it as the card's Korean text. Repos without one fall back
to the GitHub description, so mixing conventions across an account is fine.

The parser tolerates the variants people actually write: `**한글 요약**`,
`__한글 요약__` or plain `한글 요약`; `—`, `–`, `-`, `:` or no separator at all;
several continuation lines inside the same blockquote; and a missing trailing
link. Anything else is treated as absent rather than as an error.

**Adopting it for another language** is a one-line change in `js/summary.js` —
the heading pattern is a single regular expression. What makes the convention
useful is not the specific words: it is that the summary lives in the repo it
describes, so it is edited where the project is edited, and no second place
needs updating when a project changes.

---

## Similar tools

showfolio is not the first tool that builds a portfolio from a GitHub username,
and it does not claim to be. The full survey, dated and sourced, is in
[docs/SIMILAR-TOOLS.md](docs/SIMILAR-TOOLS.md); the short version:

| Project | Build step | New repo without a rebuild | Status |
| :--- | :--- | :--- | :--- |
| [gitfolio](https://github.com/imfunniee/gitfolio) | Yes — npm CLI bakes the data in | No | Archived since 2022 |
| [GitProfile](https://github.com/arifszn/gitprofile) | Yes — Vite/React build | Yes — fetches client-side | Actively maintained |
| **showfolio** | None | Yes | This repository |

Profile README generators such as
[github-profile-readme-generator](https://github.com/rahuldkjain/github-profile-readme-generator)
are an adjacent, different category: they emit markdown for your profile README
rather than a hosted site.

Of the tools surveyed, **none parse repo READMEs for summaries, none produce
bilingual cards, and none ship an offline data snapshot as a fallback.** That is
a survey result about four specific projects on one date — not a claim about
every tool that exists. If themes, stats cards or a blog section matter more to
you than those three things, GitProfile is the better tool and is actively
maintained.

---

## Security

The full policy is [SECURITY.md](SECURITY.md). The parts worth knowing before
you deploy it:

**No data collection.** No analytics, no telemetry, no cookies, no error
reporting. `localStorage` holds a cached repo list and your EN/KO choice, under
`showfolio:`-prefixed keys, and nothing leaves the browser.

**Two CSP exceptions, and only two.** The policy is `default-src 'self'`, with:

- **`connect-src https://api.github.com`** — the repo list and the README
  bodies. READMEs are read through the REST `/readme` endpoint with
  `Accept: application/vnd.github.raw` rather than from
  `raw.githubusercontent.com`, specifically so this exception stays at one host
  instead of two.
- **`img-src https://avatars.githubusercontent.com`** — the account avatar in
  the header, and nothing else. If the request fails the image hides itself.

`script-src` and `style-src` stay `'self'`. There is no inline script and no
inline style, so an injected third-party resource fails to load rather than
executing. The same policy ships twice — as a `<meta>` tag in `index.html` and
as a real response header in `vercel.json` — and the two are kept identical.

**Everything from the network is text.** Descriptions, Korean summaries, repo
names, topics and language names are written with `textContent`; the app never
assigns to `innerHTML`. API responses are copied field by field through a
whitelist, so a new field GitHub adds cannot reach the DOM. Demo and GitHub
links are parsed as URLs and rejected unless the scheme is `http:` or `https:`,
which is why a `javascript:` homepage renders no button.

---

## Development

```bash
npm ci                              # dev dependency: @playwright/test only
npm run serve                       # python3 static server on 6186
npm test                            # node --test — 57 unit tests
npx playwright install chromium     # once
npx playwright test                 # e2e — 47 tests, chromium
npm run snapshot                    # regenerate data/snapshot.json
node scripts/shots.mjs              # regenerate the screenshots above
```

Opening `index.html` from the filesystem does **not** work: the app is ES
modules, which browsers refuse to load over `file://`. Any static server will
do.

**Both suites are fully mocked. CI makes zero GitHub API data calls.** The unit
suite injects a fake `fetch` into the client; the e2e suite intercepts
`api.github.com` with Playwright routes and answers from fixtures. That is what
makes it safe to run the whole thing on every push — a rate limit shared with
whatever else runs on a GitHub Actions IP is not a test dependency you want —
and it is also the only way to test the failure paths, since you cannot ask
GitHub for a 403 on demand. The one thing mocks cannot prove is that the real
API still returns the shape we map; that is covered by running
`npm run snapshot` against the live API, which uses the same mapping code.

Runtime dependencies: none. What you read in `js/` is what the browser runs.

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and what a change needs
before it can be merged.

---

## License

MIT — see [LICENSE](LICENSE). Security policy: [SECURITY.md](SECURITY.md).
