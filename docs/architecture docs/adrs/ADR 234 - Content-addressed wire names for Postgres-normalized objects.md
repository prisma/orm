# ADR 234 — Content-addressed wire names for Postgres-normalized objects

Status: **Accepted**.

Related: [ADR 004 — Storage Hash vs Profile Hash](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md), [ADR 009 — Deterministic Naming Scheme for Constraints](ADR%20009%20-%20Deterministic%20Naming%20Scheme.md), [ADR 224 — Control Policy](ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md), [ADR 235 — The schema differ walks two derived schema IRs](ADR%20235%20-%20The%20schema%20differ%20walks%20two%20derived%20schema%20IRs.md).

## Decision

Postgres-normalized database objects — starting with RLS policies — carry **content-addressed wire names**. The name a user authors is a *prefix*; the Postgres target appends a short hash of the object's canonical content at lowering time. Equivalence is then a wire-name match, not a body comparison.

Secondary indexes have since adopted the same scheme ([ADR 243](<./ADR 243 - Name-identified indexes and exact-name adoption.md>)): the format/parse helpers and the minimal SQL-body normalizer are family-shared in `@prisma-next/sql-schema-ir/naming`, and an index's hash tuple covers its element list (column tuple or opaque expression), partial-index predicate, uniqueness, access method, and options. The RLS-specific sections below are the original decision record; where they say "policy", the mechanism now serves policies and indexes alike. Both kinds have since also gained an **exact-named** mode (index `map:`, policy `@@map`) for adopting live objects verbatim: an exact name carries no prefix and no hash, and equivalence for it is content comparison (bodies byte-for-byte against the Postgres reprint) rather than the wire-name identity described below — the sections below now describe the WIRE mode — the naming union spells the two arms `wire` and `exact`, deliberately avoiding `managed`, which ADR 224 already binds to a control policy.

The format is:

```
<user_prefix>_<8 hex chars of SHA-256(canonical(content))>
```

One shared hash assembly in the target serves both authoring surfaces (PSL and TypeScript), so the same policy authored either way gets the same wire name. The full wire name lives in `contract.json` and in the database's catalog (e.g. `pg_policies.policyname`). The user only ever types the prefix.

## A worked example

A user authors an RLS policy that lets authenticated users update their own profile rows. In TypeScript:

```ts
policyUpdate(Profile, {
  name: 'profile_owner_write',
  roles: [authenticated],
  using: sql`"userId"::uuid = auth.uid()`,
  withCheck: sql`"userId"::uuid = auth.uid()`,
})
```

or equivalently in PSL:

```prisma
policy_update profile_owner_write {
  target    = Profile
  roles     = [authenticated]
  using     = sql`"userId"::uuid = auth.uid()`
  withCheck = sql`"userId"::uuid = auth.uid()`
}
```

PSL writes each predicate as a `sql` literal, so the quoted column name needs no escaping ([ADR 268](ADR%20268%20-%20Raw%20SQL%20is%20a%20value%20of%20the%20data%20type%20sql-expression.md)).

The lowering normalizes the content, hashes it, and stores the full wire name in the IR:

```jsonc
// In contract.json
{ "kind": "PostgresRlsPolicy",
  "name": "profile_owner_write_a3f1c8b2",  // ← prefix + 8-hex suffix
  // …
}
```

The planner emits:

```sql
CREATE POLICY profile_owner_write_a3f1c8b2 ON profile
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING      ("userId"::uuid = auth.uid())
  WITH CHECK ("userId"::uuid = auth.uid());
```

When the verifier later introspects `pg_policies`, it finds a row with `policyname = 'profile_owner_write_a3f1c8b2'`. Verification is exact-string identity on the wire name — no body comparison. If the user renames the policy to `profile_can_update_self`, the suffix is unchanged (the body didn't change), so the two sides show `profile_can_update_self_a3f1c8b2` declared and `profile_owner_write_a3f1c8b2` live — same suffix, different prefix — which the planner recognizes as a rename and answers with `ALTER POLICY ... RENAME TO …`.

## Why content addressing

The natural design — identify a policy by `(schema, table, policy_name)` and compare bodies — is undermined by Postgres's expression printer.

`pg_policies.qual` and `pg_policies.with_check` are not stored verbatim. Postgres reparses the predicate at `CREATE POLICY` time and stores a canonicalized form. Even when the predicate is semantically identical, the stored bytes drift through Postgres's renderer along several axes:

- **Cast forms.** `auth.uid()::uuid` round-trips through `pg_policies` as `(auth.uid())::uuid` — the renderer adds parens around the cast operand.
- **Outer parens.** A top-level `(x = 1)` may come back as `x = 1` or vice versa.
- **Whitespace.** Collapsed or re-inserted around operators and keywords.
- **Keyword casing.** `IS NULL` vs `is null`.

A verifier that compares bodies byte-for-byte would produce a false positive on nearly every realistic predicate. A verifier with a cheap normalizer (whitespace, outer parens, casing) still produces false positives on cast forms and paren-grouping. A normalizer thorough enough to canonicalize across Postgres's rendering would need a Postgres-grammar parser running in JS — heavy dependency, high implementation risk, outsized for the problem.

Content addressing sidesteps the comparison entirely. The target normalizes the *authored* body once and encodes the hash into the name. The verifier never inspects `pg_policies.qual`; it only checks names. The wire name *is* the equivalence relation.

## Design

### Naming format

```
<user_prefix>_<8 hex chars of SHA-256(canonical(content))>
```

- **User prefix.** What the user types in the authoring DSL. The TS helpers take a `name` field on the policy descriptor; PSL takes the head identifier on the per-operation `policy_<op> <name> { … }` block. Required; the target does not synthesize names.
- **Hash suffix.** First 8 hex characters (32 bits) of SHA-256 over the canonical content tuple. Truncation precedent is git short hashes. 32 bits is comfortable headroom for the per-table policy count any realistic contract reaches; the collision analysis is in [Consequences](#consequences).
- **Length budget.** Postgres's `name` type holds 63 **bytes** (`NAMEDATALEN - 1`). The suffix is 9 bytes (underscore + 8 hex). The prefix is bounded at 54 UTF-8 bytes at lowering time; exceeding the cap is a lowering error with a clear message. (**Amended:** this budget was originally stated in characters. The unit was always bytes — a multibyte prefix under 54 characters can exceed 63 bytes, which Postgres silently truncates — and the shipped constant is `WIRE_NAME_PREFIX_MAX_BYTES`; see [ADR 244](<./ADR 244 - Check constraints are opaque wire-named expressions.md>).)
- **No version marker.** Versioning is unnecessary — see [Normalizer stability](#normalizer-stability) below.

### Hash inputs (for RLS policies)

The canonical content tuple fed to SHA-256 is:

1. `canonical(using)` — body of the `USING` clause after normalization (internal whitespace collapse, trim). Empty if absent.
2. `canonical(withCheck)` — same normalization on the `WITH CHECK` body. Empty if absent.
3. `sort(roles)` — roles as a sorted, deduplicated list. Role ordering is not semantically meaningful in Postgres; sorting eliminates a class of accidental drift in the IR.
4. `operation` — closed-set literal (`select | insert | update | delete | all`).
5. `as` — `permissive | restrictive`.

Excluded inputs:

- **Schema and table identity.** `pg_policies.schemaname` and `pg_policies.tablename` carry these independently. They're orthogonal to "is this the same policy content."
- **The user prefix itself.** The prefix is the human-readable label, not part of equivalence. Renaming `posts_select_published → posts_read_open` keeps the suffix stable and signals a rename, not a content change.

### Verifier and planner semantics

Declared and introspected policies meet in the schema differ ([ADR 235](ADR%20235%20-%20The%20schema%20differ%20walks%20two%20derived%20schema%20IRs.md)), where a policy node's identity is its full wire name. Because the wire name is the equivalence relation, every situation reduces to name presence:

- **Declared, not live** — the differ emits a `not-found` issue for the policy. The planner answers `CREATE POLICY`. Severity in verify is governed by the table's control policy ([ADR 224](ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md)).
- **Live, not declared** — a `not-expected` issue. Verify severity per the control policy (managed → error, tolerated → warn, external → ignored, observed → silent); on a managed table the planner drops it. An out-of-band `ALTER POLICY` body change lands here: the old wire name is still live but no longer matches anything declared, so it is an ordinary extra → dropped on the next migrate, not a tamper signal.
- **Rename** — a `not-found` and a `not-expected` whose wire names share the hash suffix but differ in prefix. The planner pairs the two and emits `ALTER POLICY ... RENAME TO` instead of a drop + create. No body inspection.
- **RLS-enabled drift** — a policy is declared for a table but `pg_class.relrowsecurity = false`. The planner auto-enables RLS on tables with declared policies, so this only fires on out-of-band drift.

### IR shape implications

The `PostgresRlsPolicy` IR node carries the **full wire name** in its `name` field; the authoring surfaces accept the prefix and the lowering promotes it:

```jsonc
// contract.json — full wire name
{ "kind": "PostgresRlsPolicy", "name": "profile_owner_read_a3f1c8b2", /* … */ }
```

```ts
// TS authoring — prefix only
policySelect(Profile, { name: 'profile_owner_read', roles: [authenticated], using: sql`true` })
```

```prisma
// PSL authoring — prefix only
policy_select profile_owner_read {
  target = Profile
  roles  = [authenticated]
  using  = sql`true`
}
```

**Duplicate prefixes within `(schema, table)` are a lowering error**, even when the resulting wire names would differ by hash. The prefix is the user's logical identity for the policy; allowing two policies to share a prefix would produce a confusing footgun ("why are both of my policies still active?" — answer: because their bodies differ, so they hashed differently, so both are present in the database).

## Forward applicability

The same problem class — Postgres re-prints stored bodies — applies to other catalog-resident objects:

- **Indexes.** `pg_indexes.indexdef` is heavily normalized (column ordering, operator class names, partial-index `WHERE` clause). **Done** — see [ADR 243 — Name-identified indexes and exact-name adoption](<./ADR 243 - Name-identified indexes and exact-name adoption.md>), which extends this scheme to every index and adds the exact-name mode both kinds now share.
- **Check constraints.** `pg_constraint` stores the predicate as a parsed tree (`conbin`); reading it back via `pg_get_expr(conbin, conrelid)` yields the printer's reprint, not the authored text. **Done** — see [ADR 244 — Check constraints are opaque wire-named expressions](<./ADR 244 - Check constraints are opaque wire-named expressions.md>), which carries the whole predicate as the hash input. A check's prefix is derived from column shape when Prisma Next generates the check; an authored `@@check(name:)` supplies its own prefix, and `@@check(map:)` names the constraint exactly, bypassing the scheme for adoption.
- **Views.** `pg_views.definition` is the printer's output, not the user's text.
- **Function bodies.** `pg_proc.prosrc` is verbatim, but function bodies typically differ in whitespace and comment placement after a deploy-tool round-trip.

The naming format (`<prefix>_<8 hex SHA-256>`), the normalizer (internal whitespace collapse + trim of the authored input, see "Normalizer stability"), and the lowering-time prefix bound are object-kind-agnostic and stay constant across applications. Each object kind only needs to decide:

- The per-kind hash input tuple (analogous to the RLS list above).
- Whether the rename signal (matching suffix, different prefix) needs a kind-specific planner action (e.g. `ALTER POLICY ... RENAME TO`).
- What happens when the prefix overruns the length bound. (**Amended:** added with [ADR 244](<./ADR 244 - Check constraints are opaque wire-named expressions.md>). Indexes and policies throw, because their author can shorten the name they typed. A *derived* check's prefix has no authoring surface, so it truncates instead; an *authored* check's `name:` prefix does have one, so it throws too, same as indexes and policies.)

Whether to apply content-addressing to a given object kind is a separate decision per kind. Indexes have the widest DBA-visible surface — DBAs reference index names in `REINDEX`, `DROP INDEX`, query plans, and Postgres error messages — so the "ugly suffix" trade-off is the most prominent there. The cost of plain naming has to outweigh the cost of suffix-visibility before the pattern is worth applying to a new object kind.

## Normalizer stability

The normalizer is a **stability commitment** with the same status as the contract storage hash (ADR 004). Changing it changes the suffix of every existing wire name whose normalized body changes, so a normalizer change must say which bodies it affects.

This works without an explicit version marker because the contract-hash machinery already signals the change. A normalizer update re-emits different `contract.json`; the storage hash changes; `VERIFY_CODE_HASH_MISMATCH` fires; the user re-emits and re-applies migrations. A `_v1_` marker in the name would carry the same information twice.

The normalizer is also **deliberately minimal** (trim + internal-whitespace collapse of the authored input, keeping every line break in a body that contains a line comment). The wire name is only ever compared against other wire names — the hash is never recomputed from an introspected policy body — so there is no need to match Postgres's reprinted form. Minimal normalization also protects the no-collision property: aggressive rewriting (lowercasing, paren-stripping, cast-alias folding) risks collapsing two distinct predicates onto one hash.

A body that contains `--` keeps its line breaks. A line break ends a SQL line comment, so `a --c` followed by a line break and `b` compares `b`, while `a --c b` is all comment after `a`; collapsing the line break into a space would give those two opaque SQL bodies (in the sense of [ADR 244](<./ADR 244 - Check constraints are opaque wire-named expressions.md>)) one hash. The normalizer therefore splits such a body into lines, collapses and trims each line, drops blank lines and joins the rest with `\n`. Every body without `--`, and every one-line body, normalizes by trim and whitespace collapse alone. The normalizer gives the same output on its own output, which matters because policy authoring normalizes a body before the hash function normalizes it again. (**Amended:** the line-comment rule was added after the first release of the normalizer. No committed contract had a body containing `--`, so no committed wire name changed; a user body with both `--` and a line break gets a new wire name once, and the next `migration plan` drops and recreates the object.)

The escape hatch we deliberately do *not* build is an intentionally hash-invariant normalizer change — e.g. "the new normalizer treats `TRUE` and `1 = 1` as equivalent, but existing wire names should keep their suffixes." If that need ever arises, the moment to introduce a version marker is then; paying for it up front buys nothing.

## Consequences

### Positive

- **No false-positive body diffs.** The normalizer-plus-hash *is* the equivalence relation; the verifier never compares bodies for equivalence purposes.
- **Free rename detection.** Matching suffix with different prefix is a structural signal the planner can act on with `ALTER POLICY ... RENAME TO`.
- **No planner-runner round-trip.** Unlike read-back-after-CREATE designs, both sides recompute the wire name from the same canonical inputs at lowering and verification time independently.

### Negative

- **Normalizer changes are user-visible.** Any change to the canonicalization invalidates all existing wire names. The contract hash signals the change but the user has to re-emit and re-apply migrations to converge the database.
- **DBA-visible names are uglier.** `profile_owner_read_a3f1c8b2` in `pg_policies` rather than `profile_owner_read`. The prefix carries the human-readable intent; the suffix is data the user is asked to ignore in DB inspection.
- **The user's `name` is not the wire name.** The authoring DSL's `name` field and the IR's `name` field have different shapes (prefix vs. full). A small but real semantic gap to surface in developer-facing docs.
- **Collision probability.** 32 bits of suffix gives a 50% collision probability at roughly 65,000 distinct-bodied policies on the *same table* (birthday paradox on a 2^32 space). No realistic contract reaches that density. If it ever happens in practice, the verifier falls back to comparing canonical bodies directly as a tiebreaker and surfaces a diagnostic asking the user to rename one prefix.

## Alternatives considered

Four other designs were on the table before content addressing was chosen.

**Verbatim string match.** Identify by `(schema, table, name)`, compare `pg_policies.qual` against the authored body byte-for-byte. Free to implement; produces false positives on nearly every real predicate because of Postgres's reparse-on-store behavior. Rejected as practically unusable.

**Verbatim + cheap normalizer.** Same identity, but normalize whitespace, outer parens, and keyword casing on both sides before comparing. Trivial to implement and catches the easy cases. Still produces false positives on cast-form differences (`auth.uid()::uuid` vs `(auth.uid())::uuid`) and paren-grouping changes that aren't outer. Rejected because the failure mode is "verifier randomly fires on policies the user didn't change" — corrosive to trust.

**Canonicalize at CREATE.** After `CREATE POLICY`, read back `pg_policies.qual` to capture Postgres's canonical form, store *that* in `contract.json` alongside the authored body, and compare the canonical form at verification time. Robust against Postgres reparse drift. Rejected because it requires planner-runner support for the post-CREATE read-back (the planner needs to issue a query after every policy create), a second name/body field in the IR, and a tight coupling between planner success and IR contents. Content addressing achieves the same robustness without any of that.

**JS-side Postgres parser.** Bring a Postgres-grammar parser into the framework, canonicalize bodies into an AST, compare ASTs. Heaviest dependency, highest implementation risk, and the resulting parser would need to track Postgres versions. Rejected as outsized for the problem.
