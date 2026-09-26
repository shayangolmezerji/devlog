# devlog

Static developer blog. Astro content collections, no JavaScript
shipped to the reader.

Three posts are in the collection, none of them published: two
about decisions in `menu-events/` (event sourcing a price change
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
[official guide](https://docs.astro.build/en/guides/deploy/github/). It has run
once, on 2026-09-23, at `428b61b`, and it went red: `build` succeeded on a
GitHub-hosted Ubuntu runner and uploaded the Pages artifact, `deploy` failed at
`actions/deploy-pages` with HTTP 404 and the line `Ensure GitHub Pages has been
enabled`. `GET /repos/shayangolmezerji/devlog/pages` answers 404, so there is no
site behind the deployment.

This is an account limit, not a defect in the workflow. The repository is
private, and Pages serves a private repository only on a paid plan
([What is GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages));
`GET /user` on this account reports no plan. Until that changes, nothing reaches
a Pages URL: read the site with `npm run dev`, or from `dist/` after
`npm run build`.

`site` and `base` in `astro.config.mjs` assume the repo is published
as `shayangolmezerji/devlog`; if the name changes, `base` changes
with it.
