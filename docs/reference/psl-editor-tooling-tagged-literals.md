# Editor tooling brief: tagged literals

What the PSL editor tools (language server, formatter, highlighting) do for tagged literals such as `` @default(sql`gen_random_uuid()`) `` and `` @@index([id], where: sql`"archived" IS NULL`) ``, and which parts are not done yet.

## Where a tagged literal appears

A `sql` literal writes a value of the data type `sql/expression` ([ADR 268](../architecture%20docs/adrs/ADR%20268%20-%20Raw%20SQL%20is%20a%20value%20of%20the%20data%20type%20sql-expression.md)). It is the only form these places take:

- `@default(...)`, beside the other literals and the default functions;
- `@@index(where:)` and `@@index(expression:)`;
- `@@fullTextIndex(where:)`;
- `@@check(expression:)`;
- a policy block's `using` and `withCheck`.

A `json` literal writes a value of the target's JSON type and is taken by `@default`.

## What the parser does

The tokenizer (`packages/1-framework/2-authoring/psl-parser/src/tokenizer.ts`) lexes a backtick-fenced string as a string literal token, alongside the double-quote and single-quote forms. A backtick string may span lines; when it is unterminated it runs to the end of the input unless a later backtick closes it first. There is no separate token kind for it: the difference is the quote character of the string token.

The parser (`packages/1-framework/2-authoring/psl-parser/src/parse.ts`) produces a `TaggedLiteral` syntax node (kind listed in `src/syntax/syntax-kind.ts`) for a qualified name followed by a string literal: `` tag`body` ``, `tag"body"`, or `tag'body'`. Whitespace, newlines, and comments may sit between the tag and the string. A backtick string anywhere other than after a tag is refused with `PSL_BACKTICK_STRING_REQUIRES_TAG`. The typed AST class is `TaggedLiteralExprAst` in `src/syntax/ast/expressions.ts`; `tagName()` gives the dotted tag, and `canonicalization()` gives the text, which is the body after the fence's escapes and line-ending, blank-line, and indentation normalization, or the failure (`PSL_TAGGED_LITERAL_NUL`, `PSL_TAGGED_LITERAL_TOO_LARGE`).

## How specs take a tagged literal

The tags are not a registry of their own. They come from the data type authoring entries in the spec context's `dataTypes`: `AttributeSpecContext.dataTypes` (`packages/1-framework/2-authoring/psl-parser/src/attribute-spec/spec-context.ts`) for attributes and `BlockSpecContext.dataTypes` (`src/block-spec/types.ts`) for blocks. An entry whose written form is `{ kind: 'tag', tag }` registers that tag. The SQL family registers `sql`, the tag of `sql/expression`, which it defines in `packages/2-sql/1-core/contract/src/sql-expression.ts`. Every SQL target registers `json`, and no component registers a prefixed tag.

Two combinators take a tagged literal:

- `dataTypeValue(dataType, ctx.dataTypes)` (`src/attribute-spec/combinators/data-type-value.ts`) takes a value of one data type. It reads any literal, applies the cast rule while parsing, and reports refusals at the written value. The six raw-SQL places use it with `sql/expression`: `indexModelSpec` and `checkModelSpec` in `packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts`, `postgresFullTextIndexSpec` and the policy specs in `packages/3-targets/3-targets/postgres/src/core/`. It carries `tags` and `documentation` for tooling.
- `taggedLiteral(tags, { documentation })` (`src/attribute-spec/combinators/tagged-literal.ts`) parses any tag and yields `{ tag, canonicalization, span }`. `@default` uses it, wrapped in `writtenScalar` (`src/attribute-spec/combinators/written-scalar.ts`), which yields the literal as a written scalar with its span for lowering to read, because its receiving type comes from the column: its value is a `oneOf` of the plain scalars, the registered default functions (`funcCall`), one `taggedLiteral` arm per distinct tag documentation, and a list arm (`scalarDefaultArms` in `sql-attribute-specs.ts`). A `dbgenerated(...)` call is intercepted before the arms are tried (`defaultValueArm`) and reported as `PSL_UNKNOWN_DEFAULT_FUNCTION`.

The diagnostics:

- An unregistered tag, including `pg.sql`, is `PSL_UNKNOWN_LITERAL_TAG`, listing the known tags.
- A value the receiving type does not take is `PSL_VALUE_TYPE_INCOMPATIBLE`. At a raw-SQL place a plain string gets the rewrite, for example ``Expected sql`...`; write sql`(archived IS NULL)` ``.
- A text the tag's parse or a cast refuses, such as a `json` text that is not a JSON document, is `PSL_INVALID_LITERAL`.
- An argument that is not a literal at a raw-SQL place, such as an identifier, is `PSL_INVALID_ATTRIBUTE_SYNTAX`, ``Expected sql`...`; got an identifier``.
- A `@default` `sql` text that is exactly `now()` or `autoincrement()`, or that fails the default SQL check, is `PSL_INVALID_DEFAULT_SQL`. A single value on a list column is `PSL_DEFAULT_LIST_EXPECTED`; a value the column's codec refuses is `PSL_INVALID_DEFAULT_LITERAL`.

`PSL_DEFAULT_LIST_EXPECTED` and `PSL_INVALID_DEFAULT_LITERAL` are declared in `packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts`, and `PSL_INVALID_DEFAULT_SQL` in `psl-column-resolution.ts`. The others are declared in `framework-components/src/shared/psl-extension-block.ts`.

## What the language server does

It tokenizes and parses a fence without errors, including a multi-line backtick body and a body holding `${`.

Completion offers the registered tags wherever an argument takes them: inside `@default(` next to the function list, and at `where:`, `expression:` and the other raw-SQL arguments. `packages/1-framework/3-tooling/language-server/src/completion-values.ts` reads `tags` and `documentation` from a `taggedLiteral` or `dataTypeValue` argument and offers each tag as a value item, with a `` tag`$1` `` snippet when the client supports snippets. A required raw-SQL argument completes to a `sql` literal: `@@check(` completes to ``check(expression: sql`${1:expression}`)`` (`src/completion-snippets.ts`). A block parameter that takes raw SQL completes the same way: `using = ` in a `policy_select` block offers `sql`, because block value completion builds the block spec with the stack's data types (`blockValueGrammar` in `src/attribute-spec-resolution.ts`).

Semantic tokens (`src/semantic-tokens.ts`) colour a tagged literal: a `namespace` token for the namespace of a namespaced tag, a `keyword` token for the tag, and a `string` token for the literal, split per line for a multi-line body.

Diagnostics are reported through the normal path with a span on the literal or the attribute; the server maps them like any other interpreter diagnostic (`src/diagnostic-mapping.ts`).

## What the formatter does

It leaves a backtick string token byte-identical, including its line breaks and indentation: the body's canonicalization strips common indentation, so reflowing it would change the source for nothing. The formatter is `format` in `@internal/psl-parser/format`. The fixture `packages/1-framework/2-authoring/psl-parser/test/format/fixtures/tagged-literal/` checks this for a multi-line body.

## Where the tests are

- Tokenizer: `packages/1-framework/2-authoring/psl-parser/test/tokenizer.test.ts`.
- Parser: `packages/1-framework/2-authoring/psl-parser/test/parse-tagged-literal.test.ts`.
- Combinators: `packages/1-framework/2-authoring/psl-parser/test/attribute-spec-combinators.tagged-literal.test.ts` and `attribute-spec-combinators.data-type-value.test.ts`.
- Canonicalization: `packages/1-framework/1-core/framework-components/test/tagged-literal.test.ts`.
- Interpreter: `packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.tagged-literal.test.ts` and `interpreter.sql-expression-places.test.ts`; Postgres: `packages/3-targets/3-targets/postgres/test/psl-full-text-index.test.ts` and `psl-policy-predicates.test.ts`.
- Language server: `packages/1-framework/3-tooling/language-server/test/completion-provider.test.ts` and `semantic-tokens.test.ts`.
- Diagnostics fixtures: `test/integration/test/authoring/diagnostics/removed-dbgenerated/` and the parity pair `test/integration/test/authoring/parity/default-sql-literal/`.

## What is not done

- SQL or JSON highlighting inside a literal's body. Semantic tokens style the whole body as a string; injecting SQL or JSON highlighting is the editor grammar's job, keyed by the tag.
- Hover on a tagged literal. The server has no hover provider.
