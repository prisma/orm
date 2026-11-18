# Domain-enum inference — Spec

> **Note (2026-10-15).** `@noCheck` was removed (TML-3595). Path B below emits `@noCheck(membership)`, so it no longer works as written and must be redesigned before this project starts. Today a column with a hand-written membership check pulls as `String` plus `@@check(map:)`. Typing it by an enum would derive a second membership check beside the live one.


**Related:** [sql-check-constraint-unification](../sql-check-constraint-unification/spec.md) (this closes the gap that project's § Non-goals left open) · [ADR 244](../../docs/architecture%20docs/adrs/ADR%20244%20-%20Check%20constraints%20are%20opaque%20wire-named%20expressions.md)

## Purpose

Make `contract infer` recover a text-backed domain enum from a live database, so pulling a schema whose column is constrained to a fixed value set gives back an `enum` rather than a bare `String`.

## At a glance

A database that constrains a column by hand:

```sql
CREATE TABLE users (id int PRIMARY KEY, role text NOT NULL);
ALTER TABLE users ADD CONSTRAINT chk_role CHECK (role IN ('user', 'admin'));
```

Pulled today — the value set is lost, and the column is a plain string:

```prisma
model Users {
  id   Int    @id
  role String

  @@check(expression: "(role = ANY (ARRAY['user'::text, 'admin'::text]))", map: "chk_role")
  @@map("users")
}
```

Pulled after this project:

```prisma
enum UsersRole {
  @@type("pg/text@1")
  user  = "user"
  admin = "admin"
}

model Users {
  id   Int       @id
  role UsersRole @noCheck(membership)

  @@check(expression: "(role = ANY (ARRAY['user'::text, 'admin'::text]))", map: "chk_role")
  @@map("users")
}
```

The column now carries the union type, `db.enums.UsersRole` exists, and `ORDER BY role` sorts in declaration order — while the constraint itself is still declared verbatim, so `db verify` stays clean and no plan touches it.

## The mechanism

**Harvesting decides the type. It never decides the constraint.**

Postgres does not hand back the predicate you wrote. `CHECK (role IN ('user','admin'))` on `text` comes back as `(role = ANY (ARRAY['user'::text, 'admin'::text]))`; on `varchar` as `((role)::text = ANY ((ARRAY['user'::character varying, …])::text[]))`; a single-member check collapses to `(role = 'user'::text)`. **None of that matters here**, because inference does not interpret the predicate's structure. It harvests the single-quoted literals in order, unescapes doubled quotes, and discards casts. Every reprint shape above yields `['user', 'admin']` under that treatment.

This is the distinction from the predicate parser slice 1 deleted. That parser matched predicate *shapes* with anchored regular expressions — which is why `(status)::text` defeated it — and its output was load-bearing for equality and DDL, so an unrecognised predicate silently vanished from the diff. Harvesting matches no shape, and its output reaches only the type surface.

Two paths, chosen by whether the live constraint carries a Prisma Next content hash.

### Path A — the check is one Prisma Next created (wire-named)

The constraint is named `<table>_<column>_check_<8hex>`, where the hash commits to the text authoring rendered. So the harvest can be **proven**: render `"<column>" IN (<harvested values>)` through `postgresRenderCheckExpressions`, hash it with `computeCheckContentHash`, compose the wire name with `composeCheckWirePrefix`, and compare against the live constraint's actual name. A match proves the harvested list is exactly the list some contract declared — wrong order, wrong members, wrong escaping and wrong column all produce a different hash.

On a match, emit **only** the enum block and the typed column. Authoring re-derives the identical wire-named membership check on the next `contract emit`, so the constraint round-trips as a derived check. No `@@check`, no `@noCheck`.

On no match, fall through to Path B.

### Path B — the check is not one Prisma Next created (exact-named)

There is no hash, because Prisma Next never wrote the predicate. The harvest cannot be proven, so it is not asked to carry anything that would be unsafe if wrong. Emit three things:

- the **enum block and typed column**, from the harvest — this is the type surface, and the only thing a wrong harvest can spoil;
- **`@noCheck(membership)`** on the column, so authoring does not derive a second membership check beside the one already live;
- **`@@check(expression: <reprint verbatim>, map: "<live name>")`**, which declares the actual constraint. Slice 4 already compares this form byte-for-byte, and because the stored text is Postgres's own print, it matches on every subsequent verify.

The constraint's identity therefore never depends on the harvest. If someone edits the predicate out of band later, the byte comparison reports drift — the correct outcome, and the same behaviour any adopted check already has.

### What a wrong harvest costs

A wrong or failed harvest on Path B produces a wrong TypeScript union on one column. It cannot produce a wrong constraint, a spurious migration operation, or a silent constraint drop. The user's remedy is to edit the emitted enum, which is a normal thing to do to inferred PSL — the pull is a starting point, not a finished contract.

## Locked decisions

1. **A harvest that yields no literals recovers nothing.** The column stays `String` and the check stays a plain `@@check`, exactly as today. No heuristics about what "looks like" an enum beyond "the predicate mentions this column and contains string literals".
2. **Only single-column predicates are candidates.** If the reprint references any column other than the one under consideration, it is not a membership check for that column and is left alone. This is a containment rule, not a parse: it is decided by identifier presence, not by predicate structure.
3. **Path A emits no `@@check` and no `@noCheck`.** Anything else would double-declare a constraint authoring is about to derive.
4. **Path B always emits `@@check(map:)`.** The constraint is declared verbatim whether or not the harvest succeeded, so an unrecoverable predicate is never worse off than today.
5. **Recovered enums are split per column, not shared.** Two columns with identical value sets get two enums. Sharing is what a human would author, but it silently couples the columns — widening one later requires splitting — and there is no non-arbitrary name for a set belonging to neither column. Merging is a follow-up, and a hand-edit away.
6. **The enum's name is derived from table and column** (`toEnumName(`${table}_${column}`)` → `UsersRole`), reserved against model names, native-enum names, and PSL scalar type names, with the existing numeric-suffix disambiguator on collision. A domain enum has no `@@map` escape hatch — its name *is* its contract key (`entries.valueSet[<name>]`) — so the name must be right at emit time, and it must never throw: `contract infer` must not fail on a legal schema.
7. **Member names come from `toEnumMemberName(value)`**, deduplicated within the block by the existing helper, with the value carried explicitly (`user = "user"`). Values are the only thing the database has; names are derived.
8. **The codec id comes from the column's `nativeType`** (`text` → `pg/text@1`, `character varying` → its codec), emitted as the block's `@@type`.
9. **Native enums are untouched.** They already infer, by a different route (`pg_type`), and keep it.

## Structural work this requires

**Domain `enum` blocks must be top-level; infer currently emits one namespace.** A family `enum` inside `namespace { … }` is a hard diagnostic (`PSL_ENUM_NAMESPACE_NOT_SUPPORTED`), and infer applies that wrap whenever the pulled database has a native enum or an RLS policy — so on such a database a recovered domain enum and the wrap are mutually exclusive today.

This is smaller than it first appears. `PslDocumentAst.namespaces` is already an array; `UNSPECIFIED_PSL_NAMESPACE_ID` already names the flat bucket; the printer already sorts that bucket first (`astDocumentToPrintDocument`) and prints its contents with no wrapper, precisely so top-level declarations round-trip to top-level output (`serialize-print-document.ts:94-99`). Nothing about the document shape needs to change. What needs to change is that `buildPslDocumentAst` constructs exactly one namespace: it must construct two when there is top-level content — the flat bucket for recovered enums, the named one for models, native enums and policies.

**Infer's `@noCheck` emission is gated on list columns.** The waiver block only runs for `column.many === true`, so a scalar domain-enum column cannot currently be given `@noCheck(membership)`. Path B needs that gate lifted. The authoring side already accepts a membership waiver on any domain-enum column, so this is an infer-side change only.

**The derived-name set needs the harvested values threaded through.** `computeDerivedCheckNames` passes `memberValues: undefined` today, with a comment written for this project. Passing the recovered values makes the membership check's wire name land in that set, which makes the existing `@@check` emission skip it automatically — so Path A's "no `@@check`" falls out of the mechanism already there rather than needing new exclusion logic.

## Definition of Done

- A database whose enum column was created by Prisma Next round-trips: emit → migrate → infer returns the same enum, the same member order, and a contract that verifies clean with no pending operations.
- A never-migrated database with a hand-written membership check pulls into an enum plus `@noCheck(membership)` plus `@@check(map:)`, and `db verify --schema-only` is clean immediately — including `--strict`.
- A wire-*shaped* constraint name whose hash does not verify recovers nothing via Path A and falls to Path B. (There is an existing fixture for this: a real one-member check created under the fake name `t_role_check_0a1b2c3d`.)
- A predicate that is not a membership test (`cardinality(tags) > 0`, a composite `AND`, a numeric comparison) recovers nothing and still emits its `@@check`.
- Recovery works on a database that also has a native enum and an RLS policy — the namespace-wrap conflict is resolved, not avoided.
- Enum naming never throws: collisions with models, native enums, and PSL keywords all disambiguate.
- The reprint corpus is captured first, against a real database, for every shape recovery claims to handle: `text` with one member, `text` with 2+, `varchar` with one, `varchar` with 2+, and the enum-array `<@` form. Two single-member fixtures currently in the tree are hand-written and suspect — one on a `text` column, one on `varchar`; each is replaced with the captured reprint for its own column type.
- Existing infer tests that assume no domain enum is recovered are updated deliberately, each diff reviewed as intent.

## Non-goals

- **Recovering an enum from anything but a check constraint.** No inference from column comments, lookup tables, or naming conventions.
- **Merging identical value sets into one enum** (decision 5).
- **Interpreting predicate structure.** Harvesting literals is not parsing, and this project adds no predicate parser.
- **Changing how native enums infer.**
- **Recovering member *names*.** The database has values only.

## Alternatives considered

- **Reinstate a predicate parser.** Rejected for the reasons ADR 244 gives, and unnecessary: matching predicate shapes is what broke before, and neither path here matches a shape.
- **Verified recovery only (Path A alone).** Safe and cheap, but it does not close the case that motivated the project — a brownfield database has no Prisma Next hash — so it would ship round-trip fidelity while leaving adoption exactly as it is.
- **Harvest, and let the recovered enum own the constraint on Path B** (no `@@check(map:)`). Rejected: authoring would then derive a wire-named check that does not exist in the database, planning a rename or a drop-and-add of a constraint the user never asked to touch. Declaring the live constraint verbatim keeps the harvest out of the constraint's identity entirely.
- **Ask the user to confirm each recovery interactively.** Rejected: `contract infer` is a non-interactive command used in scripts, and the emitted PSL is already meant to be reviewed and edited.
