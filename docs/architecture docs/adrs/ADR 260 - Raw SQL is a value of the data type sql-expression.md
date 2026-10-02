# ADR 260 — Raw SQL is a value of the data type `sql/expression`

**Status:** Accepted. Built: the data type, the `sql` tag, and the six PSL places. Decided and not yet built: the TypeScript builder's `sql` values (the TypeScript examples below show that surface as planned) and the wire-name rule for line comments.
**Date:** 2026-09-30
**Builds on:** [ADR 129 — Tagged literals write values of data types](ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md), [ADR 231 — Declarative attribute specifications](ADR%20231%20-%20Declarative%20attribute%20specifications.md), [ADR 254 — Data types and casts](ADR%20254%20-%20Data%20types%20and%20casts.md), [ADR 255 — Block specs bind top-level block values](ADR%20255%20-%20Block%20specs%20bind%20top-level%20block%20values.md)

---

## At a glance

Every place in a schema that holds raw SQL takes a `sql` literal, and only a `sql` literal:

```prisma
model Post {
  id        Int       @id
  authorId  String
  title     String
  createdAt DateTime  @default(sql`now() - interval '1 day'`)
  archived  DateTime?

  @@rls
  @@index([authorId], where: sql`"archived" IS NULL`)
  @@index(expression: sql`lower("title")`, map: "post_title_lower_idx")
  @@check(expression: sql`
    length("title") > 0
    AND length("title") < 200
  `, name: "post_title_length")
}

policy_update post_owner_write {
  target    = Post
  roles     = [authenticated]
  using     = sql`"authorId"::uuid = auth.uid()`
  withCheck = sql`"authorId"::uuid = auth.uid()`
}
```

The places are `@default`, `@@index(where:)`, `@@index(expression:)`, `@@fullTextIndex(where:)`, `@@check(expression:)`, and a policy's `using` and `withCheck`. A plain string in any of them is refused, and the message says what to write:

```text
PSL_VALUE_TYPE_INCOMPATIBLE: sql/expression has no cast from pg/text; write it as sql`"archived" IS NULL`
```

The TypeScript builder follows the same rule. As planned, the `sql` tag returns a `SqlExpression`, every builder field that takes raw SQL accepts only that value, and one `sql` value may be interpolated in another:

```ts
const owner = sql`"authorId"::uuid = auth.uid()`;

policyUpdate(Post, {
  name: 'post_owner_write',
  roles: [authenticated],
  using: owner,
  withCheck: sql`${owner} AND "archived" IS NULL`,
});
check({ expression: sql`length("title") > 0`, name: 'post_title_nonempty' });
```

## Decision

Raw SQL is a value of one data type, `sql/expression`. The SQL family defines it and registers it, with `sql` as its tag. Each place that takes raw SQL declares that it receives `sql/expression`, and the cast rule of [ADR 254](ADR%20254%20-%20Data%20types%20and%20casts.md) decides what it admits. `sql/expression` declares no casts and no data type casts from it, so the only value a place admits is a `sql` literal. Plain strings, numbers and booleans are values of other types and are refused by that rule, not by a separate syntax check. Prisma never parses the SQL inside the literal.

## Why

**The type, not the syntax, decides what a place admits.** [ADR 254](ADR%20254%20-%20Data%20types%20and%20casts.md) gives every written value a data type, `sql` included. Because `sql` names a data type, a place that takes raw SQL is a position of a fixed type, like any other, and the rule that refuses `@default("abc")` on an `Int` column also refuses `where: "x > 0"`. No second mechanism exists to keep in step with the first.

**SQL in these places is hard to write as a quoted string.** Prisma names columns after fields, so the SQL usually quotes camelCase column names. A quoted PSL string needs `\"` for each of them, as in `"\"userId\"::uuid = auth.uid()"`. A `sql` literal needs no escaping, may span lines, and shows that its text is raw SQL.

**One way to write raw SQL.** Accepting both forms would give two ways to write the same value, with nothing gained. There is one syntax to print, document and complete.

## Every place takes a `sql` literal, and plain strings are refused

The places are `@default`, `@@index(where:)`, `@@index(expression:)`, `@@fullTextIndex(where:)`, `@@check(expression:)`, and a policy's `using` and `withCheck`. The canonical text of a literal is what the contract stores (ADR 129). A quoted string rewritten as a `sql` literal keeps its text, except where canonicalization removes indentation shared by every line, blank lines at the start or end, a whitespace-only line or a carriage return; the stored text then changes once. The hash behind wire names is computed from whitespace-collapsed text, so no wire name changes, except for a text that holds both `--` and a line break, which gets a new name once (see below).

Plain strings are refused everywhere. This is a breaking change; the project keeps no code for backward compatibility, and upgrade instructions with a codemod rewrite existing schemas.

## `@default` is the one place with checks of its own

`@default` stores a `sql/expression` value as a function-kind column default; any other value is cast to the column's type. It keeps its refusals: the texts `now()` and `autoincrement()`, and a text that holds `;`, a comment marker, `$$` or `SELECT` (`PSL_INVALID_DEFAULT_SQL`). These checks follow from how a default is rendered and compared, so they belong to `@default`, not to the type. The other places check nothing about the text, because a row-level-security predicate often holds `EXISTS (SELECT ...)`. A check on SQL content belongs to the place that receives the value.

## The SQL family defines and registers `sql/expression`

`@@index` and `@@check` belong to the SQL family, so the family must name the type they receive. It exports the id `sql/expression`, the data type (no casts) and its authoring entry, from `@internal/sql-contract/sql-expression`, and registers them itself, so every SQL target has the same type and the same tag. A stack holds one target, so the family's registration never meets another. The rule "nothing casts from `sql/expression`" is what refuses a plain string, so the family also refuses a stack in which a data type declares such a cast (`CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION`).

This is not the "family-level vocabulary of written types" ADR 254 rejects. That alternative put family types in front of each target's real types through pass-through casts. `sql/expression` has no casts and no column has it.

## The only tag is `sql`

`pg.sql` and `sqlite.sql` do not exist. The target fills the slot the family names, so a prefix says nothing the stack does not already say, and one tag per type keeps one way to write a value. A prefixed tag is an unknown tag, `PSL_UNKNOWN_LITERAL_TAG`.

## Specs name the data type an argument receives

An argument in an attribute spec or a block spec declares the data type it receives with `dataTypeValue(dataType, ctx.dataTypes)` ([ADR 231](ADR%20231%20-%20Declarative%20attribute%20specifications.md)). It reads any literal, applies the cast rule while the argument is parsed, reports refusals at the written value, and returns the canonical value. The index and check specs build it from `AttributeSpecContext.dataTypes` ([ADR 249](ADR%20249%20-%20Central%20attribute-spec%20registry.md)); the policy specs build it from `BlockSpecContext.dataTypes` ([ADR 255](ADR%20255%20-%20Block%20specs%20bind%20top-level%20block%20values.md)):

```ts
function checkModelSpec(ctx: AttributeSpecContext) {
  return modelAttribute('check', {
    documentation: 'Declares a named database CHECK constraint on this table.',
    named: {
      expression: {
        type: dataTypeValue(SQL_EXPRESSION_DATA_TYPE_ID, ctx.dataTypes),
        documentation: 'The nonempty SQL predicate checked for each row.',
      },
      // name, map
    },
  });
}
```

Admitting a value of a data type picks no codec and no stored representation, so block specs may read the stack's data types without making parsing depend on codecs. Checking a value reads only the literal's syntax and tag.

The language server completes `sql` wherever an argument receives `sql/expression`, and colours the tag as a keyword and the literal as a string.

## The TypeScript builder follows the same rule

As planned, the `sql` template tag returns a `SqlExpression`, a value of `sql/expression` whose text is canonical. `.default()` and every builder field that takes raw SQL (`index`'s `where` and `expression`, `check`, `fullTextIndex`'s `where`, a policy's `using` and `withCheck`) accept it, and a plain string does not compile. The refusals specific to defaults move from the tag into `.default()`.

The tag accepts other `sql` values inside `${…}` and refuses anything else there. It joins the pieces and canonicalizes the whole text once. The `SqlExpression` constructor canonicalizes too, so no way of making a value skips it.

Why: PSL removes the common indentation of a multi-line literal, and a TypeScript template string keeps it. Without the tag, the same SQL would get the same wire name but different text in `contract.json`, and PSL and TypeScript would stop emitting byte-identical contracts (ADR 129). Interpolation exists because TypeScript contracts reuse a predicate across policies; without it, authors would build SQL some other way and skip the canonicalization.

## Wire names keep line breaks in text that holds `--`

`normalizeSqlBody`, which prepares SQL text for the content hash in index, check and policy wire names ([ADR 234](ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md)), collapses all whitespace, line breaks included, to one space. So `a -- note⏎OR b` and `a -- note OR b` get the same name, although in the second `OR b` is part of the comment, and a fix made by adding a line break would plan as no change. Decided: when the text holds `--`, `normalizeSqlBody` keeps its line breaks. Text without `--` hashes exactly as before. Multi-line `sql` literals make line comments likely, which is why the rule belongs to this decision.

## One set of codes for the cast rule

`@default` and the six places report refusals of the shared read and cast functions with the same codes: `PSL_VALUE_TYPE_INCOMPATIBLE` (no cast from the written value's type), `PSL_INVALID_LITERAL` (an entry or a cast refused the value) and `PSL_UNKNOWN_LITERAL_TAG`. The framework's `describeRefusal` words them. A refusal ends with what to write: ``write it as sql`...` `` with the exact rewrite for a quoted string, `write it as a sql literal` when that rewrite would read back as different text, or the forms the type admits, such as ``write sql`...` ``. Default-only refusals keep default-only codes. ADR 254 says defaults and other positions are admitted by one rule, so users and tools see it under one name.

## Consequences

- A PSL or TypeScript schema that writes raw SQL as a plain string stops working. The upgrade instructions carry a codemod that rewrites every place in a `.prisma` file.
- A stored text may change once, where canonicalization removes indentation shared by every line, blank lines at the start or end, a whitespace-only line or a carriage return. Wire names do not change, because canonicalization removes only what the wire-name normalizer already ignores; this holds for a text with a line comment too, since the normalizer's line-comment rule (ADR 234) drops the same blank lines and collapses the same whitespace per line. For a wire-named index, check or policy, one `migration plan` after upgrading records the new text, and the migration has no operations. For an index or check named with `map:`, `migration plan` stops with a conflict that asks for a custom migration written with `migration new`; the database needs no change, so that migration has no operations. For a policy named with `@@map`, `migration plan` writes a migration that drops the policy and creates it again with the canonical text, because `migration plan` allows destructive operations.
- `contract infer` prints each place as a `sql` literal. It prints a wire-named index whose text would not read back unchanged with its canonical text, which hashes to the same name. It skips an exact-named object whose text would not read back, with a note that the object is not in the schema, that the next plan will drop it, and that adding it by hand still differs from the database (ADR 129). `contract print` refuses any object whose text would not read back.
- An extension that builds spec contexts supplies the stack's data types in `AttributeSpecContext.dataTypes` and `BlockSpecContext.dataTypes`.

## Alternatives considered

- **Accept plain strings beside `sql` literals.** Rejected. Two ways to write the same value, with no benefit.
- **A "tagged literal" parameter kind, with its own error for plain strings.** Rejected. It describes syntax, not types, and the cast rule already refuses values of other types.
- **Apply `@default`'s SQL checks to every place.** Rejected. They refuse valid row-level-security predicates such as `EXISTS (SELECT ...)`.
- **A type per target, such as `pg/sql-expression`, with a hook telling the family which one to use.** Rejected. Naming one id in the family is simpler, and shared codec ids already work that way.
- **The SQL family listing tag names in its own code.** Rejected. A new target would have to edit the family.
- **Prefixed tags, `pg.sql` and `sqlite.sql`.** Rejected. They add nothing the stack does not say.
- **Special handling of `--` inside `sql/expression` text.** Rejected. The problem is placing SQL inside a larger statement, so it is solved where DDL is rendered, not in the type.
- **Wait for ADR 254's follow-up work to build typed arguments.** Rejected. Typed arguments are needed by the raw-SQL places, and that work has no specification.
- **A separate step that types block values in the family interpreter.** Rejected. Block specs already parse values with the same combinators as attributes (ADR 255), so a second mechanism would duplicate it.
- **Leave the TypeScript builder on plain strings.** Rejected. PSL and TypeScript would stop emitting identical contracts for multi-line text.
- **A `SqlExpression` class with a private constructor and no interpolation.** Rejected. Authors would repeat SQL text across policies, or find another way to build values and skip the canonicalization.

## References

- [ADR 129 — Tagged literals write values of data types](ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md)
- [ADR 231 — Declarative attribute specifications](ADR%20231%20-%20Declarative%20attribute%20specifications.md)
- [ADR 234 — Content-addressed wire names for Postgres-normalized objects](ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md)
- [ADR 236 — Target-contributed model attributes](ADR%20236%20-%20Target-contributed%20model%20attributes.md)
- [ADR 243 — Name-identified indexes and exact-name adoption](ADR%20243%20-%20Name-identified%20indexes%20and%20exact-name%20adoption.md)
- [ADR 244 — Check constraints are opaque wire-named expressions](ADR%20244%20-%20Check%20constraints%20are%20opaque%20wire-named%20expressions.md)
- [ADR 249 — Central attribute-spec registry](ADR%20249%20-%20Central%20attribute-spec%20registry.md)
- [ADR 254 — Data types and casts](ADR%20254%20-%20Data%20types%20and%20casts.md)
- [ADR 255 — Block specs bind top-level block values](ADR%20255%20-%20Block%20specs%20bind%20top-level%20block%20values.md)
