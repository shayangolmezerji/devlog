# devlog

Static developer blog. Astro content collections, no JavaScript
shipped to the reader.

Three posts are planned, each about one architecture decision made in
the sibling repos (`menu-events/`, `linux-recovery/`). They are
outline drafts until the code they describe is merged. The rules for
what may be published are in `docs/editorial.md`.

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
.github/workflows/       Pages deploy, copied from the Astro docs
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
