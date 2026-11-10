# ADR 005 — Thin Core, Fat Targets

> **Update — the hooks are removed.** The middleware hooks `beforeExecute` and `afterExecute` this ADR describes no longer exist, and `onError` is not part of the middleware interface: a failed statement ends with the `activityEnded` outcome `failed`. [ADR 271](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities%2C%20each%20started%2C%20ended%20and%20finalized.md) replaced them with lifecycle events and interceptors on a tree of activities. `beforeCompile` remains.

## Context

- Prisma 7 intertwined cross-cutting logic with dialect details, making changes risky and contributions difficult
- We need a small, stable center that defines contracts and lifecycle semantics, while pushing dialect and engine specifics to replaceable adapters
- The design must support SQL family today and a Mongo family later without inventing an over-abstract common denominator

## Decision

Adopt a thin core, fat targets architecture:

- **Core** provides stable types, lifecycle, and verification primitives, but no database-specific behavior
- **Targets** implement dialect or engine specifics behind well-defined adapter interfaces
- **Capabilities** are declared by adapters and drive conditional behavior rather than hardcoded branches in core
- **Extensions** are namespaced to the target to avoid polluting the core schema

## Details

### Core responsibilities

- Data contract schema and hashing (coreHash, profileHash)
- Deterministic emission and canonicalization
- Plan model and immutability guarantees
- Runtime pipeline and plugin hooks (beforeCompile, beforeExecute, afterExecute, onError)
- Error taxonomy, diagnostics envelope, redaction and policy levels
- Conformance test harness and adapter interface definitions
- Tooling surfaces for dev-time emit and CI preflight

### Target responsibilities

- Scalar codecs and type mappings (e.g., int4 → number, jsonb → unknown)
- Storage constructs and constraints (tables, indexes, FK for SQL; collections, indexes for Mongo)
- Capability flags and feature gates (e.g., lateral, jsonAgg, concurrentIndex, vector)
- Lowerers from lane ASTs to executable statements or opsets
- Migration operation executors and phased strategies per engine
- Preflight analyzers and advisors tailored to the target
- Optional policy packs and lints that depend on target semantics

### Packaging model

- `@prisma/core` minimal shared utilities, contracts, plan types, runtime kernel
- `@prisma/contract` contract schema, validators, diff, hashing
- `@prisma/runtime` core execution pipeline and plugin API
- `@prisma/sql` relational DSL and AST
- `@prisma/adapter-pg`, `@prisma/adapter-mysql`, `@prisma/adapter-sqlite` SQL family adapters
- `@prisma/adapter-mongo` document family adapter
- `@prisma/migrate-sql` planner for relational targets, with `@prisma/migrate-pg` executors
- `@prisma/preflight` engine-agnostic envelope with target-specific analyzers registered by adapters

### Contract extension shape

- Core contract defines models, mappings, and a neutral storage description
- Targets extend under a namespaced `capabilities` and `storage.extensions.<target>` section
- Adapters register validators for their extension fields
- coreHash excludes target extensions that do not change meaning, while profileHash includes them

### Runtime integration

- Adapters register with the runtime: codecs, lowerers, executors, analyzers, and capability flags
- Plugins can declare target affinity and receive adapter metadata for conditional checks
- No adapter code is imported by core packages directly, only through interfaces

### Conformance and quality gates

- Contract conformance suite per target
- Golden tests for AST → SQL lowering and plan hashing
- Migration executor suite for transactional, phased, and failure scenarios
- Capability matrix published and versioned per adapter

## Alternatives considered

- **One grand unified abstraction that hides SQL vs document differences**: Simplifies APIs but collapses useful power and becomes the lowest common denominator
- **Keep everything in one package with if (dialect) branches**: Faster to start but creates tight coupling and slows evolution
- **Push everything into adapters including plan and runtime semantics**: Maximally flexible but loses a coherent platform and safety guarantees

## Consequences

### Positive

- Clear separation of concerns and smaller blast radius for changes
- Easier community contributions focused on adapters and plugins
- Independent evolution of targets without destabilizing core
- PPg can ship platform features by enriching the Postgres adapter without touching core

### Trade-offs

- Some cross-target features will be duplicated in adapters
- Requires a documented compatibility matrix and stricter conformance tests
- More packages to version and release

## Scope and non-goals

### In scope for MVP

- Postgres adapter with capabilities and lowerers
- Adapter interfaces for codecs, lowering, migration executors, and preflight analyzers
- Conformance tests and capability flags honored by core

### Out of scope for MVP

- Full MySQL/SQLite adapters and Mongo family
- A unified ORM layer that guarantees identical ergonomics across SQL and Mongo

## Backwards compatibility and migration

- Prisma 7 projects can adopt the new runtime and SQL DSL incrementally while keeping existing databases
- TypedSQL lane continues to work through a plan factory backed by the target adapter
- No expectation of feature parity with Prisma 7, but equivalent utility is the goal

## Open questions

- Error code namespace split between core and adapters
- Versioning policy for capability flags and extension fields
- Ordering of plugin execution relative to adapter analyzers
- How to expose adapter-specific diagnostics in a consistent developer experience

## Decision record

- Keep the core minimal and stable, focused on contracts, plans, runtime lifecycle, and verification
- Move dialect and engine specifics into fat target adapters with explicit capability flags and extension points
- Enforce this boundary in code ownership, package layout, and conformance tests
