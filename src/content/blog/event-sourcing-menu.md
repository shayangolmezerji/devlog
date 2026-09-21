---
title: "Event sourcing a menu when the log is append-only and prices change"
description: "Outline. How the menu-events event store treats a price change when the log itself never rewrites."
date: 2026-09-22
tags: [event-sourcing, menu-events]
draft: true
---

To be written from merged code in `menu-events/`. The prose lands only
after the implementation it describes exists.

## The decision in one line

## Why the log is append-only

## What "the price changed" means as an event

## Correction versus new event

## What the read model does with each

## What we gave up

Postgres and Redis instead of Go and Kafka, and which guarantees that
costs. Written against the tradeoff note in the repo's README.
