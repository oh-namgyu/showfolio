# Similar tools

showfolio is not the first tool that turns a GitHub username into a portfolio
page, and this file is the survey that says so. It exists so the README can
compare honestly instead of claiming novelty, and so a reader who wants a
different trade-off can find the right project quickly.

Surveyed **2026-08-27**. Everything below was read from the projects' own
repositories and sites on that date. Stars and dates go stale; the categories do
not.

---

## Same category — a site built from a GitHub account

| Project | What it is | Build step | New repo appears without a rebuild | Fetches the API in the browser | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| [gitfolio](https://github.com/imfunniee/gitfolio) | npm CLI — `gitfolio build <username>` generates a static portfolio and blog into `dist/` | Yes (CLI) | **No** — data is baked in at build time | No — the API is called during the build | **Archived** 2022-02-19, GPL-3.0 |
| [GitProfile](https://github.com/arifszn/gitprofile) | React + Vite portfolio template; you set your username in `gitprofile.config.ts` and deploy the built SPA | Yes (Vite) | **Yes** — the repo list is fetched client-side | Yes | Active (last push 2026-08-18), MIT, 37 themes |
| **showfolio** | Static ES modules, no bundler; edit `js/config.js`, deploy the folder | **No** | **Yes** | Yes, after a snapshot-driven first paint | This repository, MIT |

**Reading the table.** The interesting axis is not "static vs. dynamic" — it is
*when the data is decided*.

- **gitfolio decides at build time.** That is genuinely faster to serve and
  works with no API access at all, but a repo you publish on Tuesday is absent
  until you rebuild and redeploy. The project has been archived since February
  2022.
- **GitProfile decides at request time**, like showfolio: a new repo shows up on
  the next visit. It is the closest comparison by behaviour. The difference is
  in what happens when the request fails, and in what a card says.
- **showfolio decides at both**, in that order — a committed snapshot paints
  first, then a live call replaces it. The snapshot is why a rate-limited or
  offline visitor still sees a full grid instead of an error, and it is why the
  first paint costs zero third-party requests.

## Adjacent category — profile README generators

These produce **markdown you paste into your profile README**, not a hosted
site. They are frequently suggested in the same breath as the tools above, so
they are listed here to be ruled out rather than compared:

- [github-profile-readme-generator](https://github.com/rahuldkjain/github-profile-readme-generator) — a web form that emits badges, stats cards and skill lists. Active, Apache-2.0.
- [github-profilinator](https://github.com/rishavanand/github-profilinator) — GUI blocks composed into README markdown. Archived (last push 2025-04-08), MIT.
- [GPRM](https://gprm.itsvg.in/) — hosted README maker. Site live; repository activity not checked.

`github.com/topics/portfolio-generator` and `topics/developer-portfolio` hold a
large number of hand-edited personal templates. Those are a genre rather than a
comparable project, and are not surveyed individually.

---

## What showfolio does that the surveyed tools do not

Stated as a survey result, not as a claim about every tool that exists.

1. **Summaries parsed out of each repo's README.** Every tool surveyed uses the
   GitHub API's `description` field and nothing more. showfolio reads the repo's
   README through the API and pulls the `> **한글 요약** — …` blockquote out of
   it, so a card can carry a real paragraph the author wrote rather than a
   one-line description squeezed into GitHub's About box. (GitProfile pulls in
   Medium/Dev.to posts — external article feeds, not README parsing.)
2. **Bilingual cards.** None of the surveyed tools advertise bilingual output.
   showfolio renders English from `description` and Korean from the parsed
   summary, switchable per visitor.
3. **A committed offline snapshot as the fallback path.** GitProfile ships a
   PWA service worker, which caches *assets*; it is not a data fallback, and a
   first-time visitor who hits the anonymous rate limit gets nothing. showfolio
   commits `data/snapshot.json` and paints from it before any external request,
   so rate limiting degrades the page from "live" to "as of the snapshot"
   instead of to an error.
4. **No build step at all.** GitProfile needs a Vite build to deploy; gitfolio
   needs its CLI. showfolio is the folder — `git clone`, edit one file, upload.

None of these are novel *ideas*, and none of them are claimed to be. The
combination is what this project is; if any of the four matters less to you than
themes, stats cards or a blog section, GitProfile is the better tool and is
actively maintained.

## Deliberately out of scope

Things the tools above do that showfolio does not, so the comparison stays even:
contribution graphs and stats cards, blog-post feeds, multiple visual themes,
resume/CV sections, and any authenticated data (GraphQL, private repos, pinned
repos as configured on GitHub — showfolio's "pinned" is its own config list).
