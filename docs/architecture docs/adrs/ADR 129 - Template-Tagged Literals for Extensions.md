# ADR 129 — Tagged literals carry raw SQL and other pack-owned text in PSL

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

The tag, `sql`, names who owns the text. The string literal after it holds the text, in backticks or quotes. Prisma never interprets that text. The Postgres target reads the `sql` tag, checks the body is one expression, and stores it in the contract exactly as written:

```json
{ "default": { "kind": "function", "expression": "(now() + '00:03:00'::interval)" } }
```

The migration planner renders that expression as written, `DEFAULT ((now() + '00:03:00'::interval))`. The TypeScript builder has the same form, `` .default(sql`(now() + '00:03:00'::interval)`) ``, and produces the same contract.

## Decision

PSL gains one expression form for text that a pack owns and Prisma does not parse: a **tagged literal**, a qualified name followed by a string literal. The tag is registered by a pack in the stack. The string's content is canonicalized once by the framework, the same way for PSL and for the TypeScript builder, and handed to the pack that registered the tag, which decides what the literal lowers to.

The `sql` tag is the first user. Every SQL target registers it, and a `` @default(sql`...`) `` lowers to the contract's ordinary function-kind column default, so the contract format does not change and every consumer of column defaults keeps working. Index expressions, check-constraint bodies, and row-level-security predicates continue to take plain strings; whether they move to tagged literals is a separate decision.

## Why a tag and backticks

Raw SQL is full of the characters a quoted string fights with. `'{}'::text[]` has quotes, `E'\n'` has a backslash that must survive, and a view definition spans many lines. Written as `"..."`, each of those needs escaping, and the escaped form is what a reader sees. A backtick string changes the rules: it keeps every character except two escapes, and it may span lines, so SQL is written as SQL.

A plain string also says nothing about who reads it. `@default("gen_random_uuid()")` is a string default with those seventeen characters as its value. `` @default(sql`gen_random_uuid()`) `` says a pack owns the text and Prisma passes it through. The tag makes that ownership visible in the schema, and lets authoring refuse text no pack in the stack handles.

## Syntax

```
TaggedLiteral := QualifiedName StringLiteral
```

- The tag is an ordinary qualified name of one identifier, or two joined by a dot, such as `pg.sql`. One dot is all the prefix rule below needs. Whitespace, newlines, and comments may appear between the tag and the string, as in TypeScript. The formatter writes them together, `` sql`...` ``.
- A string literal uses one of three quote characters. A double-quoted or single-quoted string has the ordinary PSL escapes and ends at the end of its line. A backtick string may span lines, and has exactly two escapes: `` \` `` is a backtick and `\\` is one backslash. Every other backslash sequence is kept as written, so `E'\n'` reaches the database unchanged.
- A backtick string is valid only as the string of a tagged literal. Anywhere else it is `PSL_BACKTICK_STRING_REQUIRES_TAG`. The quoted forms exist for a body full of backticks.
- An unterminated string of any quote style is `PSL_UNTERMINATED_STRING`. An unterminated backtick string ends before the next line whose first non-whitespace character is `}`, so the rest of the file still parses.
- A tagged literal is an expression and may appear wherever an expression may appear. An attribute accepts it only where its argument specification says so; elsewhere it is refused with that attribute's usual diagnostic.

## The canonical body

The body a pack receives is the same whichever quote style was used and whichever language wrote it. After the string's escapes are resolved, the framework's `canonicalizeTaggedLiteralBody` applies these steps in order:

1. A NUL character is `PSL_TAGGED_LITERAL_NUL`.
2. Line endings become `\n`.
3. A blank first line and a blank last line are dropped, so a body may start on the line after the opening backtick and end on the line before the closing one.
4. The common leading whitespace of the non-blank lines is removed. Tabs and spaces are counted as characters, not expanded.
5. Internal blank lines are kept, as empty lines.
6. No trailing newline is added.
7. A body over 65536 UTF-8 bytes is `PSL_TAGGED_LITERAL_TOO_LARGE`.

So these three write the same default:

```prisma
a DateTime @default(sql`(now() + '00:03:00'::interval)`)
b DateTime @default(sql"(now() + '00:03:00'::interval)")
c DateTime @default(sql`
  (now() + '00:03:00'::interval)
`)
```

The TypeScript `sql` template tag reads its raw template text and runs the same function, so a TypeScript contract and a PSL contract that write the same SQL emit byte-identical contracts. It resolves one escape PSL does not: `\$` becomes `$`. JavaScript reads `${` in a template literal as the start of an interpolation, which the tag refuses, and `\${` is the only way to write those two characters; PSL has no interpolation, so a PSL body writes `${` as it is. The two languages therefore differ for the sequence `\$` alone.

## Who owns a tag

A tag is known only when a pack in the contract's stack registers it. Registration lives beside the default-function registry packs already contribute: `ControlMutationDefaults.defaultLiteralTagRegistry`, a map from tag to an entry with the tag's usage text, its documentation for signature help and completion, and a `lower` function. Stack assembly merges every contributor's map and refuses two contributors that register the same tag.

Any pack in the stack may register tags: a target, a family, or an extension. The naming rule is about prefixes:

- **Only the target may register an unprefixed tag.** `sql` is registered by Postgres and by SQLite, through one implementation the SQL family exports, so the two targets cannot drift. The target rather than the family registers it, because nobody has promised the tag will never vary by target.
- **Each target also registers a prefixed alias:** `pg.sql` on Postgres, `sqlite.sql` on SQLite. A schema that wants to say which database it is written for can.
- **Every other pack prefixes its tags** with its own namespace, so an extension's literals cannot collide with a target's or with each other's.

An attribute offers the tagged-literal form only when at least one tag is registered, and the language server completes the registered tags. Parsing an attribute argument checks only that it is a tagged literal. Whether its tag is registered is checked when the default is lowered, where the registry is at hand: an unregistered tag is `PSL_UNKNOWN_DEFAULT_LITERAL_TAG`, and the message lists the registered tags.

## What a tag lowers to

The registering pack's `lower` function receives the tag, the canonical body, and the literal's source span, and returns the same result shape a default function returns. For the `sql` tag that is a storage default, `{ kind: 'function', expression: <body> }`. The framework does not rewrite the body, the contract stores it, and the planner renders it inside `DEFAULT (...)`.

Two checks apply, in PSL and TypeScript alike:

- A body containing `;`, a SQL comment marker, `$$`, or the word `SELECT` is `PSL_INVALID_DEFAULT_SQL`. This is the rule the planners already apply before rendering any function default, moved to authoring so the diagnostic points at the schema.
- A body that is exactly `now()` or `autoincrement()` is refused with a hint to write the named function. In the contract those two texts are Prisma's own markers: the planners turn `autoincrement()` into a sequence-backed column and may render `now()` in a target's own spelling, so the author's SQL would not be used as written. Any other body, including `NOW()` or `gen_random_uuid()`, passes unchanged.

An empty body passes, and the database reports the error.

The planners render the authored expression, never a normalised form of it. Planning and verification compare a raw default the way they compare any function default: each target runs its own introspection parser over the authored expression and over the expression the database reports, then compares the two parsed forms. A body the database reprints differently from how it was written therefore neither reports drift nor plans a change.

## Consequences

- Raw SQL in a schema is visibly raw and visibly owned. A reader sees `sql` and knows Prisma passes the text through.
- One canonicalization serves both languages, so the choice between PSL and TypeScript never changes a contract.
- Nothing downstream of authoring changes. The contract shape, the planner, the verifier, and `contract infer` all work on the function-kind default they already handled. `contract infer` prints a default it cannot name as `` @default(sql`...`) ``, so an adopted database round-trips.
- The tagged literal reuses the parser's qualified name and string literal, so tooling that understands those understands most of a tagged literal. The formatter never re-indents a backtick string's content. Highlighting the content as SQL is the editor's job, keyed by the tag.
- The 64 KiB limit is a fixed rule, not an option.

## Alternatives considered

- **Keep raw SQL as a plain string argument.** Rejected. Escaping makes SQL unreadable, a string carries no owner, and authoring cannot refuse text nobody handles.
- **Fenced code blocks (```` ``` ````) inside PSL.** Rejected. They complicate the tokenizer, have no natural owner, and offer nothing a tagged backtick string does not.
- **Backtick strings only, with no quoted form (`sql"..."` or `sql'...'`).** Rejected. A body that contains backticks would need escaping again, which is the problem backticks exist to remove.
- **Backtick strings valid everywhere a string is.** Rejected. It widens every string-taking attribute's syntax with nothing to gain; a backtick string exists to carry text a tag owns.
- **A separate token and node for tagged literals, with the string text read from raw tokens.** Rejected. It duplicates the qualified-name and string-literal parsing, their escape handling, and their unterminated-string recovery.
- **Require the string to follow the tag with no whitespace.** Rejected. It adds a rule and a diagnostic for no benefit; TypeScript allows the space, and the formatter normalises it away.
- **Check the tag against the registry while parsing the attribute argument.** Rejected. A registry-dependent failure during parsing had to be told apart from an argument of the wrong shape, which meant special-casing one diagnostic code when choosing between alternatives. Lowering already has the registry.
- **Give common database functions Prisma names, such as `@default(gen_random_uuid())`.** Rejected. It dresses a target's SQL function as a Prisma function, and it sits beside Prisma's own `uuid()`, which generates the value in the client before the insert, while `gen_random_uuid()` makes the database generate it; nothing in the names shows that difference. Named defaults are kept for Prisma concepts that work on every target and that the planners treat specially: `now()` and `autoincrement()`.
- **Refuse `${` in a body.** Rejected. A PSL tagged literal has no interpolation, so `${` is ordinary text. The TypeScript `sql` tag refuses a real JavaScript interpolation, which is a different thing, and accepts `\${` for the literal characters.
- **Resolve `\$` in PSL too, so both languages escape alike.** Rejected. PSL needs no escape there, and adding one would make every PSL author who writes a backslash before a dollar sign escape it, to serve a body that only JavaScript has trouble writing.
- **The SQL family, not each target, registers the unprefixed `sql` tag.** Rejected. It would assert that the tag can never differ between targets. Sharing the implementation through the family gives the same result without the assertion.
- **Store a raw default as a pack-owned envelope with a content hash and compare it by hash, the way index expressions and check constraints are compared by their content-addressed names.** Not adopted for column defaults. A column default has no name in the database catalog to carry a hash, so verification would still have to compare the database's reprint of the expression, and the contract shape would change for every consumer. The function-kind default already does the job.

## References

- ADR 104 — PSL extension namespacing and syntax
- ADR 112 — Target extension packs
- ADR 158 — Execution mutation defaults (the default-function registry the tag registry sits beside)
- ADR 234 and ADR 244 — Content-addressed names for indexes, policies, and check constraints (the comparison model raw defaults do not use)
