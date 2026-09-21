# Editorial rules

The point of this blog is depth on four repos, not volume.

## What gets published

- One post per architecture decision. A decision, its alternatives,
  what it cost.
- Only after the code it describes is merged in the repo it names.
  Drafts build locally and never reach the site.
- Numbers come from measured runs. No estimates presented as
  measurements.

## Voice

- Plain. State what it does, not why it is amazing.
- No hype, no emoji, short sentences.
- No "in today's fast-paced world" openings, no sign-off
  paragraphs.

## Code

- Every code block must run when copied. If it cannot be made to
  run, it is pseudocode and gets labelled as such.
- Commands shown with their real output.

## Workflow

1. Write against merged code, front matter `draft: true`.
2. `npm run dev`, read it rendered.
3. Flip `draft`, build, reread the built HTML once.
4. Commit. The workflow publishes on push to `main`.

A post that has to describe code that does not exist yet is not late,
it is wrong. Leave it a draft.
