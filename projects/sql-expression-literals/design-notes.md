# SQL expression literals — design notes

Decisions made with Will on 2026-09-24 while deciding TML-3282, revised the same day after an architect review and a principal-engineer review. Each one says why, and what it assumes. They move into a new ADR (decision 13) and short amendments to ADRs 129, 195, 231, 234, 236, 243, 244, 249, 254 and 255 before close-out.

## Principles

- **Every written value has a data type.** ADR 254 says so, and `sql` was its one exception. A place that takes a value declares the type it receives, and the cast rule decides what it admits. A plain string, a number and a boolean are values of other types, so they are refused by that rule, not by a syntax check.
- **Checks on a value belong to the place that uses it.** A type says what its values are. Rules such as "a default may not contain `SELECT`" are rules about defaults.
- **Raw SQL is written one way.** There is no second syntax to keep, print or document.

## Decisions

### 1. Every place that holds raw SQL takes a `sql` literal

The places are `@@index(where:)`, `@@index(expression:)`, `@@fullTextIndex(where:)`, `@@check(expression:)`, a policy's `using` and `withCheck`, and `@default`.

Why: SQL in these places almost always quotes camelCase column names, because Prisma names columns after fields. A quoted PSL string needs `\"` for every one of them, as in `"\"userId\"::uuid = auth.uid()"`. A `sql` literal needs no escaping, may span lines, and shows that the text is raw SQL.

Assumes: the canonical body of a string written today equals the string's text, so the stored text and hash do not change. The exception is leading whitespace, which the canonicalization removes; the hash input is already trimmed, so wire names still do not change. This was established by reading the code and is tested in the PSL slice.

### 2. Plain strings are refused

Why: nothing is gained by accepting them. The project predates 1.0, and the repo keeps no backward-compatibility code.

Consequence: a breaking change, with upgrade instructions, and every committed artefact that uses the old form is regenerated in the same PR.

### 3. A `sql` literal is a value of the data type `sql/expression`

Each place declares that it receives `sql/expression`, and `sql/expression` declares no casts, so only a `sql` literal is admitted. ADR 254's lowering-entry kind, which existed only for `sql`, is removed.

`@default` is the one consumer with extra behaviour: a `sql/expression` value is stored as a default expression, where any other value is cast to the column's type. `@default` keeps its refusals of `now()`, `autoincrement()`, `;`, comments, `$$` and `SELECT`. The other places check nothing, because RLS predicates often contain `EXISTS (SELECT ...)`.

Why: the type, not the syntax, decides what a place admits. Before PR #30381 a policy parameter was typed by a codec id nothing checked, so `` using = sql`x` `` was stored as the text `` sql`x` ``. #30381 types it as a plain string, which refuses a `sql` literal; this project types it as `sql/expression`, which admits only a `sql` literal.

### 4. The SQL family defines `sql/expression`; each SQL target registers it

The SQL family exports the id `sql/expression`, the data type declaration (which declares no casts) and its authoring entry. Postgres and SQLite each register the declaration and the entry unchanged. (Revised 2026-09-24 after the architect review: the family, not each target, owns the declaration, so the rule "`sql/expression` casts from nothing", which is what refuses plain strings, has one owner.)

Why: `@@index` and `@@check` belong to the SQL family and must name the type they receive. The family already names shared codec ids, such as `sql/int@1`, that each target fills in.

Assumes: a stack contains one target, so the two registrations never meet.

ADR 254 changes: its rule "no type spans targets" gains the case of a family naming an id that targets register. This is not ADR 254's rejected "family-level vocabulary of written types": that alternative put family types in front of each target's real types through pass-through casts. `sql/expression` has no casts.

### 5. The only tag is `sql`

`pg.sql` and `sqlite.sql` are removed, with ADR 129's rule that each target registers a prefixed alias.

Why: the target fills the slot the family names, so a prefix says nothing the stack does not already say. One tag per type per stack is all the registration rule needs; it exists to stop two registrations colliding. Only docs and tests use the prefixed tags.

### 6. Specs get a building block that names a data type

An argument, in an attribute spec or a block spec, can declare "receives a value of data type X", checked by the cast rule when the argument is parsed. ADR 254 describes this building block; PR #30350 did not build it.

Why: the places in decision 1 need it now. It is used only by them; typing function arguments such as `nanoid(8)` stays with ADR 254's follow-up project, which can reuse it.

Block parameters get it through PR #30381, which this project builds on: #30381 makes block values use the same argument building blocks as attributes, so the policy spec declares `using` and `withCheck` with it exactly as `@@index(where:)` does. That needs block specs to receive the stack's data types, which ADR 255 had kept codecs out of; Serhii, the author of #30381, agreed on 2026-09-25, because admitting a value of a data type picks no codec and no stored representation. He may move block parsing into the interpreter, where the data types already are. (Revised 2026-09-24: the first design added its own block-value typing step, which #30381 makes unnecessary.) Checking a value this way reads only the literal's syntax and tag; Prisma never parses the SQL inside.

### 7. The TypeScript builder follows the same rule

The `sql` template tag returns a `sql/expression` value. `.default()` and every builder field that takes raw SQL accept it, and a plain string does not compile. The default-specific refusals move from the tag into `.default()`.

Why: the contract stores the body as written, and the hash uses a whitespace-collapsed copy. PSL removes the common indentation of a multi-line body; a TypeScript template string keeps it. Without the tag in TypeScript, the same SQL would get the same wire name but different text in `contract.json`, breaking ADR 129's promise of byte-identical contracts.

The `sql` tag accepts other `sql` values inside `${…}`, and refuses anything else there. It joins the pieces and cleans up the whole text once. Why: TypeScript contracts reuse a predicate across policies, for example `` sql`${owner} AND deleted_at IS NULL` ``; without this, users would build SQL some other way and skip the cleanup. The `SqlExpression` constructor also cleans up its text, so no way of making a value skips it. (Added 2026-09-24 after the principal-engineer and architect reviews.)

### 8. `contract infer` prints `sql` literals

It prints every place as a `sql` literal through one printer for all tags: the backtick form, with a multi-line body starting on its own line, or the double-quote form when the body contains a backtick, as it does for defaults today. It uses the tag constant the SQL family defines next to the `sql/expression` entry.

When a reported body would not read back unchanged (canonicalization would change it, for example a string constant holding a carriage return), infer skips that object with a note naming the reason, as it already skips policies with unprintable roles. Why: an adopted (`map:`) object compares bodies byte for byte, so printing a body that reads back changed would cause a planner conflict or a drop and recreate on every plan. (Added 2026-09-24 after the principal-engineer review.)

### 9. Opaque SQL is its own DDL node

The DDL holds an `OpaqueSql` node wherever raw SQL sits inside a larger statement, in place of a string pasted into a template such as `` `CHECK (${expression})` ``. Each adapter renders every such node through one function that encloses it safely, including a line break before the closing parenthesis when the text contains a line comment. Column defaults use the same function.

Why: a body whose last line ends in `-- comment` hides the closing parenthesis and breaks the DDL. Bodies that span lines make comments likely. The problem belongs to placing SQL inside a statement, so it is solved there, not in the `sql/expression` type.

The node is new, not the query AST's `RawExpr`. It is named `OpaqueSql`, the word ADR 244 uses for SQL text Prisma does not parse; "embedded SQL" already means SQL statements written inside a host-language program. (Renamed 2026-09-24 after the architect review.) `RawExpr` requires a result codec spec, can hold parameter references that DDL cannot bind, takes part in the query AST's expression walks, and its renderers need a contract and a parameter map that the DDL renderer does not have. Opaque SQL in DDL needs none of that.

### 10. Migration files write SQL bodies as untagged template literals; `sql` values are a stretch slice

A newly generated `migration.ts` writes a single-line SQL body that holds a quote as an untagged template literal, for example `` checkExpression('c', `"kind" IN ('admin', 'user')`) ``, so no quote is escaped. It is still an ordinary string, so no migration function changes and no import is added. Multi-line bodies stay string literals, because the file generator's indentation would become part of an untagged template's text.

Why: this removes most of today's escaping for almost no cost. `sql`-tagged values in migration files (readable multi-line bodies, the same form as contract files) add little beyond it and cost an API change, so they are a stretch slice at the end of the project. If that slice is built, the migration functions accept a `sql` value or a string. The string form is permanent, not only for old files: committed files use it, and the generator writes one whenever a template cannot hold the text unchanged. (Revised 2026-09-24 after the principal-engineer review; the operator chose untagged templates first.)

### 11. Wire names keep line breaks in bodies that contain `--`

`normalizeSqlBody`, which prepares SQL text for the content hash in index, check and policy names, keeps line breaks when the body contains `--`.

Why: it collapses all whitespace, line breaks included, to one space. So `a -- note⏎OR b` and `a -- note OR b` get the same name, although in the second `OR b` is part of the comment. A fix made by adding a line break would plan as no change and verify clean. Multi-line bodies and working line comments make this reachable. Bodies without `--` hash exactly as before, and no committed body has both `--` and a line break, so no existing name changes. (Added 2026-09-24 after the principal-engineer review; the operator agreed.)

### 12. One set of codes for refusals the cast rule makes

`@default` and the six places report refusals from the shared read and cast functions with the same codes (`PSL_VALUE_TYPE_INCOMPATIBLE`, `PSL_INVALID_LITERAL`, `PSL_UNKNOWN_LITERAL_TAG`). Default-only refusals keep default-only codes. Why: ADR 254 says defaults and other positions are admitted by one rule, so users and tools should see it under one name. (Added 2026-09-24 after the architect review.)

### 13. The decision gets its own ADR

A new ADR records why raw SQL is a value of the data type `sql/expression`, with decisions 1 to 7, 11 and 12 and their rejected alternatives. ADRs 129, 195, 231, 234, 236, 243, 244, 249, 254 and 255 are amended briefly and link to it. Why: ADR 129 called this "a separate decision", and without one ADR no single place answers why. (Added 2026-09-24 after the architect review.)

### 14. The typed argument ships before the places that use it

The argument type `dataTypeValue`, the cast rule's move into the framework and the data types in the attribute spec contexts are their own slice (TML-3367), after the `sql/expression` data type and before the six places. Why: the project "Data types own column types" reuses the argument type for default-function arguments such as the `8` in `nanoid(8)`, and is blocked until it exists. That project needs the argument type to take any data type id, to work as a parameter inside a function call signature, to need no target-specific code, to report general codes at the written value, to return the canonical value with its type id, and to be callable from PSL attribute specs and the Prisma 7 contract source. The design meets all six. It depends on the `sql/expression` slice because that slice removes the lowering-entry kind from the code that moves. (Added 2026-09-29; Will agreed.)

## Alternatives rejected

- **Accept plain strings beside `sql` literals.** Two ways to write the same thing, with no benefit.
- **A "tagged literal" parameter kind, with its own error for plain strings.** It describes syntax, not types; the cast rule already refuses values of other types.
- **Apply `@default`'s SQL checks to every place.** They refuse valid RLS predicates.
- **A type per target, such as `pg/sql-expression`, with a hook telling the family which one to use.** Naming one id in the family is simpler, and codec ids already work that way.
- **The SQL family listing tag names in its own code.** A new target would have to edit the family.
- **Prefixed tags.** They add nothing.
- **Special handling of `--` in `sql/expression` text.** The problem is embedding SQL in a statement, so it is solved in rendering.
- **Wait for ADR 254's follow-up project to build typed arguments.** It has no spec, and this work needs them now.
- **Leave the TypeScript builder on plain strings.** PSL and TypeScript would stop emitting identical contracts for multi-line bodies.
- **Leave migration files on plain strings.** Generated files would keep their escaped quotes.
- **Migration functions that accept only `sql` values.** Migration files committed before this project would stop loading.
- **`sql` values in migration files before untagged templates.** Most of the benefit comes from not escaping quotes, which untagged templates give with no API change.
- **A separate block-value typing step in the family interpreter.** PR #30381 types block values in the parser with the same building blocks as attributes, so a second mechanism would duplicate it.
- **A private `SqlExpression` constructor and no composition.** Users would repeat SQL text across policies, or find another way to build values.

## Accepted costs

- A breaking change for PSL and TypeScript schemas that use these places, and for extension authors.
