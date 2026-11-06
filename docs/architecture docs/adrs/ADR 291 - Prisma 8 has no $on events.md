# ADR 291 — Prisma 8 has no `$on` events

**Status:** Accepted
**Date:** 2026-10-22
**Builds on:** [ADR 271 — The runtime middleware observes a tree of activities, each started, ended and finalized](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities,%20each%20started,%20ended%20and%20finalized.md)

---

## Decision

Never. The runtime exposes one middleware interface that observes every activity, so a second event API in the core would duplicate it. Use instead: a small middleware on the lifecycle events. It sees each activity start, and end with its outcome: succeeded, failed or stopped ([ADR 271](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities,%20each%20started,%20ended%20and%20finalized.md)).

## Context

Prisma 7 subscribes to client events with `$on('query')`, `$on('info')`, `$on('warn')` or `$on('error')`. Will Madden decided on 2026-10-22, with the reason: "$on - never, middleware already covers tis".

## Consequences

Logging and event handling are written as middleware ([`prisma-8` skill, runtime.md](../../../skills/prisma-8/references/runtime.md)). No revisit-if condition is recorded.
