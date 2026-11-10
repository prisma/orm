# ADR 169 — Declared applicability for mutation default generators

**Amended by [ADR 275](ADR%20275%20-%20Client%20generators%20are%20field%20attributes%2C%20and%20a%20type%20alias%20is%20expanded%20into%20each%20column.md):** applicability is still keyed by codec id, but it is declared on a binding of a generator function, not on the generator descriptor; `applicableCodecIds` is removed. A client generator is written `@onCreate(uuid(7))`, not `@default(uuid(7))`, and a default function lowers to a database default only.

## Context

Prisma Next supports **execution-time mutation defaults** via `execution.mutations.defaults` (ADR 158). These defaults reference generators by stable ids (for example `cuid2`, `uuidv4`), and the execution plane fills in omitted values during mutations.

We need a system-wide way to answer:

- For a given generator (or default function), **which column types does it apply to?**

This question matters for authoring surfaces and tooling:

- Vocabulary-driven authoring (PSL, and future declarative sources) must be able to validate applicability deterministically.
- TS-first authoring can remain permissive (escape hatches), but would benefit from optional validation and “suggest available defaults for this column” ergonomics.
- Runtime needs a consistent way to resolve generator ids to implementations, including extension-provided generators, without hardwiring behavior into one package.

## Problem

Historically, mutation default generators were imported and passed into TS column builders. We wanted to validate that a generator’s output is compatible with the backing column/codec.

One explored approach was to infer compatibility by reasoning about:

- SQL column type vs generator output type
- TypeScript types vs codec `encode` input types

In practice this becomes complicated quickly (type-level reasoning across codecs, dialect facets, parameterization, and narrowing), and risks producing brittle or misleading validation.

We want a simpler, deterministic approach that:

- avoids complex compatibility inference,
- keeps extension seams aligned with “compose, don’t configure”, and
- supports multiple authoring surfaces without special-casing PSL.

## Design constraints

- **No executable code in contracts**: contracts store references (ids), not implementations (ADR 158).
- **Deterministic, inspectable validation**: applicability rules must not depend on ad-hoc inference.
- **Composable**: extension packs should be able to add generators/default vocabulary without changing core/provider code.
- **Escape hatches remain**: TS-first authoring must remain able to express application-specific generators and defaults.

## Decision

### 1) Compatibility is declared, not inferred

We treat generator/column compatibility as **declared applicability** supplied by the generator contributor, not as something the system infers via type comparisons.

Contributors provide applicability metadata sufficient to validate “this generator id is valid for this column descriptor”.

In this initial implementation, applicability is keyed by `codecId` only.

### 2) Introduce a component-composed generator registry (execution-time)

Runtime resolves generator ids through a registry assembled from the composed runtime stack (target/adapter/extension packs).

- Built-ins are provided via normal component contributors (for example adapter/target contributors), not implicit runtime fallback wiring.
- Packs can add additional generator ids.

Missing generator ids referenced by a contract are a stable, targeted runtime error.

### 3) Mutation default descriptors are surface-agnostic; argument resolution is surface-specific

The shared registry describes **what mutation defaults are available** and **how to produce generator specs from validated parameters**. Each authoring surface adds its own argument parsing or method presentation on top.

A mutation default descriptor declares:

- identity: the generator id (e.g. `uuidv7`)
- applicability: which `codecId`s the default applies to
- parameter schema: what parameters the default accepts and their constraints
- spec production: given validated parameters, produce a storage default or execution generator spec
- type compatibility resolution: given the generator spec, resolve what column type the generator expects (used for validation in PSL and for column type derivation in TS authoring helpers)

This is the shared layer. It lives in SQL core, not in any authoring surface package.

Note: mutation default descriptors configure **defaults only** — they don't set the column type themselves. In PSL, the column type is declared separately (e.g. `id String @onCreate(uuid())`). (Amended 2026-10-22: `field.generated(...)` was removed by [ADR 275](ADR%20275%20-%20Client%20generators%20are%20field%20attributes%2C%20and%20a%20type%20alias%20is%20expanded%20into%20each%20column.md); a TypeScript field writes `.onCreate(gen.uuid())`.) The TS authoring surface's `t.generated('id', uuidv4())` helper bundled type + default together as a convenience, but the underlying descriptor still describes a default, not a column type. For the broader concept of helpers that configure column type + default + constraints in one declaration, see ADR 170 (type constructors and field presets).

Each authoring surface projects the registry differently:

- **PSL** parses `@onCreate(uuid(7))` as a text function call, resolves the name against the registry, parses raw string arguments into validated parameters, and delegates to the descriptor's spec production.
- **TS authoring (future)** would expose composed builder methods (e.g. `col.uuid({ version: 7 })` or `.default((d) => d.uuid(7))`) where the available methods are derived from the registry's descriptors. Arguments are already typed — no text parsing needed.

Both surfaces produce the same contract output: `{ kind: 'generator', id: 'uuidv7' }`.

The key implication: shared types (descriptor, result, registry) must not use surface-specific terminology. Terms like "default function" or "lowering handler" encode PSL's function-call syntax into what should be a surface-neutral abstraction. The shared vocabulary uses terms like "mutation default descriptor", "mutation default resolution", and "mutation default registry".

Applicability is declared on generator descriptors and checked during authoring via `codecId`.

Duplicate descriptor names and duplicate generator ids are hard errors during assembly.

PSL authoring packages consume this registry as an input; assembly ownership lives in composition layers (for example SQL family/control orchestration), not in PSL provider/interpreter packages.

### 4) Preserve TS-first escape hatches (opt-in validation)

TS-first authoring may express:

- registry-backed generators (eligible for applicability validation), and
- application-specific overrides for a specific column (may bypass applicability validation intentionally).

This is not a guided UX path; it is an explicit “trust me” contract authoring decision. When used, the author must still provide a runtime implementation for any referenced generator ids through lower-level runtime wiring (e.g. a runtime extension pack).

### 5) Keep generator metadata single-sourced and contributor-owned

Generator-owned storage-shape metadata (including parameterized behavior such as `nanoid(size)`) is defined once in contributor-owned metadata and reused across:

- TS authoring helper construction,
- emit-time generator descriptors consumed by PSL interpretation.

Runtime generator implementations remain contributor-owned and are resolved only through composed runtime contributors.

## Consequences

### Benefits

- **Deterministic validation** without brittle type inference.
- **Composable extensibility**: packs can add generators and default vocabulary through the same composition seams as other runtime behavior.
- **Reusable metadata**: future tooling can answer “what defaults are available for this column?” using the registry’s declared applicability.
- **Authoring-surface neutrality**: the shared descriptor registry is consumed by PSL, TS authoring, and future surfaces equally. No surface owns the vocabulary — each surface projects it into its own syntax (parsed function calls, typed builder methods, etc.).

### Costs

- **Contributor responsibility**: applicability must be declared correctly; misdeclared applicability can yield runtime failures or incorrect assumptions.
- **Registry assembly surface**: contributors must avoid duplicate ids/names because collisions fail assembly deterministically.
- **Migration work**: move from “hardwired maps” (e.g. ids) to “composed registry contributors” incrementally.

### Risks and mitigations

- **Incorrect applicability declarations**:
  - Mitigation: conformance tests, pack-level tests, and (where feasible) runtime “encode probe” validation for built-ins (optional; not required by this ADR).
- **Collision/override ambiguity**:
  - Mitigation: fail fast with deterministic hard errors for duplicate names/ids.

## Related ADRs

- ADR 158 — Execution mutation defaults
- ADR 112 — Target Extension Packs
- ADR 150 — Family-Agnostic CLI and Pack Entry Points
- ADR 155 — Driver Codec Boundary and Lowering Responsibilities
- ADR 113 — Extension function & operator registry (adjacent pattern: registry as extension seam)
- ADR 170 — Pack-provided type constructors and field presets (broader column helper pattern that subsumes mutation defaults)

