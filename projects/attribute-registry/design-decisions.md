# attribute-registry — design decisions

Settled in the pre-spec design discussion (2026-08-27, operator + agent, architect / principal-engineer lenses). Each entry: decision, why, assumptions, alternatives rejected.

## 1. Registry entries are uniformly spec factories

Every entry is `(ctx) => AttributeSpec`, keyed `(level, name)`. Static specs are nullary factories.

**Why:** the attribute surface is not fully static — SQL builds `@default` specs per field (scalar/list/enum arms from the field's type and the default-function registry), Mongo builds its index specs per model (field-name arms). A registry of plain spec values cannot hold them; two entry kinds (static | factory) would push the branching into every consumer. The accepted ADR 231 names dynamic composition a design principle, so factories align with it.

**Assumes:** the LSP can afford factory invocation per completion site (specs are cheap to build).

**Rejected:** static-spec-only registry with `@default` special-cased outside it (the LSP needs `@default` completion most of all); dual entry kinds (non-uniformity just relocates).

## 2. The factory ctx is framework-owned and uniform, carrying site + stack facts

Resolved by research (see spec § The factory context): `{ symbols, model, controlMutationDefaults }`, with field-level factories receiving an extended ctx where `field` is required. `codecLookup` is excluded — no `codecRef` combinator exists in shipped code. Enum member names for `@default` come from `symbols.topLevel.blocks[field.typeName]` (declaration AST), not from the family's `EnumTypeHandle`, which stays interpreter-side for lowering.

**Why:** today's factory signatures are family-specific (`buildDefaultSpec({ isList, registry })`, `buildEnumDefaultSpec(memberNames)`) — only the owning interpreter knows what to pass, so the LSP could never invoke them; the opacity ADR 231 removed would just move into the signature. A uniform ctx both consumers can assemble (the LSP already holds the symbol table, `controlMutationDefaults`, and `codecLookup` via `ProjectInterpretation`) is what makes the registry actually consumable. Note: the implemented `InterpretCtx` is thinner than ADR 231's draft (no symbol table, no codec lookup) — it is the *parse-time* context and is not reused as the factory ctx.

**Operator call:** stack-scoped facts live in the ctx rather than being closed over at registration time. Cost accepted: the ctx type widens when a family needs a new stack fact. Benefit: namespaces stay module-level constants and every factory's dependencies are visible in one signature.

**Rejected:** closure-captured stack facts (hides dependencies, forces per-stack namespace construction); reusing `InterpretCtx` (wrong lifetime, missing facts).

## 3. Family built-ins register on `AuthoringContributions`; a typed assembler in `psl-parser` does one documented narrow

**Why:** `AuthoringModelAttributeDescriptor.spec` is already `unknown` in core — core cannot name `AttributeSpec` (it lives in the PSL authoring layer). Registering family built-ins on the same surface reuses the one channel the control stack already threads to both the interpreter and the LSP (`config-resolution.ts`). `assembleAttributeSpecs` in `psl-parser` restores typing with a single `blindCast`-with-reason, precedented by the SQL interpreter's existing narrow of contributed specs (assembled shape settled in decision 9).

**Rejected:** a second, authoring-layer-only contribution channel bypassing core (new plumbing, targets can't reach it); making core generic over the spec type (type machinery disproportionate to one documented cast — operator accepted the narrow).

## 4. The registry is descriptive; interpreters keep their flow

Interpreters keep their existing call sites and pull factories from the registry (through their own typed namespace — same objects, so the LSP reads exactly what the interpreter runs). No generic interpretation loop over built-ins.

**Why (research, both interpreters read end-to-end):** an authoritative `(parse, lower) → keyed output` loop is not implementable today without a rewrite. SQL model-level is loop-shaped but writes heterogeneous typed accumulators with cross-attribute preconditions; SQL field-level is pull-based inside type/column/relation resolution; Mongo has no generic loop at all, never reads `authoringContributions.modelAttributes`, and its `@map`/`@@base`/`@relation`/`@@discriminator` lowering is cross-model and multi-phase. Only a small tail (`@@textIndex`, `@@check`-class) is cleanly liftable.

**Assumes:** object identity between registered namespace and interpreter-consumed factories is what keeps the two consumers in sync; the grep gate ("no unregistered spec imports") closes the remaining drift window.

**Rejected:** authoritative descriptor loop (rewrite, not lift); per-attribute hybrid now (scope without payoff — left as additive follow-up).

## 5. ADR 236's descriptor migrates to the factory shape

`AuthoringModelAttributeDescriptor.spec` becomes a factory over the uniform ctx; postgres `@@rls` adapts (factory ignoring its ctx); ADR 236's text is amended.

**Why:** one entry shape for the whole registry (decision 1) — the alternative (assembler wraps static contributed specs in `() => spec`) preserves ADR 236's surface but reintroduces a second authoring shape that every future target copies.

**Rejected:** wrap-at-assembly (operator chose surface migration over the special case).

## 6. The field-level contribution namespace is family-built-ins-only

**Why:** covering field-level built-ins (`@id`, `@default`, `@relation`, `@map`, `@noCheck`, Mongo's gaps) requires a field-level registration surface — `modelAttributes` cannot hold them. But no interpreter has a generic field-attribute *lowering* path, so a target entry there would parse and never lower — a half-working surface. Family-only until someone builds that path; explicit non-goal in the spec. This is a sibling addition motivated by the registry, not part of ADR 236's target-contribution story.

**Shape (operator call):** one contribution key, a single namespace with `model` and `field` subkeys (`{ model: {...}, field: {...} }`), rather than two parallel keys. Each subkey keeps its own ctx contract (`field` entries take the extended ctx), so per-level typing is unaffected. Target descriptors stay on `modelAttributes`: their entries carry `lower` (a different shape than a bare spec factory), and merging would force `lower` optional on family entries — the assembler merges both sources into the one registry view instead.

## 7. Scope includes fixing Mongo's attribute gaps

Mongo's field-level `@id` and `@unique` get declarative specs (today: presence-only checks, no spec objects), and both families get registry-key-driven unknown-attribute diagnostics (SQL has model-level only at `interpreter.ts:1144`; Mongo silently ignores unknown attributes everywhere).

**Why:** the registry is only as useful as its coverage — unregistered attributes are invisible to completion, and the unknown-name diagnostic is unsound against an incomplete registry. Ordering constraint recorded in the spec: diagnostics land only after the family's full set is registered.

## 8. Block-level attributes are in scope, registered per block descriptor, with full consumer migration

Initially excluded on a cost claim that research falsified: the "different substrate" is a choice inside `reconstructExtensionBlock` — the real `ExpressionAst` args are in hand there and flattened to strings by `printSyntax`. The kit can parse block attributes; what's missing is a `blockAttribute()` constructor and a block-level ctx variant (`InterpretCtx.selfModel` is required today; an `enum` block has no model). Both shipped block attributes (`@@type` enum codec binding, extension-block `@@map`) are single-string positionals — static specs.

**Registration home:** `AuthoringPslBlockDescriptor.attributes`, sibling of `parameters` — not the flat `(level, name)` keyspace. Block attributes are scoped per block kind; descriptor placement makes scoping structural (a block's legal attributes are its descriptor's keys) and reaches the LSP through `pslBlockDescriptors`, which its pipeline already consumes.

**Full migration:** kit parses at reconstruction/validation; typed values attach to `PslExtensionBlock` as plain data (core reads data, never invokes the kit — layering intact); the three hand-parsing sites (`framework-authoring.ts:333`, postgres `authoring.ts:272,330`) migrate.

**Assumes:** those three sites are the complete consumer set (grep-verified at decision time; the DoD grep gate re-verifies at implementation).

**Rejected:** flat `('block', name)` keys with a which-blocks annotation (inverts ownership; every consumer joins two structures to answer "what's legal here"); validation-only migration (spec text and hand-parsers would coexist — the exact drift this project exists to eliminate); keeping block level out of scope (the cost claim justifying it was wrong).

## 9. The assembled view is plain strongly-typed data — no registry interface, no accessor methods

Operator correction (2026-08-28), replacing an agent-proposed `AttributeRegistry` interface (`get(level, name)` / `entries(level)` behind `createAttributeRegistry`). The assembly point is `assembleAttributeSpecs(contributions): AssembledAttributeSpecs` — frozen plain records `{ model: Record<string, ModelAttributeSpecFactory>, field: Record<string, FieldAttributeSpecFactory> }`.

**Why:** overloading accessors on a string `level` parameter makes no sense — the level is always statically known at every call site. A generic `get(): F | undefined` accessor forces an `undefined` check on every consumer, including the SQL and Mongo interpreters, which each have a set of known attributes they know for certain are registered — their access must stay total. Interpreters therefore consume their own registered `const` namespaces directly (strong literal-key typing, `InferAttr` intact, object identity with the assembled content); the assembled plain data serves only consumers that genuinely face unknown names (LSP enumeration via `Object.entries`, unknown-name diagnostics via `name in specs.model`), where partiality is inherent, not imposed.

**Rejected:** service-style interface + factory with accessor methods (string-parameter overloads; imposed partiality; method surface adds nothing over data).
