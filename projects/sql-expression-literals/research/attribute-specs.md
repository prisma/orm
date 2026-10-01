# Research: the PSL attribute specification system

Scope: facts needed to add a building block (combinator) that declares "this argument receives a value of data type X", checked by the ADR 254 cast rule, and to use it for `@@index(where:)`, `@@index(expression:)`, `@@check(expression:)` (SQL family) and `@@fullTextIndex(where:)` (Postgres target).

All paths are relative to the worktree root. Line numbers are from the working tree on branch `tml-3282-sql-expression-literals` at commit `6a5b58ecb7`.

Short names used below:

- `PP` = `packages/1-framework/2-authoring/psl-parser/src`
- `CP` = `packages/2-sql/2-authoring/contract-psl/src`
- `LS` = `packages/1-framework/3-tooling/language-server/src`
- `FC` = `packages/1-framework/1-core/framework-components/src`

---

## 1. The combinator kit

### 1.1 Files

`PP/attribute-spec/`:

| File | Lines | Contents |
| --- | --- | --- |
| `types.ts` | 326 | Every type: contexts, `ArgTypeKind`, one interface per combinator kind, `InspectableArgType`, `OptionalArgType`, `Param`, `PositionalParam`, `AttributeSpec`, output inference (`OutOf`, `NamedOut`, `PosOut`, `AttributeOut`, `InferAttr`). |
| `interpret.ts` | 206 | The binder: `interpretArgs`, `interpretAttribute`, `ArgBindingSpec`. |
| `optional.ts` | 11 | `optional(type, default?)`. |
| `spec-context.ts` | 28 | Construction-time contexts and factory types. |
| `assemble.ts` | 54 | `assembleAttributeSpecs` (ADR 249 assembly point). |
| `field-attribute.ts`, `model-attribute.ts`, `block-attribute.ts` | 40, 40, 34 | `fieldAttribute`, `modelAttribute`, `blockAttribute` spec constructors. |
| `combinators/diagnostic.ts` | 20 | `ATTRIBUTE_DIAGNOSTIC_CODE`, `leafDiagnostic`. |
| `combinators/str.ts` | 41 | `str()`, `str(value)`. |
| `combinators/num.ts` | 41 | `num()`, `num(value)`. |
| `combinators/num-literal.ts` | 19 | `numLiteral()`. |
| `combinators/int.ts` | 38 | `int({ min, max })`. |
| `combinators/bool.ts` | 20 | `bool()`. |
| `combinators/identifier.ts` | 33 | `identifier()`, `identifier(name, { documentation })`. |
| `combinators/json.ts` | 41 | `json()`. |
| `combinators/list.ts` | 54 | `list(of, opts)`, `ListOptions`. |
| `combinators/record.ts` | 47 | `record(of)`. |
| `combinators/one-of.ts` | 43 | `oneOf(...alts)`. |
| `combinators/entity-ref.ts` | 53 | `entityRef(selector)`. |
| `combinators/field-ref.ts` | 51 | `fieldRef()`, `referencedFieldRef()`. |
| `combinators/func-call.ts` | 57 | `funcCall(name, sig)`. |
| `combinators/tagged-literal.ts` | 33 | `taggedLiteral(tags, { documentation })`. |

There is no constructor for the `rejecting` kind. The only `rejecting` value is built by hand in `CP/sql-attribute-specs.ts:250-257` (`noEnumMember`).

All combinators and types are exported from `PP/exports/index.ts:38-97`.

### 1.2 Parse-time contexts and `ArgTypeKind`

`PP/attribute-spec/types.ts:16-49`:

```ts
export type AttributeLevel = 'field' | 'model' | 'block';

export interface AttributeCtx {
  readonly sources: PslSources;
  readonly symbols: SymbolTable;
}

export interface ModelAttributeCtx extends AttributeCtx {
  readonly selfModel: ModelSymbol;
}

export interface FieldAttributeCtx extends ModelAttributeCtx {
  readonly field: FieldSymbol;
  resolveReferencedModel(): ModelSymbol | undefined;
}

export type ArgTypeKind =
  | 'bool'
  | 'entityRef'
  | 'fieldRef'
  | 'funcCall'
  | 'identifier'
  | 'int'
  | 'json'
  | 'list'
  | 'num'
  | 'oneOf'
  | 'record'
  | 'referencedFieldRef'
  | 'rejecting'
  | 'str'
  | 'taggedLiteral';

export type ArgTypeContext = 'attribute' | 'field' | 'model';
```

The parse-time contexts carry no data-type information: no authoring entries and no `DataTypeLookup`.

### 1.3 The base combinator shape

`PP/attribute-spec/types.ts:51-55` and `223-225`:

```ts
export interface ArgTypeOutput<T, Ctx extends AttributeCtx> {
  readonly label: string;
  readonly _out?: T;
  readonly parse: (arg: ExpressionAst, ctx: Ctx) => Result<T, readonly PslDiagnostic[]>;
}

export interface ArgType<T, Ctx extends AttributeCtx> extends ArgTypeOutput<T, Ctx> {
  readonly kind: ArgTypeKind;
}
```

Each kind has its own interface that adds metadata the language server reads (`types.ts:57-221`). The union the language server inspects is `InspectableArgType` (`types.ts:248-266`):

```ts
export type InspectableArgType<Ctx extends AttributeCtx> =
  | BoolArgType<Ctx>
  | EntityRefArgType<EntityDeclaration, Ctx>
  | FieldRefArgType<ModelAttributeCtx & Ctx>
  | FuncCallArgType<string, Ctx>
  | IdentifierArgType<string, Ctx>
  | IntArgType<Ctx>
  | JsonArgType<Ctx>
  | ListArgType<unknown, Ctx>
  | FixedNumArgType<number, Ctx>
  | UnrestrictedNumArgType<Ctx>
  | NumLiteralArgType<Ctx>
  | OneOfArgType<readonly [AnyArgType, ...AnyArgType[]], Ctx>
  | RecordArgType<unknown, Ctx>
  | ReferencedFieldRefArgType<FieldAttributeCtx & Ctx>
  | RejectingArgType<never, Ctx>
  | FixedStrArgType<string, Ctx>
  | UnrestrictedStrArgType<Ctx>
  | TaggedLiteralArgType<Ctx>;
```

A new kind has to be added to `ArgTypeKind`, get its own interface, and join `InspectableArgType`. The language server's `valueItems` switch (section 7) has no `default` branch, so a new member of `InspectableArgType` that is not handled there is a TypeScript error ("function lacks ending return statement").

### 1.4 Combinator signatures

```ts
// combinators/str.ts:8-9
export function str(): UnrestrictedStrArgType<AttributeCtx>;
export function str<const T extends string>(value: T): FixedStrArgType<T, AttributeCtx>;
// combinators/num.ts:8-9
export function num(): UnrestrictedNumArgType<AttributeCtx>;
export function num<const T extends number>(value: T): FixedNumArgType<T, AttributeCtx>;
// combinators/num-literal.ts:8
export function numLiteral(): NumLiteralArgType<AttributeCtx>;       // output: { text: string }
// combinators/int.ts:9
export function int(opts?: { min?: number; max?: number }): IntArgType<AttributeCtx>;
// combinators/bool.ts:7
export function bool(): BoolArgType<AttributeCtx>;
// combinators/identifier.ts:12-16
export function identifier(): UnrestrictedIdentifierArgType<AttributeCtx>;
export function identifier<const N extends string>(name: N, options: { readonly documentation: string }): FixedIdentifierArgType<N, AttributeCtx>;
// combinators/json.ts:13
export function json(): JsonArgType<AttributeCtx>;
// combinators/list.ts:7-17
export interface ListOptions { readonly allowEmpty?: boolean; readonly unique?: boolean; readonly label?: string }
export function list<T, Ctx extends AttributeCtx>(of: ArgType<T, Ctx>, opts?: ListOptions): ListArgType<T, Ctx>;
// combinators/record.ts:7
export function record<T, Ctx extends AttributeCtx>(of: ArgType<T, Ctx>): RecordArgType<T, Ctx>;
// combinators/one-of.ts:14-16
export function oneOf<Alts extends readonly [AnyArgType, ...AnyArgType[]]>(...alts: Alts): OneOfArgType<Alts, ContextForRequirement<RequiredContextFor<CtxOf<Alts[number]>>>>;
// combinators/entity-ref.ts:13-15
export function entityRef<const S extends EntitySelector>(expected: S): EntityRefArgType<DeclarationFor<S>, AttributeCtx>;
// combinators/field-ref.ts:37, 45
export function fieldRef(): FieldRefArgType<ModelAttributeCtx>;
export function referencedFieldRef(): ReferencedFieldRefArgType<FieldAttributeCtx>;
// combinators/func-call.ts:10-13
export function funcCall<const Name extends string, const Signature extends FuncCallSig>(name: Name, sig: Signature): FuncCallArgType<Name, AttributeCtx, Signature>;
// combinators/tagged-literal.ts:12-15
export function taggedLiteral(tags: readonly string[], options: { readonly documentation: string }): TaggedLiteralArgType<AttributeCtx>;
// optional.ts:3-6
export function optional<Type extends AnyArgType>(type: Type, ...rest: [] | [defaultValue: OutOf<Type> | undefined]): OptionalArgType<OutOf<Type>, CtxOf<Type>, Type>;
```

`optional` spreads the wrapped type and adds `optional: true`, `hasDefault`, and `defaultValue` (`optional.ts:7-10`). The wrapped `kind`, `label`, `parse` and metadata stay on the same object, so the language server sees the inner kind directly.

Labels (used in `Expected one of:` messages and signature help): `str()` is `string`; `str(v)` is `JSON.stringify(v)`; `numLiteral()` and `num()` are `number`; `bool()` is `boolean`; `list` is `<of.label>[]` or `(<of.label>)[]`, or `opts.label`; `oneOf` joins alternative labels with ` | `; `taggedLiteral(tags)` is `` `${tags[0] ?? 'tag'}\`...\`` `` (for example `` sql`...` ``).

### 1.5 Parsed value types

`PP/attribute-spec/types.ts:80-90`, `154-156`, `206-221`:

```ts
export interface FuncCallSig {
  readonly documentation: string;
  readonly positional?: readonly PositionalParam<unknown, AttributeCtx>[];
  readonly named?: Readonly<Record<string, Param<unknown, AttributeCtx>>>;
}

export interface TypedFuncCall {
  readonly fn: string;
  readonly span: PslSpan;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface NumLiteral {
  readonly text: string;
}

/**
 * A tagged literal argument as parsed: its tag, the canonicalization of its string literal, and its
 * span. Neither the tag nor the canonicalization has been checked; lowering does both.
 */
export interface ParsedTaggedLiteral {
  readonly tag: string;
  readonly canonicalization: TaggedLiteralCanonicalization;
  readonly span: PslSpan;
}

export interface TaggedLiteralArgType<Ctx extends AttributeCtx = AttributeCtx>
  extends ArgTypeOutput<ParsedTaggedLiteral, Ctx> {
  readonly kind: 'taggedLiteral';
  readonly tags: readonly string[];
  readonly documentation: string;
}
```

`TaggedLiteralCanonicalization` is `FC/shared/tagged-literal.ts:5-11`:

```ts
export type TaggedLiteralCanonicalization =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly reason: 'nul' | 'too-large'; readonly offset: number };
```

### 1.6 `taggedLiteral` in full

`PP/attribute-spec/combinators/tagged-literal.ts:1-33`:

```ts
import { notOk, ok, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import { nodePslSpan } from '../../resolve';
import { TaggedLiteralExprAst } from '../../syntax/ast/expressions';
import type { AttributeCtx, ParsedTaggedLiteral, TaggedLiteralArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

/**
 * A `` tag`...` ``, `tag"..."`, or `tag'...'` argument. `tags` and `documentation` describe the
 * registered tags for tooling; parsing accepts any tag.
 */
export function taggedLiteral(
  tags: readonly string[],
  options: { readonly documentation: string },
): TaggedLiteralArgType<AttributeCtx> {
  return {
    kind: 'taggedLiteral',
    label: `${tags[0] ?? 'tag'}\`...\``,
    tags,
    documentation: options.documentation,
    parse: (arg, ctx): Result<ParsedTaggedLiteral, readonly PslDiagnostic[]> => {
      const literal = TaggedLiteralExprAst.cast(arg.syntax);
      if (literal === undefined) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected a tagged literal')]);
      }
      return ok({
        tag: literal.tagName(),
        canonicalization: literal.canonicalization(),
        span: nodePslSpan(literal.syntax, ctx.sources),
      });
    },
  };
}
```

Facts: parsing accepts any tag, including one not in `tags`. The tag is checked later, in `lowerTaggedLiteral` (section 6). The canonicalization result is passed through unchecked. The span covers the whole literal including the tag.

The AST helpers it calls are `PP/syntax/ast/expressions.ts:192-229`. `tagName()` joins space, namespace and identifier (`pg.sql`). `canonicalization()` is `canonicalizeTaggedLiteralBody(this.literal()?.value() ?? '')`. `body()` returns the canonical body or `undefined`. A plain backtick string without a tag is a `StringLiteralExprAst` (quote `` ` ``), not a tagged literal, and `str()` accepts it (`expressions.ts:170-184`).

### 1.7 How a leaf reports a diagnostic

`PP/attribute-spec/combinators/diagnostic.ts:1-20`:

```ts
export const ATTRIBUTE_DIAGNOSTIC_CODE: PslDiagnosticCode = 'PSL_INVALID_ATTRIBUTE_SYNTAX';

export function leafDiagnostic(
  ctx: Pick<AttributeCtx, 'sources'>,
  node: AstNode,
  message: string,
  code: PslDiagnostic['code'] = ATTRIBUTE_DIAGNOSTIC_CODE,
): PslDiagnostic {
  return {
    code,
    message,
    ...diagnosticSource(ctx.sources, node.syntax).at(nodePslSpan(node.syntax, ctx.sources)),
  };
}
```

`PslDiagnostic.code` is `string` (`PP/diagnostic.ts:9`). A pack declares its own code as `ContributedPslDiagnosticCode` (`` `PSL_${string}` ``, `FC/shared/psl-extension-block.ts:140`). Every combinator returns a `Result` and never pushes to a shared sink (ADR 231 principle 5). Leaf messages today: `Expected a string literal`, `Expected a number literal`, `Expected a boolean literal`, `Expected a tagged literal`, `Expected a function call`, `Expected one of: <labels>`, and so on. All use the default code unless a caller passes one; `defaultValueArm` passes `'PSL_UNKNOWN_DEFAULT_FUNCTION'` (section 4.3).

---

## 2. The binder

### 2.1 Applying an `AttributeSpec`

`PP/attribute-spec/interpret.ts:137-163`:

```ts
export function interpretAttribute<Out, Ctx extends AttributeCtx>(
  attrNode: FieldAttributeAst | ModelAttributeAst,
  spec: AttributeSpec<Out, Ctx>,
  ctx: Ctx,
): Result<Out, readonly PslDiagnostic[]> {
  const attributeSpan = nodePslSpan(attrNode.syntax, ctx.sources);
  const bound = interpretArgs(attrNode.argList()?.args() ?? [], spec, ctx, attributeSpan, attrNode.syntax);
  if (!bound.ok) return notOk<readonly PslDiagnostic[]>(bound.failure);
  const value = blindCast<Out, '...'>(bound.value);
  if (spec.refine !== undefined) {
    const refineDiagnostics = spec.refine(value, ctx, attrNode);
    if (refineDiagnostics.length > 0) {
      return notOk<readonly PslDiagnostic[]>(refineDiagnostics);
    }
  }
  return ok(value);
}
```

`refine` runs only when every argument parsed. Its diagnostics replace a success.

`interpretArgs` (`interpret.ts:28-135`) takes an `ArgBindingSpec` (`{ name, positional, named }`, lines 22-26), so `funcCall` reuses it for call arguments (`func-call.ts:23-29`). What it does:

- Unnamed arguments fill `spec.positional` slots in order. An extra positional argument gives one `Attribute "<name>" received too many positional arguments` (lines 47-62).
- A named argument not in `spec.named` gives `Attribute "<name>" received unknown argument "<name>"` (lines 67-78).
- A repeated key (including one given positionally and by name) gives `Attribute "<name>" received duplicate argument "<key>"` (lines 83-93).
- Each argument value is parsed by `parseArgValue` (lines 165-187). A missing value gives `Attribute argument is missing a value`. Otherwise it calls `argType.parse(value, ctx)` (line 182) and copies failures into the shared list.
- Absent keys are finalized (lines 99-129): an optional type with `hasDefault` gets its default; an optional type without a default leaves the key absent; a required type gives `Attribute "<name>" is missing required argument "<key>"` anchored at the attribute span.
- All binder diagnostics use `ATTRIBUTE_DIAGNOSTIC_CODE` (`PSL_INVALID_ATTRIBUTE_SYNTAX`) (lines 195-206).
- Any diagnostic makes the whole result `notOk`. Otherwise the result is `Record<string, unknown>` keyed by positional `key` or named name.

### 2.2 Delivering parsed arguments to the SQL interpreter

`CP/sql-attribute-specs.ts:108-130` wraps the binder for model attributes:

```ts
export function interpretModelAttribute<Out>(input: {
  readonly symbols: SymbolTable;
  readonly node: ModelAttributeAst;
  readonly spec: AttributeSpec<Out, ModelAttributeCtx>;
  readonly model: ModelSymbol;
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
}): Out | undefined {
  const result = interpretAttribute(input.node, input.spec, buildModelAttributeCtx({ ... }));
  if (!result.ok) {
    input.diagnostics.push(...result.failure);
    return undefined;
  }
  return result.value;
}
```

`buildModelAttributeCtx` (lines 77-87) builds `{ sources, selfModel, symbols }`. `interpretFieldAttribute` (lines 135-161) is the same for field attributes. The interpreter receives the typed output (`InferAttr` of the spec) or `undefined`.

### 2.3 How `oneOf` picks an arm and reports errors

`PP/attribute-spec/combinators/one-of.ts:14-43`:

```ts
export function oneOf<Alts extends readonly [AnyArgType, ...AnyArgType[]]>(
  ...alts: Alts
): OneOfArgType<Alts, ContextForRequirement<RequiredContextFor<CtxOf<Alts[number]>>>> {
  const label = alts.map((alt) => alt.label).join(' | ');
  return {
    kind: 'oneOf',
    label,
    alternatives: alts,
    parse: (arg, ctx) => {
      for (const alt of alts) {
        const result = parse(arg, ctx);   // alt.parse, cast to the strongest context
        if (result.ok) return ok(result.value);
      }
      return notOk([leafDiagnostic(ctx, arg, `Expected one of: ${label}`)]);
    },
  } satisfies OneOfArgType<Alts, ParseContext>;
}
```

Alternatives are tried in declaration order. The first success wins. When all fail, every branch diagnostic is dropped and one diagnostic `Expected one of: <label | label | ...>` with code `PSL_INVALID_ATTRIBUTE_SYNTAX` is reported at the argument node. The parse context is the strongest context any alternative needs (`RequiredContextFor`, `types.ts:234-246`).

Consequence for a new combinator placed inside `oneOf`: its own specific refusal message (for example "write `` sql`...` ``") is lost when another arm also fails, unless the owner wraps `parse` the way `defaultValueArm` does (section 4.3).

---

## 3. Spec context

### 3.1 The construction-time context

`PP/attribute-spec/spec-context.ts:1-28` (whole file):

```ts
import type { ControlDefaultRegistries } from '@internal/framework-components/control';
import type { FieldSymbol, ModelSymbol, SymbolTable } from '../symbol-table';
import type { AttributeCtx, AttributeSpec, FieldAttributeCtx, ModelAttributeCtx } from './types';

export interface AttributeSpecContext {
  readonly symbols: SymbolTable;
  readonly model: ModelSymbol;
  readonly controlMutationDefaults: ControlDefaultRegistries;
}

export interface FieldAttributeSpecContext extends AttributeSpecContext {
  readonly field: FieldSymbol;
}

export type ModelAttributeSpecFactory = (
  ctx: AttributeSpecContext,
) => AttributeSpec<never, ModelAttributeCtx>;

export type FieldAttributeSpecFactory = (
  ctx: FieldAttributeSpecContext,
) => AttributeSpec<never, FieldAttributeCtx>;

export interface AttributeSpecNamespace {
  readonly model: Readonly<Record<string, ModelAttributeSpecFactory>>;
  readonly field: Readonly<Record<string, FieldAttributeSpecFactory>>;
}

export type BlockAttributeSpecFactory = () => AttributeSpec<never, AttributeCtx>;
```

`ControlDefaultRegistries` is `FC/shared/mutation-default-types.ts:97-104`:

```ts
/**
 * What an attribute spec needs to build its `@default` arms: the functions a stack registers, and
 * the PSL support for its data types, which is where the tags live. ADR 254.
 */
export interface ControlDefaultRegistries
  extends Pick<ControlMutationDefaults, 'defaultFunctionRegistry'> {
  readonly dataTypeEntries: Readonly<Record<string, AuthoringDataTypeEntry>>;
}
```

So a model or field factory already receives every authoring entry of the stack (value entries keyed by data type id, and lowering entries under `lowering:<tag>`). It does not receive a `DataTypeLookup`, so it cannot see casts. The entry types are in section 6.4.

### 3.2 How `@default`'s factory uses `ctx.controlMutationDefaults.dataTypeEntries`

`CP/sql-attribute-specs.ts:188-220` (`scalarDefaultArms`) walks `registries.dataTypeEntries`, keeps entries with `written.kind === 'tag'` (value and lowering entries alike), groups tags by `documentation`, and builds one `taggedLiteral(tags, { documentation })` arm per group. `defaultFieldSpec` passes `ctx.controlMutationDefaults` in (line 284). Quoted in section 4.3.

### 3.3 Where contexts are constructed

Interpreter (SQL, PSL):

- `@default`: `CP/psl-column-resolution.ts:780-790` and `CP/psl-field-resolution.ts:68-78`, both through `fieldSpecContext` with `controlMutationDefaults: { defaultFunctionRegistry: input.defaultFunctionRegistry, dataTypeEntries: input.dataTypeSupport.entries }`.
- Target-contributed model attributes (this is how `@@fullTextIndex` gets its spec): `CP/interpreter.ts:1146-1159`:

  ```ts
  const specFactory = blindCast<ModelAttributeSpecFactory, '...'>(contributedModelAttribute.spec);
  const parsed = interpretModelAttribute({
    node,
    spec: specFactory({
      symbols: input.symbolTable,
      model,
      controlMutationDefaults: {
        defaultFunctionRegistry: input.defaultFunctionRegistry,
        dataTypeEntries: input.dataTypeSupport.entries,
      },
    }),
    model, symbols: input.symbolTable, sources: input.sources, diagnostics,
  });
  ```

- SQL built-in model attributes are called with no argument: `sqlAttributeSpecs.model.index()` (`CP/interpreter.ts:1049`), `sqlAttributeSpecs.model.check()` (`CP/interpreter.ts:1109`), and the same for `control`, `id`, `unique`, `discriminator`, `base`. The registry entries are `index: () => indexModelSpec` and `check: () => checkModelSpec` (`CP/sql-attribute-specs.ts:704-705`), which ignore the context. `buildModelNodeFromPsl` (`CP/interpreter.ts:729`) already has what a context needs: `BuildModelNodeInput` (line 620) carries `defaultFunctionRegistry` (line 640) and `dataTypeSupport: DataTypeSupport` (line 641), which holds both `entries` and `lookup` (built at `CP/interpreter.ts:2177-2180` from `input.authoringContributions?.dataTypes` and `input.dataTypeLookup`).
- Helpers `modelSpecContext` and `fieldSpecContext` (`CP/sql-attribute-specs.ts:673-697`). `modelSpecContext` is used only in `CP/../test/sql-attribute-specs.test.ts:157`.
- Mongo builds `AttributeSpecContext` through `specContextFor` (`packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts:1104-1108`), passing `input.controlMutationDefaults` (typed `ControlDefaultRegistries`, line 102). Widening `AttributeSpecContext` affects this site too.

Language server: `LS/attribute-spec-resolution.ts:41-94`. For `model` and `field` owners it builds

```ts
const specContext = {
  symbols: source.symbolTable,
  model,
  controlMutationDefaults: {
    ...source.controlMutationDefaults,
    dataTypeEntries: source.authoringContributions.dataTypes ?? {},
  },
};
return (name) => specs.model[name]?.(specContext);
```

It returns no spec at all when `source.authoringContributions` or `source.controlMutationDefaults` is undefined (lines 58-62, 75-79). `AttributeSpecSource` (lines 21-26) carries `pslBlockDescriptors`, `symbolTable`, `authoringContributions?`, `controlMutationDefaults?`, and no `DataTypeLookup`. The language server's `PipelineInputs` (`LS/pipeline.ts:23-28`, built by `pipelineInputsFromStack` in `LS/config-resolution.ts:71-80`) also drops `stack.dataTypeLookup`, although `ControlStack` has it (`FC/control/control-stack.ts:88`) and the interpretation context passes it on to the interpreter (`LS/config-resolution.ts:98`).

### 3.4 Could a block attribute spec factory receive the same context?

Not today. Facts:

- `BlockAttributeSpecFactory` takes no argument (`spec-context.ts:28`).
- Block attributes are interpreted inside `psl-parser` while the symbol table is built: `buildSymbolTable` (`PP/symbol-table.ts:135`) calls `interpretBlockAttributes` for every collected block (lines 229-234), which calls `parseBlockAttribute` (`PP/block-reconstruction.ts:118-173`), which calls `factory()` with no argument and parses with `{ sources, symbols }` (lines 161-165).
- `BuildSymbolTableOptions` (`PP/symbol-table.ts:120-124`) holds only `documents`, `sources`, `pslBlockDescriptors`. It has five production callers: `LS/pipeline.ts:52`, `LS/project-artifacts.ts:184`, `CP/provider.ts:109`, `packages/2-sql/2-authoring/contract-prisma7/src/interpreter.ts:192`, `packages/2-mongo-family/2-authoring/contract-psl/src/provider.ts:73`.
- The language server calls `factory()` with no argument too (`LS/attribute-spec-resolution.ts:46-55`).
- A block has no model, so `AttributeSpecContext` (which requires `model`) does not fit as is.

What would have to change for a block factory to receive data-type entries: `BlockAttributeSpecFactory` gains a context parameter (a type without `model`); `BuildSymbolTableOptions` gains the stack's data-type entries (and a lookup, if the combinator checks casts); the five `buildSymbolTable` callers pass them; `parseBlockAttribute` passes them to the factory; the language server's block branch passes them.

This project does not need it for block attributes. The existing block attributes are `@@map` on policies and native enums (`packages/3-targets/3-targets/postgres/src/core/authoring.ts:564-585`) and `@@type` on enums (`packages/2-sql/9-family/src/core/authoring-entity-types.ts:145`). A policy's `using` and `withCheck` are block **parameters**, not block attributes: `policyPredicateParam = { kind: 'value', codecId: 'pg/text@1', required: true, ... }` (`postgres/src/core/authoring.ts:547-552`), read as flattened text by `readValueParam` and `unwrapQuotedString` (lines 267-289). Those go through the ADR 126 parameter path, not the attribute spec system.

---

## 4. Current declarations

### 4.1 `@@index`

`CP/sql-attribute-specs.ts:374-458`:

```ts
export const PSL_INDEX_FIELDS_XOR_EXPRESSION: ContributedPslDiagnosticCode = 'PSL_INDEX_FIELDS_XOR_EXPRESSION';
export const PSL_INDEX_EXPRESSION_REQUIRES_NAME: ContributedPslDiagnosticCode = 'PSL_INDEX_EXPRESSION_REQUIRES_NAME';
export const PSL_INDEX_NAME_XOR_MAP: ContributedPslDiagnosticCode = 'PSL_INDEX_NAME_XOR_MAP';

const indexModelSpec = modelAttribute('index', {
  documentation:
    'Declares a database index over fields or a SQL expression, optionally restricted by a predicate.',
  positional: [
    {
      key: 'fields',
      type: optional(list(fieldRef(), { allowEmpty: false, unique: true })),
      documentation:
        'The ordered list of distinct indexed fields. Mutually exclusive with `expression`.',
    },
  ],
  named: {
    expression: {
      type: optional(str()),
      documentation:
        'The SQL index expression. Requires `name` or `map` and cannot be combined with a fields list.',
    },
    where: {
      type: optional(str()),
      documentation: 'The SQL predicate restricting rows included in a partial index.',
    },
    unique: { type: optional(bool()), documentation: 'Whether the index enforces uniqueness.' },
    name: { type: optional(str()), documentation: 'The index name. Mutually exclusive with `map`.' },
    map: { type: optional(str()), documentation: 'The database index name. Mutually exclusive with `name`.' },
    type: { type: optional(str()), documentation: 'The target-specific index access method.' },
    options: {
      type: optional(record(str())),
      documentation: 'Target-specific index options. Requires an explicit `type`.',
    },
  },
  refine: (value, ctx, attributeNode) => { /* see below */ },
});
```

Cross-argument checks in `refine` (lines 419-457), all anchored at the attribute node:

| Condition | Message | Code |
| --- | --- | --- |
| `(value.fields === undefined) === (value.expression === undefined)` | `` `@@index` requires exactly one of a fields list or an `expression` argument `` | `PSL_INDEX_FIELDS_XOR_EXPRESSION` |
| `expression` set and neither `name` nor `map` | `` `@@index` with an `expression` argument requires a `name` or `map` argument (a default name cannot be derived from an expression) `` | `PSL_INDEX_EXPRESSION_REQUIRES_NAME` |
| `name` and `map` both set | `` `@@index` takes at most one of `name` and `map` `` | `PSL_INDEX_NAME_XOR_MAP` |
| `options` set and `type` not set | `` `@@index` options argument requires a type argument `` | default `PSL_INVALID_ATTRIBUTE_SYNTAX` |

The checks compare `expression` with `undefined` only. They do not read its content, so they work unchanged if `expression` becomes a different value type.

### 4.2 `@@check`

`CP/sql-attribute-specs.ts:460-524`:

```ts
export const PSL_CHECK_REQUIRES_NAME_OR_MAP: ContributedPslDiagnosticCode = 'PSL_CHECK_REQUIRES_NAME_OR_MAP';
export const PSL_CHECK_NAME_XOR_MAP: ContributedPslDiagnosticCode = 'PSL_CHECK_NAME_XOR_MAP';
export const PSL_CHECK_EXPRESSION_EMPTY: ContributedPslDiagnosticCode = 'PSL_CHECK_EXPRESSION_EMPTY';
export const PSL_CHECK_ON_STI_VARIANT: ContributedPslDiagnosticCode = 'PSL_CHECK_ON_STI_VARIANT';

const checkModelSpec = modelAttribute('check', {
  documentation: 'Declares a named database CHECK constraint on this table.',
  named: {
    expression: { type: str(), documentation: 'The nonempty SQL predicate checked for each row.' },
    name: {
      type: optional(str()),
      documentation: 'The constraint name. Exactly one of `name` and `map` is required.',
    },
    map: {
      type: optional(str()),
      documentation: 'The database constraint name. Exactly one of `name` and `map` is required.',
    },
  },
  refine: (value, ctx, attributeNode) => {
    const diagnostics: PslDiagnostic[] = [];
    if (value.expression.trim().length === 0) {
      diagnostics.push(leafDiagnostic(ctx, attributeNode,
        '`@@check` expression must not be empty — an empty predicate is not a constraint',
        PSL_CHECK_EXPRESSION_EMPTY));
    }
    if (value.name === undefined && value.map === undefined) {
      diagnostics.push(leafDiagnostic(ctx, attributeNode,
        '`@@check` requires a `name` or `map` argument (a default name cannot be derived — a check has no column tuple to name itself after)',
        PSL_CHECK_REQUIRES_NAME_OR_MAP));
    }
    if (value.name !== undefined && value.map !== undefined) {
      diagnostics.push(leafDiagnostic(ctx, attributeNode,
        '`@@check` takes at most one of `name` and `map`',
        PSL_CHECK_NAME_XOR_MAP));
    }
    return diagnostics;
  },
});
```

`expression` is the only required named argument in the SQL model specs. Its `refine` reads the string content (`value.expression.trim()`), so it must change if the parsed value is no longer a string. `PSL_CHECK_ON_STI_VARIANT` is raised from the interpreter, not from `refine` (doc comment at lines 468-474). The interpreter also refuses `@@check` before parsing when the target lacks the `checkConstraint` capability: code `PSL_CHECK_UNSUPPORTED_TARGET` (`CP/interpreter.ts:1099-1106`). SQLite reaches that refusal.

### 4.3 `@default`

`CP/sql-attribute-specs.ts:184-297`:

```ts
type DefaultLiteralElement = string | NumLiteral | boolean | ParsedTaggedLiteral;

type DefaultArgValue = DefaultLiteralElement | DefaultLiteralElement[] | TypedFuncCall;

function scalarDefaultArms(
  isList: boolean,
  registries: ControlDefaultRegistries,
): readonly [ArgType<DefaultArgValue, AttributeCtx>, ...ArgType<DefaultArgValue, AttributeCtx>[]] {
  // One arm per distinct documentation, so each tag's completion and signature help carries the
  // text of the tag it names rather than every registered tag's text run together.
  const tagsByDocumentation = new Map<string, string[]>();
  for (const entry of Object.values(registries.dataTypeEntries)) {
    if (entry.written.kind !== 'tag') continue;
    const tags = tagsByDocumentation.get(entry.documentation);
    if (tags === undefined) tagsByDocumentation.set(entry.documentation, [entry.written.tag]);
    else tags.push(entry.written.tag);
  }
  const tagArms = () =>
    [...tagsByDocumentation].map(([documentation, tags]) => taggedLiteral(tags, { documentation }));
  // A list element may itself be a tagged literal, so `Jsonb[] @default([json`{}`])` parses.
  const literal = () => oneOf(str(), numLiteral(), bool(), ...tagArms());
  const listArm = () => list(literal(), { label: `list of (${literal().label})` });
  const funcArms = [...registries.defaultFunctionRegistry.entries()].map(([name, entry]) =>
    funcCall(name, blindCast<FuncCallSig, '...'>(entry.signature)),
  );
  // A scalar column takes a list literal too: a codec such as `pg/vector@1` declares a list of
  // element types, and its value is written as a PSL list on a column that is not a list.
  return isList
    ? [listArm(), ...funcArms, ...tagArms()]
    : [str(), numLiteral(), bool(), ...funcArms, ...tagArms(), listArm()];
}

/**
 * The `@default` value arms, with a `dbgenerated(...)` call reported as removed before the arms
 * are tried, so the author is told what replaced it instead of being shown the list of arms.
 */
function defaultValueArm(
  arms: readonly [ArgType<DefaultArgValue, AttributeCtx>, ...ArgType<DefaultArgValue, AttributeCtx>[]],
  registry: ControlDefaultRegistries['defaultFunctionRegistry'],
) {
  const value = oneOf(...arms);
  return {
    ...value,
    parse: (arg: Parameters<typeof value.parse>[0], ctx: AttributeCtx) =>
      FunctionCallAst.cast(arg.syntax)?.path().join('.') === 'dbgenerated'
        ? notOk<readonly PslDiagnostic[]>([
            leafDiagnostic(ctx, arg, removedDbgeneratedMessage(registry), 'PSL_UNKNOWN_DEFAULT_FUNCTION'),
          ])
        : value.parse(arg, ctx),
  };
}

function defaultFieldSpec(ctx: FieldAttributeSpecContext) {
  const members = enumMemberNames(ctx);
  const valueArms =
    members === undefined
      ? scalarDefaultArms(ctx.field.list, ctx.controlMutationDefaults)
      : enumDefaultArms(members, ctx.field.typeName);
  return fieldAttribute('default', {
    documentation: 'Supplies a default value when this field is omitted from a mutation.',
    positional: [
      {
        key: 'value',
        type: defaultValueArm(valueArms, ctx.controlMutationDefaults.defaultFunctionRegistry),
        documentation:
          'A literal, enum member, or registered default function compatible with this field.',
      },
    ],
  });
}
```

Enum fields use `enumDefaultArms` (lines 269-278): one `identifier(member, { documentation })` per member, or `noEnumMember()` (a `rejecting` kind, lines 250-257) when the enum has none. `@default` has no `refine`. Diagnostic codes raised at parse: `PSL_INVALID_ATTRIBUTE_SYNTAX` (`Expected one of: ...`) and `PSL_UNKNOWN_DEFAULT_FUNCTION` (removed `dbgenerated`). The other `@default` codes are raised in lowering (section 6).

`defaultValueArm` is the existing pattern for a spec that intercepts one kind of syntax before `oneOf` runs so its own message is reported instead of `Expected one of:`.

### 4.4 `@@fullTextIndex` (Postgres target)

`packages/3-targets/3-targets/postgres/src/core/authoring.ts`. Codes, lines 81-87:

```ts
const PSL_FULL_TEXT_INDEX_ONE_FIELD: ContributedPslDiagnosticCode = 'PSL_FULL_TEXT_INDEX_ONE_FIELD';
const PSL_FULL_TEXT_INDEX_REQUIRES_NAME: ContributedPslDiagnosticCode = 'PSL_FULL_TEXT_INDEX_REQUIRES_NAME';
const PSL_FULL_TEXT_INDEX_NAME_XOR_MAP: ContributedPslDiagnosticCode = 'PSL_FULL_TEXT_INDEX_NAME_XOR_MAP';
const PSL_FULL_TEXT_INDEX_TEXT_FIELD: ContributedPslDiagnosticCode = 'PSL_FULL_TEXT_INDEX_TEXT_FIELD';
```

Spec, lines 717-792:

```ts
const postgresFullTextIndexSpec = modelAttribute('fullTextIndex', {
  documentation:
    'Indexes one text column for full-text search, rendering the expression `fullTextMatches`, `fullTextRank` and `fullTextHeadline` lower to.',
  positional: [
    { key: 'fields', type: list(fieldRef(), { allowEmpty: false, unique: true }), documentation: 'The single field to index.' },
  ],
  named: {
    language: {
      type: optional(oneOf(str(firstLanguage), ...remainingLanguages.map((language) => str(language)))),
      documentation: 'The text-search configuration. Defaults to `english`, and must match the language the query operations are given.',
    },
    name: { type: optional(str()), documentation: 'The index name. Mutually exclusive with `map`.' },
    map: { type: optional(str()), documentation: 'The database index name. Mutually exclusive with `name`.' },
    where: {
      type: optional(str()),
      documentation: 'The SQL predicate restricting rows included in a partial index.',
    },
  },
  refine: (value, ctx, attributeNode) => {
    // fields.length !== 1        -> PSL_FULL_TEXT_INDEX_ONE_FIELD
    //   'The full-text operations work on one column; declare one `@@fullTextIndex` per column'
    // neither name nor map       -> PSL_FULL_TEXT_INDEX_REQUIRES_NAME
    //   '`@@fullTextIndex` requires a `name` or `map` argument (a default name cannot be derived from an expression)'
    // both name and map          -> PSL_FULL_TEXT_INDEX_NAME_XOR_MAP
    //   '`@@fullTextIndex` takes at most one of `name` and `map`'
  },
});

const postgresFullTextIndexSpecFactory: ModelAttributeSpecFactory = () => postgresFullTextIndexSpec;

type PostgresFullTextIndexParsed = {
  readonly fields: readonly string[];
  readonly language?: FullTextSearchLanguage;
  readonly name?: string;
  readonly map?: string;
  readonly where?: string;
};
```

`PostgresFullTextIndexParsed` is written by hand, not inferred from the spec. Its `where?: string` must change with the spec. The factory ignores its context, but the interpreter already passes it a full context with `dataTypeEntries` (section 3.3), and so does the language server. `PSL_FULL_TEXT_INDEX_TEXT_FIELD` is raised in `lower` (section 5.3).

---

## 5. From parsed arguments to IR

### 5.1 `@@index` in the SQL interpreter

`CP/interpreter.ts:1042-1093` (inside `buildModelNodeFromPsl`):

```ts
if (modelAttribute.name === 'index') {
  const node = modelAttributeNodes[attributeIndex];
  if (node === undefined) continue;
  const parsed = interpretModelAttribute({
    node,
    spec: sqlAttributeSpecs.model.index(),
    model, symbols: input.symbolTable, sources: input.sources, diagnostics,
  });
  if (parsed === undefined) continue;
  let columnNames: readonly string[] | undefined;
  if (parsed.fields !== undefined) {
    const mapped = mapFieldNamesToColumns({ ... });
    if (!mapped) continue;
    columnNames = mapped;
  }
  indexNodes.push(
    blindCast<IndexNode, 'dynamically assembled from PSL arguments; the interpreter diagnoses both invalid shapes and lowerAuthoredIndex re-checks'>({
      ...ifDefined('columns', columnNames),
      ...ifDefined('expression', parsed.expression),
      where: parsed.where,
      unique: parsed.unique,
      name: parsed.name,
      map: parsed.map,
      type: parsed.type,
      options: parsed.options,
    }),
  );
  continue;
}
```

`parsed.expression` and `parsed.where` go straight into the node with no conversion. `indexNodes` and `checkNodes` (declared at lines 873-874) become the model node's `indexes` and `checks` (lines 1561-1562).

### 5.2 `@@check` in the SQL interpreter

`CP/interpreter.ts:1094-1124`:

```ts
if (modelAttribute.name === 'check') {
  const node = modelAttributeNodes[attributeIndex];
  if (node === undefined) continue;
  if (input.capabilities['sql']?.['checkConstraint'] !== true) {
    diagnostics.push({ code: 'PSL_CHECK_UNSUPPORTED_TARGET', message: `...`, ...source.at(modelAttribute.span) });
    continue;
  }
  const parsed = interpretModelAttribute({
    node,
    spec: sqlAttributeSpecs.model.check(),
    model, symbols: input.symbolTable, sources: input.sources, diagnostics,
  });
  if (parsed === undefined) continue;
  checkNodes.push({
    expression: parsed.expression,
    name: parsed.name,
    map: parsed.map,
  });
  continue;
}
```

### 5.3 `@@fullTextIndex` in the Postgres target

The interpreter's generic path for contributed model attributes (`CP/interpreter.ts:1125-1211`) parses with the descriptor's spec factory (lines 1146-1164), calls its `lower` with `AuthoringModelAttributeContext` (lines 1168-1192), and for an `{ index }` result checks the shape with `isAuthoredIndexInput` and pushes it onto `indexNodes` (lines 1196-1206):

```ts
if ('index' in lowered) {
  if (!isAuthoredIndexInput(lowered.index)) {
    throw contractError('CONTRACT.PACK_CONTRIBUTION_INVALID', `...`, { meta: { ... } });
  }
  indexNodes.push(lowered.index);
  continue;
}
```

The descriptor's `lower` (`postgres/src/core/authoring.ts:816-854`):

```ts
fullTextIndex: {
  kind: 'modelAttribute',
  attribute: 'fullTextIndex',
  spec: postgresFullTextIndexSpecFactory,
  repeatable: true,
  lower: (parsed: PostgresFullTextIndexParsed, ctx: AuthoringModelAttributeContext) => {
    const fieldName = parsed.fields[0];
    invariant(fieldName !== undefined && parsed.fields.length === 1, `...`);
    const columnName = ctx.fieldStorageName(fieldName);
    const codecId = ctx.fieldCodecId(fieldName);
    if (columnName === undefined || codecId === undefined || !isFullTextIndexableCodec(codecId)) {
      ctx.diagnostics?.push({ code: PSL_FULL_TEXT_INDEX_TEXT_FIELD, message: `...`, sourceId: ctx.sourceId ?? 'unknown' });
      return undefined;
    }
    return {
      index: {
        expression: renderFullTextIndexExpression(parsed.language ?? DEFAULT_FULL_TEXT_SEARCH_LANGUAGE, columnName),
        type: 'gin',
        options: undefined,
        where: parsed.where,
        unique: undefined,
        name: parsed.name,
        map: parsed.map,
      },
    };
  },
},
```

`isAuthoredIndexInput` (`packages/2-sql/1-core/contract/src/index-naming.ts:56-75`) requires `where` to be `undefined` or a `string`. So `lower` must hand over a string body, whatever the parsed type of `where` becomes.

### 5.4 IR nodes and lowering

`IndexNode` and `CheckNode` (`packages/2-sql/2-authoring/contract-ts/src/contract-definition.ts:92-125`):

```ts
export type IndexNodeElements =
  | { readonly columns: readonly string[]; readonly expression?: never }
  | { readonly columns?: never; /** Opaque SQL: the entire element list of CREATE INDEX — never parsed. */ readonly expression: string };

export type IndexNode = IndexNodeElements &
  AuthoredIndexMethod & {
    /** Opaque SQL: partial-index predicate (WHERE body, without the keyword). */
    readonly where: string | undefined;
    readonly unique: boolean | undefined;
    readonly map: string | undefined;
    readonly name: string | undefined;
  };

export type CheckNode = {
  readonly expression: string;
  readonly map: string | undefined;
  readonly name: string | undefined;
};
```

`AuthoredIndexInput` has the same shape (`packages/2-sql/1-core/contract/src/index-naming.ts:18-46`). `AuthoredCheckInput` is `{ expression: string; map; name }` (`packages/2-sql/1-core/contract/src/authored-check-naming.ts:20-24`).

The definition tree is lowered in `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts`: indexes at lines 1263-1281 (`lowerAuthoredIndex(tableName, { ...columns/expression, where, unique, map, name, type, options }, authoringWarnings)`), checks at lines 1287-1291 (`lowerAuthoredCheck(tableName, authoredCheck, authoringWarnings)`).

`lowerAuthoredIndex` (`index-naming.ts:137-214`) re-checks the four cross-argument rules and throws `CONTRACT.ARGUMENT_INVALID` for each. With `map`, it emits the exact-name body warning `PN_EXACT_NAME_BODY_COMPARISON` when `expression` or `where` is set, and returns `{ naming: { kind: 'exact', name }, where, unique, type, options, expression | columns }`. Without `map`, it computes the wire name from `name` or `defaultIndexName(tableName, columns)` and `computeIndexContentHash({ columns?, expression?, where?, unique, type?, options? })`.

`lowerAuthoredCheck` (`authored-check-naming.ts:37-82`) throws for `map` with `name`, and for `expression.trim().length === 0` (`Check on table "<t>": expression must not be empty — an empty predicate is not a constraint.`). With `map` it warns and returns `{ naming: { kind: 'exact', name }, expression }`. With `name` it returns `{ naming: { kind: 'wire', prefix, hash: computeCheckContentHash(expression) }, expression }`. Without either it throws.

Every step from the PSL interpreter onward carries the SQL body as a plain `string`. The TypeScript builder produces the same `IndexNode` and `CheckNode` shapes.

---

## 6. `@default`: from parsed syntax to `WrittenValue`

### 6.1 The functions

`WrittenValue` and `DataTypeSupport` (`CP/data-type-default.ts:37-49`):

```ts
/** One written value, in the syntax a contract source wrote it in. */
export type WrittenValue =
  | { readonly kind: 'tag'; readonly tag: string; readonly body: string }
  | { readonly kind: 'string'; readonly text: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'number'; readonly text: string }
  | { readonly kind: 'list'; readonly elements: readonly WrittenValue[] };

/** The assembled data types of a stack and the PSL support for them. */
export interface DataTypeSupport {
  readonly entries: Readonly<Record<string, AuthoringDataTypeEntry>>;
  readonly lookup: DataTypeLookup;
}
```

The conversion from the parsed `@default` value to `WrittenValue` is in `lowerDefaultForField` (`CP/psl-column-resolution.ts:760-932`). There is no named, exported conversion function; it is inline:

- `writtenElement` (lines 828-849), a closure, converts one list element: `string` to `{ kind: 'string', text }`; `boolean` to `{ kind: 'boolean', value }`; `NumLiteral` (checked with `'text' in element`) to `{ kind: 'number', text }`; `ParsedTaggedLiteral` through `lowerTaggedLiteral`. A lowering tag (the current `sql`) inside a list is refused with `PSL_INVALID_DEFAULT_LITERAL`, `Literal tag "<tag>" produces a default of its own and cannot be an element of a list literal.`
- Scalar branches (lines 863-878): an array becomes `{ kind: 'list', elements }`; a `string`, `boolean` or `NumLiteral` becomes the matching `WrittenValue` and goes to `readAsLiteral`.
- Tagged literal or function call (lines 880-896): `'tag' in value` goes to `lowerTaggedLiteral`; otherwise to `lowerDefaultFunctionWithRegistry`. A `{ ok: true, written }` result goes to `readAsLiteral`.

`lowerTaggedLiteral` (`CP/psl-column-resolution.ts:710-758`, module-private):

```ts
const TAGGED_LITERAL_CANONICALIZATION_CODES = {
  nul: 'PSL_TAGGED_LITERAL_NUL',
  'too-large': 'PSL_TAGGED_LITERAL_TOO_LARGE',
} as const;

/** A tag naming a data type yields the written value its body is; a lowering tag lowers itself. */
type TaggedLiteralLowering =
  | LoweredPslDefaultResult
  | { readonly ok: true; readonly written: WrittenValue };

function lowerTaggedLiteral(
  literal: ParsedTaggedLiteral,
  support: DataTypeSupport,
  context: DefaultFunctionLoweringContext,
  source: DiagnosticSource,
): TaggedLiteralLowering {
  const reject = (code: string, message: string): LoweredPslDefaultResult => ({
    ok: false, kind: 'owned', diagnostic: { code, message, ...source.at(literal.span) },
  });
  const entry =
    support.entries[loweringEntryKey(literal.tag)] ?? entryForTag(support, literal.tag)?.entry;
  if (entry === undefined) {
    return reject('PSL_UNKNOWN_DEFAULT_LITERAL_TAG',
      `Unknown literal tag "${literal.tag}". Known tags: ${knownTags(support).join(', ')}.`);
  }
  const { canonicalization } = literal;
  if (!canonicalization.ok) {
    return reject(TAGGED_LITERAL_CANONICALIZATION_CODES[canonicalization.reason],
      describeTaggedLiteralFailure(canonicalization.reason));
  }
  if (!isDataTypeLoweringEntry(entry)) {
    return { ok: true, written: { kind: 'tag', tag: literal.tag, body: canonicalization.body } };
  }
  const result = entry.lower({
    literal: { tag: literal.tag, body: canonicalization.body, span: literal.span },
    context,
  });
  return result.ok ? result : { ...result, kind: 'external' };
}
```

Order of checks: unknown tag first, then canonicalization failure, then value entry versus lowering entry. Messages for canonicalization failures come from `describeTaggedLiteralFailure` (`FC/shared/tagged-literal.ts:16-23`): `Tagged literals must not contain NUL characters.` and `Tagged literal exceeds 65536 bytes.`

`readAsLiteral` (lines 808-826) calls `lowerDataTypeDefault` and pushes its `{ code, message }` at `source.at()` (the attribute), then returns `{ defaultValue: { kind: 'literal', value, canonical: true } }`.

### 6.2 The cast rule

`CP/data-type-default.ts` (module-private unless marked):

| Function | Lines | Exported | What it does |
| --- | --- | --- | --- |
| `valueEntries` | 93-99 | no | Entries that are not lowering entries. |
| `entryForTag` | 102-110 | yes | The value entry whose `written` is `{ kind: 'tag', tag }`. |
| `knownTags` | 113-117 | yes | Every tag, value and lowering entries, in merge order. |
| `entryForPlain` | 119-127 | no | The value entry for plain `string`, `boolean` or `number`. |
| `plainText` | 130-141 | no | Text an entry reads from a non-list `WrittenValue`. |
| `readValue` | 152-208 | no | Finds the entry for the written syntax; runs `classify` (number) or `parse`; returns `{ type: DataTypeId, value: JsonValue }` or a refusal (`unknown-tag`, `unwritable`, `unreadable`). |
| `castInto` | 211-245 | no | If the value's type equals the receiving type, returns it; else looks up `support.lookup.get(receivingType)?.casts[valueType]`; none gives a `no-cast` refusal listing `Object.keys(casts)`. |
| `readDataTypeDefault` | 264-351 | yes | Column-specific: finds the column codec's data type through `codecLookup.descriptorFor(codecId).dataType`, runs `readValue` then `castInto`, then validates with the codec instance (`decodeJson`). Handles lists and list casts. |
| `lowerDataTypeDefault` | 425-475 | yes | Words each refusal as a PSL diagnostic. |
| `describeCasts` | 477-479 | no | `it casts from nothing` or `it casts from a, b`. |

`readValue` and `castInto` take `DataTypeSupport` plus a `WrittenValue` and a receiving `DataTypeId`; they contain nothing specific to columns or to SQL. `readDataTypeDefault` needs a column codec, so it does not fit a position that names a data type directly.

Diagnostics from `lowerDataTypeDefault` (lines 425-475), with `where` = `` Field "<Model.field>"[ at element N] ``:

| Refusal | Code | Message |
| --- | --- | --- |
| `unreadable` | `PSL_INVALID_JSON_LITERAL` or `PSL_INVALID_DEFAULT_LITERAL` | `<where>: <message>` |
| `unknown-tag` | `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` | `Unknown literal tag "<tag>". Known tags: <list>.` |
| `unwritable` | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `<where>: this target has no data type for a <syntax> value` |
| `not-a-list` | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `<where>: this column holds a list, so its default is a list literal, as in [1, 2]` |
| `no-cast` | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `<where>: <columnType> has no cast from <valueType>; <describeCasts>` |
| `undecodable` | `PSL_INVALID_DEFAULT_LITERAL` | `<where>: <message>` |

The codes are declared at `CP/data-type-default.ts:23-32` as `ContributedPslDiagnosticCode`.

### 6.3 Layering facts for reuse

- `WrittenValue`, `DataTypeSupport`, `readValue`, `castInto`, `entryForTag` and `knownTags` live in the SQL family's authoring package (`@internal/sql-contract-psl`). The combinator kit lives in the framework's `psl-parser`. The framework domain cannot import from the SQL domain (`pnpm lint:deps`).
- `psl-parser` depends on `@internal/framework-components` (`packages/1-framework/2-authoring/psl-parser/package.json`) and already imports its `authoring`, `codec`, `control` and `psl-ast` entry points. `AuthoringDataTypeEntry` and `isDataTypeLoweringEntry` are in `@internal/framework-components/authoring`; `DataTypeLookup`, `DataTypeId` and `DataType` are in `@internal/framework-components/codec` (`FC/exports/codec.ts:37-46`).
- So a combinator in `psl-parser` can name the entry and lookup types. It cannot call `readValue` or `castInto` where they are now.

### 6.4 Data-type entry and lookup types

`FC/shared/framework-authoring.ts:587-654`:

```ts
export type DataTypeWrittenForm =
  | { readonly kind: 'tag'; readonly tag: string; readonly parse: (text: string) => JsonValue }
  | { readonly kind: 'plain'; readonly syntax: 'string' | 'boolean'; readonly parse: (text: string) => JsonValue }
  | {
      readonly kind: 'plain';
      readonly syntax: 'number';
      readonly types: readonly DataTypeId[];
      readonly classify: (text: string) => { readonly type: DataTypeId; readonly value: JsonValue } | undefined;
    };

export interface DataTypeAuthoringEntry {
  readonly written: DataTypeWrittenForm;
  readonly print: (value: JsonValue) => string;
  readonly documentation: string;
  readonly lower?: never;
}

export interface DataTypeLoweringAuthoringEntry {
  readonly written: { readonly kind: 'tag'; readonly tag: string };
  readonly documentation: string;
  readonly lower: (input: {
    readonly literal: TaggedLiteralValue;
    readonly context: DefaultFunctionLoweringContext;
  }) => LoweredDefaultResult;
}

export type AuthoringDataTypeEntry = DataTypeAuthoringEntry | DataTypeLoweringAuthoringEntry;

export function loweringEntryKey(tag: string): string { return `${LOWERING_ENTRY_PREFIX}${tag}`; }   // 'lowering:'
export function isLoweringEntryKey(key: string): boolean { ... }
export function isDataTypeLoweringEntry(entry: AuthoringDataTypeEntry): entry is DataTypeLoweringAuthoringEntry { ... }
```

`FC/shared/data-type.ts:40-56`:

```ts
export interface DataType {
  readonly id: DataTypeId;
  /** Keyed by the id of the type each cast takes values of. */
  readonly casts: Readonly<Record<DataTypeId, Cast>>;
  readonly listCast?: ListCast;
}

export interface DataTypeLookup {
  get(id: string): DataType | undefined;
  has(id: string): boolean;
}
```

Current `sql` registrations (the lowering entries the project removes): `packages/3-targets/6-adapters/postgres/src/core/data-type-authoring.ts:12-18` registers `lowering:sql` and `lowering:pg.sql`; `packages/3-targets/6-adapters/sqlite/src/core/data-type-authoring.ts:15-16` registers `lowering:sql` and `lowering:sqlite.sql`. Both use `sqlDefaultLiteralTagEntry(tag)` from `packages/2-sql/9-family/src/core/sql-default-literal-tag.ts:14-45`, whose documentation is `"Uses the SQL in the string, verbatim, as the column's default expression."` and whose `lower` refuses reserved bodies and `checkSqlDefaultBody` failures with `PSL_INVALID_DEFAULT_SQL`. A test-only copy is `CP/../test/fixture-sql-tag.ts`.

---

## 7. Language server

### 7.1 Where specs are read

- `LS/attribute-spec-resolution.ts:41-94`, `attributeSpecResolver(context, source)`, quoted in section 3.3. Used by completion (`LS/completion-provider.ts:158, 175, 208, 265`) and signature help (`LS/signature-help.ts:21`).
- `LS/attribute-argument-grammar.ts:13-18`: `directArgType` casts an `ArgType` to `InspectableArgType<never>`; the cast reason says inspection never calls `parse`. `advanceGrammar` (lines 31-54) walks into `oneOf` alternatives, `list.of`, `record.of`, and `funcCall.signature`.
- There is no hover provider in the language server (`grep -i hover` in `LS` finds nothing). Documentation reaches the editor through completion item `detail` and signature help.

### 7.2 How a `taggedLiteral` arm is treated

`LS/completion-values.ts:96-167`:

```ts
function valueItems(
  input: ValueCompletionInput<AttributeArgumentPosition>,
  param: ArgType<unknown, never> | undefined,
  syntax: AttributeValuePosition['syntax'],
): readonly CompletionItem[] {
  if (param === undefined) return [];
  const type = directArgType(param);
  if (type.kind === 'oneOf') {
    return type.alternatives.flatMap((alternative) => valueItems(input, alternative, syntax));
  }
  if (type.kind === 'funcCall') { /* function item */ }
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
  switch (type.kind) {
    case 'identifier': return type.name === undefined ? [] : scalarItems(input, [type.name], type.documentation);
    case 'str': return scalarItems(input, type.value === undefined ? [] : [JSON.stringify(type.value)]);
    case 'num': return scalarItems(input, type.value === undefined ? [] : [String(type.value)]);
    case 'bool': return scalarItems(input, ['true', 'false']);
    case 'fieldRef':
    case 'referencedFieldRef': return scalarItems(input, input.fieldNames(type.kind));
    case 'list':
    case 'record':
    case 'entityRef':
    case 'int':
    case 'json':
    case 'rejecting':
      return [];
  }
}
```

One completion item per tag. The label is the tag; the snippet inserts `` tag`$1` ``; `detail` is the arm's documentation. Items are de-duplicated and ordered by `orderedItems` (lines 205-215). An unrestricted `str()` (the current `where`, `expression`) offers nothing.

### 7.3 Other places that read argument types

- Required-argument snippets: `LS/completion-snippets.ts:42-52`. `argSnippetPlaceholder` returns `"${n:key}"` for `str`, `[${n:key}]` for `list`, `{ ${n:key} }` for `record`, and a bare `${n:key}` for every other kind. `@@check`'s `expression` is required, so `@@check(` completes today as `expression: "${1:expression}"`. With a new kind and no new case, it would complete as `expression: ${1:expression}`.
- Signature help: `LS/signature-help.ts:95-128` renders each parameter as `key?: <type.label>` and uses `param.documentation`. The label of the new combinator appears there.

### 7.4 What completing `sql` in a new data-type position would need

Facts only:

- The completion code reads metadata from the combinator object; it never calls `parse`. A new kind needs its tags (and documentation) as metadata on the object, like `TaggedLiteralArgType.tags` and `.documentation`.
- The metadata has to come from the stack's entries. The factory context already has them (`ctx.controlMutationDefaults.dataTypeEntries`), in the interpreter and in the language server. The entry for a data type is keyed by its id, so the receiving type's own entry gives its tag (`written.kind === 'tag'`) and `documentation` directly. The language server has no `DataTypeLookup`, so it cannot list the tags of other types that the receiving type casts from; for a type that casts from nothing, the receiving type's own entry is the complete list.
- `valueItems` must handle the new kind (a compile error forces it, section 1.3). `argSnippetPlaceholder` needs a case if a required argument should snippet as `` sql`${n:key}` ``.
- `@@index` and `@@check` factories must build their spec from the context; today they are `() => indexModelSpec` and `() => checkModelSpec`. The language server already passes a context at model level; the SQL interpreter does not (section 3.3).
- The existing completion test for tags inside `@default` is `packages/1-framework/3-tooling/language-server/test/completion-provider.test.ts:1186-1260` (`offers each registered tag inside @default( with its own documentation`). It expects `json`, `sql`, `pg.sql` for Postgres.

---

## 8. What ADRs 231, 249 and 254 say about a combinator that names a data type

ADR 254 (`docs/architecture docs/adrs/ADR 254 - Data types and casts.md`):

- Line 5: "A follow-up project owns the rest of this decision: ... type constructors naming a type and a codec, and function parameters typed by a data type."
- Line 143: "Some tags name no data type. `sql` takes an expression in the database's language, which nothing in the framework reads, and stores it in the contract's expression form on any column. Such a tag is registered in the same map as the others, as a **lowering** entry under a reserved key that no data type id can collide with; Postgres registers `sql` and `pg.sql` this way, SQLite `sql` and `sqlite.sql`."
- Line 151 (the rule for a literal): "The receiving type must be that type or cast from it: for a column, the column's type; for a function argument, the parameter's declared type; inside a list, per element. No cast is `PSL_DEFAULT_TYPE_INCOMPATIBLE`".
- Line 153: "Each argument is an expression delivered to a parameter, and a parameter names a data type, so an argument is admitted by the same rule as a default."
- Line 155, the direct statement: "Value positions, in attributes and in function signatures, are typed through the attribute specification with one combinator that names a data type; the syntax that is not a value (field references, entity references, identifiers, lists, records, calls) keeps its own combinators. One binder parses, validates and drives the editor for both attributes and calls."
- Line 160, reading a default step 2: "A reference resolves; a call dispatches; a `sql` tag lowers."
- Line 77: "No type spans targets, and no family registers types." (Design note 4 amends this.)
- Line 207 rejects "A family-level vocabulary of written types (`sql/i8`, `sql/json`, …) that every target's types cast from."

ADR 231 (`docs/architecture docs/adrs/ADR 231 - Declarative attribute specifications.md`):

- Line 175: "The current kit does not provide a document-path scope or include a codec reference combinator. Those would be separate additions if a future consumer requires them."
- Line 244: "Literal-to-codec compatibility remains a lowering concern. A `matchingScalarLiteral` combinator is not implemented."
- Line 337 (follow-up): "Decide whether literal-to-field-type compatibility should remain in lowering or gain a dedicated field-context combinator."
- Line 63, principle 5: "Keep leaf parsing diagnostic-pure. Every combinator returns a `Result`; it does not mutate a shared diagnostic sink."
- Line 197: `oneOf` "discards the branch diagnostics and emits one aggregate `Expected one of: …` diagnostic".
- Lines 84-99 show `AttributeCtx` with `sourceId` and `sourceFile`; the code has `sources` and `symbols` (`types.ts:18-21`). The ADR example is out of date.

ADR 249 (`docs/architecture docs/adrs/ADR 249 - Central attribute-spec registry.md`):

- Line 26: "`index` and `check` ignore the context and return a hoisted constant; `default` builds its spec from the declaring field".
- Line 101: "The context is framework-owned, and a family that needs a new fact widens it for everyone rather than adding a bespoke parameter."
- Line 230: rejects "Reusing the parse-time context as the construction-time context ... they carry neither the symbol table nor the mutation-default registry a spec needs while being built."
- Lines 31-49 and 78-82 show `controlMutationDefaults: ControlMutationDefaultRegistry`; the code has `ControlDefaultRegistries` (registry plus `dataTypeEntries`). Lines 110-113 show `AttributeCtx` with `sourceId` and `sourceFile`. Both examples are out of date.

None of the three ADRs mentions typing a value position with a data type other than ADR 254 line 155 (and lines 5, 153).

---

## 9. Tests

psl-parser (`packages/1-framework/2-authoring/psl-parser/test/`):

| File | What it covers |
| --- | --- |
| `attribute-spec-combinators.test.ts` | Runtime parsing for `str`, `identifier`, `int`, `num`, `numLiteral`, `json`, `bool`, `oneOf`, `fieldRef`, `entityRef`, `list`, `optional`, `record`, `funcCall`, and combinators run through `interpretAttribute`. |
| `attribute-spec-combinators.tagged-literal.test.ts` | `taggedLiteral`: label, parsed tag, canonical body, span, quote styles, unlisted tags accepted. |
| `attribute-spec-combinators.foreign-copy.test.ts` | Combinators match on syntax kind, not AST class identity. |
| `attribute-spec-combinators.test-d.ts` | Type tests: inspectable children, output inference, pinned literal types, `oneOf` union output. |
| `attribute-spec.test.ts` | The binder: positional and named binding, duplicates, optional and default values, `refine`, leaf purity, `interpretArgs`. |
| `attribute-spec.test-d.ts` | Output type inference for required, optional and positional parameters. |
| `attribute-spec-block.test.ts`, `attribute-spec-block.test-d.ts` | `blockAttribute` runtime and types; nullary `BlockAttributeSpecFactory`. |
| `attribute-spec-assembly.test.ts`, `attribute-spec-assembly.test-d.ts` | `assembleAttributeSpecs`; factory context types, including that a model factory is assignable to a field factory. |
| `attribute-spec-documentation.test.ts` | Documentation is kept on specs and parameters and not leaked into parsed output. |
| `parse-tagged-literal.test.ts` | Parser and canonicalization of tagged literals. |
| `symbol-table.block-attribute-traversal.test.ts` | Block attributes interpreted during symbol-table construction. |

SQL family (`packages/2-sql/2-authoring/contract-psl/test/`):

| File | What it covers |
| --- | --- |
| `sql-attribute-specs.test.ts` | Registry: every factory's name and level; key sets; `@relation` and `@@index` metadata (line 252 calls `sqlAttributeSpecs.model.index()` with no argument); `@default` arms from the registry, including `taggedLiteral` arms and their absence when no tag is registered. |
| `interpreter.index-naming.test.ts` | `@@index` naming and the argument matrix: `name`, `map`, `expression`, `where`, `unique`, `type`, exact-name warning. |
| `interpreter.diagnostics.test.ts` | Lines 1581-1640: `PSL_INDEX_FIELDS_XOR_EXPRESSION`, `PSL_INDEX_EXPRESSION_REQUIRES_NAME`, `PSL_INDEX_NAME_XOR_MAP`; line 1080: duplicate fields in `@@index`. |
| `interpreter.check-attribute.test.ts` | `@@check`: PSL and TS parity, the three `refine` codes, empty and whitespace expressions, STI variant, capability gating. |
| `interpreter.model-attribute-indexes.test.ts` | A contributed attribute that lowers to an index matches `@@index(expression:)`. |
| `ts-psl-parity.test.ts` | Lines 471-722: PSL and TS index parity for expression, full matrix, `map`, `name`, unnamed. |
| `interpreter.defaults.tagged-literal.test.ts` | `@default` tagged literal lowering: unknown tag, NUL, size limit, `json` tag, lowering tag in a list. |
| `interpreter.defaults.data-types.test.ts` | The ADR 254 cast rule for `@default`. |
| `fixture-data-types.ts`, `fixture-sql-tag.ts` | Test data types and a copy of the `sql` lowering entry. |

Postgres target:

| File | What it covers |
| --- | --- |
| `packages/3-targets/3-targets/postgres/test/psl-full-text-index.test.ts` | `@@fullTextIndex`: equivalence with `@@index(expression:)`, language, renamed column, `where` pass-through (line 154, written as `where: "id > 0"`), non-text and relation fields, one field, name and map rules. |
| `packages/3-targets/3-targets/postgres/test/migrations/full-text-index-planning.test.ts` | Planning of full-text indexes. |

Language server (`packages/1-framework/3-tooling/language-server/test/`):

| File | What it covers |
| --- | --- |
| `completion-values.test.ts` | Value completion from argument types, including the `rejecting` kind. |
| `completion-provider.test.ts` | End-to-end completion with the real SQL stack; lines 1186-1260 test tag completion in `@default`. |
| `completion-snippets.test.ts` | Required-argument snippets. |
| `signature-help.test.ts`, `signature-help-values.test.ts` | Signature rendering from specs. |
| `attribute-spec-consumability.test.ts` | The language server can enumerate and call registered factories with a built context. |
