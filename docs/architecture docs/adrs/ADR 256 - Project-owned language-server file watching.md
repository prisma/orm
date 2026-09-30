# ADR 256 — Project-owned language-server file watching

**Status:** Accepted
**Date:** 2026-09-30

## Context

Schema diagnostics must change when another process edits a project member, even if no schema file is open in the editor. Checking disk metadata when an editor request reads a file cannot provide that behavior: without an editor request, the check never runs. Filesystem notifications therefore drive membership and content invalidation.

For example, a loaded project can configure `schemas/**/*.prisma` before the `schemas` directory exists:

```text
app/
  prisma.config.ts

external creation:
app/
  prisma.config.ts
  schemas/
    nested/
      user.prisma
```

The server observes a safe existing ancestor, discovers the new file through the configured input expansion, and reports diagnostics if its text carries `// use prisma-8`. Removing the file or its directory clears its previous report. No subsequent editor operation is required for push diagnostics. Pull clients receive a refresh request when supported and obtain updated reports on their next pull.

## Decision

A stable, concrete `Project` owns its watching lifecycle. `ProjectRegistry` discovers and routes projects; it does not own a separate watcher service hierarchy. Each project selects compatible, successfully registered client notifications or internal Chokidar 5 subscriptions. There is no third stat-on-read freshness mechanism and no polling.

The design follows four rules:

1. **Notifications drive disk freshness.** Immutable disk snapshots remain cached until explicit invalidation. Cache misses read normally; they are not a freshness fallback for already cached files.
2. **Editor buffers are authoritative.** Disk invalidation, readiness reconciliation, and reload never replace an unsaved overlay with disk text.
3. **Watching does not define membership.** Events trigger the existing `resolveSchemaInputs`/`expandContractInputs` path and the schema directive check. Watching a candidate does not make it a member.
4. **Watching failures do not disable editing.** Loading, analysis, and editor operations continue; warnings explain that external changes may be missed until project reload or server restart.

## Backend selection and startup

Client watching requires dynamic registration support and input patterns that the client watcher can safely represent: simple ASCII paths with ordinary `*`, `?`, or whole-segment `**` wildcards. Extended or uncertain syntax uses internal watching instead. The registration result must distinguish rejection from a successful void response even through the connection's disconnect guards.

A registration attempt has a 10-second deadline. Failure, absence of a registration handle, or timeout selects internal watching. A late successful registration is disposed rather than replacing the current backend. A successful compatible client registration does not retain a duplicate internal schema watcher.

Initial loading does not wait for either backend. When internal subscriptions become ready, the project evicts its disk snapshots and reconciles membership once. Successful client registration also schedules reconciliation. This accounts for text cached before notifications became available, without producing a diagnostic sweep for every file discovered during Chokidar's initial scan.

## Directory coverage and limits

Chokidar receives literal directories, not input globs. Positive patterns contribute their static directory prefix; literal files contribute their containing directory. Missing roots use their nearest safe existing ancestor, and equivalent or nested roots within one project are deduplicated. Consequently empty globs and future subdirectories are covered without enumerating only the files present at startup. Inputs outside the config directory remain supported when their roots are safe.

The owning config's directory is observed to survive atomic replacement. If schema roots do not already cover it, a shallow subscription watches that config rather than recursively observing the config tree. Internal events retain their owning project identity, including events for deleted files and inputs outside the config directory.

Coverage is deliberately conservative:

- Recursive watching of a filesystem root or UNC share root is refused.
- Dynamic patterns containing parent traversal are refused instead of deriving an unsafe root.
- Symbolic schema roots and symbolic ancestors are rejected. Encountered symlink paths are skipped and reported; subscriptions do not follow them. Input expansion can still read such files, but changes behind those links are not guaranteed to be observed.
- Internal watching covers already discovered projects and their owning config, not workspace-wide discovery of new configs or imported config dependencies.
- A client that successfully registers but silently loses notifications is not detected.

Filesystem metadata is used to choose safe existing watch roots, never to revalidate cached document text on reads.

## Events, reloads, and shutdown

Client and internal events enter the same per-project update path. A 50 ms delay from the latest observed event coalesces bursts and lets Chokidar's same-path change suppression window finish before content is read. Reading earlier could cache an intermediate write while the backend suppresses the final change notification. The batch invalidates affected disk snapshots, expands membership against current text, rebuilds analysis, and publishes or clears reports for the resulting membership. Directory deletion and atomic saves are interpreted from the final filesystem state, not as a requirement to publish every intermediate state. Events received during asynchronous work schedule another pass.

Membership sequences, resolved configuration identity, and watcher generations reject stale asynchronous work. Config events compare canonical filesystem identities, including Windows drive and UNC paths. Config reload explicitly discards project disk snapshots. Failed reloads can retain the last-good configuration and its analysis.

Reload must not stop observing the config while that config is being loaded. Previous internal subscriptions remain available for owning-config events until replacement coverage is ready; their schema callbacks are rejected as superseded. Repeated config replacements during consecutive asynchronous loads therefore schedule further loads rather than disappearing between subscriptions. Replacement readiness closes the retained subscriptions.

Closing the last editor document leaves the project and its watching active. Server shutdown and asynchronous disposal cancel queued batches and registration attempts, reject subsequent callbacks, and await closure of every owned Chokidar subscription, including subscriptions still starting or retained during replacement.

## Failure behavior and consequences

Internal initialization and active-watcher failures are logged. Working subscriptions are kept where possible, but a warning does not promise complete external freshness. Missed changes can remain cached until an explicit project/config reload or server restart. Setup is retried on reload, not in an automatic retry loop. Reload evicts cached disk content while preserving overlays.

Chokidar uses native watching with polling disabled. An environment override that would enable polling is rejected before paths are added. Watcher failures never select a stat fallback or suspend project analysis.

This choice trades guaranteed detection on unsupported filesystems for continued editing and a clear recovery action. Safe ancestor watching can cover more paths than the input glob matches; the existing membership resolver remains authoritative. Keeping old config observation until replacement readiness temporarily retains subscriptions, which the project owns and closes.

Diagnostic delivery remains exactly two modes: pull with related-document support, or push for every other client. The watching backend does not change that negotiation. Ownership of diagnostics for files shared by multiple projects is a separate concern and is unchanged.

## Alternatives considered

- **Stat-on-read revalidation:** cannot update a never-opened member without an editor request and would create a third freshness mechanism.
- **Polling after native-watcher failure:** adds recurring filesystem work and obscures the explicit failure/recovery policy.
- **Block analysis until watching succeeds:** makes editor operations unavailable because of notification infrastructure failures.
- **Watch only initially expanded files:** misses empty globs, future directories, and replacement membership.
- **Close old subscriptions before loading replacement configuration:** loses config edits during asynchronous loading.

## References

- [Language-server README](../../../packages/1-framework/3-tooling/language-server/README.md) — current membership, diagnostic delivery, and ownership reference.
- [Real filesystem/protocol tests](../../../packages/1-framework/3-tooling/language-server/test/server.internal-watcher.test.ts) — unopened members, empty globs, creation/deletion, config-input replacement, startup reconciliation, and shutdown.
- [Config changes during asynchronous loading](../../../packages/1-framework/3-tooling/language-server/test/project.config-watch.test.ts) — real atomic replacements across consecutive paused loads.
- [Deterministic lifecycle tests](../../../packages/1-framework/3-tooling/language-server/test/server.watch-cache.test.ts) — backend selection, registration outcomes, nonfatal failures, overlays, generations, batching, and disposal.
