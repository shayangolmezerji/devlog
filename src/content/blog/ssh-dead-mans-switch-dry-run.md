---
title: "A dead man's switch for SSH, and why dry-run made it testable"
description: "Outline. The linux-recovery access fallback, and how a dry-run mode turned an untestable safety net into a testable one."
date: 2026-09-22
tags: [systemd, linux-recovery]
draft: true
---

To be written from merged code in `linux-recovery/`. Tests are
`shellcheck` plus `bats`; the post describes what those actually cover.

## The failure the switch exists for

## The design as shipped

systemd units, the timer, what resets the man.

## Why dry-run came first

The part that made the behavior testable in CI without a locked-out
machine.

## What bats covers, and what it cannot

## The obvious objections
