# ADR 243 — Name-identified indexes and exact-name adoption

Status: **Accepted**

> **Note (2026-10-05).** Dropping an index is now classed `widening`, not `destructive`, because an index holds no stored data. Where this ADR says an index is dropped under a destructive policy, read a policy that allows `widening`.

Related: [ADR 234 — Content-addressed wire names for Postgres-normalized objects](<./ADR 234 - Content-addressed wire names for Postgres-normalized objects.md>) (extended here), [ADR 235 — The schema differ walks two derived schema IRs](<./ADR 235 - The schema differ walks two derived schema IRs.md>), [ADR 009 — Deterministic Naming Scheme](<./ADR 009 - Deterministic Naming Scheme.md>), [ADR 161 — Explicit foreign key constraint and index configuration](<./ADR 161 - Explicit foreign key constraint and index configuration.md>), [ADR 210 — Index-type registry](<./ADR 210 - Index-type registry.md>), [ADR 224 — Control Policy](<./ADR 224 - Control Policy — framework-locked vocabulary and family-owned dispatch.md>).

## Decision

Two decisions, one rule.

**1. Every SQL index is name-identified.** ADR 234's content-addressed wire names extend from RLS policies to all index nodes — declared `@@index`es (unique indexes included) and FK-backing indexes. The user authors a prefix, or gets one derived from ADR 009's default names; lowering appends `_<8 hex of SHA-256(canonical content)>`; the schema differ pairs index nodes by name, not by column tuple. This unlocks index kinds whose defining content is a reprinted SQL body — expression (functional) indexes and partial (`WHERE`) indexes — which a tuple identity cannot represent at all, and which comparing *hand-authored* body text cannot verify, because the authored text and Postgres's reprint of it differ in casts, parentheses and whitespace. Comparing body text is not useless in general: decision 2 below relies on it, but only where both sides are reprints.

Constraints — primary key, foreign key, unique, check — are outside the rule. (**Amended:** check constraints have since joined it. A check's content is an opaque SQL predicate that Postgres reprints, so content comparison is not exact for it after all; see [ADR 244](<./ADR 244 - Check constraints are opaque wire-named expressions.md>). The other three constraint kinds remain outside.) A primary-key, foreign-key, or unique constraint is its own discrete entity, never a marker on an index ([ADR 161](<./ADR 161 - Explicit foreign key constraint and index configuration.md>), superseding note), and it is fully structured, so content comparison is already exact and no wire name is needed. An expression-unique is therefore a unique *index*, authored as `@@index(expression: …, unique: true)` — Postgres has no expression form of `ADD CONSTRAINT UNIQUE`, and `@@unique` remains the constraint surface, untouched.

**2. Every name-identified object kind has an exact-name mode for adoption.** Authoring `map: "<name>"` instead of `name: "<prefix>"` stores the verbatim physical name with no hash, and the node's equivalence becomes **content comparison**: structured attributes strictly, SQL bodies byte-for-byte. Byte-comparing bodies is exactly wrong for hand-authored text and exactly right for text captured by `contract infer` — an inferred body *is* Postgres's reprint, and reprint-against-reprint is stable. Exact mode is the adoption and round-trip path; wire mode is the authoring path. (**Amended:** checks carry this split too — `@@check(expression, name:)` / `check({ expression, name })` is the wire mode, `@@check(expression, map:)` / `check({ expression, map })` is the exact mode, and `contract infer` emits exactly that `map:` form for every hand-written check it finds. See [ADR 244](<./ADR 244 - Check constraints are opaque wire-named expressions.md>) § "Equivalence, and what it does not detect" for the check-specific account — checks are the one kind whose derived-vs-authored status cannot be read off wire-naming alone, which is a wrinkle indexes and policies do not have.)

The rule generating both: **compare by content wherever content is faithfully comparable; where Postgres reprints it, the name carries the content hash and the name is the equivalence relation.**

## Naming is a two-arm union at construction, flat in storage

A node's naming mode is stated once, when the node is built:

```ts
type SqlObjectNaming =
  | { kind: 'exact'; name: string }
  | { kind: 'wire'; prefix: string; hash: string };
```

The four name-identified classes — the contract's `Index` and `PostgresRlsPolicy`, the schema IR's `SqlIndexIR` and `PostgresPolicySchemaNode` — take this union as constructor input. A name and prefix that disagree are therefore unconstructable.

**Storage stays flat and derived.** The contract records `name` and an optional `prefix`; the hash is input-only and never stored, because it is recoverable from the name. Flat data becomes a union again only at the two places flat data genuinely arrives — deserialized contract JSON and the literal in a generated migration file — through one asserting helper.

Two different baselines matter here, and they are easy to confuse:

- **Against the contract shape before this ADR**, the shape changes and every storage hash moves: indexes gain a required `name`, an optional `prefix`, and the expression, predicate and uniqueness fields. Adopting this ADR requires re-emitting contracts and one widening migration. See Consequences.
- **Against the contract shape before the naming union was introduced** — an internal refactor made while this work was in flight — nothing changes. The union is constructor input, not storage, so introducing it moved zero bytes in `contract.json`.

The mode arm is named `wire`, not `managed`. ADR 224 binds `managed` to a control policy value (`managed`/`tolerated`/`external`/`observed`), and the two axes are orthogonal: a table can be control-`managed` while its index's naming is `exact`. One word naming two unrelated claims about the same object is a defect; `wire` matches this ADR's own vocabulary and ADR 234's title.

## A worked example

The motivating case is the Cipherstash team's EQL encrypted search, which needs several index types on one encrypted column:

```prisma
model User {
  id    Int    @id
  email String
  @@index(expression: sql`eql_v3.eq_term(email)`, name: "users_email_eq", type: "btree")
}
```

The expression is a `sql` literal, the only form PSL takes for raw SQL, and a `sql` value in the TypeScript builder, as in ``constraints.index({ expression: sql`eql_v3.eq_term(email)`, name: 'users_email_eq', type: 'btree', options: {} })`` ([ADR 268](ADR%20268%20-%20Raw%20SQL%20is%20a%20value%20of%20the%20data%20type%20sql-expression.md)).

Lowering hashes the canonical content tuple and stores the wire name in the contract:

```jsonc
{ "name": "users_email_eq_7c31d9a4", "prefix": "users_email_eq",
  "expression": "eql_v3.eq_term(email)", "unique": false, "type": "btree" }
```

The planner emits:

```sql
CREATE INDEX "users_email_eq_7c31d9a4" ON "public"."user" USING "btree" (eql_v3.eq_term(email));
```

Verification introspects `pg_class` and `pg_index` and finds `users_email_eq_7c31d9a4` — an exact name match, with no body read. If the user renames the prefix, the suffix survives and the planner emits `ALTER INDEX … RENAME TO`. If the user edits the expression, the suffix changes and the planner creates the new index and, under a destructive policy, drops the old one — a rebuild, which an expression change genuinely requires.

Adoption of the same index created by someone else's tooling:

```prisma
// emitted by `contract infer` — note map:, and the body is Postgres's reprint
@@index(expression: sql`eql_v3.eq_term(email)`, map: "users_email_eq", type: "btree")
```

Verify pairs the node by the verbatim name and compares the stored reprint against the introspected reprint. They are byte-equal, so there is zero drift and zero operations. The emitted contract signs the live database.

## Why the wholesale switch, and not expression indexes only

Tuple identity could have been kept for plain column indexes, reserving name identity for body-carrying ones. That was rejected for three reasons, and the decision was taken during the pre-1.0 window in which the break is uniquely cheap:

- **Tuple identity cannot represent legal databases.** Two indexes on the same column tuple — a unique index plus a redundant plain one — are legal in Postgres. A tuple-keyed differ cannot host both as siblings, so introspection carried a keep-one-per-tuple deduplication hack, which was a deliberate lie about the database. Name identity deletes it.
- **Decorative names are unverifiable names.** Under tuple identity, `isEqualTo` ignored `name` entirely, so a live index named anything at all paired silently. Under wire naming, verify checks what we created.
- **The upgrade is automatic.** The exact-to-wire transition machinery — content pairing followed by `ALTER INDEX … RENAME`, a widening-class metadata-only operation — converts every pre-existing plain-named index on the first widening plan. After 1.0 this would be a mass-migration event; before the release candidate it is a routine plan.

## Naming and hashing

The format, parsing, prefix-length budget (54 UTF-8 bytes plus a 9-byte suffix, within Postgres's 63-byte identifier limit; **Amended:** [ADR 244](<./ADR 244 - Check constraints are opaque wire-named expressions.md>) corrected the unit from characters to bytes), normalizer (trim and internal-whitespace collapse of the *authored* input only), and the normalizer-stability commitments are all ADR 234's, unchanged. They are now family-shared in `@prisma-next/sql-schema-ir/naming`, because `SqlIndexIR` is family-shared.

The index content tuple is a stability commitment — changing it re-suffixes every wire name in every deployed database:

```
[ normalizeSqlBody(expression ?? ''), normalizeSqlBody(where ?? ''),
  columns ?? [] /* authored order */, unique, type ?? '', sortedOptions ]
```

`sortedOptions` is `[key, String(value)]` pairs sorted by key. Prefix, schema, and table are excluded, for ADR 234's reasons. The RLS tuple is unchanged. A table of literal content-to-hash pairs is pinned in the naming tests, so a change to the tuple encoding fails the suite rather than silently renaming every user's indexes.

Default prefixes for unnamed authoring are ADR 009's existing default names, so an unnamed `@@index([a,b])` becomes `t_a_b_idx_<8hex>`. An expression index has no derivable default and must be named with `name:` or `map:`; an authoring diagnostic enforces it. A synthesized FK-backing index is the exception to authored-prefix rejection: its default prefix is derived during FK materialization (which also removes indexes that duplicate another, [ADR 161](<./ADR 161 - Explicit foreign key constraint and index configuration.md#a-foreign-key-names-its-backing-index>)) and truncated to the 54-byte wire-name budget before the content-hash suffix is appended. The emitted storage contract persists that truncated prefix and full physical name; authored index prefixes remain fail-loud when over budget.

## Equivalence matrix

The differ calls `expected.isEqualTo(actual)`, so the expected node's own properties select the strategy:

| Node | Pairing id | Compared by `isEqualTo` | Never compared |
| --- | --- | --- | --- |
| Wire-named index | wire name | `unique`, `type`, `options` (loose), `columns` (ordered, when both sides carry them) | `expression`, `where` — the hash in the name covers them, and the live side is a non-comparable reprint |
| Exact-named index | verbatim name | all of the above, **plus** `expression ?? ''` and `where ?? ''` byte-for-byte | — |
| Wire-named policy | wire name | nothing: id equality is content equality, because the hash covers the full tuple | bodies |
| Exact-named policy | verbatim name | `operation`, `permissive`, sorted `roles`, `using ?? ''`, `withCheck ?? ''` byte-for-byte | — |

Wire-named nodes still compare structured attributes, so out-of-band structured drift such as `ALTER INDEX … SET (fillfactor=…)` surfaces as `not-equal`; only reprinted bodies are exempt. Exact-mode byte comparison is deliberately un-normalized: both sides are reprints in the supported flow, and normalizing would only mask real drift.

## Planner semantics

- `not-found` produces `CREATE [UNIQUE] INDEX`, with bodies rendered verbatim and `WHERE (…)` for partial indexes. `not-expected` produces `DROP INDEX` under a destructive policy. `not-equal` produces the existing `indexIncompatible` conflict.
- **Rename pairing runs in two passes**, both widening-class, per `(schema, table)`, and deterministic by sorted names:
  1. *Hash pairing.* A missing and an extra whose wire names share a hash under different prefixes pair into `ALTER INDEX … RENAME TO`. This is ADR 234's rename detection, now serving indexes.
  2. *Content pairing.* A remaining missing wire-named node and a remaining extra of any name shape that are content-equal — structured attributes strict, bodies byte-equal — pair into a rename. This is the exact-to-wire transition and the pre-1.0 upgrade path. It pairs only when the body text is byte-identical, so switching the name mode and rewriting the body must be separate migrations; done together they degrade to create-and-drop.
- Under an additive-only policy both passes are skipped and pairing degrades to the additive half. The new name is created now, and because the rename precheck requires its target to be absent, the old object can then only leave through a destructive-allowed drop, never a later rename. A rename happens only when a widening-allowed plan is the *first* convergence. This matches the existing RLS rename degradation.

## Adoption and inference

`contract infer` emits every index, and re-detects wire naming: it recomputes the content hash from the introspected content, and if the live name is `<prefix>_<that hash>`, it emits `name: <prefix>`. Otherwise it emits `map: "<live name>"` with the reprinted bodies verbatim.

Re-detection succeeds when the *hash inputs* are recovered exactly as they were hashed. That holds for an index whose content is structured — column lists, uniqueness, access method, options — **and** whose authored spelling survives introspection unchanged. Those re-infer to byte-identical contracts.

Two things break the recovery, and both make the index re-infer as `map:` even though we created it as `name:`:

- **A reprinted SQL body.** Postgres reprints expression and predicate text, so the recomputed hash differs from the one in the live name. A body that happens to reprint byte-identically does re-detect as wire-named, which is equally sound.
- **A normalized-away spelling.** An index authored with an explicit `type: "btree"` hashed that string, but introspection reports the default access method as absent, so the recomputed tuple differs even though nothing about the index is structurally different.

In both cases the round trip stays correct — the contract still signs the database with zero operations — but the authoring representation changes from wire-named to exact-named. Byte identity is therefore a property of the recoverable subset, not of everything structured.

Policies always adopt as exact, through `@@map`, by design: a reprinted policy body cannot be shown to re-hash to its live suffix, so re-detection is not attempted. RLS enablement round-trips through `@@rls`.

Re-detection insists on the hash recompute rather than the name shape alone. Introspection also parses live names into prefixes, but only to group candidates for the rename pass, where a false parse costs at most a missed pairing.

The acceptance bar is literal: infer, then emit, then verify reports zero issues and plan reports zero operations, on a database this toolchain has never seen.

Hand-authoring a body under `map:` is allowed but produces false drift — authored text against a reprint — and draws an emit-time warning directing the user to `name:`.

## Consequences

### Positive

- Expression, partial, and unique-expression indexes are authorable, migratable, and verifiable, with no SQL parser and no body comparison against hand-authored text.
- Several indexes can coexist on one column, which is what EQL's encrypted-search pattern requires.
- A foreign database is adoptable with zero operations, and convertible to wire naming with a renames-only migration.
- The introspection deduplication and expression-skip hacks are deleted, so the live-side tree stops lying.
- Index names become verified, and renames are detected structurally.

### Negative

- Every physical index name grows a 9-character suffix, so `EXPLAIN` output and Postgres error messages show `users_email_eq_7c31d9a4`. Accepted: the tool manages names so users don't have to.
- One-time break: the contract shape and every storage hash change, and existing databases need one widening plan of renames. Accepted only because this ships before the release candidate.
- Exact-mode reliability depends on the text having come from inference. The hand-authored case is a documented, warned degradation rather than an error.
- Expression bodies are opaque, so a column rename silently stales them. This was already true of RLS predicates.

## Alternatives considered

**Expression-only name identity.** Keep tuple identity for plain indexes. Rejected for the reasons in "Why the wholesale switch": representational holes, unverifiable names, and a permanently split identity model, saved from mass-migration cost only while pre-1.0. The window decided it.

**Folding unique constraints into index nodes** — one node kind with a constraint marker, so name identity would cover `@@unique` too. Rejected twice over. The schema-differ substrate tried it and backed out: under one node kind a unique constraint and a same-column index collide, forcing introspection deduplication and fail-loud derivation rules back in, which is the tree-massaging that substrate work existed to delete. The contract's discrete-entities principle forbids it regardless: every element must be interpretable from its own node, and an index carrying `constraint: true` is a second catalog object smuggled in as a boolean — an instruction rather than a fact. A unique constraint in `pg_constraint` and an index in `pg_index` are different elements, with different DDL and independent lifecycles, so the contract carries each as its own entity.

**A stored mode marker on the contract entity** — an explicit `naming: 'wire' | 'exact'` field in `contract.json`. Rejected: the presence or absence of `prefix` already determines the mode, and a stored enum can drift against the structure that defines it. The union described above is constructor input, not storage, so it adds no field to the emitted contract.

**Canonicalize at CREATE, a JavaScript-side Postgres parser, or cheap normalizers.** Rejected in ADR 234, and nothing here changes those rationales. Exact-mode byte comparison is not a normalizer: it works only because both sides pass through the same printer.

**Deciding the mode by pattern-sniffing the name** — asking whether it ends in `_<8hex>`. Rejected for the declared side, because a hand-picked exact name can match the pattern by accident. Parsing is used only where ADR 234 already uses it, extracting prefixes from live names to group renames, where a false parse is cheap.
