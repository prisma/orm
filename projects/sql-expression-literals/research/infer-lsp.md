# Research: `contract infer`, the language server, the formatter and the Prisma 7 reader

Facts collected for the SQL expression literals design. Scope: the places that take raw SQL (`@@index(where:, expression:)`, `@@check(expression:)`, `@@fullTextIndex(where:)`, policy `using` / `withCheck`, `@default`). All paths are relative to the worktree root. Line numbers are as of commit `6a5b58ecb7`.

## Key findings

1. Infer prints `@@index` `expression:` / `where:` and `@@check` `expression:` as double-quoted PSL strings through `escapePslString`. It prints policy `using` / `withCheck` through `JSON.stringify`, which is a different escaping rule. It prints a raw `@default` as a `sql` literal through a private helper, `sqlLiteralText`, with the tag `sql` written into the code.
2. Infer does not read data type entries from the assembled stack. It calls `postgresDataTypeEntries()` from the target directly. The `sql` and `pg.sql` lowering entries are added only in the adapter, so infer never sees them. `print` from an authoring entry is used only for literal defaults.
3. `default-mapping.ts` contains two different rules for writing a tagged literal. `literalText` always uses backticks and escapes a backtick as `` \` ``. `sqlLiteralText` switches to the `sql"..."` form when the body holds a backtick. Design decision 8 describes the second rule.
4. Infer has no `@@fullTextIndex` printer. A live full-text GIN index prints as a generic `@@index(expression: "...", ...)`.
5. The policy lowering reads a value parameter back with `unwrapQuotedString`. That function decodes only `\\`, `\"`, `\n` and `\r`. `JSON.stringify` also writes `\t`, `\b`, `\f` and `\uXXXX`, so a predicate that holds one of those characters does not read back the same. A `` sql`x` `` value passes through unchanged (it does not start with `"`), which is the bug the spec names.
6. Language server: tag completion exists only where an attribute spec uses the `taggedLiteral` combinator, and today that is only `@default`. Block parameter values (`using = |`) get no completions at all. There is no hover provider. Semantic tokens give a tagged literal no token, while a plain string gets a `string` token. This repo has no TextMate grammar.
7. The formatter writes a backtick string token exactly as written, including line breaks and indentation. The `tagged-literal` fixture already covers a multi-line body. It also uses `pg.sql` twice, and this project removes that tag.
8. The Prisma 7 reader supports none of the non-default places. It maps `dbgenerated("...")` straight to `{ kind: 'function', expression }` (`defaults.ts:397-416`). It does not use the lowering entry, the `sql` tag entry, the body checks, or canonicalization.

## 1. How infer prints each place today

### 1.1 How the printer carries an argument value

Attribute arguments carry their value as raw PSL source text, not as a structured value. `packages/1-framework/1-core/framework-components/src/control/psl-ast.ts:65-78`:

```ts
export interface PslAttributePositionalArgument {
  readonly kind: 'positional';
  readonly value: string;
  readonly span: PslSpan;
}
export interface PslAttributeNamedArgument {
  readonly kind: 'named';
  readonly name: string;
  readonly value: string;
  readonly span: PslSpan;
}
```

The printer concatenates these strings unchanged. `packages/1-framework/2-authoring/psl-printer/src/ast-to-print-document.ts:107-121`:

```ts
export function renderPslAttribute(attr: PslAttribute): string {
  const prefix = attr.target === 'model' || attr.target === 'enum' ? '@@' : '@';
  if (attr.args.length === 0) {
    return `${prefix}${attr.name}`;
  }
  const inner = attr.args.map(renderAttributeArgument).join(', ');
  return `${prefix}${attr.name}(${inner})`;
}

function renderAttributeArgument(arg: PslAttributeArgument): string {
  if (arg.kind === 'positional') {
    return arg.value;
  }
  return `${arg.name}: ${arg.value}`;
}
```

Infer builds the arguments with helpers in `packages/3-targets/3-targets/postgres/src/core/psl-infer/psl-literals.ts`: `buildAttribute` (40-52), `positionalArg` (54-56), `namedArg` (58-60), `buildMapAttribute` (33-38), and `parseDefaultAttributeString` (26-31). The last one takes the whole `@default(...)` string that `mapDefault` returns, strips `@default(` and `)`, and stores the inside as one positional argument.

A block parameter value is also raw source text: `PslExtensionBlockParamScalarValue { kind: 'value'; raw: string; span }` (`packages/1-framework/1-core/framework-components/src/shared/psl-extension-block.ts`, around line 217). The descriptor for a value parameter is `PslBlockParamValue { kind: 'value'; codecId: string; required?; documentation? }` (same file, 168-173). The parser builds `raw` with `printSyntax(value.syntax).trim()` (`packages/1-framework/2-authoring/psl-parser/src/block-reconstruction.ts:196`).

The block printer is `serializeExtensionBlock` / `renderParamValue` / `renderValueParam` in `packages/1-framework/2-authoring/psl-printer/src/serialize-print-document.ts:122-287`. Without a `codecLookup`, a value parameter prints `raw` unchanged (257-259). With one, it does `JSON.parse(raw)`, then codec `decodeJson` and `encodeJson`, then `JSON.stringify` (268-286). Block attributes print as `@@name(args)`, with the argument values joined unchanged (166-169).

The CLI prints without a `codecLookup`. `packages/1-framework/3-tooling/cli/src/orm/contract/infer.ts:154-156`:

```ts
pslContent = printPsl(pslContractAst, {
  pslBlockDescriptors: client.getPslBlockDescriptors(),
});
```

The Supabase generator prints the same way (`packages/3-extensions/supabase/scripts/generate-contract.ts:481`, `printPsl(merged, { pslBlockDescriptors })`), after calling `postgresTargetDescriptor.inferPslContract` (395-399).

`escapePslString` exists as two identical copies:

- `packages/2-sql/4-lanes/relational-core/src/ast/data-type-support.ts:59-66`, which infer and `default-mapping.ts` import.
- `packages/1-framework/2-authoring/psl-printer/src/serialize-print-document.ts:57-63`, which the printer's `@map` rewriting uses (`ast-to-print-document.ts:17`, 197, 248).

```ts
export function escapePslString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}
```

Its inverse inside the printer is `unescapePslString` (`ast-to-print-document.ts:160-182`). It decodes `\\ \" \' \n \r`. The PSL reader decodes more: `decodeStringLiteral` in `packages/1-framework/2-authoring/psl-parser/src/syntax/ast/expressions.ts` (around 90-155) handles `\n \r \t \" \' \\ \xHH \uHHHH`. `StringLiteralExprAst.value()` (179-184) applies that to `"` and `'` strings. A backtick string resolves only `` \` `` and `\\`, through `resolvePslBacktickEscapes`.

### 1.2 `@@index` — `buildIndexAttribute`

`packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-index-attributes.ts:29-76`. The raw SQL lines:

```ts
  } else {
    assertDefined(index.expression, `buildIndexAttribute: index "${index.name}" carries neither columns nor expression; SqlIndexIR enforces exactly one`);
    args.push(namedArg('expression', `"${escapePslString(index.expression)}"`));
  }
  ...
  if (index.where !== undefined) {
    args.push(namedArg('where', `"${escapePslString(index.where)}"`));
  }
```

The arguments print in this order:

1. The field list `[a, b]` as a positional argument, or `expression:`.
2. `name:` or `map:`.
3. `where:`.
4. `unique: true`.
5. `type:`.
6. `options: { k: "v" }`, with keys sorted.

`name:` prints only when `parseWireName(index.name)` succeeds and its hash equals `computeIndexContentHash({ columns, expression, where, unique, type, options })` (44-57). Otherwise `map:` carries the live name. The call site is `infer-model-blocks.ts:124-129`.

Where the text comes from: `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts:953` reads `pg_get_expr(ix.indpred, ix.indrelid) AS where_predicate`, which is not pretty-printed. Line 955 reads `pg_get_indexdef(ix.indexrelid, k.ord::int, true) AS element_def`, which is pretty-printed, only for indexes that contain an expression.

### 1.3 `@@check` — `buildCheckAttribute`

`infer-index-attributes.ts:89-94`:

```ts
export function buildCheckAttribute(check: SqlCheckConstraintIR): PslModelAttribute {
  return buildAttribute('model', 'check', [
    namedArg('expression', `"${escapePslString(check.expression)}"`),
    namedArg('map', `"${escapePslString(check.name)}"`),
  ]);
}
```

It always uses `map:`. The doc comment (78-88) explains that the reprinted text never re-hashes to the wire name. The call site is `infer-model-blocks.ts:131-135`, which skips derived checks (`derivedCheckNames`). The text comes from `control-adapter.ts:1001`, `pg_get_expr(c.conbin, c.conrelid) AS check_expression`.

### 1.4 Policies — `buildPolicyBlocks`

`packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-policy-blocks.ts:113-124`:

```ts
        ...(policy.using !== undefined
          ? { using: { kind: 'value', raw: JSON.stringify(policy.using), span: SYNTHETIC_SPAN } }
          : {}),
        ...(policy.withCheck !== undefined
          ? {
              withCheck: {
                kind: 'value',
                raw: JSON.stringify(policy.withCheck),
                span: SYNTHETIC_SPAN,
              },
            }
          : {}),
```

- `permissive = false` prints as raw `'false'` (125-127).
- `@@map` always carries the physical name, through `escapePslString` (129-141).
- The block is `kind: 'policy'`, with `keyword` set to `policy_<operation>` (98-101).
- The call site is `infer-psl-contract.ts:313-321`.
- The text comes from `control-adapter.ts:1322`, `SELECT ... qual, with_check ... FROM pg_policies`.

The parameter descriptor that prints and reads it is in `packages/3-targets/3-targets/postgres/src/core/authoring.ts:547-552`:

```ts
const policyPredicateParam = {
  kind: 'value',
  codecId: 'pg/text@1',
  required: true,
  documentation: 'A SQL predicate controlling which rows this policy permits.',
} as const;
```

It is used for `using` and `withCheck` in the five `policy_*` descriptors (594-670).

The read-back path is `lowerRlsPolicyFromBlock` (`authoring.ts:250-332`). `readValueParam` (164-167) returns `param.raw`. `unwrapQuotedString` (181-205) returns `raw` unchanged when it does not start and end with `"` (182-184). Otherwise it decodes only `\\`, `\"`, `\n` and `\r`, and keeps any other escape as its two characters. So:

- `` using = sql`x` `` is stored as the text `` sql`x` ``. This is the bug the spec names.
- `JSON.stringify` writes `\t`, `\b`, `\f` and `\u00XX` for control characters. `unwrapQuotedString` does not decode them. So a live predicate that holds a tab or another control character does not read back the same. The PSL string reader itself would decode `\t` and `\uXXXX`.

### 1.5 `@@fullTextIndex`

Infer has no `@@fullTextIndex` printer. `packages/3-targets/3-targets/postgres/src/core/psl-infer/` has no full-text code. A live full-text index goes through `buildIndexAttribute` as an expression index: `@@index(expression: "<reprint of to_tsvector(...)>", map: "...", type: "gin")`, plus `where:` if the index is partial. No infer test covers a `to_tsvector` index.

For reference, the authoring side:

- The spec's `where` is `optional(str())` (`authoring.ts:743-746`).
- The lowering passes `where: parsed.where` unchanged (847).
- The expression comes from `renderFullTextIndexExpression` (`packages/3-targets/3-targets/postgres/src/core/full-text-index-expression.ts:12-17`): `` `to_tsvector('${language}', ${quoteIdentifier(columnName)})` ``.

### 1.6 `@default`

The printer is `packages/2-sql/9-family/src/core/psl-contract-infer/default-mapping.ts`. `mapDefault` (52-69):

```ts
    case 'function': {
      const attribute =
        options?.functionAttributes?.[columnDefault.expression] ??
        DEFAULT_FUNCTION_ATTRIBUTES[columnDefault.expression] ??
        `@default(${sqlLiteralText(columnDefault.expression)})`;
      return { attribute };
    }
```

`DEFAULT_FUNCTION_ATTRIBUTES` (26-29) maps `autoincrement()` and `now()` to their named forms.

`sqlLiteralText` (71-78):

```ts
/**
 * A raw SQL default as a `sql` tagged literal. The backtick fence resolves only `` \` `` and `\\`,
 * so a body holding a backtick is written inside the double-quote fence with PSL string escaping.
 */
function sqlLiteralText(expression: string): string {
  if (expression.includes('`')) return `sql"${escapePslString(expression)}"`;
  return `sql\`${expression.replace(/\\/g, '\\\\')}\``;
}
```

`literalText` (190-201), the fence used for literal defaults written through a tag entry:

```ts
function literalText(entry: DataTypeAuthoringEntry, body: string): string {
  const written = entry.written;
  if (written.kind === 'tag') {
    const fenced = body.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
    return `${written.tag}\`${fenced}\``;
  }
  return written.syntax === 'string' ? `"${escapePslString(body)}"` : body;
}
```

**The read-back check**, for literal defaults only. `writeScalar` (213-233) tries each candidate type from `classifications` (129-147). A candidate is kept only if all of these hold:

1. The column admits it: equal type, or a cast from it (`admitted`, 150-163).
2. The stored form is unchanged (`sameForm`, 310-325).
3. `entry.print` produces a body (`printedBody`, 166-172).
4. The body reads back through the same entry. That uses `written.parse`, or `classify` for numbers (`readBack`, 175-188).
5. The value that reads back is admitted again, in the same stored form.

A list column prints element by element (292-301). A written list on a scalar column goes through the type's `listCast` (`writeListCast`, 258-280).

A second check sits in the target: `printedDefaultReadsBack` (`packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-default-codec.ts:82-99`). It decodes the value with the codec that `contract emit` will bind to the printed type name (`CODEC_ID_BY_PRINTED_TYPE`, 22-43).

The call sites are in `infer-model-blocks.ts`:

- 282-295 calls `inferDefaultAttribute` and then `parseDefaultAttributeString`.
- `inferDefaultAttribute` (around 345-381):
  - An identity column prints as `@default(autoincrement())`.
  - A list column prints from its literal.
  - Otherwise `parseColumnDefault` runs and the result is dispatched.
- `literalOrRawAttribute` (387-401) is **the raw-expression fallback**. A literal default with no PSL literal, or one the codec does not read back, prints as `mapDefault({ kind: 'function', expression: column.default }, ...)`, which means a `sql` literal holding the raw text Postgres returned.
- `mappedAttribute` (403-408).

Function defaults have no read-back check. `sqlLiteralText` output is never parsed back.

## 2. Authoring entries in infer, and the raw fallback

**Where infer gets its entries.** `packages/3-targets/3-targets/postgres/src/core/psl-infer/postgres-default-mapping.ts:6-11`:

```ts
export function createPostgresDefaultMapping(): DefaultMappingOptions {
  return {
    dataTypeEntries: postgresDataTypeEntries(),
    dataTypes: createDataTypeLookup(postgresDataTypes),
  };
}
```

`postgresDataTypeEntries()` is in `packages/3-targets/3-targets/postgres/src/core/data-type-entries.ts:53-81`:

| Key | Written form | `print` | Documentation |
| --- | --- | --- | --- |
| `pg/text` | plain string | `String(value)` | "Text." |
| `pg/bool` | plain boolean | `String(value)` | "A boolean, written true or false." |
| `pg/numeric` | plain number, `types: [int2, int4, int8, numeric]`, `classify` | `printNumber` | "A number, whose type comes from its own size and precision." |
| `pg/json` | tag `json`, `parse: parseJsonBody` | `printJsonBody` | "Reads the body as a JSON document and stores it as the default value." |

The adapter adds the two lowering entries on top. `packages/3-targets/6-adapters/postgres/src/core/data-type-authoring.ts:12-18`:

```ts
export function createPostgresDataTypeEntries(): Readonly<Record<string, AuthoringDataTypeEntry>> {
  return {
    ...postgresDataTypeEntries(),
    [loweringEntryKey('sql')]: sqlDefaultLiteralTagEntry('sql'),
    [loweringEntryKey('pg.sql')]: sqlDefaultLiteralTagEntry('pg.sql'),
  };
}
```

SQLite does the same with `sqlite.sql` (`packages/3-targets/6-adapters/sqlite/src/core/data-type-authoring.ts:15-16`). The lowering entry comes from `packages/2-sql/9-family/src/core/sql-default-literal-tag.ts:14-45`. Its documentation is "Uses the SQL in the string, verbatim, as the column's default expression." (17).

Infer receives neither the assembled stack nor its entries. The target hook is `inferPslContract(schema, describedContracts)` (`packages/3-targets/3-targets/postgres/src/exports/control.ts:42-45`), and it calls `inferPostgresPslContract(tree, describedContracts)`. So:

- **`print` is used only for literal defaults**, in `printedBody` (`default-mapping.ts:166-172`). Index, check and policy printing use no authoring entry.
- `writingSurface` (98-122) skips lowering entries (`if (isDataTypeLoweringEntry(entry)) continue;`, 105). For every tag entry it records `entryOf.set(key, entry)` and adds the key to `tagTypes` (107-111). `classifications` offers every tag type as a candidate for every value (145, `for (const type of surface.tagTypes) found.push({ type, value })`). If `sql/expression` becomes an ordinary tag entry in this map, it becomes a candidate for every literal default. `admitted` then rejects it unless the column type is `sql/expression` or casts from it.
- **The raw fallback is `sqlLiteralText`, not an authoring entry.** It writes the tag `sql` directly. It uses the backtick fence and doubles each backslash, because the backtick fence resolves `\\`. It needs no backtick escape, because a body with a backtick takes the other branch: `sql"..."` with `escapePslString`.
- The two fencing rules differ, as listed under key finding 3. A body holding a backtick prints as `` sql"...`..." `` through the raw fallback, but as `` tag`...\`...` `` through `literalText`.

**Canonicalization on read-back.** Every tag body, in any fence, is read back through `canonicalizeTaggedLiteralBody` (`packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts:73-96`), via `TaggedLiteralExprAst.canonicalization()` (`expressions.ts:217-219`). It does four things:

1. It turns `\r\n` and `\r` into `\n`.
2. It drops a blank first line and a blank last line.
3. It removes the common leading indentation.
4. It empties blank lines.

So none of these print-and-read round trips is exact:

- A printed body whose only line starts with whitespace. For example, `" a"` reads back as `"a"`.
- A body with CR characters.
- A multi-line body with common indentation.

This holds for the `sql"..."` form too, because canonicalization runs after the string escapes are decoded. The live texts Postgres returns today are single-line, except possibly `element_def`, which is pretty-printed (`control-adapter.ts:955`).

**Documentation text.** The `sql` and `json` documentation strings both describe `@default` (see the table above and `sql-default-literal-tag.ts:17`). The language server shows these strings as the completion `detail` (section 4).

## 3. Tests

### 3.1 Unit tests for infer and the printer

| Path | What it covers | Plain-string SQL bodies |
| --- | --- | --- |
| `packages/3-targets/3-targets/postgres/test/psl-infer/infer-psl-contract.test.ts` | Index emission matrix (308-496): wire re-detection, `map:`, expression, partial, unique, type and options. Also a two-table snapshot (233-305). | Yes: `expression: "lower(email)"` (433, 443, 465), `where: "(email IS NOT NULL)"` (454) |
| `.../psl-infer/print-psl/print-psl.check.test.ts` | `@@check` emission. Derived check emits nothing. Hand-written check emits `map:` with the reprint. | Yes: inline snapshots `@@check(expression: "(total > (0)::numeric)", map: "positive_total")` (90) and `@@check(expression: "deleted_at IS NULL OR deleted_at > now()", ...)` (136) |
| `.../psl-infer/print-psl/print-psl.no-check.test.ts` | `@noCheck(elementNotNull)` emission. Check IR is input only. | No printed `@@check` |
| `.../psl-infer/infer-policy-emission.test.ts` | Policy block emission: head, `@@map`, `permissive = false`, roles, head collisions, skipped roles. Prints with `pslBlockDescriptors` only (72-74, 219). | Yes: `using = "(owner_id = 1)"` (97, 133), `withCheck = "(owner_id = 2)"` (134). The fixtures pass bodies such as `'(owner_id = 1)'`. |
| `.../psl-infer/print-psl/print-psl.defaults-and-types.test.ts` | Defaults: `sql` literal for a uuid default (307-340). Raw Postgres defaults as `sql` literals (395-440). | Already `sql` literals: 333, 435, 437 |
| `.../psl-infer/print-psl/print-psl.literal-defaults.test.ts` | Literal defaults; raw fallback to a `sql` literal (98-124, 222) | `` sql`NULL::character varying` `` (117) |
| `.../psl-infer/print-psl/print-psl.data-type-defaults.test.ts` | Default printing per column data type. The function default uses the backtick fence (164-171), or the double-quote fence when the body holds a backtick (173-178). | `` `@default(sql"${rawDefault}")` `` (176) |
| `.../psl-infer/print-psl.round-trip.test.ts` | A printed literal default reads back through the real parser and interpreter, with `dataTypes: postgresDataTypeEntries()` (72). No lowering entry, so `sql` defaults are not covered. | No |
| `.../psl-infer/infer-parse-emit.test.ts` | Storage types survive infer, then parse, then emit | No |
| `packages/2-sql/9-family/test/psl-contract-infer/default-mapping.test.ts` | `mapDefault` function defaults (123-165): backslash doubling (149), double-quote fence (156-160). Literal defaults (167-252). | `sqlLiteral(body)` helper (22) |
| `packages/1-framework/2-authoring/psl-printer/test/generic-extension-block-printer.test.ts` | Generic block printer with a fixture codec for `value` parameters | `using: valueParam('"auth.uid() = author_id"')` (148), expects `using = "auth.uid() = author_id"` (171) |
| `packages/1-framework/2-authoring/psl-printer/test/declarative-policy-select.round-trip.test.ts` (+ `fixtures/declarative-policy-select-extension.ts`) | Parse, validate, lower, serialize, print and re-parse for a fixture `policy_select`, with a `codecId`-typed `using` | `using  = "auth.uid() = author_id"` (217, 378), `"role = \\"admin\\""` (280), expects `using = "..."` (394) |

No unit test covers infer of a full-text index. `packages/1-framework/3-tooling/cli/test/orm/contract-infer.test.ts` uses a fixture client and has no SQL bodies.

### 3.2 Integration tests: infer, then emit, then verify

| Path | What it does | Plain-string SQL bodies |
| --- | --- | --- |
| `test/integration/test/cli-journeys/infer-roundtrip-fidelity.e2e.test.ts` + `infer-roundtrip-fidelity/harness.ts` | Seed (`harness.ts:7-63`): expression index, partial index, unique expression index, two policies (34-39). Several cases emit and verify the whole inferred schema; `fixIndexTypes` strips `type: "gin"/"hash"` (80-82). | Asserts `'@@index(expression: "lower(email)", map: "users_email_lower_idx")'` (367), `'... where: "(birth_date IS NULL)")'` (384), `'@@index(expression: "lower(email)", map: "users_email_ci_key", unique: true)'` (402), `'using = "(id = 1)"'` (440), `'withCheck = "(id = 2)"'` (459) |
| `test/integration/test/cli-journeys/sign-the-database.e2e.test.ts` | Infer, emit, verify with zero issues, sign, and a dry-run that plans zero operations. Then moves one index from `map:` to a wire name by string replacement. | 123, 126, 129, and the replacement strings at 195-196 |
| `test/integration/test/cli-journeys/infer-roundtrip-fidelity.hand-written-check.e2e.test.ts` | Hand-written CHECK: infer, emit, verify, strict verify | Regex `/@@check\(expression: "\(cardinality\(tags\) > 0\)", map: "users_tags_not_empty"\)/` (61) |
| `test/integration/test/cli-journeys/contract-infer-workflow.e2e.test.ts` | Seeds one policy (33-35). Infer, emit, verify `--schema-only`, then infer again. | No assertion on the body. The inferred PSL holds a plain-string `using`. |
| `test/integration/test/cli-journeys/rls-exact-name-adoption.e2e.test.ts` | Adopts a policy by `@@map`, then renames it to the wire name. Uses fixtures `contract-rls-adopted.prisma` and `contract-rls-wire.prisma` (`utils/journey-test-helpers.ts:219-220`). | Both fixtures have `using  = "(tenant_id = 1)"` (line 15), under `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/` |
| `test/integration/test/cli-journeys/infer-roundtrip-fidelity.bare-unique-index-one-to-one.e2e.test.ts` | Partial unique index seeded (44). Infer only; no emit and no body assertion. | No |
| `test/integration/test/cli-journeys/infer-roundtrip-fidelity.prisma7-defaults.e2e.test.ts` | Prisma 7 database, then infer, then emit, then strict verify | Already `` sql`NULL::character varying` `` (242) |
| `test/integration/test/cli.db-introspect.e2e.test.ts` | Introspect output | Already `` sql`gen_random_uuid()` `` (132) |

Related committed output from the same printers: `packages/3-extensions/supabase/src/contract/contract.prisma`, generated by `scripts/generate-contract.ts`, has 58 lines with plain-string `where:`, `expression:`, `@@check` or `using` (for example 74-83 and 126-129). The Supabase infer tests (`packages/3-extensions/supabase/test/brownfield-infer.integration.test.ts`, `infer-cross-space-fk.integration.test.ts`) assert no SQL bodies.

## 4. Language server

### 4.1 Tag completion

`packages/1-framework/3-tooling/language-server/src/completion-values.ts:134-146`:

```ts
  if (syntax === 'functionName') return [];
  if (type.kind === 'taggedLiteral') {
    return type.tags.map((tag) => ({
      ...completionItem(
        input,
        tag,
        input.clientSupportsSnippets ? `${tag}\`$1\`` : tag,
        CompletionItemKind.Value,
        input.clientSupportsSnippets,
      ),
      detail: type.documentation,
    }));
  }
```

`valueItems` (96-167) handles `oneOf` by recursing and `funcCall` with a snippet. It then switches on `type.kind` with no `default` branch (147-166):

- `str` offers only a fixed value (`JSON.stringify(type.value)`). A free `str()` offers nothing (150-151).
- `list`, `record`, `entityRef`, `int`, `json` and `rejecting` offer nothing.

The value-item entry points are `provideAttributeArgumentSlotCompletionItems` (41-52) and `provideAttributeValueCompletionItems` (54-63).

Tags reach completion only through an attribute spec that uses the `taggedLiteral` combinator (`packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/tagged-literal.ts:12-33`). It has one call site outside tests: `scalarDefaultArms` in `packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts:188-220`. That function groups tags by documentation (194-202), so `sql` and `pg.sql` share one arm. The places this project changes are all declared as strings today:

- `@@index` `expression` and `where`: `optional(str())` (`sql-attribute-specs.ts:395-403`).
- `@@check` `expression`: `str()` (480).
- `@@fullTextIndex` `where`: `optional(str())` (`packages/3-targets/3-targets/postgres/src/core/authoring.ts:743-746`).

So none of them completes a tag today.

The combinator's types are `TaggedLiteralArgType { kind: 'taggedLiteral'; tags; documentation }` and `ParsedTaggedLiteral { tag; canonicalization; span }` (`packages/1-framework/2-authoring/psl-parser/src/attribute-spec/types.ts:210-221`). The `ArgTypeKind` union is at 32-47, and `InspectableArgType` at 248-266. A new argument kind would be added to both, and to the switch in `completion-values.ts:147-166`.

### 4.2 How the server gets `dataTypeEntries`

`packages/1-framework/3-tooling/language-server/src/attribute-spec-resolution.ts`:

- In the `model` case (57-73) and the `field` case (74-92), the server builds the spec context with `controlMutationDefaults: { ...source.controlMutationDefaults, dataTypeEntries: source.authoringContributions.dataTypes ?? {} }` (lines 66-70 and 85-89).
- In the `block` case (46-56), it resolves only `descriptor.attributes[name]` factories and does not pass `dataTypeEntries`.
- The source is `project.controlStack.authoringContributions` and `project.controlStack.controlMutationDefaults` (`server.ts:490-500` for completion, 528-537 for signature help).

Model spec factories receive `AttributeSpecContext { symbols; model; controlMutationDefaults }` (`packages/1-framework/2-authoring/psl-parser/src/attribute-spec/spec-context.ts:5-17`). But `sqlAttributeSpecs.model.index` and `.check` are factories that ignore the context and return constants: `index: () => indexModelSpec`, `check: () => checkModelSpec` (`sql-attribute-specs.ts:704-705`). Postgres `fullTextIndex` is also a constant factory (`authoring.ts:784`).

### 4.3 Block parameter values (policy `using` / `withCheck`)

`completion-provider.ts:141-144`:

```ts
    // Parameter-value completion (option allowed-values / ref scopes) is future
    // work.
    case 'genericBlockValue':
      return [];
```

The context type `GenericBlockValueCompletionContext` (`completion-context.ts:77-82`) carries `offset`, `blockKeyword` and `replacementStartOffset`. It carries neither the block node nor the parameter key. It is created when the preceding token is `=` (781-790).

The block keyword snippet (`completion-provider.ts:402-415`) writes a required value parameter as a bare placeholder (`` `\${${index + 2}:${name}}` ``), and a list as `[...]`. Parameter-name completion (around 452-470) shows `descriptor.parameters[name].documentation`.

### 4.4 Attribute snippets and signature help

`completion-snippets.ts:42-52` (`argSnippetPlaceholder`) writes a `str` argument as `"${n:key}"`, a list as `[...]` and a record as `{ ... }`. So `@@check` completes to `` check(expression: "${1:expression}") ``.

Signature help (`signature-help.ts:101-126`) labels each parameter with `param.type.label`. The labels are `str()` → `'string'` (`combinators/str.ts:16`) and `taggedLiteral` → `` `${tags[0] ?? 'tag'}\`...\`` `` (`tagged-literal.ts:18`).

### 4.5 Semantic tokens

`semantic-tokens.ts`:

- A string literal gets a `string` token (414-416: `if (expression instanceof StringLiteralExprAst) { addToken(expression.token(), 'string', tokens); return; }`).
- A tagged literal gets none (452-454: `if (expression instanceof TaggedLiteralExprAst) { return; }`).
- Generic block members go through the same `collectExpression` (286-300). Attribute arguments reach it through `collectAttributeArg` (400).

So `where:`, `expression:` and `using` values lose the `string` token they have today when they become `sql` literals. `test/semantic-tokens.test.ts` has no tagged-literal case. This repo has no `.tmLanguage` grammar.

### 4.6 Diagnostics

`diagnostic-mapping.ts:18-49`:

- `mapParseDiagnostics` copies range, message and code, with severity Error.
- `mapInterpreterDiagnostics` converts `diagnostic.span` with `sourceFile.pslSpanToRange`. A diagnostic without a span is placed at `documentStartRange`, line 0, characters 0-1 (31-34).

A new interpreter refusal, such as a plain string where a `sql` literal is required, reaches the editor through this path with no change. The refusal's span decides where it is underlined.

### 4.7 Hover

There is no hover provider. `server.ts:550-575` declares these capabilities: formatting, folding ranges, semantic tokens, completion (triggers `. @ [ ( { : ,`), signature help (triggers `( ,`) and pull diagnostics. `src/` has no `onHover` handler. The editor brief says hover on a tagged literal is new work (`docs/reference/psl-editor-tooling-tagged-literals.md:23, 45`).

### 4.8 Tests

`packages/1-framework/3-tooling/language-server/test/completion-provider.test.ts`:

- 1186-1262, "offers each registered tag inside @default( with its own documentation":
  - It uses the real `createPostgresDataTypeEntries()` and `createSqliteDataTypeEntries()`.
  - For Postgres it expects `true`, `false`, `json`, `sql`, `pg.sql` (1235-1241). For SQLite it expects `json`, `sql`, `sqlite.sql` (1243-1249). It also checks the form without snippets (1250-1256).
  - It checks that `json` and `sql` have different documentation (1259-1261).
- 740-814, the actual SQL stack:
  - Model attribute names include `check` and `index` (749).
  - `@@index(expression: "lower(name)", ma|)` offers `where, unique, name, map, type, options` (756-774).
  - The `@@check` snippet is `` check(expression: "${1:expression}") `` (797-813).
- 458-504: the block snippet with required value parameters as bare placeholders.
- 1037-1041: "returns no completions for a generic block value position".
- 1043-1050: descriptor-backed block parameter names with documentation.

Other tests:

- `test/completion-context.test.ts:439-458` classifies the `genericBlockValue` context.
- `test/completion-snippets.test.ts:25-27` covers `str` / `list` / `record` placeholders.
- `test/server.test.ts:144` has a fixture block descriptor with `where: { kind: 'value', codecId: 'fixture/text@1' }`.
- `test/integration/test/authoring/attribute-specs.lsp-consumability.test.ts:125-151` lists the SQL and Postgres model attribute names (`check`, `fullTextIndex`, `index`, ...) from a resolved project.

## 5. Formatter

`packages/1-framework/2-authoring/psl-parser/src/format/emit.ts`:

- `spaceBetween` (106-142): a tag and its string are written with no space between them (114-115):

  ```ts
  // Only a tagged literal puts a string directly after an identifier, and its tag and string hug.
  if (prev === 'Ident' && cur === 'StringLiteral') return false;
  ```

- `LineWriter.write` (76-85) appends `token.text` unchanged, including any line breaks inside a backtick string.
- `newline()` (59-67) adds indentation only at the start of the output line. So the continuation lines of a multi-line body keep their source indentation, even when the enclosing block's indentation changes.
- `finish()` (99-103) joins output lines with the configured newline. It does not convert the line breaks inside a string token.
- `streamRow` (192-225) pads only the type column and the first field attribute. Anything after a multi-line literal continues after its closing backtick.
- `emitBlockAttribute` (227-229) and `emitKeyValue` (231-233), for `@@check(...)` and `using = ...`, stream without padding.
- The tokenizer lexes a backtick string across lines as one `StringLiteral` token (`src/tokenizer.ts:195-210`).

Fixture `test/format/fixtures/tagged-literal/`. `input.prisma` → `expected.prisma`:

```prisma
model Token {
  id      String   @id @default(sql`gen_random_uuid()`)
  expires DateTime @default(sql"(now() + '00:03:00'::interval)")
  created DateTime @default(pg.sql`now()`)
  body    String   @default(sql`
      SELECT   1
        FROM   t   -- keep   this   spacing
  `)
  spaced  DateTime @default(sql`x`)
  dotted  String   @default(pg.sql"y")
  after   Int      @default(0)
  z       Boolean?
}
```

- The input has `sql   \`x\`` and `pg . sql "y"`, which the formatter closes up to `` sql`x` `` and `pg.sql"y"`.
- The multi-line body, with a `--` comment, stays exactly as written.
- `pg.sql` appears twice (lines 4 and 10). The formatter does not check tags, so the fixture keeps passing, but it shows a form this project removes.
- No formatter fixture puts a tagged literal in `@@index`, `@@check`, `@@fullTextIndex` or a block value.
- The runner is `test/format/fixtures.test.ts`, with `authoredCaseCount = 23` checked as a minimum (13-17). It checks that the formatter produces the expected output, that formatting is idempotent, and that the input changes when it is not already canonical.
- The editor brief says the multi-line formatter check "is not done" (`docs/reference/psl-editor-tooling-tagged-literals.md:27, 45`). The fixture's lines 5-8 already cover it, so that part of the brief is out of date.

## 6. `contract-prisma7` (ADR 252)

**Which places the reader supports.** It supports none of the non-default places:

- `@@index` / `@@unique` / `@@id` arguments are read by `parseIndexAttribute` (`packages/2-sql/2-authoring/contract-prisma7/src/indexes.ts:15-85`). It accepts `fields`, `map`, `name` (ignored) and `type`. Any other named argument, including `where`, gives `PSL.PRISMA7_INDEX_ARGUMENT_UNSUPPORTED` `argument "<key>" is not supported.` (80-81). `indexNode` always sets `where: undefined` (134).
- Any other model attribute, such as `@@fulltext` or `@@check`, gives `PSL.PRISMA7_UNKNOWN_ATTRIBUTE` (`src/interpreter.ts:601-609`). Fixture `test/fixtures/unknown-attribute/schema.prisma` uses `@@fulltext`.
- A top-level block other than `datasource`, `generator`, `enum` or `view`, such as a policy, gives `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` (`interpreter.ts:205-237`).

That Prisma 7's own language has no CHECK constraints or RLS policies comes from general knowledge. It is not verified in this repo.

**How `dbgenerated` is mapped.** `src/defaults.ts:339-341` sends `dbgenerated` to `dbgeneratedDefault` (392-416):

```ts
function dbgeneratedDefault(callArgs, unknown, span): LoweredPrisma7Default | undefined {
  if (callArgs.length === 0) return { storage: undefined, onCreate: undefined };
  const [argument] = callArgs;
  const value = argument?.value();
  const expression =
    callArgs.length === 1 && argument?.name() === undefined && value !== undefined
      ? StringLiteralExprAst.cast(value.syntax)?.value()
      : undefined;
  if (expression === undefined || expression.trim() === '') {
    return unknown('function "dbgenerated()" has an argument this contract source does not read.', span);
  }
  return { storage: { kind: 'function', expression }, onCreate: undefined };
}
```

- `dbgenerated()` with no argument means the column has no default.
- The stored expression is the decoded string as written. It is not trimmed and not canonicalized. `reservedSqlDefaultBody` and `checkSqlDefaultBody` are not applied.
- `givesColumnDefault` (57-65) treats `dbgenerated` with an argument as a column default.

**Does it use the lowering entry or the `sql` tag entry?** Neither.

- `dbgenerated` never goes through `loweringEntryKey`, `sqlDefaultLiteralTagEntry` or the default function registry. The test `test/defaults.test.ts:61-62` says it "lowers to a raw SQL default without a registry entry for dbgenerated".
- The only tag lookup in the reader is `entryForTag(input.dataTypeSupport, 'json')` (`defaults.ts:294`), for JSON column literals.
- A second path also produces function defaults without any entry: the binding's `sqlExpression` literal form (`defaults.ts:112-124`, `sqlExpressionDefault` 247-267). Postgres uses it for `bytea` and temporal columns (`packages/3-targets/3-targets/postgres/src/core/prisma7-binding.ts:59-82`).

Fixtures:

- `test/fixtures/defaults/schema.prisma:17` has `@default(dbgenerated("gen_random_uuid()"))`. It becomes `"default": { "kind": "function", "expression": "gen_random_uuid()" }` in `expected-contract.json:291-294`.
- `test/fixtures/dbgenerated-without-expression/unread-argument.prisma` has the refused forms, with messages in `test/defaults.test.ts:76-82`.
