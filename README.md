# devlog

Static developer blog. Astro content collections, no JavaScript
shipped to the reader.

Three posts are in the collection, all three live at
[shayangolmezerji.github.io/devlog](https://shayangolmezerji.github.io/devlog/):
two about decisions in `menu-events/` (event sourcing a price change
under concurrent writes, and what a projection rebuild actually
costs) and one about `linux-recovery/` (making a firewall-rewriting
watchdog testable without root). The rules for what may be
published are in `docs/editorial.md`.

## History

The scaffold landed as one batch: eight commits sharing the same second on
2026-09-22, covering the schema, the layouts, the workflow and the outline
drafts. Everything after that is one change per commit, minutes apart. Nothing a
post claims rests on the shape of this history, so it is stated here instead of
left for `git log` to look odd.

## Requirements

- Node.js. The Pages workflow builds on Node 24 by default.
- Astro 7.3.3, pinned in `package.json`. It is the only dependency.

## Running locally

```bash
npm install
npm run dev      # preview at http://localhost:4321/devlog/
npm run build    # static output in dist/
```

## Layout

```
src/content.config.ts    collection schema: title, description, date, tags, draft
src/content/blog/        one markdown file per post
src/pages/               index + blog/[...id]
src/layouts/base.astro   system fonts, 70ch measure, prefers-color-scheme
.github/workflows/       Pages deploy, upstream actions pinned to commits
```

## Front matter

```yaml
title: "..."
description: "..."
date: 2026-09-22
tags: [event-sourcing]
draft: true
```

Schema is enforced at build time in `src/content.config.ts`. Drafts
are excluded from the built site.

## Deployment

`push` to `main` runs `.github/workflows/deploy.yml`, the workflow from the
[official guide](https://docs.astro.build/en/guides/deploy/github/). Three of
its runs went red before this repository was public: `428b61b`, `7c2b1ce` and
`fdcb921`, runs `35934786115`, `36263223359` and `36270460794`. All three failed
the same way. `build` succeeded on a GitHub-hosted Ubuntu runner and uploaded the
`github-pages` artifact, `deploy` failed at `actions/deploy-pages` with HTTP
404 and the line `Ensure GitHub Pages has been enabled`, and
`GET /repos/shayangolmezerji/devlog/pages` answered 404 each time, so there was
no site behind the deployment.

The cause was the repository's visibility, not the workflow. Pages serves a
private repository only on a paid plan
([What is GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages))
and `GET /user` on this account reports no plan, so a private `devlog` had
nowhere to deploy to.

Making the repository public is the whole fix, and it is worth stating that
plainly because the red logs read like a build problem. `POST
/repos/shayangolmezerji/devlog/pages` with `build_type=workflow` created the
site and not one line of `deploy.yml` changed between the third failure and the
first success: run `36276843655` (`main` at `c06734c`) is green on both jobs,
and the index plus all three posts answer HTTP 200 at
<https://shayangolmezerji.github.io/devlog/>. Reading it locally still works,
`npm run dev` or `npm run build` into `dist/`.

`site` and `base` in `astro.config.mjs` assume the repo is published
as `shayangolmezerji/devlog`; if the name changes, `base` changes
with it.
