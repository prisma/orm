# Governance

This page describes how Prisma 8 is governed today. It is deliberately descriptive of the current reality rather than aspirational — projects with one team and a small contributor base do not benefit from formal governance theatre. Expect this to evolve as the contributor base grows; that evolution will be written down here when it happens.

## Maintainer team

Prisma 8 is maintained by [`@prisma/ORM-TS-Maintain`](https://github.com/orgs/prisma/teams/orm-ts-maintain) — a single GitHub team that owns the entire codebase via a flat [`CODEOWNERS`](../../.github/CODEOWNERS) rule. Subsystem-level ownership rules may be introduced later as the team grows; for now, one team owns everything.

Membership in the maintainer team is at Prisma's discretion. There is no documented progression path from external contributor to maintainer at this time.

## Decision-making

Decisions are reached by **maintainer consensus on the relevant PR or issue thread**. There is no formal "lazy consensus" 72-hour silence-equals-assent rule — concretely, a maintainer reviews and approves, and that's the merge signal. CODEOWNERS enforces that at least one approving review from the maintainer team is required to merge to `main`.

Architectural decisions — anything that changes the system's design, public surface, or cross-cutting behaviour — are recorded as **Architecture Decision Records** (ADRs) under [`docs/architecture docs/adrs/`](../architecture%20docs/adrs/). ADRs are append-only and serve as the durable record of *why* something was done. If a decision is contentious, large, or affects how external consumers will use Prisma 8, write an ADR; if a decision is small and local, a PR description is sufficient.

## Contributor provenance

Prisma 8 uses the [Developer Certificate of Origin (DCO) 1.1](https://developercertificate.org/), not a Contributor License Agreement. Every commit on a PR must include a `Signed-off-by:` trailer matching the commit author. The full mechanics are in [`CONTRIBUTING.md`](../../CONTRIBUTING.md#developer-certificate-of-origin-dco).

DCO was chosen over CLA because it is the lightweight standard used by Linux, Kubernetes, and a large fraction of the modern OSS ecosystem; it lowers contribution friction without giving up the legal grounding we need.

## License

Prisma 8 is licensed under [Apache-2.0](../../LICENSE). All publishable workspace packages declare `"license": "Apache-2.0"` in their `package.json`; this is enforced in CI. See [`supply-chain.md`](./supply-chain.md) for the validation details and the Apache-2.0 §4(d) NOTICE-propagation audit.

## Release-candidate status

Prisma 8 ships as a release candidate ahead of `8.0.0` final. The practical implications for contributors and consumers are described in [`CONTRIBUTING.md`](../../CONTRIBUTING.md#status--please-read-first) and [`SECURITY.md`](../../SECURITY.md).

## Code of Conduct

Participation is governed by the [Code of Conduct](../../CODE_OF_CONDUCT.md). Reporting channels are documented there.
