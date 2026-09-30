# Research: PSL block parameters and RLS policy blocks

Scope: the facts needed to change block `value` parameters from being typed by a codec id to being typed by a data type (checked by the ADR 254 cast rule), so that a policy's `using` and `withCheck` receive `sql/expression` and refuse a plain string.

All paths are relative to the worktree root. Line numbers are from the tree at commit `6a5b58ecb7`.

## Key findings

1. Only one pack declares `kind: 'value'` block parameters: the Postgres target. There are exactly two descriptors, `policyPredicateParam` (`codecId: 'pg/text@1'`, used by `using` and `withCheck`) and `policyPermissiveParam` (`codecId: 'pg/bool@1'`). No extension pack (Supabase, pgvector, PostGIS, ParadeDB), no Mongo code and no SQL-family code declares one. Every other `value` parameter in production is a variadic enum member with no descriptor.
2. The `codecId` on a `value` descriptor is read in production by nothing that runs on the normal path. The generic validator `validateExtensionBlock` reads it, but no production code calls the validator. The printer reads it only when given a `codecLookup`, and neither production caller (`contract infer`, the Supabase `generate-contract` script) passes one.
3. Block reconstruction stores a `value` parameter as `raw`: the source text of the expression, trimmed, with quotes, escapes and any tag left in. `` using = sql`x` `` becomes `raw: 'sql`x`'`. The Postgres lowering unwraps only a double-quoted string, so the tag text reaches the contract. This is the bug in design note 3.
4. The lowering context (`AuthoringEntityContext`) carries `codecLookup` but no data-type lookup and no data-type authoring entries. The SQL interpreter has both in scope (`dataTypeSupport`, built at `interpreter.ts:2177`) at the point where it builds the lowering context (`interpreter.ts:2281`), but does not pass them.
5. If the generic validator were wired in as it stands, it would break committed schemas: it would reject a `policy_update` with only `using`, because both predicates are declared `required: true` while the TypeScript builder and the parity fixture treat them as "at least one".
6. The codec checks the validator would run are empty for these two codecs: `pg/text@1` and `pg/bool@1` both have an identity `decodeJson` (a `blindCast`), so `using = true` and `permissive = "yes"` would pass it.
7. `contract infer` builds policy blocks with `raw: JSON.stringify(policy.using)` and prints `raw` verbatim. The only existing printer for a `sql` literal (`sqlLiteralText` in the SQL family) is a private function.

## 1. The block parameter types

File: `packages/1-framework/1-core/framework-components/src/shared/psl-extension-block.ts` (shared plane; re-exported from `src/control/psl-ast.ts:4-19`, `src/exports/authoring.ts:64-75`, and `src/exports/psl-ast.ts`).

### `PslBlockParam` (descriptor vocabulary), lines 142-185

```ts
/**
 * Descriptor vocabulary for a single parameter on a declared block.
 *
 * Four kinds:
 * - `ref` — the parameter value is an identifier that must resolve to a
 *   declared entity of `refKind` within the declared `scope`.
 * - `value` — the parameter value is a PSL literal parsed and printed
 *   through the codec identified by `codecId`.
 * - `option` — the parameter value is one of the literal tokens in `values`.
 *   Not a codec; not persisted data. A closed authoring-time constraint only.
 * - `list` — a bracketed list whose elements each match the `of` descriptor.
 */
export type PslBlockParam =
  | PslBlockParamRef
  | PslBlockParamValue
  | PslBlockParamOption
  | PslBlockParamList;

export interface PslBlockParamRef {
  readonly documentation?: string;
  readonly kind: 'ref';
  readonly refKind: string;
  readonly scope: 'same-namespace' | 'same-space' | 'cross-space';
  readonly required?: boolean;
}

export interface PslBlockParamValue {
  readonly documentation?: string;
  readonly kind: 'value';
  readonly codecId: string;
  readonly required?: boolean;
}

export interface PslBlockParamOption extends AuthoringOption {
  readonly documentation?: string;
  readonly required?: boolean;
}

export interface PslBlockParamList {
  readonly documentation?: string;
  readonly kind: 'list';
  readonly of: PslBlockParam;
  readonly required?: boolean;
}
```

`AuthoringOption` (`src/shared/option-descriptor.ts:8-11`) is `{ readonly kind: 'option'; readonly values: readonly string[] }`, shared with helper-argument descriptors (ADR 246).

### `PslExtensionBlockParamValue` (parsed parameter), lines 187-244

```ts
/**
 * The parsed representation of a single parameter value on a uniform
 * extension-block AST node. Mirrors the `PslBlockParam` descriptor
 * vocabulary, plus `bare` for keyonly entries:
 *
 * - `ref`    → `PslExtensionBlockParamRef` — a raw identifier string
 *   (resolution runs in the validator, not the parser).
 * - `value`  → `PslExtensionBlockParamScalarValue` — a raw PSL literal string
 *   (codec validation runs in the validator).
 * - `option` → `PslExtensionBlockParamOption` — the chosen token.
 * - `list`   → `PslExtensionBlockParamList` — ordered list of the above.
 * - `bare`   → `PslExtensionBlockParamBare` — a bare identifier line with no
 *   `= value` (e.g. `Low` in an enum block). The name is the key in
 *   `parameters`; the interpreting consumer decides the default value.
 *
 * These shapes are intentionally minimal. The validator and lowering refine
 * and consume them; the generic framework parser produces them.
 */
export type PslExtensionBlockParamValue =
  | PslExtensionBlockParamRef
  | PslExtensionBlockParamScalarValue
  | PslExtensionBlockParamOption
  | PslExtensionBlockParamList
  | PslExtensionBlockParamBare;

export interface PslExtensionBlockParamRef { readonly kind: 'ref'; readonly identifier: string; readonly span: PslSpan; }
export interface PslExtensionBlockParamScalarValue { readonly kind: 'value'; readonly raw: string; readonly span: PslSpan; }
export interface PslExtensionBlockParamOption { readonly kind: 'option'; readonly token: string; readonly span: PslSpan; }
export interface PslExtensionBlockParamList { readonly kind: 'list'; readonly items: readonly PslExtensionBlockParamValue[]; readonly span: PslSpan; }
export interface PslExtensionBlockParamBare { readonly kind: 'bare'; readonly span: PslSpan; }
```

(The four one-line interfaces above are written out on several lines in the source, at 212-244.)

### Block attributes and the block node, lines 246-318

```ts
export interface PslExtensionBlockAttributeArg { readonly kind: 'positional'; readonly value: string; readonly span: PslSpan; }
export interface PslExtensionBlockAttribute { readonly name: string; readonly args: readonly PslExtensionBlockAttributeArg[]; readonly span: PslSpan; }
export interface PslExtensionBlockParsedAttribute { readonly args: Readonly<Record<string, unknown>>; readonly span: PslSpan; }

export interface PslExtensionBlock {
  readonly kind: string;       // the descriptor's discriminator, e.g. 'policy'
  readonly keyword: string;    // the source keyword, e.g. 'policy_select'
  readonly name: string;
  readonly parameters: Record<string, PslExtensionBlockParamValue>;
  readonly blockAttributes: readonly PslExtensionBlockAttribute[]; // raw @@ lines
  readonly attributes: Readonly<Record<string, PslExtensionBlockParsedAttribute>>; // spec-parsed @@ attributes
  readonly span: PslSpan;
}
```

The doc comment (273-303) says parameters keep insertion order, only present parameters are included, and absence of a required parameter "is a validator concern, not a parser concern".

### Diagnostic codes relevant to blocks, lines 26-128

`PslDiagnosticCode` includes `PSL_INVALID_EXTENSION_BLOCK_MEMBER`, `PSL_BACKTICK_STRING_REQUIRES_TAG`, `PSL_UNKNOWN_DEFAULT_LITERAL_TAG`, `PSL_TAGGED_LITERAL_NUL`, `PSL_TAGGED_LITERAL_TOO_LARGE`, `PSL_EXTENSION_UNKNOWN_PARAMETER`, `PSL_EXTENSION_MISSING_REQUIRED_PARAMETER`, `PSL_EXTENSION_OPTION_OUT_OF_SET`, `PSL_EXTENSION_INVALID_VALUE`, `PSL_EXTENSION_UNRESOLVED_REF`, `PSL_EXTENSION_DUPLICATE_PARAMETER`, `PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE`, `PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE`. The doc for `PSL_EXTENSION_INVALID_VALUE` (lines 103-108):

```ts
  /**
   * A `value`-kind parameter's raw text is not a valid JSON literal, or the
   * parsed JSON value was rejected by the codec's `decodeJson` method, or the
   * codec id is not registered in the lookup.
   */
  | 'PSL_EXTENSION_INVALID_VALUE'
```

`ContributedPslDiagnosticCode = `PSL_${string}`` (line 140) is the type packs use for their own codes. The Postgres target also declares `PSL_EXTENSION_INVALID_VALUE` as a contributed code (`authoring.ts:89`), so the same code name exists in both vocabularies.

### `AuthoringPslBlockDescriptor`

File: `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts:408-470`.

```ts
export interface AuthoringPslBlockDescriptor {
  readonly kind: 'pslBlock';
  readonly documentation?: string;
  readonly keyword: string;
  readonly discriminator: string;
  readonly name: { readonly required: boolean };
  readonly parameters: Record<string, PslBlockParam>;
  readonly variadicParameters?: boolean;
  readonly requiresModelAttribute?: {
    readonly parameter: string;
    readonly attribute: string;
  };
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export type AuthoringPslBlockDescriptorNamespace = {
  readonly [name: string]: AuthoringPslBlockDescriptor | AuthoringPslBlockDescriptorNamespace;
};
```

It is registered on `AuthoringContributions.pslBlockDescriptors` (line 671). Assembly checks (`collectPslBlockDescriptorEntries`, 1286-1331; `assertPslBlocksHaveFactories`, 1341+) check descriptor shape, keyword uniqueness and a matching `entityTypes` factory. Nothing checks that a `value` parameter's `codecId` names a registered codec.

### `AuthoringEntityContext` (what a block lowering receives)

`framework-authoring.ts:266-284`:

```ts
export interface AuthoringEntityContext {
  readonly family: string;
  readonly target: string;
  /** Codec registry available to factories that need to validate or decode values. */
  readonly codecLookup?: CodecLookup;
  /** Source file identifier threaded into diagnostics emitted by the factory. */
  readonly sourceId?: string;
  /** Push channel for authoring-time diagnostics emitted by the factory. */
  readonly diagnostics?: AuthoringDiagnosticSink;
  /** Push channel for non-fatal authoring-time warnings emitted by the factory. */
  readonly warnings?: AuthoringWarningSink;
  readonly enumInferenceCodecs?: { readonly text: string; readonly int: string };
}
```

No `DataTypeLookup`, no `AuthoringDataTypeEntry` map. `AuthoringDiagnosticSink.push` takes `{ code: string; message: string; sourceId: string; span?: unknown }` (lines 188-195).

## 2. Block reconstruction

### Where it runs

`buildSymbolTable` (`packages/1-framework/2-authoring/psl-parser/src/symbol-table.ts`) calls `buildBlock` for each generic block, which calls `reconstructExtensionBlock(node, descriptor, sources, diagnostics)` at line 286. The descriptor is found by keyword with `findBlockDescriptor` (`extension-block.ts:19-34`). After all documents are read, `interpretBlockAttributes` runs for every collected block with a descriptor (symbol-table.ts:228-233). So parameter reconstruction happens at symbol-table time, with no access to data types or codecs.

### How a value is parsed

`parseKeyValue` (`packages/1-framework/2-authoring/psl-parser/src/parse.ts:826-847`) reads `key`, then `=`, then `parseExpression`. If no expression follows it reports `PSL_INVALID_EXTENSION_BLOCK_MEMBER`, message `Expected a value after "="`. `parseExpression` (parse.ts:191-202) tries in order: string literal, number, array, object literal, tagged literal, function call, boolean, identifier. So a block value can be any expression. A backtick string with no tag reports `PSL_BACKTICK_STRING_REQUIRES_TAG`, message `A backtick string must follow a tag, as in tag`...`.` (parse.ts:205-214). A tagged literal is `TaggedLiteral` (parse.ts:297-303): a qualified name then a string literal in any of the three quote styles. Single-quoted strings are ordinary string literals (tokenizer `QUOTES`, tokenizer.ts:195).

### `reconstructExtensionBlock`, block-reconstruction.ts:26-87

For each entry (`node.entries()`), the key is read, the span is `nodePslSpan(entry.syntax, sources)` (the whole `key = value` entry), duplicates are reported, and the value is reconstructed against `descriptor?.parameters[key]`:

```ts
    if (Object.hasOwn(parameters, key)) {
      diagnostics.push({
        filename: sourceFile.filename,
        code: 'PSL_EXTENSION_DUPLICATE_PARAMETER',
        message: `Duplicate parameter "${key}" in "${keyword}" block "${blockName}"; first occurrence wins`,
        range: { ... },
      });
      continue;
    }
    parameters[key] = reconstructParamValue(entry, descriptor?.parameters[key], span, sources, diagnostics);
```

The block's `kind` is `descriptor?.discriminator ?? keyword`; `attributes` starts `{}` and is filled later by `interpretBlockAttributes`.

### `reconstructParamValue` and `reconstructFromExpression`, lines 175-235

```ts
function reconstructParamValue(entry, param, span, sources, diagnostics): PslExtensionBlockParamValue {
  const value = entry.value();
  if (value === undefined) {
    return { kind: 'bare', span };
  }
  return reconstructFromExpression(value, param, span, sources, diagnostics);
}

function reconstructFromExpression(
  value: ExpressionAst,
  param: PslBlockParam | undefined,
  span: PslSpan,
  sources: PslSources,
  diagnostics?: ParseDiagnostic[],
): PslExtensionBlockParamValue {
  const raw = printSyntax(value.syntax).trim();
  if (param?.kind === 'list') {
    const sourceFile = sources.sourceFileFor(value.syntax);
    const array = ArrayLiteralAst.cast(value.syntax);
    if (!array) {
      diagnostics?.push({
        filename: sourceFile.filename,
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message: `List parameter expects an array literal, got ${raw}`,
        range: { ... },
      });
      return { kind: 'value', raw, span };
    }
    const items: PslExtensionBlockParamValue[] = [];
    for (const element of array.elements()) {
      items.push(reconstructFromExpression(element, param.of, nodePslSpan(element.syntax, sources), sources, diagnostics));
    }
    return { kind: 'list', items, span };
  }
  switch (param?.kind) {
    case 'ref':
      return { kind: 'ref', identifier: raw, span };
    case 'option':
      return { kind: 'option', token: raw, span };
    default:
      return { kind: 'value', raw, span };
  }
}
```

Facts that follow:

- `raw` is `printSyntax(value.syntax).trim()`: the concatenated text of every token in the expression node (`ast-helpers.ts:66-72`), including trivia inside it, trimmed at both ends. It is the source text, not a decoded value.
- The `value` arm is the default. It is taken for a `value` descriptor, for a parameter with no descriptor (unknown key, or any key of a variadic block), and for a descriptor-free block. The descriptor's `codecId` is never read here.
- A tagged literal gets no special handling. The expression AST (`TaggedLiteralExprAst`, `syntax/ast/expressions.ts:192-230`) offers `tagName()`, `literal()`, `canonicalization()` and `body()`, but reconstruction throws the node away and keeps only its text. Canonicalization failures (`PSL_TAGGED_LITERAL_NUL`, `PSL_TAGGED_LITERAL_TOO_LARGE`) are never reported for a block value; only `@default` reports them (`contract-psl/src/psl-column-resolution.ts:710-713, 744-749`).
- A top-level parameter's `span` covers the whole entry (`using = ...`), not the value. A list element's `span` covers the element only.

What `raw` holds for each way of writing `using`:

| Source | Expression node | `raw` |
|---|---|---|
| `using = "\"userId\" = 1"` | `StringLiteralExpr` | `"\"userId\" = 1"` (quotes and escapes kept) |
| `using = 'x'` | `StringLiteralExpr` | `'x'` |
| `` using = sql`x` `` | `TaggedLiteral` | `` sql`x` `` |
| `` using = pg.sql`x` `` | `TaggedLiteral` | `` pg.sql`x` `` |
| `using = true` | `BooleanLiteralExpr` | `true` |
| `using = 42` | `NumberLiteralExpr` | `42` |
| `using = foo` | `Identifier` | `foo` |
| `` using = `x` `` | `StringLiteralExpr` plus `PSL_BACKTICK_STRING_REQUIRES_TAG` | `` `x` `` |

### Block attributes, lines 89-173

`interpretBlockAttributes` runs each `@@` attribute through its descriptor-declared attribute-spec factory (`interpretAttribute`). Diagnostics: `PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE` (`Unknown attribute "@@${name}" in "${keyword}" block "${blockName}"`) and `PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE` for a duplicate (`Duplicate attribute "@@${name}" in "${keyword}" block "${blockName}"; first occurrence wins`), plus whatever the attribute spec reports. Block attributes already go through the attribute-spec kit, so an attribute argument that names a data type (design note 6) would also be available to block attributes.

## 3. The generic validator

### `validateExtensionBlock`

File: `packages/1-framework/1-core/framework-components/src/control/psl-extension-block-validator.ts:97-156`. Signature:

```ts
export function validateExtensionBlock(
  node: PslExtensionBlock,
  descriptor: AuthoringPslBlockDescriptor,
  sourceId: string,
  codecLookup: CodecLookup,
  refCtx?: ExtensionBlockRefResolutionContext,
): readonly PslDiagnostic[]
```

It reports, in order: unknown parameters (unless `variadicParameters`), missing `required: true` parameters, then per-parameter checks. The `value` arm (lines 185-225):

```ts
    case 'value': {
      if (captured.kind !== 'value') {
        return;
      }
      const codec = codecLookup.get(param.codecId);
      if (codec === undefined) {
        diagnostics.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `Parameter "${key}" in "${descriptor.keyword}" block "${node.name}" references unknown codec "${param.codecId}".`,
          sourceId,
          span: captured.span,
        });
        return;
      }
      let jsonValue: unknown;
      try {
        jsonValue = JSON.parse(captured.raw);
      } catch {
        diagnostics.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `Parameter "${key}" in "${descriptor.keyword}" block "${node.name}" is not a valid JSON literal (expected a JSON string, number, boolean, or null): ${captured.raw}`,
          sourceId,
          span: captured.span,
        });
        return;
      }
      try {
        codec.decodeJson(blindCast<JsonValue, 'JSON.parse returns a JsonValue-compatible value'>(jsonValue));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        diagnostics.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `Parameter "${key}" in "${descriptor.keyword}" block "${node.name}" was rejected by codec "${param.codecId}": ${reason}`,
          sourceId,
          span: captured.span,
        });
      }
      return;
    }
```

So it does `codecLookup.get(codecId)`, then `JSON.parse(raw)`, then `codec.decodeJson(json)`. It never calls `encodeJson`. Other codes and messages:

- `PSL_EXTENSION_UNKNOWN_PARAMETER`: `Unknown parameter "${key}" in "${descriptor.keyword}" block "${node.name}". The descriptor does not declare this parameter.` (116)
- `PSL_EXTENSION_MISSING_REQUIRED_PARAMETER`: `Required parameter "${key}" is missing from "${descriptor.keyword}" block "${node.name}".` (129)
- `PSL_EXTENSION_OPTION_OUT_OF_SET` (177)
- `PSL_EXTENSION_UNRESOLVED_REF` (304). `cross-space` refs pass unconditionally (278-286); refs are skipped when `refCtx` is absent (288-294).

If it were run on a policy today: `` sql`x` `` and `'x'` fail `JSON.parse` (invalid JSON). `true` and `42` pass, because `PgTextCodec.decodeJson` is `blindCast<string>(json)` (`packages/3-targets/3-targets/postgres/src/core/codecs.ts:368-372`) and `PgBoolCodec.decodeJson` is `blindCast<boolean>(json)` (codecs.ts:924-926). So `permissive = "yes"` would also pass.

### `validateExtensionBlockFromSymbol`

File: `packages/1-framework/2-authoring/psl-parser/src/extension-block.ts:36-53`. It builds a ref-resolution context from the symbol table (models only; `makeNamespace` makes model stubs with zero spans, 82-99), calls `validateExtensionBlock` with the source file name as `sourceId`, and maps each result through `diagnosticFromSpan`. Exported from `psl-parser/src/exports/index.ts:111` and described in `psl-parser/README.md:45-49`.

### Callers

Production (`packages/**/src`): none. The only references are the definition, the wrapper above, and the two exports. The SQL-family interpreter does not call it. Two comments in `packages/3-targets/3-targets/postgres/src/core/authoring.ts` say so:

- lines 269-273 (inside `lowerRlsPolicyFromBlock`): "The descriptor's param set already omits it, but the generic descriptor validator is not wired into the SQL-family interpreter, so the lowering enforces the per-operation predicate matrix directly".
- lines 588-593 (above `postgresAuthoringPslBlockDescriptors`): "The per-operation predicate matrix is enforced in `lowerRlsPolicyFromBlock` ... since the generic descriptor validator is not wired into the SQL-family interpreter."

Tests:

- `packages/1-framework/1-core/framework-components/test/psl-extension-block-validator.test.ts` (725 lines): calls `validateExtensionBlock` directly with a stub codec `stub/string@1` on `using` (line 114). Covers each diagnostic, including "value rejected by its codec" (346-424).
- `packages/1-framework/2-authoring/psl-parser/test/symbol-table.test.ts:719, 765`: calls `validateExtensionBlockFromSymbol` for same-namespace and same-space ref resolution.
- `packages/1-framework/2-authoring/psl-printer/test/declarative-policy-select.round-trip.test.ts:169, 357`: calls `validateExtensionBlockFromSymbol`; the test at 338-368 ("given a block without a codecLookup in the parse call") asserts codec validation rejects the value when the codec is not registered.

### What the SQL-family interpreter checks instead

The interpreter re-implements some of the validator's checks and skips the rest:

- `requiresModelAttribute`: `validateBlockModelAttributeRequirements` (`packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:379-411`), code `PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE`.
- Same-namespace `ref` with `refKind: 'model'`: resolved in `lowerExtensionBlocksForNamespace` (interpreter.ts:484-517), code `PSL_EXTENSION_MODEL_REF_UNRESOLVED`, which also covers a missing required model ref.
- Not checked anywhere in production: unknown parameters (a `foo = 1` line in a policy block is silently ignored), missing required parameters other than model refs, option sets, `value` parameters, and `cross-space` role refs (role names flow through unchecked).

This matters for any plan to wire the validator in: `using` and `withCheck` are declared `required: true` (authoring.ts:550), but `policy_update profile_touch_write` in `test/integration/test/authoring/parity/rls/schema.prisma:57-61` has only `using`, and the parity test "single-predicate update carries no withCheck on either surface" (`test/integration/test/authoring/parity/ts-psl-rls-parity.test.ts:288`) depends on that. The TypeScript builder requires at least one predicate, not both (`packages/3-extensions/postgres/src/contract/rls.ts:79-91, 145`).

## 4. Every `kind: 'value'` block parameter descriptor

Production descriptors (`packages/**/src`, `examples`, `test`):

| File:line | Parameter(s) | `codecId` | Consumed by |
|---|---|---|---|
| `packages/3-targets/3-targets/postgres/src/core/authoring.ts:547-552` (`policyPredicateParam`) | `using` on `policy_select` (601), `policy_delete` (616), `policy_update` (647), `policy_all` (664); `withCheck` on `policy_insert` (631), `policy_update` (648), `policy_all` (665) | `pg/text@1` | `lowerRlsPolicyFromBlock`: `readValueParam` then `unwrapQuotedString` (authoring.ts:262-289) |
| `packages/3-targets/3-targets/postgres/src/core/authoring.ts:553-558` (`policyPermissiveParam`) | `permissive` on all five policy keywords (602, 617, 632, 649, 666) | `pg/bool@1` | `lowerRlsPolicyFromBlock`: `readValueParam` then compares to `'true'`/`'false'` (authoring.ts:291-301) |

There are no other production `value` descriptors. Checked: every `kind: 'pslBlock'` in `src` is either in the Postgres target (seven descriptors, lines 594-706) or is the SQL-family / Mongo-family `enum` descriptor (`packages/2-sql/9-family/src/core/authoring-entity-types.ts:156-168`, `packages/2-mongo-family/9-family/src/core/authoring-entity-types.ts:155-167`). No extension pack under `packages/3-extensions` contributes `pslBlockDescriptors` (the Supabase `scripts/generate-contract.ts` only reads the Postgres target's descriptors to print). `native_enum` and `role` in Postgres declare `parameters: {}`.

Code that reads `PslExtensionBlockParamScalarValue.raw` without any descriptor (variadic or descriptor-free blocks). These are affected only if the shape of `raw` changes, not by retyping descriptors:

| File:line | What it reads |
|---|---|
| `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts:296-327` (`classifyEnumMemberType`) | `JSON.parse(raw)` of enum members, to infer the enum codec |
| `packages/2-sql/9-family/src/core/authoring-entity-types.ts:72-98` | SQL `enum` members: `JSON.parse(raw)` then `codec.decodeJson` |
| `packages/2-mongo-family/9-family/src/core/authoring-entity-types.ts:72-90` | Mongo `enum` members, same |
| `packages/3-targets/3-targets/postgres/src/core/authoring.ts:381-403` (`lowerNativeEnumFromBlock`) | `native_enum` members: `JSON.parse(raw)`, must be a string |
| `packages/2-sql/2-authoring/contract-prisma7/src/interpreter.ts:147-156` (`scalarValue`) | `datasource`/`generator` blocks: `JSON.parse(raw)`, string only |

Code that writes `kind: 'value'` nodes:

| File:line | What it writes |
|---|---|
| `packages/1-framework/2-authoring/psl-parser/src/block-reconstruction.ts:210, 233` | source text, as above |
| `packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-policy-blocks.ts:114, 119-121, 127` | `JSON.stringify(policy.using)`, `JSON.stringify(policy.withCheck)`, and `'false'` for `permissive` |
| `packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-enum-blocks.ts:80` | `JSON.stringify(value)` for `native_enum` members |
| `packages/2-sql/2-authoring/contract-prisma7/src/interpreter.ts:733` | `JSON.stringify(member.value)` for Prisma 7 enums |

Test-only `value` descriptors (all with made-up codec ids): `framework-components/test/psl-extension-block-validator.test.ts:114` (`stub/string@1`); `framework-components/test/psl-block-descriptor.types.test.ts:43, 78` (`'String'`); `psl-parser/test/symbol-table.test.ts:586` (`fixture/text@1`); `psl-printer/test/fixtures/declarative-policy-select-extension.ts:185` (`fixture-policy/text@1`); `psl-printer/test/generic-extension-block-printer.test.ts:670` (`'unused'`) plus value nodes built at 122; `language-server/test/completion-provider.test.ts:115, 117, 473-481` (`fixture/text@1`); `language-server/test/server.test.ts:144` (`fixture/text@1`).

## 5. The Postgres policy block

File: `packages/3-targets/3-targets/postgres/src/core/authoring.ts`.

### Diagnostic code constants, lines 73-93

```ts
const PSL_RLS_PREDICATE_NOT_FOR_OPERATION: ContributedPslDiagnosticCode =
  'PSL_RLS_PREDICATE_NOT_FOR_OPERATION';
const PSL_POLICY_INVALID_MAP: ContributedPslDiagnosticCode = 'PSL_POLICY_INVALID_MAP';
...
const PSL_EXTENSION_INVALID_VALUE: ContributedPslDiagnosticCode = 'PSL_EXTENSION_INVALID_VALUE';
```

### Block type and helpers, lines 135-206

```ts
export interface RlsPolicyExtensionBlock extends PslExtensionBlock {
  readonly namespaceId: string;
  readonly resolvedModelRefs?: ResolvedPslModelRefs;
}

const POLICY_KEYWORD_OPERATION: Readonly<Record<string, RlsPolicyOperation>> = {
  policy_select: 'select',
  policy_insert: 'insert',
  policy_update: 'update',
  policy_delete: 'delete',
  policy_all: 'all',
};

function readValueParam(block: PslExtensionBlock, key: string): string | undefined {
  const param = block.parameters[key];
  return param?.kind === 'value' ? param.raw : undefined;
}

function readListRefParams(block: PslExtensionBlock, key: string): string[] {
  const param = block.parameters[key];
  if (param?.kind !== 'list') return [];
  return param.items.flatMap((item) => (item.kind === 'ref' ? [item.identifier] : []));
}

/**
 * Unwraps a quoted PSL string argument, inverting the printer's
 * `escapePslString` escapes (`\\`, `\"`, `\n`, `\r`). An unknown escape
 * sequence is kept verbatim, matching the printer-side `unescapePslString`
 * convention.
 */
function unwrapQuotedString(raw: string): string {
  if (!(raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2)) {
    return raw;
  }
  // ...decodes \\ \" \n \r; keeps any other backslash pair verbatim
}
```

`unwrapQuotedString` returns its input unchanged unless it starts and ends with `"`. It does not use the parser's own decoder (`StringLiteralExprAst.value()`), and it handles only four escapes; `\t` stays as the two characters `\t`.

### `buildRlsPolicyEntity`, lines 208-248

Shared by the PSL lowering and the TypeScript entity-handle lowering (`postgresLowerEntityHandles`, authoring.ts:1065-1196, call at 1172). It hashes the normalized predicates and returns a frozen `PostgresRlsPolicy`:

```ts
function buildRlsPolicyEntity(input: {
  readonly prefix: string;
  readonly tableName: string;
  readonly namespaceId: string;
  readonly operation: RlsPolicyOperation;
  readonly roles: readonly string[];
  readonly using?: string;
  readonly withCheck?: string;
  /** Defaults to PERMISSIVE — the hash tuple slot already existed. */
  readonly permissive?: boolean;
}): PostgresRlsPolicy {
  const permissive = input.permissive ?? true;
  const wireHash = computeContentHash({
    ...ifDefined('using', input.using !== undefined ? normalizeSqlBody(input.using) : undefined),
    ...ifDefined('withCheck', input.withCheck !== undefined ? normalizeSqlBody(input.withCheck) : undefined),
    roles: input.roles,
    operation: input.operation,
    permissive,
  });
  return new PostgresRlsPolicy({ naming: { kind: 'wire', prefix: input.prefix, hash: wireHash }, tableName: input.tableName, namespaceId: input.namespaceId, operation: input.operation, roles: input.roles, using: input.using, withCheck: input.withCheck, permissive });
}
```

`normalizeSqlBody` (`packages/2-sql/1-core/schema-ir/src/naming.ts:125-127`) is `sql.replace(/\s+/g, ' ').trim()`. The TypeScript lowering never passes `permissive` (1172-1180), so TypeScript policies are always permissive. `PostgresRlsPolicy.using`/`withCheck` are `string | undefined` (`postgres-rls-policy.ts:18-22, 60-62`).

### `lowerRlsPolicyFromBlock`, lines 250-335

```ts
function lowerRlsPolicyFromBlock(
  block: RlsPolicyExtensionBlock,
  ctx: AuthoringEntityContext,
): PostgresRlsPolicy | undefined {
  const prefix = block.name;
  const operation = POLICY_KEYWORD_OPERATION[block.keyword] ?? 'select';
  const tableName = block.resolvedModelRefs?.['target']?.tableName;
  assertDefined(tableName, `...`);
  const roles = [...readListRefParams(block, 'roles')].sort();

  const usingRaw = readValueParam(block, 'using');
  const withCheckRaw = readValueParam(block, 'withCheck');

  const support = POLICY_OPERATION_PREDICATES[operation];
  const rejectPredicate = (predicate: 'using' | 'withCheck'): undefined => {
    ctx.diagnostics?.push({
      code: PSL_RLS_PREDICATE_NOT_FOR_OPERATION,
      message: `\`${block.keyword}\` policy "${block.name}" does not take a \`${predicate}\` predicate; the ${operation.toUpperCase()} operation uses ${support.using ? '`using`' : '`withCheck`'}${support.using && support.withCheck ? ' and `withCheck`' : ' only'}.`,
      sourceId: ctx.sourceId ?? 'unknown',
      span: block.parameters[predicate]?.span ?? block.span,
    });
    return undefined;
  };
  if (usingRaw !== undefined && !support.using) return rejectPredicate('using');
  if (withCheckRaw !== undefined && !support.withCheck) return rejectPredicate('withCheck');

  const using = usingRaw !== undefined ? unwrapQuotedString(usingRaw) : undefined;
  const withCheck = withCheckRaw !== undefined ? unwrapQuotedString(withCheckRaw) : undefined;

  const permissiveRaw = readValueParam(block, 'permissive');
  if (permissiveRaw !== undefined && permissiveRaw !== 'true' && permissiveRaw !== 'false') {
    ctx.diagnostics?.push({
      code: PSL_EXTENSION_INVALID_VALUE,
      message: `\`${block.keyword}\` policy "${block.name}" \`permissive\` must be \`true\` or \`false\`, got ${permissiveRaw}.`,
      sourceId: ctx.sourceId ?? 'unknown',
      span: block.parameters['permissive']?.span ?? block.span,
    });
    return undefined;
  }
  const permissive = permissiveRaw !== 'false';

  const mapAttr = block.attributes['map'];
  if (mapAttr !== undefined) {
    const exactName = mapAttr.args['name'];
    invariant(typeof exactName === 'string', '@@map on a policy block parses one string argument');
    ctx.warnings?.push(exactNameBodyWarning('policy', exactName));
    return new PostgresRlsPolicy({ naming: { kind: 'exact', name: exactName }, tableName, namespaceId: block.namespaceId, operation, roles, using, withCheck, permissive });
  }

  return buildRlsPolicyEntity({ prefix, tableName, namespaceId: block.namespaceId, operation, roles, ...ifDefined('using', using), ...ifDefined('withCheck', withCheck), permissive });
}
```

Notes on this code:

- The predicate-matrix check runs on the raw text before any reading of the value, so a wrong predicate is reported whatever it is written as.
- The lowering never checks that the operation's required predicate is present. A `policy_select` with no `using` lowers to a policy with no `using`.
- `permissive` is compared as source text, so `permissive = "false"` (a string) is refused with `PSL_EXTENSION_INVALID_VALUE`, and `permissive = false` is accepted. Retyping it to the data type `pg/bool` gives the same result through the cast rule: the plain boolean entry is keyed `pg/bool` (`packages/3-targets/3-targets/postgres/src/core/data-type-entries.ts:60-63`), and `pg/bool` declares no casts (`data-types.ts:60`), so a `pg/text` string is refused.
- `PSL_POLICY_INVALID_MAP` comes from the `@@map` block attribute spec, not from the lowering (authoring.ts:564-578):

```ts
const policyMapAttribute = blockAttribute('map', {
  documentation: 'Maps this row-level security policy to its PostgreSQL policy name.',
  positional: [{ key: 'name', type: str(), documentation: 'The nonempty PostgreSQL policy name.' }],
  refine: (parsed, ctx, attributeNode) =>
    parsed.name === ''
      ? [leafDiagnostic(ctx, attributeNode, '@@map policy name must be a non-empty string', PSL_POLICY_INVALID_MAP)]
      : [],
});
```

### Descriptors, lines 522-707

```ts
const policyTargetParam = {
  kind: 'ref',
  documentation: 'The model protected by this policy; it must declare @@rls.',
  refKind: 'model',
  scope: 'same-namespace',
  required: true,
} as const;
const policyRolesParam = {
  kind: 'list',
  documentation: 'The database roles to which this policy applies.',
  of: { kind: 'ref', refKind: 'role', scope: 'cross-space' },
} as const;
const policyPredicateParam = {
  kind: 'value',
  codecId: 'pg/text@1',
  required: true,
  documentation: 'A SQL predicate controlling which rows this policy permits.',
} as const;
const policyPermissiveParam = {
  kind: 'value',
  codecId: 'pg/bool@1',
  documentation:
    'Whether the policy is permissive (combined with OR) rather than restrictive (combined with AND).',
} as const;
const policyRequiresRls = { parameter: 'target', attribute: 'rls' } as const;
const policyBlockAttributes = { map: () => policyMapAttribute };
```

`postgresAuthoringPslBlockDescriptors` (587-707) declares `policy_select` (594), `policy_delete` (609), `policy_insert` (624), `policy_update` (639), `policy_all` (656), all with `discriminator: 'policy'`, `name: { required: true }`, `requiresModelAttribute: policyRequiresRls`, `attributes: policyBlockAttributes`. Parameter sets: select/delete take `target, roles, using, permissive`; insert takes `target, roles, withCheck, permissive`; update/all take `target, roles, using, withCheck, permissive`. `native_enum` (682) and `role` (698) have `parameters: {}`. The whole map is `as const satisfies AuthoringPslBlockDescriptorNamespace`, and a test (`test/block-documentation.test.ts`) requires every parameter to carry non-empty `documentation`. The descriptors are wired into the target in `src/core/descriptor-meta.ts:26`. The entity factory is registered in `postgresAuthoringEntityTypes.policy` (475-507).

### What happens today to each way of writing `using`

The path is: parse, `reconstructFromExpression` (default arm), no validation, `lowerRlsPolicyFromBlock`, `unwrapQuotedString`, `buildRlsPolicyEntity`, contract, then DDL `USING (${node.using})` (`packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts:2042`; `WITH CHECK` at 2045).

- `` using = sql`x` ``: parses as a `TaggedLiteral`. `raw` is `` sql`x` ``. No diagnostic anywhere. `unwrapQuotedString` returns it unchanged, so the contract stores `using: "sql`x`"` and the wire hash is computed over `` sql`x` ``. The migration renders `` USING (sql`x`) ``, which Postgres rejects as a syntax error when it is applied. The same happens for `pg.sql`, and for any tag, including an unknown one.
- `using = 'x'` (single quotes): parses as a `StringLiteralExpr`. `raw` is `'x'`. `unwrapQuotedString` only unwraps `"`, so the contract stores `'x'` with its quotes, and the migration renders `USING ('x')`, which is a SQL text literal, not the predicate the author meant.
- `using = true`: parses as a `BooleanLiteralExpr`. `raw` is `true`. The contract stores `true`, and `USING (true)` happens to be valid SQL. This works by accident.
- `using = "x"` (the only form in committed fixtures): `raw` is `"x"`, unwrapped to `x`.

## 6. How the SQL-family interpreter reaches the lowering

File: `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts`.

- Input: `InterpretPslDocumentToSqlContractInput` (125-154) carries `dataTypeLookup: DataTypeLookup` (135), `authoringContributions` (136; its `dataTypes` field holds the authoring entries), and `codecLookup` (149).
- Keyword check: registered block keywords come from `composedBlockKeywords` (606-618); unregistered keywords get `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` (2188-2196). Top-level non-enum blocks are collected into `topLevelExtensionBlocks` (2204-2215).
- Model-attribute requirement check: `validateBlockModelAttributeRequirements` is called at 2124-2129, before lowering.
- Data types: `const dataTypeSupport: DataTypeSupport = { entries: input.authoringContributions?.dataTypes ?? {}, lookup: input.dataTypeLookup }` at 2177-2180. `DataTypeSupport` is defined in `contract-psl/src/data-type-default.ts:46-49`.
- Lowering context, built at 2281-2294:

```ts
  const extensionEntityContext: AuthoringEntityContext = {
    family: input.target.familyId,
    target: input.target.targetId,
    ...ifDefined('enumInferenceCodecs', input.enumInferenceCodecs),
    ...ifDefined('codecLookup', input.codecLookup),
    sourceId: source.sources.sourceFileFor(source.node).filename,
    diagnostics: {
      push: (d) => {
        diagnostics.pushExternal(
          blindCast<ContractSourceDiagnostic, 'sink diagnostics are span-compatible'>(d),
        );
      },
    },
    warnings: authoringWarnings,
  };
```

  `dataTypeSupport` is in scope here but is not passed.
- Dispatch: `lowerExtensionBlocksForNamespace` (463-547) is called per named namespace (2350-2372) and once for the top level (2377-2399). For each block it looks up the entity descriptor by `block.kind` (`buildEntityTypesByDiscriminator`, 330-348), finds the block descriptor by keyword, resolves same-namespace `model` refs into `resolvedModelRefs`, annotates the block with `namespaceId`, and calls:

```ts
    const entity = instantiateAuthoringEntityType(
      descriptor.discriminator,
      descriptor,
      [annotatedBlock],
      { ...entityContext, sourceId: sources.sourceFileFor(blockSymbol.node.syntax).filename },
    );
```

  `instantiateAuthoringEntityType` (`framework-authoring.ts:1918-1948`) calls `descriptor.output.factory(args[0], ctx)`, which for policies is `lowerRlsPolicyFromBlock`. The factory receives the `PslExtensionBlock` (with `raw` strings), not the syntax nodes.
- Where the cast rule already runs: `@default` reads written values through `readDataTypeDefault` / `lowerDataTypeDefault` (`data-type-default.ts:264-475`). Its pieces are `entryForTag` (102-110), `knownTags` (113-117), `readValue` (152-208), `castInto` (211-245, the ADR 254 rule: same type, or `lookup.get(receiving).casts[valueType]`), and the refusal wording in `lowerDataTypeDefault`, for example `${where}: ${columnType} has no cast from ${valueType}; it casts from nothing` (code `PSL_DEFAULT_TYPE_INCOMPATIBLE`). Its `WrittenValue` input (38-43) is `tag | string | boolean | number | list`. These functions are exported from `contract-psl` but not from the framework, and `readDataTypeDefault` is shaped around a column codec (it needs `descriptorFor(codecId)` and validates through the column's codec).
- A tagged literal for `@default` is read by `lowerTaggedLiteral` (`psl-column-resolution.ts:719-756`), which looks up the entry by tag, reports canonicalization failures, and passes the canonical body on.
- The editor gets these lowering diagnostics too: the language server runs the same interpreter (`language-server/src/config-resolution.ts:98`, `project-artifacts.ts:86-110`).

## 7. Printing blocks and `contract infer`

### Generic printer

File: `packages/1-framework/2-authoring/psl-printer/src/serialize-print-document.ts`.

`serializeExtensionBlock` (122-172) prints `keyword name {`, then each descriptor parameter present in the block, in descriptor order, as `name = <rendered>`, then variadic parameters (`renderVariadicValue` prints `raw` verbatim, 187-200), then `blockAttributes` from their raw `args[].value`. `renderParamValue` (202-237):

```ts
    case 'value': {
      if (paramValue.kind !== 'value') {
        throw paramKindMismatchError(paramName, 'value', paramValue.kind);
      }
      return renderValueParam(paramValue.raw, descriptor.codecId, codecLookup, paramName);
    }
```

`renderValueParam` (251-285):

```ts
function renderValueParam(raw: string, codecId: string, codecLookup: CodecLookup | undefined, paramName: string): string {
  if (!codecLookup) {
    return raw;
  }
  const codec = codecLookup.get(codecId);
  if (!codec) {
    throw contractError('CONTRACT.PACK_CONTRIBUTION_INVALID', `Extension block parameter "${paramName}": no codec registered for id "${codecId}"`, { meta: { reason: 'codec-unregistered', paramName, codecId } });
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (e) {
    throw contractError('CONTRACT.PACK_CONTRIBUTION_INVALID', `Extension block parameter "${paramName}": codec "${codecId}" — raw literal is not valid JSON: ${String(e)}`, { meta: { reason: 'raw-literal-invalid-json', paramName, codecId }, cause: e });
  }
  return JSON.stringify(codec.encodeJson(codec.decodeJson(blindCast<...>(parsedJson))));
}
```

So the codec round trip is `JSON.parse`, `decodeJson`, `encodeJson`, `JSON.stringify`, and it only runs when a `codecLookup` is given. `codecLookup` enters through `printPslFromAst(ast, { pslBlockDescriptors, codecLookup })` (`psl-printer/src/print-psl.ts:10-41`, exported as `printPsl`). The two production callers pass no `codecLookup`:

- `packages/1-framework/3-tooling/cli/src/orm/contract/infer.ts:154-156`: `printPsl(pslContractAst, { pslBlockDescriptors: client.getPslBlockDescriptors() })`.
- `packages/3-extensions/supabase/scripts/generate-contract.ts:481`: `printPsl(merged, { pslBlockDescriptors })` (it prints role blocks only; the Supabase pack's `src/contract/contract.prisma` has no policy blocks).

The Postgres infer test helper also passes none (`packages/3-targets/3-targets/postgres/test/psl-infer/fixtures.ts:57-61`). Only the framework printer tests pass one (`generic-extension-block-printer.test.ts:279, 316`; `declarative-policy-select.round-trip.test.ts:362`). With a codec lookup, a `` sql`x` `` raw would throw `raw-literal-invalid-json`.

### `contract infer` policy blocks

File: `packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-policy-blocks.ts:98-144`. Each introspected policy becomes a `PslExtensionBlock` with:

```ts
        ...(policy.using !== undefined
          ? { using: { kind: 'value', raw: JSON.stringify(policy.using), span: SYNTHETIC_SPAN } }
          : {}),
        ...(policy.withCheck !== undefined
          ? { withCheck: { kind: 'value', raw: JSON.stringify(policy.withCheck), span: SYNTHETIC_SPAN } }
          : {}),
        ...(policy.permissive
          ? {}
          : { permissive: { kind: 'value', raw: 'false', span: SYNTHETIC_SPAN } }),
```

plus `blockAttributes: [{ name: 'map', args: [{ kind: 'positional', value: `"${escapePslString(policy.name)}"` }] }]` and the matching parsed `attributes.map`. Since the printer runs without a codec lookup, `raw` is printed as is, for example `using = "(owner_id = 1)"`.

Round trip today: `JSON.stringify` writes a double-quoted JSON string; `unwrapQuotedString` reads it back. They agree on `\\`, `\"`, `\n`, `\r`. They disagree on `\t`, `\b`, `\f` and `\u00XX` (JSON writes them; the unwrapper keeps them as two or six literal characters). Postgres's deparsed policy text is normally single-line with spaces, so this has not shown up.

### How a `sql` literal is printed today (for `@default`)

`packages/2-sql/9-family/src/core/psl-contract-infer/default-mapping.ts:71-78`, a private function:

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

The general form for a data type's value is `printedBody(entry, value)` (`entry.print`, 166-172) followed by `literalText(entry, body)` (193-200), which fences a tag body in backticks (escaping `\` and `` ` ``) or wraps a plain string in `"` with `escapePslString`. Both are private to that file. `escapePslString` lives in `packages/2-sql/4-lanes/relational-core/src/ast/data-type-support.ts:60-66` (a copy also exists at `psl-printer/src/serialize-print-document.ts:57-63`).

## 8. Language server

- Parameter-name completion: `provideGenericBlockKeyCompletionItems` (`packages/1-framework/3-tooling/language-server/src/completion-provider.ts:442-470`) offers each descriptor parameter not already present, with `detail: descriptor.parameters[parameterName]?.documentation || 'Generic block parameter'` (463).
- Block snippet: `genericBlockSnippet` (402-415) inserts each `required: true` parameter as `name = ${n:name}` (or `[${n:name}]` for a list). For `policy_update` and `policy_all` it inserts both `using` and `withCheck`.
- Value position: `completion-context.ts:781-789` classifies a cursor after `=` as `genericBlockValue`. `GenericBlockValueCompletionContext` (78-83) carries `offset`, `blockKeyword` and `replacementStartOffset`, but not the parameter name. `providePslCompletionItems` returns `[]` for it (completion-provider.ts:141-144, comment: "Parameter-value completion (option allowed-values / ref scopes) is future work.").
- The model to copy for value completion is the `@default` path: `scalarDefaultArms` (`contract-psl/src/sql-attribute-specs.ts:188-203`) builds one `taggedLiteral(tags, { documentation })` arm per documentation text from `dataTypeEntries`, and `completion-values.ts:135-145` turns a `taggedLiteral` arg type into completion items with the snippet `` tag`$1` ``.
- Hover: the language server has no hover provider at all.
- Semantic tokens: `collectGenericBlockMembers` (`semantic-tokens.ts:286-300`) marks each key as `property` and walks the value. A string gets `string`, a number `number`, a boolean `keyword`; a `TaggedLiteralExprAst` gets no token (452-454), leaving it to the TextMate grammar.
- Signature help covers attributes only (`signature-context.ts:70` finds block attributes).
- Diagnostics: the editor shows interpreter diagnostics, so lowering diagnostics for block values appear there.
- The formatter prints key-value entries by streaming their tokens (`psl-parser/src/format/emit.ts:231-233`), so a multi-line `sql` literal in a block keeps its text.

## 9. Tests and fixtures

### Framework

- `packages/1-framework/1-core/framework-components/test/psl-extension-block-validator.test.ts`: every validator diagnostic, including the codec path for `value` (unknown codec, bad JSON, `decodeJson` rejection).
- `packages/1-framework/1-core/framework-components/test/psl-block-descriptor.types.test.ts`: type tests for the `PslBlockParam` union and descriptor shape; line 43-46 asserts `param.codecId` narrows to `'String'`.
- `packages/1-framework/1-core/framework-components/test/framework-components.authoring.test.ts:~985-1000`: builds `value` nodes to test `classifyEnumMemberType`.
- `packages/1-framework/1-core/framework-components/test/psl-ast.test.ts`: namespace `entries` grouping of blocks, including keywords sharing a discriminator.
- `packages/1-framework/1-core/framework-components/test/rls-layer-invariant.test.ts`: fails if production code in `packages/1-framework` or `packages/2-sql` contains `RlsPolicy`, `policy_select`, `rls_policy`, `RLS` and similar. Any shared code for block value typing must avoid these names.
- `packages/1-framework/2-authoring/psl-parser/test/symbol-table.test.ts:570-700`: block reconstruction (ref/option/value classification, `raw: '"true"'` for `using = "true"` at 624, duplicate parameter, non-array list parameter) and ref validation through `validateExtensionBlockFromSymbol`.
- `packages/1-framework/2-authoring/psl-printer/test/generic-extension-block-printer.test.ts`: generic printer, including "value parameter serialized through the codec" (217-323), verbatim output without a codec lookup (384), invalid JSON (392-420), kind mismatch (422), variadic blocks (461-697).
- `packages/1-framework/2-authoring/psl-printer/test/declarative-policy-select.round-trip.test.ts` with `test/fixtures/declarative-policy-select-extension.ts`: a test-only `policy_select` extension (its own `readValueParam` and `unwrapQuotedString`, fixture lines 124-155) taken through parse, validate, lower, serialize, print and re-parse.
- `packages/1-framework/3-tooling/language-server/test/completion-context.test.ts:418-465`: key and value positions in generic blocks.
- `packages/1-framework/3-tooling/language-server/test/completion-provider.test.ts:~459-500` (required parameters in the block snippet), `1037` (no completions at a value position), `1043-1096` (parameter-name completions and documentation).
- `packages/1-framework/3-tooling/language-server/test/server.test.ts:1326`: parameter completions through the server with configured descriptors.

### SQL and Mongo families

- `packages/2-sql/9-family/test/block-documentation.test.ts`, `packages/2-mongo-family/9-family/test/block-documentation.test.ts`: every block and parameter is documented.
- `packages/2-sql/9-family/test/authoring-entity-types.enum.test.ts`, `packages/2-mongo-family/9-family/test/authoring-entity-types.enum.test.ts`: enum member `raw` handling.

### Postgres target

- `packages/3-targets/3-targets/postgres/test/psl-policy-authoring.test.ts`: `policy_select` parse and lower; asserts `policy.using` is the unquoted text (line ~161). Has its own copies of `readValueParam` and `unwrapQuotedString` (lines 57, 75).
- `packages/3-targets/3-targets/postgres/test/psl-policy-map-authoring.test.ts`: `@@map` exact names, `PSL_POLICY_INVALID_MAP` (309), and `permissive` (351-437: `permissive = false`, hash participation, default true, with `@@map`).
- `packages/3-targets/3-targets/postgres/test/psl-rls-operations.test.ts`: each keyword's operation, `withCheck` in the hash, and `PSL_RLS_PREDICATE_NOT_FOR_OPERATION` (255-322).
- `packages/3-targets/3-targets/postgres/test/psl-rls-authoring.test.ts`: `@@rls`, `PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE`, `PSL_EXTENSION_MODEL_REF_UNRESOLVED`, serializer round trip.
- `packages/3-targets/3-targets/postgres/test/psl-role-authoring.test.ts`: `role` blocks.
- `packages/3-targets/3-targets/postgres/test/block-documentation.test.ts`: every Postgres block parameter has documentation.
- `packages/3-targets/3-targets/postgres/test/psl-infer/infer-policy-emission.test.ts`: infer output, asserting `using = "(owner_id = 1)"` (97, 133), `withCheck = "(owner_id = 2)"` (134), `permissive = false` (117).
- `packages/3-targets/3-targets/postgres/test/psl-infer/print-psl/print-psl.top-level-blocks.test.ts`: printing top-level blocks (builds `value` nodes at 171).
- `packages/3-targets/3-targets/postgres/test/migrations/rls-planner.test.ts`: planner on policy entities.

### Postgres adapter (integration, inline PSL with `using = "..."`)

- `packages/3-targets/6-adapters/postgres/test/migrations/rls-walking-skeleton-psl.integration.test.ts`: PSL to plan, apply, filter, verify.
- `packages/3-targets/6-adapters/postgres/test/migrations/rls-migration-plan.integration.test.ts`: planned `CREATE POLICY`, including `FOR UPDATE` with both clauses.
- `packages/3-targets/6-adapters/postgres/test/migrations/rls-lifecycle-e2e.integration.test.ts`: edit replaces, removal fails verify, `WITH CHECK` enforcement.

### Supabase and repo-level

- `packages/3-extensions/supabase/test/skeleton.integration.test.ts`, `rls-role-binding.integration.test.ts`, `native-enum-session.integration.test.ts`, `service-role-refresh-tokens.integration.test.ts`, `explicit-namespace-query.integration.test.ts`: load the `example-app` or `renamed-policy` fixtures.
- `test/integration/test/authoring/parity/ts-psl-rls-parity.test.ts`: TypeScript and PSL emit identical policy entities; inline PSL at 160-192 uses `using = "\\"userId\\"..."`.
- `test/integration/test/cli-journeys/infer-roundtrip-fidelity.e2e.test.ts`: infer then emit; asserts `using = "(id = 1)"` (440), `withCheck = "(id = 2)"` (459), `permissive = false` (460).
- `test/integration/test/cli-journeys/sign-the-database.e2e.test.ts`: asserts inferred `permissive = false` (143).
- `test/integration/test/cli-journeys/rls-exact-name-adoption.e2e.test.ts`: uses the `contract-rls-*` fixtures.

### `.prisma` files containing policy blocks

All use double-quoted predicates; none uses `permissive`.

- `test/integration/test/authoring/parity/rls/schema.prisma` (eight policies, including the `policy_update` with only `using` at 57-61)
- `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/contract-rls-wire.prisma`
- `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/contract-rls-adopted.prisma`
- `examples/supabase/src/contract.prisma`
- `packages/3-extensions/supabase/test/fixtures/example-app/contract.prisma`
- `packages/3-extensions/supabase/test/fixtures/renamed-policy/contract.prisma`

`packages/3-extensions/supabase/src/contract/contract.prisma` has `role` blocks but no policy blocks.

### Docs with the old form

- ADR 126 (`docs/architecture docs/adrs/ADR 126 - PSL top-level block SPI.md`): line 19 (`using = "auth.uid() = author_id"  // value → a codec-typed literal`), 37 (`codecId: 'String'`), 57 (the `value` row of the kinds table), 61 ("`value` rides the codec JSON medium"), 71 (the validator "checks ... a `value` the codec's `decodeJson` rejects").
- ADR 234: lines 40-41, 137. ADR 236: line 26.
- `skills/prisma-8/references/supabase.md`: lines 72, 79, 87-88.
