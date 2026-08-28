# attribute-registry — Plan

**Spec:** `projects/attribute-registry/spec.md`
**Linear Project:** [Language Tools Support Prisma Next PSL](https://linear.app/prisma-company/project/language-tools-support-prisma-next-psl-3422a7e44b9c) — parent issue [TML-3226](https://linear.app/prisma-company/issue/TML-3226)

## At a glance

Four slices: one shared-machinery slice first (uniform ctx + assembler + ADR 236 factory migration), then three independent consumer slices in parallel — SQL family registration, Mongo family registration, and block-level attributes on the kit.

## Composition

### Stack (deliver in order)

1. **Slice `registry-core`** — Linear: [TML-3227](https://linear.app/prisma-company/issue/TML-3227) — `slices/registry-core/`
   - **Outcome:** The registration machinery exists end-to-end and is proven LSP-consumable. `psl-parser` owns the uniform factory ctx (`AttributeSpecContext` / `FieldAttributeSpecContext`) and `assembleAttributeSpecs` (plain-data assembled view — no interface, no accessor methods; the project's single documented `blindCast` narrow). `AuthoringContributions` gains the family built-in namespace key (`{ model, field }` subkeys, erased transit through core). `AuthoringModelAttributeDescriptor.spec` becomes a factory over the uniform ctx; postgres `@@rls` and the SQL interpreter's contributed-attribute loop adapt; ADR 236 text amended. An LSP-side test assembles the registry through the existing `config-resolution.ts` plumbing and enumerates `@@rls` for a postgres project.
   - **Builds on:** None.
   - **Hands to:** The registration surface — contribution key, uniform ctx contract, assembled registry with typed view — that all three downstream slices register into and read from.
   - **Focus:** Framework machinery + the target-contribution (ADR 236) migration only. Family built-in namespaces may assemble empty here; registering actual built-ins belongs to slices 2–3, block-level to slice 4.

### Parallel group A (after `registry-core`)

- **Slice `sql-attributes-registered`** — Linear: [TML-3228](https://linear.app/prisma-company/issue/TML-3228) — `slices/sql-attributes-registered/`
  - **Outcome:** The SQL family's full built-in surface is registered as a factory namespace and every interpreter call site (`interpreter.ts`, `psl-field-resolution.ts`, `psl-column-resolution.ts`, `psl-relation-resolution.ts`) sources specs from it — `buildDefaultSpec` / `buildEnumDefaultSpec` become factories over the uniform ctx (enum members via `symbols.topLevel.blocks`). Unknown-attribute diagnostics at model and field level are driven by registry keys. The LSP-side test extends to a family built-in (`@relation` named arguments), completing the project-DoD test in final form.
  - **Builds on:** `registry-core`'s registration surface.
  - **Hands to:** Project-DoD items: SQL enumeration, grep gate ("no unregistered spec imports"), final LSP test.
  - **Focus:** SQL family packages only. Diagnostics land after the full SQL set is registered (transitional-shape constraint).

### Parallel group B (after `registry-core`)

- **Slice `mongo-attributes-registered`** — Linear: [TML-3229](https://linear.app/prisma-company/issue/TML-3229) — `slices/mongo-attributes-registered/`
  - **Outcome:** Mongo's field-level `@id` / `@unique` gain declarative specs; the full Mongo surface — including per-model index spec factories over the uniform ctx — is registered and enumerable; call sites source from the namespace; unknown attribute names diagnose at model and field level (new behavior — Mongo silently ignores unknowns today).
  - **Builds on:** `registry-core`'s registration surface.
  - **Hands to:** Project-DoD items: Mongo spec gaps closed, Mongo enumeration, Mongo unknown-name diagnostics.
  - **Focus:** Mongo family packages only. Spec gaps + registration land before the diagnostics (transitional-shape constraint).

### Parallel group C (after `registry-core`)

- **Slice `block-attributes-on-kit`** — Linear: [TML-3230](https://linear.app/prisma-company/issue/TML-3230) — `slices/block-attributes-on-kit/`
  - **Outcome:** Block-level attributes ride the kit: `blockAttribute()` constructor + block-level ctx variant (no `selfModel` requirement), `AuthoringPslBlockDescriptor.attributes` (sibling of `parameters`) declaring `@@type` and extension-block `@@map`, kit-parsed typed values attached to `PslExtensionBlock` as plain data, and all three hand-parsing sites migrated (`framework-authoring.ts:333`, postgres `authoring.ts:272,330`) — no `blockAttributes.find` outside the generic machinery. Unknown block-attribute names diagnose against descriptor keys; consumers read a block's attributes off its descriptor (never the flat assembled structure).
  - **Builds on:** `registry-core`'s kit + ctx machinery (block-level ctx variant extends it).
  - **Hands to:** Project-DoD items: block-attribute declaration, hand-parse grep gate, block-level unknown-name diagnostics.
  - **Focus:** Block level only; flat field/model registration belongs to groups A/B.

## Dependencies (external)

None. All work is in-repo; the Linear Project and ADRs 231/236 are already in place.

## Sequencing rationale

- `registry-core` must land first: all three consumer slices register into or read from the surface it creates. Everything after it parallelises — the three consumer slices touch disjoint package sets (SQL family / Mongo family / psl-parser kit + block-descriptor consumers) with no inter-slice hand-offs.
- Groups A and C both touch the postgres target, but different files and concerns (`@@rls` descriptor adaptation is already done in `registry-core`; group C touches only the block-attribute sites in `authoring.ts`) — no collision expected; if rebase friction appears, merge A before C.
- Per-family unknown-attribute diagnostics are sequenced *inside* slices (register full set first, then diagnostics), satisfying the spec's transitional-shape constraint without inter-slice ordering.
- `pnpm fixtures:check` stays clean at every slice boundary (spec constraint; each slice's DoD).
- The registry ADR is authored at close-out (`drive-close-project`), not as a slice.
