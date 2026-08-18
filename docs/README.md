# Docs index

This directory contains the primary documentation for the repository.

## Start here

- [Architecture Overview](./Architecture%20Overview.md) — high-level design and layering
- [Getting Started](./onboarding/Getting-Started.md) — build, test, and run the demo
- [Testing Guide](./Testing%20Guide.md) — testing philosophy and commands

## Deploying

- [Serverless Deployment Guide](./Serverless%20Deployment%20Guide.md) — deploying to per-request runtimes (Cloudflare Workers + Hyperdrive worked example, with pointers for AWS Lambda, Vercel, Deno, Bun)

## Architecture deep dives

- [ADRs](./architecture%20docs/adrs/) — decisions (append-only)
- [Subsystems](./architecture%20docs/subsystems/) — deeper technical guides by subsystem
- [Package Layering](./architecture%20docs/Package-Layering.md) — package boundaries and import constraints

## Reference

- [Glossary](./glossary.md) — user-facing terminology (source of truth for naming)
- [Error reference](./reference/error-reference.md) — every published `NAMESPACE.SUBCODE` error code; completeness enforced by `pnpm check:error-reference`
- [Commands](./commands/README.md) — command docs and entry points
- [Reference docs](./reference/) — conventions and patterns used across the codebase
- [Codec authoring guide](./reference/codec-authoring-guide.md) — class-based codecs (`CodecImpl`, `CodecDescriptorImpl`) and column helpers
- [Integer representation types](./reference/integer-representation-types.md) — choosing `BigInt`, `BigIntNumber`, or `UnboundedInt` by target, storage, application value, and aggregate behavior
- [PostgreSQL temporal types](./reference/postgres-temporal-types.md) — choosing a `Temporal` or a raw-string representation for `date`, `timestamp`, `timestamptz`, and `time`, and what the Temporal global is required for
- [Aggregate descriptor guide](./reference/aggregate-descriptor-guide.md) — how a target or extension declares aggregate operations and their result codecs (`SqlAggregateDescriptor` on `types.aggregateDescriptors`)
- [Mongo Pipeline Builder](./reference/Mongo%20Pipeline%20Builder.md) — typed builder for MongoDB aggregation pipelines, reads, writes, and find-and-modify
- [`migration graph --tree` rendering](./reference/migration-graph-rendering.md) — condensed annotated-tree rendering for offline migration topology
- [Why Prisma Next only supports externally-managed native Postgres enums](./reference/postgres-native-enums.md) — the rewrite/atomicity costs behind managed native enums being create/add-value-only
- [CLI Style Guide](./CLI%20Style%20Guide.md) — CLI UX conventions

## Working with AI agents

- [Cursor Cloud Agents](./onboarding/Cursor-Cloud-Agents.md) — how cloud agents run against this repo, where config lives, how to change it, how to debug a failed run

## OSS posture

- [OSS posture overview](./oss/README.md) — index of governance, supply-chain, and contribution policies
- [Governance](./oss/governance.md) — maintainer team, decision-making, DCO basis
- [Supply chain](./oss/supply-chain.md) — license validation, NOTICE audit, npm provenance, Dependabot cooldown
- [Versioning](./oss/versioning.md) — source of truth, lockstep, dist-tag convention, release procedure
- [Supported Versions](./Supported%20Versions.md) — minimum Node, TypeScript, PostgreSQL, MongoDB, Bun, Deno versions
- [Telemetry](./Telemetry.md) — what the CLI collects, the user-level config file, env-var opt-outs, the `init` consent prompt, agent detection

