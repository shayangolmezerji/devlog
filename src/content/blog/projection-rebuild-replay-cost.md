---
title: "The projection rebuild and what replay costs"
description: "Outline. Rebuilding menu projections from the event log, and measuring replay instead of assuming it is cheap."
date: 2026-09-22
tags: [event-sourcing, menu-events]
draft: true
---

To be written from merged code in `menu-events/`. Numbers in this post
come from measured runs, not estimates.

## When a projection has to be rebuilt

## The rebuild path as implemented

## What replay costs

Measured: event count, wall time, where it degrades. Same for a
cold start and an incremental catch-up.

## Snapshot or not

## Failure modes seen in tests
