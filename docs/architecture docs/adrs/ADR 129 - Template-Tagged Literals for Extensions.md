# ADR 129 — Tagged literals write values of data types

## At a glance

A column default that Prisma cannot express as a literal or a named function is written as raw SQL in a tagged literal:

```prisma
model Session {
  id        String   @id @default(sql`gen_random_uuid()`)
  expiresAt DateTime @default(sql"(now() + '00:03:00'::interval)")
  tags      String[] @default(sql`'{}'::text[]`)
  createdAt DateTime @default(now())
}
```

The tag names the data type of the text: `sql` writes a value of the data type `sql/expression`. The string literal after it holds the body, in backticks or quotes, and the text is that body after canonicalization (below). Prisma never interprets the text. `@default` checks that the text is one expression and stores it in the contract unchanged:

```json
{ "default": { "kind": "function", "expression": "(now() + '00:03:00'::interval)" } }
```

The migration planner renders that expression as written, `DEFAULT ((now() + '00:03:00'::interval))`. The TypeScript builder has the same form, `` .default(sql`(now() + '00:03:00'::interval)`) ``, and produces the same contract.

## Decision

PSL gains one expression form for text that Prisma does not parse: a **tagged literal**, a qualified name followed by a string literal. The tag names the data type of the text, and a pack in the stack registers it. The string's body is canonicalized once by the framework, the same way for PSL and for the TypeScript builder, and the resulting text is read by the authoring entry of the data type the tag names, which gives the literal its value.

The `sql` tag is the first user. It is the tag of the data type `sql/expression`, which the SQL family defines and registers. A `` @default(sql`...`) `` is stored as the contract's ordinary function-kind column default, so the contract format does not change and every consumer of column defaults keeps working. Index expressions, check-constraint bodies, and row-level-security predicates continue to take plain strings; whether they move to tagged literals is a separate decision.

## Why a tag and backticks

Raw SQL is full of the characters a quoted string fights with. `'{}'::text[]` has quotes, `E'\n'` has a backslash that must survive, and a long predicate spans many lines. Written as `"..."`, each of those needs escaping, and the escaped form is what a reader sees. A backtick string changes the rules: it keeps every character except two escapes, and it may span lines, so SQL is written as SQL.

A plain string also says nothing about what its text is. `@default("gen_random_uuid()")` is a string default with those seventeen characters as its value. `` @default(sql`gen_random_uuid()`) `` says the tag names the data type of the text, `sql/expression`, and Prisma passes the text through. The tag makes the data type visible in the schema, and lets authoring refuse a tag no pack in the stack registers.

## Syntax

```
TaggedLiteral := QualifiedName StringLiteral
```

- The tag is an ordinary qualified name of one identifier, or two joined by a dot, such as `postgis.geometry`. One dot is all the prefix rule below needs. Whitespace, newlines, and comments may appear between the tag and the string, as in TypeScript. The formatter writes them together, `` sql`...` ``.
- A string literal uses one of three quote characters. A double-quoted or single-quoted string has the ordinary PSL escapes and ends at the end of its line. A backtick string may span lines, and has exactly two escapes: `` \` `` is a backtick and `\\` is one backslash. Every other backslash sequence is kept as written, so `E'\n'` reaches the database unchanged.
- A backtick string is valid only as the string of a tagged literal. Anywhere else it is `PSL_BACKTICK_STRING_REQUIRES_TAG`. The quoted forms exist for a body full of backticks.
- An unterminated string of any quote style is `PSL_UNTERMINATED_STRING`. An unterminated backtick string ends before the next line whose first non-whitespace character is `}`, so the rest of the file still parses.
- A tagged literal is an expression and may appear wherever an expression may appear. An attribute accepts it only where its argument specification says so; elsewhere it is refused with that attribute's usual diagnostic.

## The canonical text

The body is what is written between the quotes. The text is the canonical value an authoring entry receives, and it is the same whichever quote style was used and whichever language wrote it. After the body's escapes are resolved, the framework's `canonicalizeTaggedLiteralBody` turns the body into the text in these steps, in order:

1. A NUL character is `PSL_TAGGED_LITERAL_NUL`.
2. Line endings become `\n`.
3. A blank first line and a blank last line are dropped, so a body may start on the line after the opening backtick and end on the line before the closing one.
4. The common leading whitespace of the non-blank lines is removed. Tabs and spaces are counted as characters, not expanded.
5. Internal blank lines are kept, as empty lines.
6. No trailing newline is added.
7. A text over 65536 UTF-8 bytes is `PSL_TAGGED_LITERAL_TOO_LARGE`.

So these three write the same default:

```prisma
a DateTime @default(sql`(now() + '00:03:00'::interval)`)
b DateTime @default(sql"(now() + '00:03:00'::interval)")
c DateTime @default(sql`
  (now() + '00:03:00'::interval)
`)
```

The TypeScript `sql` template tag reads the raw body of its template and runs the same function, so a TypeScript contract and a PSL contract that write the same SQL emit byte-identical contracts. It resolves one escape PSL does not: `\$` becomes `$`. JavaScript reads `${` in a template literal as the start of an interpolation, which the tag refuses, and `\${` is the only way to write those two characters; PSL has no interpolation, so a PSL body writes `${` as it is. The two languages therefore differ for the sequence `\$` alone.

## Registering a tag

A tag is known only when a pack in the contract's stack registers it. Registration lives in the pack's authoring contribution, in the map that holds the PSL support for its data types: every tag names a data type and is that type's authoring entry. Stack assembly merges every contributor's map and refuses two contributors that claim the same tag. [ADR 254](ADR%20254%20-%20Data%20types%20and%20casts.md) describes the entry; the earlier `ControlMutationDefaults.defaultLiteralTagRegistry` this ADR named is gone.

Whether a tag carries a prefix depends on the owner of its data type, by the rule in [ADR 254](ADR%20254%20-%20Data%20types%20and%20casts.md#how-psl-writes-a-value): a tag is unprefixed when the owner of its data type is the family or a target, and every other owner prefixes its tags. So:

- **`sql` is unprefixed, because the SQL family owns `sql/expression`.** The tag is part of the definition of that data type. The family registers the data type and its authoring entry itself, so every SQL target has the same one and none can forget it.
- **`json` is unprefixed, because each SQL target owns its JSON type.**
- **`sql` has no prefixed alias.** `pg.sql` and `sqlite.sql` are unknown tags. A schema is written for the target its stack names, so the prefix said nothing the stack does not already say, and one tag per data type keeps one way to write a value.
- **An extension prefixes its tags** with its own namespace, such as `postgis.geometry`, so its literals cannot collide with a target's or with each other's.

An attribute offers the tagged-literal form only when at least one tag is registered, and the language server completes the registered tags. Parsing an attribute argument checks only that it is a tagged literal. Whether its tag is registered is checked when the default is lowered, where the registry is at hand: an unregistered tag is `PSL_UNKNOWN_LITERAL_TAG`, and the message lists the registered tags.

## What `@default` does with a `sql` literal

A `sql` literal is a value of `sql/expression`, and its canonical form is its text. `@default` stores such a value as a storage default, `{ kind: 'function', expression: <text> }`, on scalar and list columns alike. A value of any other data type goes through the cast rule of [ADR 254](ADR%20254%20-%20Data%20types%20and%20casts.md). The framework does not rewrite the text, the contract stores it, and the planner renders it inside `DEFAULT (...)`.

Two checks apply. They belong to `@default`, not to the tag, because they follow from how a default is rendered and compared. In TypeScript, the `sql` tag runs the same checks:

- A text containing `;`, a SQL comment marker, `$$`, or the word `SELECT` is `PSL_INVALID_DEFAULT_SQL`. This is the rule the planners already apply before rendering any function default, moved to authoring so the diagnostic points at the schema.
- A text that is exactly `now()` or `autoincrement()` is refused with a hint to write the named function. In the contract those two texts are Prisma's own markers: the planners turn `autoincrement()` into a sequence-backed column and may render `now()` in a target's own spelling, so the author's SQL would not be used as written. Any other text, including `NOW()` or `gen_random_uuid()`, passes unchanged.

An empty text passes, and the database reports the error.

A list column takes a `sql` default like any other column: `` tags String[] @default(sql`'{}'::text[]`) `` stores `'{}'::text[]`. Nothing can tell from SQL text, or from a function's name, whether it returns a value of the column's type, for a list column or for any other, so that is the author's responsibility, and the database reports a mismatch when the migration runs. The same holds for `now()`: `DateTime[] @default(now())` lowers. Two defaults are refused on a list column. A client-side generator such as `uuid()` produces one value, not a list (`PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED`). `autoincrement()` is Prisma's marker for a sequence-backed scalar column, not SQL, and the Postgres planner would otherwise render a scalar `SERIAL` column with no error from the database (`PSL_LIST_AUTOINCREMENT_UNSUPPORTED`).

The planners render the authored expression, never a normalised form of it. Planning and verification compare a raw default the way they compare any function default: each target runs its own introspection parser over the authored expression and over the expression the database reports, then compares the two parsed forms. A text the database reprints differently from how it was written therefore neither reports drift nor plans a change.

## Consequences

- Raw SQL in a schema is visibly raw, and its tag names its data type. A reader sees `sql` and knows Prisma passes the text through.
- One canonicalization serves both languages, so the choice between PSL and TypeScript never changes a contract.
- Nothing downstream of authoring changes. The contract shape, the planner, and the verifier all work on the function-kind default they already handled.
- `contract infer` prints each default it reads in the first of three forms that fits: a named function (`now()`, `autoincrement()`); a literal the column's data type writes and reads back as the same stored value ([ADR 254](ADR%20254%20-%20Data%20types%20and%20casts.md)); otherwise a `sql` tagged literal holding the expression the database reported, in the double-quote form when that expression contains a backtick. It never prints a comment in place of a default and never stops on one, because its job is to describe the database; a user adopting a database should not have to write defaults back by hand.
- The tagged literal reuses the parser's qualified name and string literal, so tooling that understands those understands most of a tagged literal. The formatter never re-indents a backtick string's content. Highlighting the content as SQL is the editor's job, keyed by the tag.
- The 64 KiB limit is a fixed rule, not an option.

## Alternatives considered

- **Keep raw SQL as a plain string argument.** Rejected. Escaping makes SQL unreadable, and a plain string's value is text, so nothing says it is SQL.
- **Fenced code blocks (```` ``` ````) inside PSL.** Rejected. They complicate the tokenizer, name no data type, and offer nothing a tagged backtick string does not.
- **Backtick strings only, with no quoted form (`sql"..."` or `sql'...'`).** Rejected. A body that contains backticks would need escaping again, which is the problem backticks exist to remove.
- **Backtick strings valid everywhere a string is.** Rejected. It widens every string-taking attribute's syntax with nothing to gain; a backtick string exists to carry the body of a tagged literal.
- **A separate token and node for tagged literals, with the string text read from raw tokens.** Rejected. It duplicates the qualified-name and string-literal parsing, their escape handling, and their unterminated-string recovery.
- **Require the string to follow the tag with no whitespace.** Rejected. It adds a rule and a diagnostic for no benefit; TypeScript allows the space, and the formatter normalises it away.
- **Check the tag against the registry while parsing the attribute argument.** Rejected. A registry-dependent failure during parsing had to be told apart from an argument of the wrong shape, which meant special-casing one diagnostic code when choosing between alternatives. Lowering already has the registry.
- **Give common database functions Prisma names, such as `@default(gen_random_uuid())`.** Rejected. It dresses a target's SQL function as a Prisma function, and it sits beside Prisma's own `uuid()`, which generates the value in the client before the insert, while `gen_random_uuid()` makes the database generate it; nothing in the names shows that difference. Named defaults are kept for Prisma concepts that work on every target and that the planners treat specially: `now()` and `autoincrement()`.
- **Refuse `${` in a body.** Rejected. A PSL tagged literal has no interpolation, so `${` is ordinary text. The TypeScript `sql` tag refuses a real JavaScript interpolation, which is a different thing, and accepts `\${` for the literal characters.
- **Resolve `\$` in PSL too, so both languages escape alike.** Rejected. PSL needs no escape there, and adding one would make every PSL author who writes a backslash before a dollar sign escape it, to serve a body that only JavaScript has trouble writing.
- **Each target defines its own `sql` data type and tag.** Rejected. The tag is part of the definition of `sql/expression`, so two definitions could drift. The family defines and registers the type once.
- **Each target registers the family's type and entry unchanged.** Rejected. Every SQL target had to repeat the same two lines. A target that forgot them lost the `sql` tag, and a target that declared its own `sql/expression` with a cast from its text type could let a plain string through where SQL is expected.
- **Prefixed aliases, `pg.sql` and `sqlite.sql`.** Rejected. An alias is a second way to write the same value, and the stack already names the target.
- **A tag that lowers its own body and names no data type.** Rejected. It made a second kind of authoring entry, which every reader of the entries had to tell apart, for one tag.
- **Store a raw default as a pack-owned envelope with a content hash and compare it by hash, the way index expressions and check constraints are compared by their content-addressed names.** Not adopted for column defaults. A column default has no name in the database catalog to carry a hash, so verification would still have to compare the database's reprint of the expression, and the contract shape would change for every consumer. The function-kind default already does the job.

## References

- ADR 104 — PSL extension namespacing and syntax
- ADR 112 — Target extension packs
- ADR 158 — Execution mutation defaults (the default-function registry the tag registry sits beside)
- ADR 234 and ADR 244 — Content-addressed names for indexes, policies, and check constraints (the comparison model raw defaults do not use)
