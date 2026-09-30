# Research: block specs on the #30381 base

Scope: the facts needed to make the Postgres policy block declare `using` and `withCheck` with `dataTypeValue(SQL_EXPRESSION_DATA_TYPE_ID, dataTypes)`, where `dataTypes` is the stack's `DataTypeSupport` (`{ entries, lookup }`). That requires the block spec factory to receive the stack's data types.

Base: commit `47d727b70d` (head of PR #30381, "Generic block values bind the shared typed expression grammar"). Its merge base with `main` is `fc35fcaddc`. Paths are repo-relative. Line numbers are from `47d727b70d`.

## Key findings

1. A block spec factory receives `BlockSpecContext = { symbols, block }` and nothing else. No stack data reaches a block spec factory or a block attribute factory today.
2. Five places build a `BlockSpecContext` in production code: `symbol-table.ts:230`, `block-spec/derive.ts:30`, `block-spec/interpret.ts:198` (block attribute factories), language server `completion-provider.ts:453`, and language server `attribute-spec-resolution.ts:61`. One test builds it by hand: `postgres/test/block-documentation.test.ts:6-16`.
3. `buildSymbolTable` takes `{ documents, sources, pslBlockDescriptors }`. It has five production callers. The SQL provider, the Mongo provider and the Prisma 7 interpreter have both the data type entries and a `DataTypeLookup` in scope. The two language server callers have the entries (optionally) but no `DataTypeLookup`.
4. `deriveParsedBlocks(symbolTable, sources, pslBlockDescriptors)` runs the same spec pipeline for direct interpreter callers. The SQL interpreter calls it (`interpreter.ts:2117`) with entries and lookup in scope. The Mongo interpreter calls it (`interpreter.ts:1142`) with entries in scope but no lookup.
5. The bug that motivated design section 9 is already fixed by #30381. `using` is `optional(str())`, and `str()` accepts only a string literal. `` using = sql`x` `` now fails in `buildSymbolTable` with `PSL_INVALID_ATTRIBUTE_SYNTAX` "Expected a string literal", anchored on the expression, and the block gets no envelope.
6. The predicate matrix is now grammar. Each `policy_*` keyword binds a fixed spec that declares only its operation's predicate keys, so a wrong predicate is `PSL_EXTENSION_UNKNOWN_PARAMETER`. The code `PSL_RLS_PREDICATE_NOT_FOR_OPERATION` no longer exists anywhere.
7. `permissive` is `optional(bool())`. `permissive = "false"` is already refused by `bool()`. Design section 9.5's change to `permissive` is obsolete.
8. The lowering reads decoded values straight from the envelope: `const using = block.values.using;` (`authoring.ts:319`). With `dataTypeValue`, `block.values.using` would be a `ParsedDataTypeValue`, not a string.
9. `contract infer` builds the print shape with `using: { expression: JSON.stringify(policy.using), span: SYNTHETIC_SPAN }` (`infer-policy-blocks.ts:106`, and `:109` for `withCheck`). The printer writes `expression` verbatim. The printer no longer has a `codecLookup` option.
10. The language server completes block keys from the bound spec, returns nothing at a block value position, and gives a tagged literal no semantic tokens.
11. #30381 did not change `ControlDefaultRegistries`, `modelSpecContext`, or the `index`/`check` spec factories. It added an optional `parsedBlocks` to `AttributeSpecContext`, `fieldSpecContext` and `lowerDefaultForField`.
12. Design section 6 says `dataTypeValue`'s `parse` throws `InternalError` when the lookup does not register the receiving type. Every `buildSymbolTable` run with the Postgres descriptors parses policy values. That includes the language server's per-document pipeline run and many tests that assemble contributions without `dataTypes`.

## 1. The block spec layer

### Package entries

| Name | Defined in | Exported from |
| --- | --- | --- |
| `BlockSpecContext`, `BlockSpec`, `FixedBlockSpec`, `EntriesBlockSpec`, `BlockEntryValueSpec`, `BlockSpecFactory`, `InferBlock` | `packages/1-framework/2-authoring/psl-parser/src/block-spec/types.ts` | `@internal/psl-parser` (types, `src/exports/index.ts:109-117`) |
| `fixedBlock`, `entriesBlock` | `psl-parser/src/block-spec/binders.ts` | `@internal/psl-parser` (`index.ts:97`) |
| `PslBlockSpecDescriptor` (type), `blockSpecFactoryOf` | `psl-parser/src/block-spec/descriptor.ts` | `@internal/psl-parser` (`index.ts:99-100`) |
| `interpretExtensionBlock`, `interpretExtensionBlockAttributes` and their input types | `psl-parser/src/block-spec/interpret.ts` | `@internal/psl-parser` (`index.ts:101-108`) |
| `deriveParsedBlocks` | `psl-parser/src/block-spec/derive.ts` | `@internal/psl-parser` (`index.ts:98`) |
| `jsonValue` | `psl-parser/src/attribute-spec/combinators/json-value.ts` | `@internal/psl-parser` (`index.ts:46`); type `JsonValueArgType` at `index.ts:82` |
| `BlockAttributeSpecFactory` | `psl-parser/src/attribute-spec/spec-context.ts` | `@internal/psl-parser` (`index.ts:63`) |
| `ParsedPslExtensionBlock`, `PslExtensionBlock`, `PslExtensionBlockSourceEntry`, `PslExtensionBlockParsedAttribute` | `packages/1-framework/1-core/framework-components/src/shared/psl-extension-block.ts` | `@internal/framework-components/authoring` (`src/exports/authoring.ts:63-68`), `@internal/framework-components/psl-ast` (`src/exports/psl-ast.ts` is `export * from '../control/psl-ast'`, which re-exports them at `control/psl-ast.ts:2-13`), and re-exported as types by `@internal/psl-parser` (`index.ts:1-29`) |
| `AuthoringPslBlockDescriptor`, `AuthoringPslBlockDescriptorNamespace` | `framework-components/src/shared/framework-authoring.ts:423-449` | `@internal/framework-components/authoring` |

`@internal/psl-parser` has one relevant entry, `"."` (`package.json` exports: `.`, `./format`, `./interpret`, `./syntax`, `./tokenizer`). The psl-parser source imports from `@internal/framework-components/authoring`, `/control` and `/psl-ast`, but not yet from `/codec`, which is where `DataTypeLookup` and `createDataTypeLookup` are exported (`framework-components/src/exports/codec.ts:38,43`).

### `types.ts` (whole file, 57 lines)

```ts
// block-spec/types.ts:10-13
export interface BlockSpecContext {
  readonly symbols: SymbolTable;
  readonly block: BlockSymbol;
}

// :16-19
export interface BlockEntryValueSpec {
  readonly type: ArgType<unknown, AttributeCtx>;
  readonly documentation: string;
}

// :26-30
export interface FixedBlockSpec<Out = unknown> {
  readonly mode: 'fixed';
  readonly parameters: Readonly<Record<string, Param<unknown, AttributeCtx>>>;
  readonly _out?: Out;
}

// :38-43
export interface EntriesBlockSpec<Out = unknown> {
  readonly mode: 'entries';
  readonly value: BlockEntryValueSpec;
  readonly allowBare: boolean;
  readonly _out?: Out;
}

// :45-57
export type BlockSpec<Out = unknown> = FixedBlockSpec<Out> | EntriesBlockSpec<Out>;
export type InferBlock<S> = S extends BlockSpec<infer Out> ? Out : never;
export type BlockSpecFactory = (
  ctx: BlockSpecContext,
) => BlockSpec<Readonly<Record<string, unknown>>>;
```

The doc comment on `BlockSpecContext` (`:4-9`) says it is "handed to block spec factories and block attribute spec factories", and that `block` "serves attribute interpretation and metadata inspection, not reference resolution".

Rules in a block spec are `ArgType<unknown, AttributeCtx>` or `Param<unknown, AttributeCtx>`. `AttributeCtx` is `{ sources: PslSources; symbols: SymbolTable }` (`attribute-spec/types.ts:19-22`). A `dataTypeValue` rule typed `DataTypeValueArgType<AttributeCtx>` fits. `optional(type)` spreads the rule (`optional.ts:3-11`: `{ ...type, optional: true, hasDefault: false }`), so `optional(dataTypeValue(...))` keeps `kind`, `tags` and `documentation`.

### Binders (`binders.ts`)

```ts
// :10-14
export function fixedBlock<const P extends Record<string, Param<unknown, AttributeCtx>>>(config: {
  readonly parameters: P;
}): FixedBlockSpec<NamedOut<P>> {
  return { mode: 'fixed', parameters: config.parameters };
}

// :22-34 (three overloads)
export function entriesBlock<R extends ArgType<unknown, AttributeCtx>>(config: {
  readonly value: { readonly type: R; readonly documentation: string };
}): EntriesBlockSpec<Record<string, OutOf<R>>>;
export function entriesBlock<R extends ArgType<unknown, AttributeCtx>>(config: {
  readonly value: { readonly type: R; readonly documentation: string };
  readonly allowBare: true;
}): EntriesBlockSpec<Record<string, OutOf<R> | undefined>>;
// implementation returns { mode: 'entries', value: config.value, allowBare: config.allowBare ?? false }
```

### Descriptor restoration (`descriptor.ts`)

```ts
// :13-16
export interface PslBlockSpecDescriptor extends AuthoringPslBlockDescriptor {
  readonly spec: BlockSpecFactory;
  readonly attributes?: Readonly<Record<string, BlockAttributeSpecFactory>>;
}

// :23-28
export function blockSpecFactoryOf(descriptor: AuthoringPslBlockDescriptor): BlockSpecFactory {
  return blindCast<BlockSpecFactory, '...single point that restores the factory type...'>(descriptor.spec);
}
```

The core descriptor (`framework-authoring.ts:423-445`):

```ts
export interface AuthoringPslBlockDescriptor {
  readonly kind: 'pslBlock';
  readonly documentation?: string;
  readonly keyword: string;
  readonly discriminator: string;
  readonly name: { readonly required: boolean };
  readonly spec: unknown;
  readonly requiresModelAttribute?: {
    readonly parameter: string;
    readonly attribute: string;
  };
  readonly attributes?: Readonly<Record<string, unknown>>;
}
```

Registration checks that `spec` is a function and every `attributes` value is a function (`framework-authoring.ts:836-842`).

### Interpretation (`interpret.ts`)

```ts
// :19-25
export interface InterpretExtensionBlockInput<S> {
  readonly block: BlockSymbol;
  readonly descriptor: AuthoringPslBlockDescriptor;
  readonly spec: S;
  readonly symbols: SymbolTable;
  readonly sources: PslSources;
}

// :37-39
export function interpretExtensionBlock<S extends BlockSpec<unknown>>(
  input: InterpretExtensionBlockInput<S>,
): Result<ParsedPslExtensionBlock<InferBlock<S>>, readonly PslDiagnostic[]>
```

It takes an already-built spec. It builds the rule context itself at `:41` (`const ctx: AttributeCtx = { sources, symbols };`) and calls `rule.parse(value, ctx)` at `:102`. It then calls `interpretExtensionBlockAttributes({ block, descriptor, symbols, sources })` (`:126-131`), which builds the attribute factory context itself at `:198`: `factory({ symbols, block })`. So the attribute factory context is not passed in by the caller.

```ts
// :151-156
export interface InterpretExtensionBlockAttributesInput {
  readonly block: BlockSymbol;
  readonly descriptor: AuthoringPslBlockDescriptor;
  readonly symbols: SymbolTable;
  readonly sources: PslSources;
}
```

A successful envelope is built at `:137-148`: `kind: descriptor.discriminator`, `keyword: block.keyword`, `name: block.name`, `values`, `parameterSpans`, `attributes`, `span: block.span`.

### `jsonValue()` (`json-value.ts:23-29`)

```ts
export function jsonValue(): JsonValueArgType<AttributeCtx> {
  return {
    kind: 'jsonValue',
    label: 'JSON value',
    parse: (arg, ctx): Result<JsonValue, readonly PslDiagnostic[]> => readJsonValue(arg, ctx),
  };
}
```

It reads string, number, boolean, the `null` identifier, arrays and object literals from the AST. It refuses other identifiers, calls and tagged literals with `leafDiagnostic` (code `PSL_INVALID_ATTRIBUTE_SYNTAX`). #30381 added `'jsonValue'` to `ArgTypeKind` and `JsonValueArgType` to `InspectableArgType` (`attribute-spec/types.ts`).

### The typed envelope and the print shape (`psl-extension-block.ts`)

```ts
// :217-225
export interface ParsedPslExtensionBlock<Values = Readonly<Record<string, unknown>>> {
  readonly kind: string;
  readonly keyword: string;
  readonly name: string;
  readonly values: Values;
  readonly parameterSpans: Readonly<Record<string, PslSpan>>;
  readonly attributes: Readonly<Record<string, PslExtensionBlockParsedAttribute>>;
  readonly span: PslSpan;
}

// :167-170
export interface PslExtensionBlockParsedAttribute {
  readonly args: Readonly<Record<string, unknown>>;
  readonly span: PslSpan;
}

// :140-143 — producer-only
export interface PslExtensionBlockSourceEntry {
  readonly expression?: string;
  readonly span: PslSpan;
}

// :193-206 — producer-only print shape
export interface PslExtensionBlock {
  readonly kind: string;
  readonly keyword: string;
  readonly name: string;
  readonly parameters: Record<string, PslExtensionBlockSourceEntry>;
  readonly blockAttributes: readonly PslExtensionBlockAttribute[];
  readonly span: PslSpan;
}
```

The doc comment at `:130-139` says the entry text "is born from a producer's own values (e.g. database inference), never from parsed source" and "No validator, classifier, or lowering may read it".

`PslDiagnosticCode` (`:24-116`) still holds `PSL_EXTENSION_UNKNOWN_PARAMETER`, `PSL_EXTENSION_MISSING_REQUIRED_PARAMETER`, `PSL_EXTENSION_INVALID_VALUE`, `PSL_EXTENSION_DUPLICATE_PARAMETER`, `PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE`, `PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE`, `PSL_INVALID_EXTENSION_BLOCK_MEMBER`, `PSL_UNKNOWN_DEFAULT_LITERAL_TAG`, `PSL_TAGGED_LITERAL_NUL`, `PSL_TAGGED_LITERAL_TOO_LARGE`. `PSL_VALUE_TYPE_INCOMPATIBLE` and `PSL_INVALID_LITERAL` (design section 6) are not in it yet.

### Deleted by #30381

`packages/1-framework/1-core/framework-components/src/control/psl-extension-block-validator.ts` (with `validateExtensionBlock`), `packages/1-framework/2-authoring/psl-parser/src/block-reconstruction.ts`, the `PslBlockParam*` and `PslExtensionBlockParam*` types, `BlockSymbol.block`, and in Postgres `readValueParam`, `unwrapQuotedString` and the `PSL_RLS_PREDICATE_NOT_FOR_OPERATION` check. `psl-parser/src/extension-block.ts` now holds only `findBlockDescriptor` (`:7-22`).

## 2. `buildSymbolTable`

### Signature (`psl-parser/src/symbol-table.ts`)

```ts
// :119-123
export interface BuildSymbolTableOptions {
  readonly documents: readonly DocumentAst[];
  readonly sources: PslSources;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
}

// :125-136
export interface SymbolTableResult {
  readonly symbolTable: SymbolTable;
  readonly diagnostics: readonly ParseDiagnostic[];
  readonly parsedBlocks: ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock>;
}

// :142
export function buildSymbolTable(options: BuildSymbolTableOptions): SymbolTableResult
```

### Where specs are bound and interpreted

After collecting every declaration (`:143-219`), it walks the collected blocks (`:222-243`):

```ts
for (const block of collectedBlocks) {
  const descriptor = findBlockDescriptor(pslBlockDescriptors, block.keyword);
  if (descriptor === undefined) continue;
  const spec = blockSpecFactoryOf(descriptor)({ symbols: symbolTable, block });
  const parsed = interpretExtensionBlock({ block, descriptor, spec, symbols: symbolTable, sources });
  if (parsed.ok) {
    parsedBlocks.set(block, parsed.value);
  } else {
    diagnostics.push(...parsed.failure);
  }
}
```

`deriveParsedBlocks` (`derive.ts:19-42`) does the same walk over `topLevel` and every namespace's `blocks`, binds at `:30` with `{ symbols: symbolTable, block }`, and keeps only successes:

```ts
export function deriveParsedBlocks(
  symbolTable: SymbolTable,
  sources: PslSources,
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace,
): ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock>
```

### Where block diagnostics go

Failures are psl-parser `PslDiagnostic` values (`{ filename, code, message, range, data? }`, `diagnostic.ts:7-13`; `ParseDiagnostic` is an alias, `parse.ts:12`). They are pushed into `SymbolTableResult.diagnostics`. Providers map them into `ContractSourceDiagnostic` seeds with `mapPslDiagnostics` (SQL `provider.ts:177-183`).

| Code | Raised at | Span |
| --- | --- | --- |
| `PSL_EXTENSION_DUPLICATE_PARAMETER` | `interpret.ts:51-61` | the later entry |
| `PSL_EXTENSION_UNKNOWN_PARAMETER` | `interpret.ts:71-81` | the entry. Message: `Unknown parameter "${key}" in "${block.keyword}" block "${block.name}". The block does not declare this parameter.` |
| `PSL_INVALID_EXTENSION_BLOCK_MEMBER` | `interpret.ts:91-99` | the entry (a bare key where the spec does not allow one) |
| rule failures | `interpret.ts:102-104` | whatever the rule returns; `leafDiagnostic` (`combinators/diagnostic.ts:9-20`) anchors on the expression and defaults to `PSL_INVALID_ATTRIBUTE_SYNTAX` |
| `PSL_EXTENSION_MISSING_REQUIRED_PARAMETER` | `interpret.ts:114-122` | the block |
| `PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE` | `interpret.ts:177-184` | the attribute |
| `PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE` (duplicate) | `interpret.ts:185-192` | the attribute |
| attribute argument failures | `interpretAttribute` via `interpret.ts:198-206` | per argument |

A block with any diagnostic gets no envelope. Family interpreters only skip blocks without envelopes; they do not re-report.

### Production callers and the stack data each has

| Caller | Call | Stack data in scope |
| --- | --- | --- |
| Language server, per document | `packages/1-framework/3-tooling/language-server/src/pipeline.ts:60`, in `runPipeline(filename, text, inputs: PipelineInputs)` | `PipelineInputs` (`pipeline.ts:26-31`): `scalarTypes`, `pslBlockDescriptors`, `authoringContributions?: AssembledAuthoringContributions` (which has `dataTypes`), `controlMutationDefaults?`. No `DataTypeLookup`. |
| Language server, project | `language-server/src/project-artifacts.ts:188`, in `readSymbolTableResult()` | `controlStack: PipelineInputs` (same shape) and `interpretation?: ProjectInterpretation`, whose `context: ContractSourceContext` has `dataTypeLookup` only when the config has a PSL interpreter (`config-resolution.ts:82-102`). |
| SQL provider | `packages/2-sql/2-authoring/contract-psl/src/provider.ts:169`, in `load(context)` | `context: ContractSourceContext` (`packages/1-framework/1-core/config/src/contract-source-types.ts:40-57`): `authoringContributions.dataTypes` and `dataTypeLookup`. |
| Mongo provider | `packages/2-mongo-family/2-authoring/contract-psl/src/provider.ts:111`, in `load(context)` | the same `ContractSourceContext`. |
| Prisma 7 interpreter | `packages/2-sql/2-authoring/contract-prisma7/src/interpreter.ts:226` | Passes `pslBlockDescriptors: {}`, so no spec is ever bound. Has `input.authoringContributions` (`AssembledAuthoringContributions`, so `.dataTypes`) and `input.dataTypeLookup` (`InterpretPrisma7DocumentsInput`, `:78-87`). It builds `dataTypeSupport: { entries: input.authoringContributions?.dataTypes ?? {}, lookup: input.dataTypeLookup }` at `:1138-1141`. |

The five callers listed before #30381 are confirmed.

Where the language server inputs come from:

- `pipelineInputsFromStack(stack: ControlStack)` (`config-resolution.ts:71-80`) copies `scalarTypes`, `pslBlockDescriptors`, `authoringContributions` and `controlMutationDefaults`. The `ControlStack` it reads has `dataTypeLookup` (`framework-components/src/control/control-stack.ts:88`), but the function does not copy it.
- A project without PSL inputs uses `emptyPipelineInputs = { scalarTypes: [], pslBlockDescriptors: {} }` (`config-resolution.ts:24-27`), so no block is interpreted.
- `runPipeline` is called from `computeDocumentDiagnostics` (`document-diagnostics.ts:30`), which `project-artifacts.ts:153` calls per document. `readDocument` keeps only `computed.parseDiagnostics` (`:165`). The server publishes symbol diagnostics from the project-level table (`server.ts:156-162`), not from the per-document run. The per-document run still binds and parses every block.

Other direct binders of a block spec:

- `deriveParsedBlocks` callers: SQL `contract-psl/src/interpreter.ts:2115-2117` (`input.authoringContributions?.dataTypes` and `input.dataTypeLookup` in scope; the local `dataTypeSupport` is built later, at `:2171-2174`), and Mongo `contract-psl/src/interpreter.ts:1140-1146` (`input.authoringContributions?.dataTypes` and `input.controlMutationDefaults.dataTypeEntries` in scope; `InterpretPslDocumentToMongoContractInput` at `:99-116` has no lookup).
- Language server key completion: `completion-provider.ts:453`.

Test scale: `buildSymbolTable(` is called 101 times in 71 test files (`git grep` over `packages/**/test/**` and `test/**`). `deriveParsedBlocks(` is called once in tests (`psl-parser/test/symbol-table.parsed-blocks.test.ts:401`), and `blockSpecFactoryOf(` once (`postgres/test/block-documentation.test.ts:23`). `scripts/lint-framework-vocabulary.test.mjs:39-45` holds `buildSymbolTable` source strings as lint fixtures.

## 3. The Postgres blocks

All in `packages/3-targets/3-targets/postgres/src/core/authoring.ts`.

### Policy parameter rules (`:151-171`)

```ts
const policyTargetParam = {
  type: entityRef({ kind: 'model' }),
  documentation: 'The model protected by this policy; it must declare @@rls.',
};
const policyRolesParam = {
  type: optional(list(oneOf(entityRef({ kind: 'block', keyword: 'role' }), identifier()))),
  documentation: 'The database roles to which this policy applies.',
};
const policyUsingParam = {
  type: optional(str()),
  documentation: 'A SQL predicate controlling which rows this policy permits.',
};
const policyWithCheckParam = {
  type: optional(str()),
  documentation: 'A SQL predicate checking rows being written by this policy.',
};
const policyPermissiveParam = {
  type: optional(bool()),
  documentation:
    'Whether the policy is permissive (combined with OR) rather than restrictive (combined with AND).',
};
```

These are module-level constants built once, not per stack.

### Policy specs (`:173-205`) and the factory input (`:212-224`)

```ts
export function policyUsingOnlySpec() {         // target, roles, using, permissive
  return fixedBlock({ parameters: { target: policyTargetParam, roles: policyRolesParam, using: policyUsingParam, permissive: policyPermissiveParam } });
}
export function policyWithCheckOnlySpec() {     // target, roles, withCheck, permissive
  ...
}
export function policyBothPredicatesSpec() {    // target, roles, using, withCheck, permissive
  ...
}

type PolicyBlockValues = InferBlock<ReturnType<typeof policyBothPredicatesSpec>>;

export interface RlsPolicyExtensionBlock extends ParsedPslExtensionBlock<PolicyBlockValues> {
  readonly namespaceId: string;
  readonly resolvedModelRefs?: ResolvedPslModelRefs;
}
```

The three spec functions take no argument; the descriptors pass them as `spec: policyUsingOnlySpec` and so on, and the context argument is ignored. `psl-block-specs.test-d.ts:17-19` uses `InferBlock<ReturnType<typeof policyUsingOnlySpec>>`, which keeps working if the functions take a context.

### Descriptors (`:551-637`)

| Keyword | Spec | Other fields |
| --- | --- | --- |
| `policy_select` (`:557-566`) | `policyUsingOnlySpec` | `discriminator: 'policy'`, `requiresModelAttribute: policyRequiresRls`, `attributes: policyBlockAttributes` |
| `policy_delete` (`:567-576`) | `policyUsingOnlySpec` | same |
| `policy_insert` (`:577-586`) | `policyWithCheckOnlySpec` | same |
| `policy_update` (`:587-597`) | `policyBothPredicatesSpec` | same |
| `policy_all` (`:598-607`) | `policyBothPredicatesSpec` | same |
| `native_enum` (`:613-621`) | `nativeEnumSpec` | `discriminator: 'native_enum'`, `attributes: { map: () => nativeEnumMapAttribute }` |
| `role` (`:628-636`) | `roleSpec` | `discriminator: 'role'` |

Each is declared `satisfies PslBlockSpecDescriptor`, and the whole map `as const satisfies AuthoringPslBlockDescriptorNamespace`. `policyRequiresRls = { parameter: 'target', attribute: 'rls' } as const` (`:526`).

### The lowering (`lowerRlsPolicyFromBlock`, `:298-355`)

```ts
const prefix = block.name;
const operation = POLICY_KEYWORD_OPERATION[block.keyword] ?? 'select';
const target = block.resolvedModelRefs?.['target'];
assertDefined(target, ...);
const roles =
  block.values.roles === undefined
    ? []
    : block.values.roles
        .map((role) => (typeof role === 'string' ? role : role.declaration.name))
        .sort();
const using = block.values.using;
const withCheck = block.values.withCheck;
const permissive = block.values.permissive ?? true;
```

With `@@map` (`:328-343`) it builds `new PostgresRlsPolicy({ naming: { kind: 'exact', name: exactName }, tableName: target.tableName, namespaceId: target.namespaceId, operation, roles, using, withCheck, permissive })` and pushes `exactNameBodyWarning('policy', exactName)` to `ctx.warnings`. Otherwise it calls `buildRlsPolicyEntity({ prefix, tableName, namespaceId, operation, roles, ...ifDefined('using', using), ...ifDefined('withCheck', withCheck), permissive })` (`:345-354`). `buildRlsPolicyEntity` (`:263-296`) takes `using?: string` and `withCheck?: string`, hashes `normalizeSqlBody(...)` of each with `computeContentHash`, and is shared with the TypeScript handle lowering `postgresLowerEntityHandles` (`:995`).

The factory output is `policyEntityTypeOutput` (`:364-371`): `{ factory: lowerRlsPolicyFromBlock, pslPlacement: (entity) => ({ namespaceId: entity.namespaceId }) }`, checked against `AuthoringEntityTypeFactoryOutput<RlsPolicyExtensionBlock, PostgresRlsPolicy | undefined> & SqlPslEntityPlacementOutput`.

### The predicate matrix

There is no check in the lowering any more. The comment at `:552-556` says each keyword's fixed spec "declares exactly its operation's keys, so a predicate the operation does not take is rejected as an unknown key at interpretation". A wrong predicate gets `PSL_EXTENSION_UNKNOWN_PARAMETER` from `buildSymbolTable` (tested in `psl-rls-operations.test.ts:261-331`). `POLICY_OPERATION_PREDICATES` (`src/core/rls/canonicalize.ts:13-21`) is now used only by the TypeScript path (`packages/3-extensions/postgres/src/contract/rls.ts:124`). An omitted supported predicate is accepted (`psl-rls-operations.test.ts:372-399`).

### `@@map`

```ts
// :528-544
const policyMapAttribute = blockAttribute('map', {
  documentation: 'Maps this row-level security policy to its PostgreSQL policy name.',
  positional: [{ key: 'name', type: str(), documentation: 'The nonempty PostgreSQL policy name.' }],
  refine: (parsed, ctx, attributeNode) =>
    parsed.name === ''
      ? [leafDiagnostic(ctx, attributeNode, '@@map policy name must be a non-empty string', PSL_POLICY_INVALID_MAP)]
      : [],
});
const policyBlockAttributes = { map: () => policyMapAttribute };
```

The lowering reads it as `block.attributes['map'].args['name']` with `invariant(typeof exactName === 'string', ...)`.

### Diagnostics a policy block can produce now

| Code | Where | When |
| --- | --- | --- |
| `PSL_INVALID_ATTRIBUTE_SYNTAX` | `str()` (`combinators/str.ts:18-25`), `bool()`, `entityRef()` rules in `buildSymbolTable` | `using`/`withCheck` not a string literal ("Expected a string literal", which includes `` sql`...` ``); `permissive` not a boolean ("Expected a boolean literal"); unknown target ("Unknown model ..."); wrong reference kind |
| `PSL_EXTENSION_UNKNOWN_PARAMETER` | `interpret.ts:71` | any undeclared key, including a predicate the operation does not take |
| `PSL_EXTENSION_MISSING_REQUIRED_PARAMETER` | `interpret.ts:114` | `target` missing (the only required key) |
| `PSL_EXTENSION_DUPLICATE_PARAMETER`, `PSL_INVALID_EXTENSION_BLOCK_MEMBER` | `interpret.ts` | duplicate or bare key |
| `PSL_POLICY_INVALID_MAP` | `@@map` refine | `@@map("")` |
| `PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE`, `PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE` | `interpret.ts:177-192` | undeclared or duplicate `@@` attribute |
| `PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE` | SQL `interpreter.ts:406-431` | target model lacks `@@rls`; anchored on `parameterSpans['target']` |
| `PSL_DUPLICATE_EXTENSION_ENTITY` | SQL `interpreter.ts:2334-2341` | two blocks converge on one destination key |
| warning `exactNameBodyWarning` | lowering `:332` | every `@@map` policy |

### Native enum and role blocks

```ts
// :226-234
export function roleSpec() {
  return fixedBlock({ parameters: {} });
}
export function nativeEnumSpec() {
  return entriesBlock({
    value: { type: str(), documentation: 'The member value stored in the database enum type.' },
  });
}
```

`lowerNativeEnumFromBlock` (`:382-432`) takes `ParsedPslExtensionBlock<NativeEnumValues>` (`Record<string, string>`), reads `@@map` from `block.attributes['map'].args['name']`, and reports `PSL_NATIVE_ENUM_DUPLICATE_MEMBER_VALUE` (span `block.parameterSpans[memberName]`) and `PSL_NATIVE_ENUM_MISSING_MEMBERS`. `lowerRoleFromBlock` (`:462-476`) reports `PSL_ROLE_BLOCK_OUTSIDE_UNBOUND_NAMESPACE` when `block.namespaceId !== UNBOUND_NAMESPACE_ID`.

### Family `enum` blocks

Both families use `entriesBlock` with `jsonValue()` and `allowBare: true`:

- SQL: `sqlFamilyEnumSpec` at `packages/2-sql/9-family/src/core/authoring-entity-types.ts:13-21`; descriptor at `:151-162` with `attributes: { type: () => enumTypeBlockAttribute }` (`:140-149`, one positional `codecId: str()`). The factory (`:29-132`) calls `resolveEnumCodecId(block, ctx)` (`framework-authoring.ts:329-353`, reads `block.attributes['type'].args['codecId']`) and decodes each member with the codec.
- Mongo: `mongoFamilyEnumSpec` at `packages/2-mongo-family/9-family/src/core/authoring-entity-types.ts:13-21`; descriptor at `:151-162`.

No block spec other than the policy predicates needs data types.

## 4. Block attributes

- A descriptor carries `attributes?: Readonly<Record<string, unknown>>` (core, erased). The parser view narrows it to `Readonly<Record<string, BlockAttributeSpecFactory>>` (`descriptor.ts:15`).
- `BlockAttributeSpecFactory = (ctx: BlockSpecContext) => AttributeSpec<never, AttributeCtx>` (`spec-context.ts:42-44`). Before #30381 it took no argument.
- Specs are built with `blockAttribute(name, { documentation, positional?, named?, refine? })` (`attribute-spec/block-attribute.ts:19-34`); `refine` receives `(parsed, ctx: AttributeCtx, attributeNode)`.
- Interpretation: `interpretExtensionBlockAttributes` (`block-spec/interpret.ts:164-210`) restores each factory with `blindCast`, calls `factory({ symbols, block })` (`:198`), and runs `interpretAttribute(attribute, spec, { sources, symbols })`. A success lands in `envelope.attributes[name] = { args, span }`. Any attribute failure fails the whole block.
- Language server: the `'block'` branch of `attributeSpecResolver` (`attribute-spec-resolution.ts:50-63`) finds the `BlockSymbol` with `blockSymbolForNode` (`completion-symbols.ts:32-47`), returns nothing when there is none, and calls `factory({ symbols: source.symbolTable, block })` (`:61`). Completion of block attribute names and keys, and signature help (`signature-context.ts:70-75`), go through this resolver.
- Registered block attributes: policy `map` (Postgres `:528-544`), `native_enum` `map` (`:546-549`), SQL and Mongo family enum `type`. None needs data types.

Because the attribute factory context and the value spec context are the same type, a new required field on `BlockSpecContext` must also be supplied at `interpret.ts:198` and `attribute-spec-resolution.ts:61`.

## 5. `contract infer` policy printing

### The print shape (`packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-policy-blocks.ts:98-127`)

```ts
blocks.push({
  kind: 'policy',
  keyword: POLICY_OPERATION_KEYWORD[policy.operation],
  name: head,
  parameters: {
    target: { expression: modelName, span: SYNTHETIC_SPAN },
    roles: { expression: `[${policy.roles.join(', ')}]`, span: SYNTHETIC_SPAN },
    ...(policy.using !== undefined
      ? { using: { expression: JSON.stringify(policy.using), span: SYNTHETIC_SPAN } }
      : {}),
    ...(policy.withCheck !== undefined
      ? { withCheck: { expression: JSON.stringify(policy.withCheck), span: SYNTHETIC_SPAN } }
      : {}),
    ...(policy.permissive ? {} : { permissive: { expression: 'false', span: SYNTHETIC_SPAN } }),
  },
  blockAttributes: [
    { name: 'map', args: [{ kind: 'positional', value: `"${escapePslString(policy.name)}"`, span: SYNTHETIC_SPAN }], span: SYNTHETIC_SPAN },
  ],
  span: SYNTHETIC_SPAN,
});
```

The `sql` literal text goes in the `expression` of `using` (`:106`) and `withCheck` (`:109`). The file imports only `escapePslString` from `@internal/sql-relational-core/ast`; it has no tag printer. The only existing `sql` literal printer is the private `sqlLiteralText` in `packages/2-sql/9-family/src/core/psl-contract-infer/default-mapping.ts:75-78` (backtick form, or `sql"..."` with `escapePslString` when the body holds a backtick; not multi-line aware).

### The printer (`packages/1-framework/2-authoring/psl-printer/src/serialize-print-document.ts`)

`serializeExtensionBlock` (`:118-158`) checks the keyword is registered and the descriptor's `discriminator` equals `kind`, then writes:

```ts
const lines: string[] = [`${extensionBlock.keyword} ${extensionBlock.name} {`];
for (const [entryKey, entry] of Object.entries(extensionBlock.parameters)) {
  lines.push(
    entry.expression === undefined
      ? `${PSL_INDENT_UNIT}${entryKey}`
      : `${PSL_INDENT_UNIT}${entryKey} = ${entry.expression}`,
  );
}
```

A multi-line `expression` is written as is: its continuation lines get no block indent. `wrapNamespaceBlock` (`:160-171`) then prefixes every non-empty line with two spaces when the policies sit in a named namespace. (Design section 11.1 cites this as `serialize-print-document.ts:289-298`; it is now `:160-171`.)

`printPslFromAst(ast, options)` (`print-psl.ts:26-31`) takes only `pslBlockDescriptors`. The `codecLookup` option that design section 9.6 wanted to delete is already gone.

Policies go into the named namespace bucket with models and native enums (`infer-psl-contract.ts:411-423`). That bucket is wrapped in `namespace <name> { … }` only when `namespaceName` is a real schema name; otherwise it prints flat (`:372-399`).

Tests that pin the printed text: `infer-policy-emission.test.ts:97,133,134` (`'using = "(owner_id = 1)"'` and similar) and `test/integration/test/cli-journeys/infer-roundtrip-fidelity.e2e.test.ts:440` (`'using = "(id = 1)"'`). `psl-policy-placement.test.ts:370-398` round-trips a predicate holding a newline and quotes (`"name = \\"O'Hara\\"\\nnext"`) and expects `using: 'name = "O\'Hara"\nnext'`.

## 6. Language server

| Feature | Where | What it does now |
| --- | --- | --- |
| Block key completion | `completion-provider.ts:438-476` (`provideGenericBlockKeyCompletionItems`) | Finds the descriptor, finds the `BlockSymbol` with `blockSymbolForNode` (returns `[]` if none), binds `blockSpecFactoryOf(descriptor)({ symbols: source.symbolTable, block })` at `:453`, returns `[]` for an entries spec, and otherwise offers each undeclared key with `detail: parameter.documentation`. It never calls a rule's `parse` (test `completion-provider.test.ts:1150`). |
| Block keyword snippet | `completion-provider.ts:408-411` | `${keyword} ${1:Name} {\n  ${0:// Block keys and attributes}\n}`; no key lines, because no symbol exists yet. |
| Block value position | `completion-provider.ts:143-144` | `case 'genericBlockValue': return [];` The context (`completion-context.ts:77-82`) carries only `offset`, `blockKeyword`, `replacementStartOffset`, not the block node. |
| Block attribute names, keys, signature help | `attribute-spec-resolution.ts:50-63` | See section 4. |
| Semantic tokens for block members | `semantic-tokens.ts:286-299` | Key gets `property`; the value goes through `collectExpression`. The `TaggedLiteralExprAst` branch is empty (`:452-454`). `SemanticTokenSource` (`:88-93`) has no `parsedBlocks`; `server.ts:458` passes one in an object literal, which the function ignores. |

Stack data the language server has for specs:

- `PslCompletionCandidateSource extends AttributeSpecSource` (`completion-provider.ts:34-36`). `AttributeSpecSource` (`attribute-spec-resolution.ts:24-30`) is `{ pslBlockDescriptors, symbolTable, parsedBlocks?, authoringContributions?, controlMutationDefaults? }`. No lookup.
- `server.ts:488-501` (completion) and `:529-539` (signature help) fill it from `project.controlStack` (a `PipelineInputs`) and `project.artifacts.symbolTable()` / `.parsedBlocks()`. `authoringContributions` and `controlMutationDefaults` are added only when defined (`exactOptionalPropertyTypes`).
- The model and field attribute branches build `controlMutationDefaults: { ...source.controlMutationDefaults, dataTypeEntries: source.authoringContributions.dataTypes ?? {} }` (`attribute-spec-resolution.ts:71-78`, `:91-98`), and return nothing when `authoringContributions` or `controlMutationDefaults` is absent (`:65-69`, `:83-87`).
- `completion-values.ts:147-167` switches over every `ArgTypeKind`; `'jsonValue'` was added at `:163`. A new `'dataTypeValue'` kind must be handled there.

## 7. `contract-psl/src/interpreter.ts`

- Input: `InterpretPslDocumentToSqlContractInput` (`:133-167`) has `parsedBlocks?` (`:142`), `dataTypeLookup: DataTypeLookup` (`:149`), `authoringContributions?: AuthoringContributions` (`dataTypes` optional there), `controlMutationDefaults?`, `codecLookup?`.
- Envelopes: `const parsedBlocks = input.parsedBlocks ?? deriveParsedBlocks(input.symbolTable, input.sources, composedPslBlockDescriptors);` (`:2114-2117`). `dataTypeSupport` is built after that, at `:2171-2174`: `{ entries: input.authoringContributions?.dataTypes ?? {}, lookup: input.dataTypeLookup }`.
- `validateBlockModelAttributeRequirements` (`:406-431`) runs next over every envelope.
- Family enums: `processEnumDeclarations` (`:556-600`) instantiates the `enum` factory with each envelope.
- Extension blocks: `lowerExtensionBlocksForNamespace` (`:485-545`) is still the function; it now takes envelopes:

```ts
function lowerExtensionBlocksForNamespace(
  blocks: Readonly<Record<string, BlockSymbol>>,
  ownerNamespaceId: string,
  entityTypesByDiscriminator: ReadonlyMap<string, AuthoringEntityTypeDescriptor>,
  entityContext: AuthoringEntityContext,
  parsedBlocks: ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock>,
  modelCoordinateOf: (model: ModelSymbol) => { readonly namespaceId: string; readonly tableName: string } | undefined,
  sources: PslSources,
): readonly LoweredPackEntity[]
```

  For each block with an envelope and a registered entity type, it projects every checked model reference value to `resolvedModelRefs[param] = { namespaceId, tableName }`, builds `annotatedBlock = { ...envelope, namespaceId: ownerNamespaceId, ...resolvedModelRefs }`, calls `instantiateAuthoringEntityType(descriptor.discriminator, descriptor, [annotatedBlock], { ...entityContext, sourceId })`, and files the row at `descriptor.output.pslPlacement(entity).namespaceId` when the output has the hook. Callers: `:2355` (named namespaces) and `:2377` (top level).
- Entity factory context: `extensionEntityContext: AuthoringEntityContext` (`:2276-2290`) holds `family`, `target`, `enumInferenceCodecs?`, `codecLookup?`, `sourceId`, `diagnostics`, `warnings`. `AuthoringEntityContext` (`framework-authoring.ts:266-284`) has no data type field.
- `parsedBlocks` also reaches model building (`BuildModelNodeInput.parsedBlocks`, `:668`; passed at `:2508`) and from there `collectResolvedFields` (`:742`).
- Model attribute spec sites: `sqlAttributeSpecs.model.index()` at `:1051`, `.check()` at `:1111`, contributed model attribute factory at `:1154-1161` with `{ symbols, model, controlMutationDefaults: { defaultFunctionRegistry: input.defaultFunctionRegistry, dataTypeEntries: input.dataTypeSupport.entries } }` (no `parsedBlocks`, no lookup).

## 8. The attribute spec layer on the new base

| Item | Changed by #30381? | Current definition |
| --- | --- | --- |
| `AttributeSpecContext` (`psl-parser/src/attribute-spec/spec-context.ts:7-18`) | Yes: gained optional `parsedBlocks` | `{ symbols: SymbolTable; model: ModelSymbol; controlMutationDefaults: ControlDefaultRegistries; parsedBlocks?: ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock> }` |
| `FieldAttributeSpecContext` (`:20-22`) | No | `AttributeSpecContext & { field: FieldSymbol }` |
| `BlockAttributeSpecFactory` (`:42-44`) | Yes: now takes `BlockSpecContext` | see section 4 |
| `ControlDefaultRegistries` (`framework-components/src/shared/mutation-default-types.ts:101-104`) | No | `extends Pick<ControlMutationDefaults, 'defaultFunctionRegistry'> { readonly dataTypeEntries: Readonly<Record<string, AuthoringDataTypeEntry>> }` — no lookup |
| `sqlAttributeSpecs` (`contract-psl/src/sql-attribute-specs.ts:707-726`) | No for `index`/`check` | `index: () => indexModelSpec`, `check: () => checkModelSpec`; `indexModelSpec` (`:389-463`) has `expression` and `where` as `optional(str())`; `checkModelSpec` (`:483-530`) has `expression: str()` and refines `value.expression.trim().length === 0` |
| `enumMemberNames` (`sql-attribute-specs.ts:263-273`) | Yes | reads `ctx.parsedBlocks?.get(block)` and returns `Object.keys(envelope.values)` |
| `modelSpecContext` (`:679-689`) | No | `{ symbols, model, controlMutationDefaults }` |
| `fieldSpecContext` (`:691-705`) | Yes: optional `parsedBlocks` | |
| `lowerDefaultForField` (`contract-psl/src/psl-column-resolution.ts:762`) | Yes: optional `parsedBlocks`, passed into `fieldSpecContext` | still builds `controlMutationDefaults: { defaultFunctionRegistry, dataTypeEntries: input.dataTypeSupport.entries }` |
| `lowerEnumDefaultForField` (`psl-field-resolution.ts:56`) | Yes: required `parsedBlocks` | same `controlMutationDefaults` shape |
| `postgresFullTextIndexSpec` (`postgres/src/core/authoring.ts:647-712`) | No | `where: optional(str())`; factory `() => postgresFullTextIndexSpec` (`:714`) |
| `DataTypeSupport` | No | still in `contract-psl/src/data-type-default.ts:46-49`: `{ entries: Readonly<Record<string, AuthoringDataTypeEntry>>; lookup: DataTypeLookup }` |

So design sections 7 and 8 still apply as written, except for line numbers (the contributed model attribute context is now at `interpreter.ts:1154-1161`).

## 9. Tests and fixtures

### Block spec layer (fixture descriptors with `str()`; not affected by a Postgres spec change)

- `packages/1-framework/2-authoring/psl-parser/test/block-spec.test.ts` — `interpretExtensionBlock` for fixed and entries specs: spans, unknown/duplicate/missing/bare keys, references, prototype-named keys, block attribute context (`:639-667` asserts the attribute factory saw `block` and `symbols`).
- `psl-parser/test/block-spec.test-d.ts` — `InferBlock` output types, context requirements, `PslBlockSpecDescriptor` narrowing (`:136-155` types `(ctx: BlockSpecContext) => …`).
- `psl-parser/test/symbol-table.parsed-blocks.test.ts` — `buildSymbolTable` envelope lifecycle, forward and scoped references, one report per failure, `deriveParsedBlocks` equality (`:380-406`).
- `psl-parser/test/attribute-spec-combinators.json-value.test.ts` — `jsonValue()`.
- `packages/1-framework/1-core/framework-components/test/psl-block-descriptor.types.test.ts` — core descriptor shape with erased `spec`.
- `packages/1-framework/2-authoring/psl-printer/test/declarative-policy-select.round-trip.test.ts` and `test/fixtures/declarative-policy-select-extension.ts` — a test-only policy extension through parse, spec, lower, serialize, print, re-parse.
- `psl-printer/test/generic-extension-block-printer.test.ts` — rendering of the print shape.

### Postgres blocks (use the real Postgres descriptors)

- `packages/3-targets/3-targets/postgres/test/psl-policy-authoring.test.ts` — `policy_select` parse, envelope, lower, contract, serializer round trip. Assembles contributions without `dataTypes` (`:36-44`).
- `postgres/test/psl-policy-map-authoring.test.ts` — `@@map` exact names, `PSL_POLICY_INVALID_MAP`, `permissive`, exact-name warnings.
- `postgres/test/psl-policy-placement.test.ts` — placement at the target coordinate; inference round trips through the typed pipeline (`:292-398`).
- `postgres/test/psl-rls-authoring.test.ts` — `@@rls`, the `@@rls` requirement, typed policy values (`:497-614`). Uses `createDataTypeLookup(postgresDataTypes)` for the interpreter but assembled contributions have no `dataTypes` (`:35-45`).
- `postgres/test/psl-rls-operations.test.ts` — each operation, `withCheck` in the hash, wrong predicate as unknown key (`:261-331`), `@@rls` for every keyword, omitted predicates.
- `postgres/test/psl-block-specs.test-d.ts` — pins `BothValues['using']` and `['withCheck']` to `string | undefined` (`:24-25`) and the native enum and role outputs.
- `postgres/test/block-documentation.test.ts` — builds `{ symbols, block }` by hand (`:6-16`) and binds every Postgres spec to check documentation.
- `postgres/test/psl-role-authoring.test.ts`, `psl-native-enum-authoring.test.ts`, `psl-native-enum-family-coexistence.test.ts` — role and native enum blocks.
- `postgres/test/psl-infer/infer-policy-emission.test.ts` — printed policy blocks, including `using = "..."` text.
- `postgres/test/psl-infer/print-psl/print-psl.top-level-blocks.test.ts`, `print-psl.round-trip.test.ts`, `infer-parse-emit.test.ts` — printing and round trips that call `buildSymbolTable`.
- `packages/2-sql/2-authoring/contract-psl/test/interpreter.block-attribute-requirements.test.ts` — `requiresModelAttribute`.
- `contract-psl/test/interpreter.extension-placement.test.ts` — reference projection and the placement hook.
- `packages/2-sql/9-family/test/authoring-entity-types.enum.test.ts`, `authoring-entity-types.enum-block-attribute.test.ts` — family enum.
- `packages/1-framework/1-core/framework-components/test/rls-layer-invariant.test.ts` — framework and SQL family source may not contain `RlsPolicy`, `policy_select`, `rls_policy` and similar.
- Integration: `test/integration/test/authoring/parity/ts-psl-rls-parity.test.ts`, `packages/3-targets/6-adapters/postgres/test/migrations/rls-walking-skeleton-psl.integration.test.ts`, `rls-migration-plan.integration.test.ts`, `rls-lifecycle-e2e.integration.test.ts`, `test/integration/test/cli-journeys/infer-roundtrip-fidelity.e2e.test.ts`, `sign-the-database.e2e.test.ts`.

### Language server

- `packages/1-framework/3-tooling/language-server/test/completion-provider.test.ts:1075-1195` — value position returns nothing; key completion from fixed specs; no keys for entries specs; key completion inside an invalid block; spec bound with the block symbol and rules never parsed (asserts two factory calls, one from the symbol table and one from completion).
- `language-server/test/pipeline.test.ts:122-220` — block validation in `runPipeline` with a fixture `guard` spec.
- `language-server/test/server.test.ts:1339-1350` — block key completion through the server.
- `language-server/test/signature-help.test.ts:398` — metadata inspection never parses.
- `language-server/test/completion-context.test.ts` — `genericBlockKey` / `genericBlockValue` classification.

### Scale

Quoted `using`/`withCheck` values in test sources and fixtures (`git grep -c -E '(using|withCheck) *= *"'`): `psl-rls-operations.test.ts` 24, `psl-policy-map-authoring.test.ts` 20, `ts-psl-rls-parity.test.ts` 10, `parity/rls/schema.prisma` 10, `psl-rls-authoring.test.ts` 10, `symbol-table.parsed-blocks.test.ts` 9 (fixture spec), `block-spec.test.ts` 9 (fixture spec), `psl-policy-placement.test.ts` 6, `declarative-policy-select.round-trip.test.ts` 5 (fixture spec), `rls-lifecycle-e2e.integration.test.ts` 4, both Supabase fixtures 4 each, `rls-migration-plan.integration.test.ts` 3, `infer-policy-emission.test.ts` 3, `generic-extension-block-printer.test.ts` 3 (print shape), `infer-roundtrip-fidelity.e2e.test.ts` 2, `psl-policy-authoring.test.ts` 2, the two CLI journey fixtures 1 each, `rls-walking-skeleton-psl.integration.test.ts` 1, `pipeline.test.ts` 1 (fixture spec), `declarative-policy-select-extension.ts` 1, `symbol-table.test.ts` 1.

### `.prisma` files with a policy block

- `examples/supabase/src/contract.prisma` (lines 14-33: `policy_select` ×2, `policy_update`)
- `packages/3-extensions/supabase/test/fixtures/example-app/contract.prisma` (14-33)
- `packages/3-extensions/supabase/test/fixtures/renamed-policy/contract.prisma` (16-32)
- `test/integration/test/authoring/parity/rls/schema.prisma` (19-66: every operation)
- `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/contract-rls-adopted.prisma` (12-15)
- `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/contract-rls-wire.prisma` (12-15)

The Supabase pack's own `packages/3-extensions/supabase/src/contract/contract.prisma` has `native_enum` and `role` blocks but no policy.

## 10. Pending upgrade fragment

`upgrade-instructions/pending/typed-block-value-specs/extension/instructions.md` (extension audience only) has two change ids:

- `psl-block-descriptor-declares-a-spec-factory` — detection `variadicParameters`, `PslBlockParam`.
- `block-factories-consume-typed-envelopes` — detection `PslExtensionBlockParam`.

Its step 6 quotes `buildSymbolTable({ documents, sources, pslBlockDescriptors })`, and its translation table maps `{ kind: 'value', codecId: 'String' }` to `str()`.

## Other text that states the current shape

- ADR 255 (`docs/architecture docs/adrs/ADR 255 - Block specs bind top-level block values.md`): the "At a glance" example uses `using: { type: optional(str()) }` (`:28`); the Decision fixes `BlockSpecContext = { symbols: SymbolTable; block: BlockSymbol }` (`:85`); "Collect first" quotes `buildSymbolTable({ documents, sources, pslBlockDescriptors })` (`:100`) and `deriveParsedBlocks(symbolTable, sources, pslBlockDescriptors)` (`:114`); a consequence says editor metadata binds specs "with the same `{ symbols, block }` context" (`:169`); the rejected alternative "Injected reference resolvers in the spec context" (`:184`) argues against adding resolvers to the context.
- `packages/1-framework/2-authoring/psl-parser/README.md:42` describes `buildSymbolTable({ documents, sources, pslBlockDescriptors })`.
- ADR 126 still has `using  = "auth.uid() = author_id"  // value → a codec-typed literal` (`:19`).
- Design sections that no longer match the code: all of section 9 (it targets `PslBlockParamValue`, `block-reconstruction.ts`, `psl-extension-block-validator.ts`, `readValueParam`, `unwrapQuotedString`, `typedValues`, and the printer's `codecLookup`, all removed); section 11.1's line reference (now `serialize-print-document.ts:160-171`); section 11.2's `raw:` in `infer-policy-blocks.ts` (now `expression:`); section 7's "inline object at about line 1146" (now `:1154-1161`).
