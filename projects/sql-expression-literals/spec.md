# SQL expression literals — project spec

## Purpose

A schema author writes raw SQL the same way wherever a schema holds it, without escaping, and Prisma refuses anything else through the same type rule that admits every other written value. Today raw SQL is a `sql` literal in `@default` but a quoted string everywhere else, so the SQL in index predicates, CHECK constraints and RLS policies is full of `\"`.

## At a glance

```prisma
model Profile {
  id         String    @id @default(sql`gen_random_uuid()`)
  userId     String
  archivedAt DateTime?

  @@index([userId], where: sql`"archivedAt" IS NULL`, name: "profile_user_active")
  @@check(expression: sql`char_length("userId") > 0`, name: "profile_user_id_present")
}

policy_update profile_owner_write {
  target    = Profile
  roles     = [authenticated]
  using     = sql`"userId"::uuid = auth.uid()`
  withCheck = sql`"userId"::uuid = auth.uid()`
}
```

```ts
const owner = sql`"userId"::uuid = auth.uid()`;
check({ expression: sql`char_length("userId") > 0`, name: 'profile_user_id_present' });
policyUpdate(Profile, { name: 'profile_owner_write', roles: [authenticated], using: owner, withCheck: sql`${owner} AND "archivedAt" IS NULL` });
```

A `` sql`...` `` literal is a value of the data type `sql/expression` (ADR 254). Each place that takes raw SQL declares that it receives that type. `where: "(archived_at IS NULL)"` is refused because a quoted string is a `pg/text` value and `sql/expression` casts from nothing; the message ends with the rewrite, ``write it as sql`(archived_at IS NULL)` ``. In TypeScript a plain string in those fields does not compile.

The places are `@@index(where:)`, `@@index(expression:)`, `@@fullTextIndex(where:)`, `@@check(expression:)`, a policy's `using` and `withCheck`, and `@default`, which already takes `sql` literals and stores one as a default expression.

The decisions and their reasons are in [design-notes.md](design-notes.md). Every name, signature, message and file is fixed in [design.md](design.md). The slices and their order are in [plan.md](plan.md).

## Non-goals

- Editor support inside a `sql` literal: SQL highlighting and hover. They stay as described in [the editor tooling brief](../../docs/reference/psl-editor-tooling-tagged-literals.md).
- Completion at a block parameter value such as `using = |`; the language server offers none there today.
- Typing function arguments, such as the `8` in `nanoid(8)`. This project builds the building block and uses it only for raw SQL.
- The rest of ADR 254's follow-up work: DDL names, parameters, deriving `nativeType`, type constructors naming a type and a codec.
- Any check on the content of SQL outside `@default`. Prisma does not parse SQL; the database reports errors.
- `.default({ kind: 'function', expression })` in TypeScript, which stays accepted, and `.defaultSql()`, which TML-3286 removes at 8.0.0.
- The Prisma 7 reader's mapping of `dbgenerated(...)`.
- A `contract infer` printer for `@@fullTextIndex`, and the data-transform `SELECT EXISTS (…)` wrapper.
- Regenerating migration files that are already committed.
- Empty predicates and expressions, which render invalid DDL such as `WHERE ()` with strings today too.
- The Mongo family.

The complete list is in [design.md](design.md) section 21.

## Place in the larger world

- **ADR 129** defined the tagged-literal syntax and the `sql` tag for `@default`, and left these places as "a separate decision". This project is that decision. It removes the prefixed aliases `pg.sql` and `sqlite.sql` and adopts two alternatives ADR 129 had rejected, with new reasons.
- **ADR 254** gave every written value a data type, with `sql` as the one exception: a "lowering entry" that names no type. This project removes the exception, widens the definition of a data type to include `sql/expression`, and builds the argument building block ADR 254 promised.
- **ADR 255 and PR #30381** make block values use the same argument building blocks as attributes. This project builds on #30381 and gives policy predicates the same type as the attribute places.
- **ADR 231 and ADR 249** describe the argument building blocks and the spec context, which gains the stack's data types.
- **ADR 195** renders planner IR to TypeScript migration files; the stretch slice records an exception to its "same argument shapes" rule.
- **ADR 234, 243 and 244** name indexes, policies and checks by a hash of their SQL. The hash keeps line breaks in bodies that contain `--`; nothing else about it changes.

## Cross-cutting requirements

1. **One type, owned by the family.** The SQL family defines the data type `sql/expression` (which declares no casts), its authoring entry with the tag `sql`, and its canonical form, the text. The family registers the declaration and the entry itself, so every SQL target has the same ones. No prefixed tag exists.
2. **Admission by type.** Every place that takes raw SQL declares that it receives `sql/expression`, and the ordinary cast rule decides what is admitted, when the argument is parsed. Refusals use the same codes in `@default` and the six places. A refusal of a plain string ends with the exact rewrite.
3. **Checks on SQL text belong to the consumer.** `sql/expression` accepts any text the canonicalization accepts. `@default` keeps its refusals of `now()`, `autoincrement()`, `;`, comments, `$$` and `SELECT`, in PSL and in TypeScript. The other places add none.
4. **Same contract from PSL and TypeScript.** Every TypeScript `sql/expression` value is canonicalized as a PSL `sql` literal is, whether it comes from the `sql` tag, from interpolating other `sql` values, or from the constructor. The same SQL written in either language emits a byte-identical contract.
5. **Names and stored text.** For a body without `--`, the wire name of an index, check or policy does not change. The stored text changes only for a body that canonicalization changes (every line indented, a blank first or last line, a carriage return, a whitespace-only inner line), which changes the contract's storage hash once. A body that has both `--` and a line break gets a new wire name once. The upgrade instructions say what to do in both cases.
6. **Tools know the form.** The language server completes and documents `sql` in every attribute argument that takes it and colours `sql` literals. `contract infer` prints every place as a `sql` literal, and skips, with a note, an object whose SQL would not read back unchanged.
7. **Line comments in raw SQL are safe.** Every site that places contract SQL inside a statement renders it through one function, so a body whose last line ends in a `--` comment produces valid DDL.
8. **Migration files avoid escaped quotes.** A newly generated `migration.ts` writes a single-line SQL text holding both quote kinds as an untagged template literal. Migration files already committed keep loading and applying unchanged. `sql` values in migration files are a stretch goal.
9. **Breaking changes are documented for both audiences,** with a codemod that rewrites plain-string SQL in `.prisma` files.

## Transitional-shape constraints

- Each slice merges to `main` on its own and leaves `main` green.
- The slice that refuses plain strings in PSL (2b) regenerates, in the same dispatch, every committed artefact that uses them: the Supabase pack's `contract.prisma`, `examples/supabase`, the parity and CLI fixtures (F30).
- Between slices 2b and 3, PSL refuses plain strings while the TypeScript builder still takes them. Every committed TypeScript fixture uses single-line bodies, so both languages still emit identical contracts in that window.
- Migration files already committed keep loading and applying unchanged throughout.

## Contract impact

No shape change. `Index.where`, `Index.expression`, `CheckConstraint.expression` and `PostgresRlsPolicy.using` / `withCheck` stay strings holding the canonical text. `fixtures:check` shows no `contract.json` change. A user contract whose raw SQL is not canonical changes its stored text once (requirement 5).

## Adapter impact

Postgres and SQLite. The SQL family registers `sql/expression` and its entry; the targets do not. Each adapter registers its target's data types and entries unchanged, and no longer adds lowering entries or a prefixed tag. Both adapters render opaque SQL through one function. Postgres also owns policies, `@@fullTextIndex` and the `contract infer` printers. SQLite refuses expression and partial indexes and `@@check`, so on SQLite the type is used only by `@default`.

## ADR pointer

A new ADR 256, "Raw SQL is a value of the data type `sql/expression`", records the decision. ADRs 129, 195, 231, 234, 236, 243, 244, 249, 254 and 255 are amended briefly and link to it. Details are in [design.md](design.md) section 19.

## Project DoD

- A schema with a partial index, an expression index, a CHECK constraint and a policy with `using` and `withCheck`, written with `sql` literals, one spanning several lines, one ending in a `--` comment and one policy using `EXISTS (SELECT …)`, emits, migrates onto a real Postgres database and verifies clean. `contract infer` prints every text as a `sql` literal; the inferred schema emits and verifies clean against the same database; a second inference equals the first.
- A body whose last line ends in a `--` comment migrates successfully as a CHECK predicate, a policy predicate and a partial index predicate, and moving a line break around the comment changes the object's name.
- A plain string, a number or a boolean in any of the six places is refused in PSL with a message that says how to write the value, and does not compile in the TypeScript builder.
- `` pg.sql`...` `` and `` sqlite.sql`...` `` are refused as unknown tags.
- `@default` and the six places report cast-rule refusals with the same codes; the framework has no lowering-entry kind.
- `fixtures:check` shows no `contract.json` change for any existing fixture.
- A newly generated `migration.ts` writes a single-line SQL text holding both quote kinds as a template literal, and the committed example migrations still produce their committed `ops.json`.
- ADR 256 exists, the amended ADRs, docs and `prisma-8` skill references use the new form (checked by grep), and upgrade instructions with the codemod are recorded.
- The team DoD in [`drive/calibration/dod.md`](../../drive/calibration/dod.md) holds, including a manual QA script for each slice that changes diagnostics.

## Open questions

None. Serhii, the author of #30381, agreed on 2026-09-25 that block specs may receive the stack's data types.

## References

- [TML-3282](https://linear.app/prisma-company/issue/TML-3282): the decision ticket.
- PR #30381 and ADR 255: block specs.
- [ADR 129](../../docs/architecture%20docs/adrs/ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md), [ADR 254](../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md), [ADR 231](../../docs/architecture%20docs/adrs/ADR%20231%20-%20Declarative%20attribute%20specifications.md), [ADR 249](../../docs/architecture%20docs/adrs/ADR%20249%20-%20Central%20attribute-spec%20registry.md), [ADR 195](../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md), [ADR 234](../../docs/architecture%20docs/adrs/ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md), [ADR 243](../../docs/architecture%20docs/adrs/ADR%20243%20-%20Name-identified%20indexes%20and%20exact-name%20adoption.md), [ADR 244](../../docs/architecture%20docs/adrs/ADR%20244%20-%20Check%20constraints%20are%20opaque%20wire-named%20expressions.md).
- [prisma/orm#30350](https://github.com/prisma/orm/pull/30350): data types and casts.
- Reviews of the first design: [research/design-review-architect.md](research/design-review-architect.md), [research/design-review-principal-engineer.md](research/design-review-principal-engineer.md).
