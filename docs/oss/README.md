# OSS posture

This directory documents the **policies and posture** that govern Prisma 8 as an open-source project — how decisions are made, how dependencies are managed, how releases are produced, and how external contributions are handled.

These pages are written for maintainers and curious contributors who want to understand the *reasoning* behind a policy, not just the rule itself. Audience-facing documents that GitHub surfaces by convention — [`CONTRIBUTING.md`](../../CONTRIBUTING.md), [`SECURITY.md`](../../SECURITY.md), [`CODE_OF_CONDUCT.md`](../../CODE_OF_CONDUCT.md), [`LICENSE`](../../LICENSE) — remain the primary entry points for their respective audiences. The pages here cross-reference those files; they don't duplicate them.

## Audience map

| If you are… | Read… |
| --- | --- |
| A would-be contributor | [`CONTRIBUTING.md`](../../CONTRIBUTING.md) |
| Reporting a vulnerability | [`SECURITY.md`](../../SECURITY.md) |
| A current or prospective maintainer | [Governance](./governance.md) |
| Triaging incoming contributor PRs | [PR triage](./pr-triage.md) |
| Curious about supply-chain hygiene | [Supply chain](./supply-chain.md) |
| Wondering how PR CI is structured for cost | [PR CI pipeline](./ci-pipeline.md) |
| Reasoning about the version contract (consumer or extension author) | [Versioning](./versioning.md) |
| Cutting a release (or auditing how) | [Versioning](./versioning.md) |

## Pages in this directory

- [`governance.md`](./governance.md) — Maintainer team, decision-making model, DCO basis, ADR pointer.
- [`supply-chain.md`](./supply-chain.md) — License declarations, NOTICE audit, npm provenance, Dependabot soak window.
- [`ci-pipeline.md`](./ci-pipeline.md) — How PR CI builds once, caches deterministic tasks, and skips heavy work on inert diffs.
- [`pr-triage.md`](./pr-triage.md) — Criteria for triaging external contributor PRs: fork-CI safety, version-line scope, direction fit, staleness, and the verdict vocabulary.
- [`versioning.md`](./versioning.md) — Release-candidate cadence and breaking-change policy, lockstep contract (and what it means for skill/extension authors), dist-tag convention, release procedure.
