# devlog

Static developer blog. Astro content collections, no JavaScript
shipped to the reader.

Three posts are published: two about decisions in `menu-events/`
(event sourcing a price change under concurrent writes, and what a
projection rebuild actually costs) and one about `linux-recovery/`
(making a firewall-rewriting watchdog testable without root). The
rules for what may be published are in `docs/editorial.md`.

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

`push` to `main` builds and publishes via `withastro/action@v6`, the
workflow from the [official guide](https://docs.astro.build/en/guides/deploy/github/).
On GitHub, set Settings -> Pages -> Source to GitHub Actions once.
`site` and `base` in `astro.config.mjs` assume the repo is published
as `shayangolmezerji/devlog`; if the name changes, `base` changes
with it.
