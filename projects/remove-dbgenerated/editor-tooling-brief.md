# Editor tooling brief: tagged literal defaults

Handover for the PSL editor tools after raw SQL defaults moved from `dbgenerated("...")` to tagged literals. Everything below names the code as it is on the `remove-dbgenerated-delete` branch.

## What changed in the parser

The tokenizer (`packages/1-framework/2-authoring/psl-parser/src/tokenizer.ts`) lexes a backtick-fenced string as a string literal token, alongside the double-quote and single-quote forms. A backtick string may span lines; when it is unterminated it runs to the end of the input unless a later backtick closes it first. There is no separate token kind for it: the difference is the quote character of the string token.

The parser (`packages/1-framework/2-authoring/psl-parser/src/parse.ts`) produces a `TaggedLiteral` syntax node (kind listed in `src/syntax/syntax-kind.ts`) for a qualified name followed by a string literal: `` tag`body` ``, `tag"body"`, or `tag'body'`. Whitespace, newlines, and comments may sit between the tag and the string. A backtick string anywhere other than after a tag is refused with `PSL_BACKTICK_STRING_REQUIRES_TAG`. The typed AST class is `TaggedLiteralExprAst` in `src/syntax/ast/expressions.ts`; `tagName()` gives the dotted tag, and `canonicalization()` gives the body after the fence's escapes and line-ending, blank-line, and indentation normalization, or the failure (`PSL_TAGGED_LITERAL_NUL`, `PSL_TAGGED_LITERAL_TOO_LARGE`).

Attribute specs accept a tagged literal through the `taggedLiteral(tags, { documentation })` combinator in `src/attribute-spec/combinators/tagged-literal.ts`. It parses any tag and carries the registered tags and their documentation for tooling; the value it yields is `{ tag, canonicalization, span }`. The `@default` value is a `oneOf` of the plain scalars, the registered default functions (`funcCall`), one `taggedLiteral` arm per distinct tag documentation, and a list arm; it is built in `packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts` (`scalarDefaultArms`). A `dbgenerated(...)` call is intercepted before the arms are tried (`defaultValueArm`) and reported as `PSL_UNKNOWN_DEFAULT_FUNCTION` with a message naming the `sql` tagged literal and the supported functions.

The tags themselves are not a registry of their own. They come from the data type authoring entries on `ControlDefaultRegistries.dataTypeEntries` (`packages/1-framework/1-core/framework-components/src/shared/mutation-default-types.ts`): an entry whose written form is `{ kind: 'tag', tag }` registers that tag. Every SQL target registers `json` and `sql`; Postgres adds `pg.sql` and SQLite adds `sqlite.sql`. An unregistered tag is `PSL_UNKNOWN_DEFAULT_LITERAL_TAG`, reported when the default is lowered, listing the known tags. A `sql` body that is exactly `now()` or `autoincrement()` is `PSL_INVALID_DEFAULT_SQL`. A `json` body that is not a JSON document is `PSL_INVALID_JSON_LITERAL`; a value the column's data type does not take is `PSL_DEFAULT_TYPE_INCOMPATIBLE`; a value the type's reader or the column's codec refuses is `PSL_INVALID_DEFAULT_LITERAL` (all declared in `packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts`, the first two in `framework-components/src/shared/psl-extension-block.ts`).

## What the language server must do

Tokenize and parse a fence without errors, including a multi-line backtick body and a body holding `${`; the parser already does this, so this is a check, not new work.

Offer completion for the registered tags inside `@default(` next to the function list. This is done: `packages/1-framework/3-tooling/language-server/src/completion-values.ts` reads the `taggedLiteral` arm's `tags` and offers each tag as a value item, with a `` tag`$1` `` snippet when the client supports snippets.

Report the diagnostic codes above at their spans. The interpreter reports them through the normal diagnostics path with a span on the literal or the attribute; the server maps them like any other interpreter diagnostic (`src/diagnostic-mapping.ts`). Check that the span of `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` and `PSL_INVALID_DEFAULT_SQL` lands on the literal, not the field.

Hover on a tagged literal should show the tag's documentation string (the `documentation` the `taggedLiteral` arm carries, the same text completion shows). The server has no hover provider today; this is new work.

## What the formatter must do

Leave a backtick string token byte-identical, including its line breaks and indentation: the body's canonicalization strips common indentation, so any reflow by the formatter changes what the author sees without changing what is lowered, and a formatter that re-indents a multi-line body changes the source for nothing. The formatter is `format` in `@internal/psl-parser/format`; I did not verify what it does with a multi-line string token, so start with a test.

## What highlighting should do

Inject SQL highlighting inside `sql`, `pg.sql`, and `sqlite.sql` fences (TextMate grammar or the semantic token provider), with the fence delimiters styled as string delimiters and the tag as a function or keyword. Today `src/semantic-tokens.ts` returns no tokens for a `TaggedLiteralExprAst` (the branch is an early return), so the whole literal is unstyled. `json` bodies would take JSON highlighting the same way.

## Where the tests are

- Tokenizer: `packages/1-framework/2-authoring/psl-parser/test/tokenizer.test.ts` (backtick strings, unterminated recovery).
- Parser: `packages/1-framework/2-authoring/psl-parser/test/parse-tagged-literal.test.ts` (the node, the three fences, the tag-required rule).
- Combinator: `packages/1-framework/2-authoring/psl-parser/test/attribute-spec-combinators.tagged-literal.test.ts`.
- Canonicalization: `packages/1-framework/1-core/framework-components/test/tagged-literal.test.ts`.
- Interpreter: `packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.tagged-literal.test.ts` (lowering, the unknown-tag and reserved-function diagnostics, the expected arm list) and `interpreter.defaults.functions.test.ts` (the `dbgenerated` removed message).
- Completion: `packages/1-framework/3-tooling/language-server/test/completion-provider.test.ts` ("offers each registered tag inside @default( with its own documentation"; the function list now ends at `nanoid`).
- Diagnostics fixtures: `test/integration/test/authoring/diagnostics/removed-dbgenerated/` and the parity pair `test/integration/test/authoring/parity/default-sql-literal/`.

## What is not done

Everything in the highlighting section: no SQL or JSON injection, no styling of the fence or the tag. Hover on a tagged literal. The formatter check for multi-line backtick bodies. Tag completion is done and tested; everything else in the language server section is a verification task, not a feature.
