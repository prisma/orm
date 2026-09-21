# Project spec — Remove `dbgenerated(...)` from Prisma 8

**Linear:** not yet created. **Branch:** `remove-dbgenerated-plan` holds these artifacts; each slice gets its own branch off `main`. **Shape:** project, three slices. Slices A and B run in parallel by different agents. Slice C runs after both have merged.

## Purpose

`@default(dbgenerated("..."))` lets a schema put arbitrary SQL into a column default as an unnamed string. ADR 167 accepted it as a stopgap while typed default literals were unfinished. It was never meant to ship in Prisma 8. This project removes it and builds the two things it was standing in for:

1. A designed way to write a raw SQL default: the ADR 129 tagged literal, written `@default(sql\`...\`)` or `@default(sql"...")` in PSL, and `.default(sql\`...\`)` in TypeScript.
2. The codec-owned PSL literal layer that ADR 184 decided and nobody built, so that every typed literal default (JSON, big integers, decimals, timestamps, and so on) is read from PSL and printed back to PSL by the column's codec, with no special cases in the interpreter or the printer.

When both exist, `dbgenerated` is deleted everywhere, the shipped Supabase contract is regenerated without it, and users get an upgrade instruction.

## Background the implementer needs

- **How a default is stored.** A column default in the contract is one of two shapes: `{ kind: 'literal', value }` or `{ kind: 'function', expression }`. The definition is [`packages/1-framework/0-foundation/contract/src/types.ts:128`](../../packages/1-framework/0-foundation/contract/src/types.ts). Nothing in this project changes that type. `dbgenerated("x")` lowers to the function shape with `x` as the expression, and so will the new tagged literal.
- **Who consumes the function shape.** The migration planner writes `DEFAULT (<expression>)` into DDL after a keyword check ([Postgres](../../packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts), [SQLite](../../packages/3-targets/3-targets/sqlite/src/core/migrations/planner-ddl-builders.ts)). The verifier compares expressions as lower-cased, whitespace-stripped text ([`resolved-default-equality.ts`](../../packages/2-sql/1-core/schema-ir/src/ir/resolved-default-equality.ts)). On Postgres, the verifier first runs the introspection parser over the authored expression so that `gen_random_uuid()` written by hand and `gen_random_uuid()` read from the catalog compare equal ([`default-normalizer.ts` `postgresResolveDefault`](../../packages/3-targets/3-targets/postgres/src/core/default-normalizer.ts)). SQLite has no such step today.
- **Where `dbgenerated` is registered.** Each target's control-plane default-function registry: [Postgres](../../packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts) and [SQLite](../../packages/3-targets/6-adapters/sqlite/src/core/control-mutation-defaults.ts). The same registries hold `autoincrement()`, `now()`, and the client-side generators `uuid()`, `cuid()`, `ulid()`, `nanoid()`.
- **Who produces it.** `contract infer` prints it for any Postgres default it cannot express as a literal or a named function ([`postgres-default-mapping.ts`](../../packages/3-targets/3-targets/postgres/src/core/psl-infer/postgres-default-mapping.ts)). The TypeScript builder's `.defaultSql("...")` produces the same shape. The Prisma 7 contract source ([`contract-prisma7/src/defaults.ts`](../../packages/2-sql/2-authoring/contract-prisma7/src/defaults.ts)) passes a Prisma 7 `dbgenerated("x")` through the registry, and separately turns `Bytes` and `DateTime` literal defaults into raw SQL text because the verify side cannot yet compare those types as values.
- **Who depends on it.** The shipped Supabase extension contract has 21 uses: 10 `gen_random_uuid()`, 4 JSON casts (`'{}'::jsonb`, `'[]'::jsonb`), 6 enum-value casts (`'confidential'::auth.oauth_client_type` and similar), and 1 expression `(now() + '00:03:00'::interval)`.
- **The prior decision.** The RC1 project recorded on 2026-07-20 that `@dbgenerated()` retires in favour of ADR 129 tagged literals ([`projects/prisma-8-rc1/feature-surface.md`](../prisma-8-rc1/feature-surface.md), item 6). That decision stands. Only the raw SQL syntax part of it is in this project. Mixins and type constructors are not.

## Decisions

Each decision is final. An implementer who finds one of them impossible stops and reports; they do not pick an alternative.

### D1. The contract representation does not change

A raw SQL default stays `{ kind: 'function', expression }`. A typed literal default stays `{ kind: 'literal', value }` with the value in the codec's JSON form. Every emitted `contract.json` from before this project loads unchanged. Whether a raw SQL default should later become a content-addressed payload (ADR 129's `ext` envelope with a body hash, like index expressions, check constraints, and RLS predicates) is a separate decision, recorded in [`deferred.md`](deferred.md), to be made after this project ships.

### D2. Raw SQL is written as a tagged literal with two fences

PSL: `@default(sql\`gen_random_uuid()\`)` and `@default(sql"gen_random_uuid()")`. The backtick fence is the default form. The double-quote fence exists for a body that contains many backticks. Both fences are equivalent after canonicalization. TypeScript: `.default(sql\`gen_random_uuid()\`)` with a `sql` template tag. The full grammar, escaping, canonicalization, and lowering rules are in [slice A](slices/a-sql-default-literal/spec.md).

### D3. Tags are registered by targets; the unprefixed tag is target-provided

A tag is a qualified identifier: one or more identifiers joined by dots. The unprefixed tag `sql` is registered by every SQL target (Postgres and SQLite) through a shared implementation the SQL family exports. Each target also registers its own prefixed alias: `pg.sql` on Postgres, `sqlite.sql` on SQLite. A tag is only known when the pack that registers it is part of the contract's stack; an unknown tag is a diagnostic that lists the known tags. Any extension other than the family and the target must use a prefix. This rule is recorded as an amendment to ADR 129.

### D4. The SQL body is used verbatim

The canonicalized body is the expression. Nothing rewrites it at authoring time, in the contract, or in DDL: both planners render the authored expression, not the normalised form they compare. The SQLite adapter's authoring-time rewrite of `CURRENT_TIMESTAMP`, `datetime('now')`, and `datetime("now")` to `now()` is deleted with `dbgenerated`. An empty body is passed through like any other body; the database reports the error. Two authoring-time checks apply, in PSL and TypeScript alike: the planners' existing safety rule, moved earlier so it has a source span (a body containing `;`, `--`, `/*`, `$$`, or the word `SELECT` is rejected), and a body that is exactly `now()` or `autoincrement()` is refused with a hint to write the named function, because those two texts are Prisma markers the planners render specially.

### D5. SQLite compares defaults exactly the way Postgres does

Both targets run their introspection parser over the expression in the contract before comparing it to the expression the database reports, in planning and in verification alike, so the two are compared in the same form and a second plan after applying a raw default plans nothing. The comparison is only a comparison: DDL renders the authored expression (D4). The comparison logic itself is not changed in this project; see [`deferred.md`](deferred.md) item 1.

### D6. Named defaults are Prisma concepts; database functions are raw SQL

No named default function is added. `now()` and `autoincrement()` stay named because they work on every SQL target and the planners treat them specially. A database function such as `gen_random_uuid()` is written as `` @default(sql`gen_random_uuid()`) ``. (Amended 2026-09-17 after Serhii's review. The first version registered `gen_random_uuid()` as a named Postgres function. That name read like Prisma's own `uuid()`, which generates the value client-side before the insert, while `gen_random_uuid()` makes the database generate it, and nothing in either name showed the difference.)

### D7. TypeScript gets the same forms

The SQL family contract builder exports `sql` (template tag), `now()`, and `autoincrement()`. All return a function-kind default accepted by `.default()`. `.defaultSql()` stays, marked `@deprecated` with a message naming the replacement, and is deleted at 8.0.0 GA. Every `.defaultSql(...)` call inside this repository is rewritten to the new forms.

### D8. A list column takes storage defaults, except `autoincrement()`

Nobody can tell from a function's name whether it returns a value of the column's type, for a list column or for any other column. That is the author's responsibility and the database reports the error if it is wrong. So `tags String[] @default(sql`'{}'::text[]`)` and `tags DateTime[] @default(now())` both lower. Two defaults are still refused on a list column: client-side generators (`uuid()`, `cuid()`, `ulid()`, `nanoid()`), which generate one value, and `autoincrement()` (`PSL_LIST_AUTOINCREMENT_UNSUPPORTED`), which is a Prisma marker for a sequence-backed scalar column rather than SQL and would otherwise be rendered as a scalar `SERIAL` column with no error from the database.

### D9. Codecs own the PSL form of every literal

`encodePsl` and `decodePsl` become required members of the framework `Codec` interface and abstract members of `CodecImpl`. Every codec class in the repository implements them, including Mongo codecs. The interpreter passes a literal's normalised content and kind to the column codec's `decodePsl` and stores the result through `encodeJson` as today. The printer calls `encodePsl` and writes the result. The numbers-only shortcut in the interpreter, the per-codec formatter table in the Postgres infer printer, and the Prisma 7 source's JSON literal handling are all deleted. The full interface, the rule for what each codec's PSL form is, and the list of codecs are in [slice B](slices/b-codec-psl-literals/spec.md). ADR 184 is amended to say this was always the design and the interface is a consumer interface satisfied by the pack's codecs, not a separate entity.

### D10. The codec receives normalised content, not source text with fences

`decodePsl` receives `{ kind, text }` where `kind` is `string`, `number`, or `boolean`, and `text` is the literal's content with the quotes removed and escape sequences resolved for a string, the digits exactly as written for a number, and `true` or `false` for a boolean. The codec never sees the fence. A number is never converted to a JavaScript number before the codec sees it. `encodePsl` returns the same shape and the printer adds quotes and escapes.

### D11. The DDL side of ADR 184 is out of scope

`encodeDdl` and `decodeDdl` are not built. The consequence: the Prisma 7 source keeps turning `Bytes` and `DateTime` literal defaults into raw SQL expressions, because verify cannot yet compare those as typed values. That is recorded in [`deferred.md`](deferred.md).

### D12. `contract infer` prints the new forms and never a gap

When a Postgres default is a named function, infer prints the named function. When the column codec can read it as a literal, infer prints the literal through `encodePsl`. Otherwise infer prints `@default(sql\`<expression>\`)`, switching to the double-quote fence when the expression contains a backtick. Infer never emits a comment in place of a default and never stops on one. The family printer's `// Raw default:` comment fallback is deleted.

### D13. The Prisma 7 source maps `dbgenerated` directly

A Prisma 7 `@default(dbgenerated("x"))` lowers directly to `{ kind: 'function', expression: 'x' }` without going through the default-function registry. A Prisma 7 `@default(dbgenerated())` with no argument lowers to no column default at all, on every field, with no diagnostic. The contract then says the column has no default and the migration and runtime systems act on that. The current diagnostic for the empty form on required fields is deleted.

### D14. Editor tooling is mostly a hand-off

Slice A implements completion of registered tags inside `@default(`, because the attribute specification already carries the tags. Hover, SQL highlighting inside backtick strings, and anything further go to Serhii in a written brief from slice C.

## Non-goals

- Mixins, field presets, type aliases, type constructors (the rest of the 2026-07-20 decision).
- Content-addressing raw SQL defaults (deferred, D1).
- Migrating index expressions, check constraint bodies, and RLS predicates from plain strings to tagged literals (deferred).
- `encodeDdl` and `decodeDdl` (deferred, D11).
- New named storage default functions.
- Any change to Mongo authoring. Mongo codecs implement the new methods; nothing calls them yet.

## Cross-cutting requirements

- **No contract format change.** A test in slice C loads the Supabase pack's previous `contract.json` (the one committed before regeneration) through the normal loader and asserts it validates. Contract hashes of unchanged contracts must not move.
- **No rewriting of SQL bodies anywhere** (D4).
- **No backward-compatibility shims** other than the deprecated `.defaultSql()` (D7). `@default(dbgenerated(...))` is a hard error after slice C.
- **Every removed spelling is swept from docs, READMEs, error reference, scorecards, skills, and examples.** The grep in slice C's definition of done is the check.
- **Diagnostics have spans.** Every new diagnostic points at the literal or attribute that caused it.
- **Plain language in every artifact and message.** No invented terms.
- **Tests before implementation** per repository rules. Each slice spec lists the tests that must exist and be red before the change that turns them green.

## Contract-impact

Entities affected: `ColumnDefault` (unchanged shape, new producers). `Codec` interface (two new required members, slice B). `ControlMutationDefaults` (a new tag registry beside the function registry, slice A). No migration of stored contracts.

## Adapter-impact

- Postgres adapter: registry gains the tag registry; loses `dbgenerated`.
- SQLite adapter: registry gains the tag registry; loses `dbgenerated` and the `NOW_SYNONYMS` rewrite.
- Postgres target: infer prints the new forms; codecs implement PSL methods.
- SQLite target: verify-side default resolution hook; codecs implement PSL methods.
- Mongo: codecs implement PSL methods; nothing else.
- Extensions: pgvector, postgis, arktype-json codecs implement PSL methods. Supabase contract regenerated.

## ADR pointers

- ADR 129 — amended in slice A: two fences, tag registration rule (D3), canonicalization applies to both fences, the `TaggedLiteral` node's fields as built.
- ADR 184 — amended in slice B: `encodePsl` and `decodePsl` are required members of `Codec` (D9, D10); the "single interface" alternative is not rejected for PSL; DDL methods remain future work.
- ADR 167 — note added in slice C: the `dbgenerated(...)` stopgap is removed and what replaced it.

## Definition of done (project)

- All three slices merged to `main`.
- `git grep -n dbgenerated -- packages examples test docs skills upgrade-instructions scorecard` returns only: the ADR 167 note, the upgrade instruction, the Prisma 7 source's handling of the Prisma 7 language and its fixtures, and CHANGELOG or release-notes history.
- `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm fixtures:check`, `pnpm lint:deps`, `pnpm lint:docs`, and the root typecheck are green on `main`.
- The Supabase reference-fixture verify test is green against the regenerated contract.
- The three ADR amendments are merged.
- The Serhii brief exists at `projects/remove-dbgenerated/editor-tooling-brief.md` and is handed over before close-out moves it to `docs/`.
- Final retro run; `projects/remove-dbgenerated/` deleted at close-out after long-lived content moves to `docs/`.

## Decision log

Conclusions from the shaping discussion on 2026-09-16, with reasons, assumptions, and rejected alternatives.

**Remove it, and replace it with the ADR 129 tagged literal.** Why: the 2026-07-20 team decision already chose this; the brief's Option A (named functions plus typed literals, gaps reported) would leave real defaults such as `(now() + '00:03:00'::interval)` unwritable; Option C (keep it) was never accepted by anyone. Assumes the 2026-07-20 decision stands. Confirmed by the operator.

**Keep the contract representation.** Why: `dbgenerated` already lowers to the function shape, every consumer works on it, and changing it would touch the planner, verifier, printer, emitter, and Prisma 7 source for no gain in this project. Alternative rejected for now: ADR 129's hashed `ext` payload. Deferred, not rejected.

**Bare `sql` tag, target-registered.** Why: `pg.sql` is cumbersome; users should write `sql`. The target registers it rather than the family because nobody is certain the tag's behaviour will never vary by target; a shared implementation lives in the family. Alternative rejected: family-registered unprefixed tag.

**Two fences.** Why: a body with many backticks needs a fence that is not a backtick. Alternative rejected: backtick only (ADR 129 as written).

**Verbatim bodies.** Why: a person who writes a SQL literal expects that SQL to be used. Alternative rejected: authoring-time rewrites of known synonyms (the SQLite `NOW_SYNONYMS` behaviour).

**Keep `.defaultSql()` deprecated until GA.** Why: operator decision; it is a small surface and users have contracts using it. This overrides the repository's no-backward-compatibility rule for this one member.

**Rewrite in-repo `.defaultSql` calls to named helpers where a helper exists.** Why: consistency between PSL and TypeScript; `now()` and `autoincrement()` already exist in PSL, so TypeScript gets the same names.

**Codec interface, not a separate registry.** Why: the PSL literal form is part of what owning a type means; a separate registry keyed by codec ID would be the same information in a second place. The methods are required with no base-class default so that no codec's PSL form is implicit.

**Normalised content to the codec, no pre-parsing.** Why: converting a number literal to a JavaScript number before the codec sees it loses precision for big integers and decimals. Alternative rejected: passing source text with fences (the codec has no business with PSL quoting).

**DDL side out of scope.** Why: no strong reason to do it now; the Prisma 7 source's workaround for bytes and timestamps is contained and recorded.

**Infer prints, never stops.** Why: infer's job is to describe the database faithfully; a user adopting a database should not be halted on a default they then have to add by hand. Alternative rejected: reporting a gap and stopping.

**Empty Prisma 7 `dbgenerated()` means no default.** Why: the contract states whether a column has a default; the migration and runtime systems act on that; extra validation in the reader is a special case. Alternative rejected: the current diagnostic on required fields.

**List columns take storage defaults, except `autoincrement()`.** Why: the interpreter cannot know any function's return type, for lists or for anything else, so refusing storage functions on lists alone was a special case. Client-side generators are refused because a generator produces one value; `autoincrement()` is refused because it is a Prisma marker, not SQL, and the Postgres planner would silently render a scalar `SERIAL` column. Alternative rejected: the previous rule from the infer round-trip project, which kept the refusal to move a type error from DDL time to authoring time; the operator prefers the database to report it.

**No named `gen_random_uuid()`.** Why: Serhii pointed out that `uuid()` (client-side generator) and a named `gen_random_uuid()` (database default) both read as "make a UUID" with the difference hidden. A Postgres function name dressed as a Prisma function also contradicts ADR 129's rule that raw SQL looks raw. Alternative rejected: keeping the named function for the Supabase contract's ten uses; `` sql`gen_random_uuid()` `` lowers to the same contract.

**Persona cross-pollination.** Scope was settled under the product lens first (remove, replace, deadline is "before GA", tooling is a hand-off). Shape under the architect lens (two independent pieces meeting at the removal step). Buildability under the principal-engineer lens is in the slice specs.
