---
changes:
  - id: sql-target-declares-integer-argument-generators
    summary: |
      The SQL family no longer declares the signatures of `uuid`, `cuid` and `nanoid`, because their arguments are now values of the target's integer data type, which only the target knows. A SQL target declares them by spreading `sqlIntegerArgumentGeneratorFunctions({ integer })` from `@prisma/orm-family-sql/family/pack` into its `generatorFunctions`, on both its pack ref and its control descriptor. Without it, composing a stack fails with `CONTRACT.PACK_CONTRIBUTION_INVALID`: `"sql" binds generator function "uuid", which no component declares.` The detection matches files that bind the identifier generator functions.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\s\S])(?![\s\S]*\bsqlIntegerArgumentGeneratorFunctions\b)[\s\S]*\bidGeneratorFunctionBindings\('
  - id: generator-signature-from-data-types
    summary: |
      The `signature` of a `GeneratorFunctionContribution`, like that of a default function in a `defaultFunctionRegistry` entry, may now be a function of the stack's data types that returns the `FuncCallSig`. Code that reads a contribution's `signature` as a `FuncCallSig` builds the call with `generatorFunctionCall(name, signature, dataTypes)` from `@prisma/orm-framework/psl-parser`, and a default function's with `defaultFunctionCall(name, entry, dataTypes)` from `@prisma/orm-family-sql/contract-psl/attribute-specs`. A plain object still works.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\b(?:defaultFunctionRegistry|generatorFunctions)\b)[\s\S]*\.signature\b'
  - id: generator-function-field-length
    summary: |
      The column a generator function binding resolves for, `GeneratorFunctionField` (`@prisma/orm-framework/components/components`), has a required `length` key: the column's length in its data type's normal form, so a bare `Char` gives 1, or `undefined` for a column with no length or one whose database does not limit it, such as SQLite's. Code that calls `resolve` or `callFor` on a generator function registry passes it; for a SQL column, `sqlCodecColumnLength(dataTypes, codecId, typeParams)` from `@prisma/orm-family-sql/contract/data-type` computes it. The built-in identifier bindings refuse a column shorter than what they write, and a binding of your own can read `length` to do the same. The detection matches files that call the registry's `resolve` or `callFor`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bgeneratorFunctions\.(?:resolve|callFor)\('
  - id: build-contract-definition-takes-lookups
    summary: |
      `buildContractDefinition` (`@prisma/orm-family-sql/contract-ts/contract-builder`) now requires `codecLookup` and `dataTypeLookup`, the same lookups `buildSqlContractFromDefinition` takes, so that each `.onCreate(...)` and `.onUpdate(...)` call is checked against its column's length. Pass them in the definition. The detection matches files that call `buildContractDefinition`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bbuildContractDefinition\('
  - id: arg-binding-spec-label
    summary: |
      `ArgBindingSpec` (`@prisma/orm-framework/psl-parser`), the second argument of `interpretArgs`, names its callee with `label`, the whole phrase such as `Attribute "rel"`, instead of `name`. `funcCall(name, signature, { label })` takes the phrase its binding diagnostics use; without it they say `Attribute "<name>"` as before.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '\binterpretArgs\s*\('
        - '\bArgBindingSpec\b'
  - id: one-of-refuses-data-type-value
    summary: |
      `oneOf` (`@prisma/orm-framework/psl-parser`) throws an `InternalError` when one of its arms is a `dataTypeValue`. Give the value its own parameter, or use it as a parameter of a `funcCall` arm.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '\boneOf\([^;]*\bdataTypeValue\('
  - id: text-data-types
    summary: |
      A component's authoring contributions may name `textDataTypes`, the data types whose values are text; a SQL target names its own. A SQL `@@discriminator` field must be stored in one of them. An extension that adds a text type names it there to make it a discriminator.
---

## `sql-target-declares-integer-argument-generators`

```ts
// Before
generatorFunctions: [
  ...idGeneratorFunctionBindings({ text: [MY_TEXT_CODEC_ID] }),
],

// After
import {
  idGeneratorFunctionBindings,
  sqlIntegerArgumentGeneratorFunctions,
} from '@prisma/orm-family-sql/family/pack';

generatorFunctions: [
  ...sqlIntegerArgumentGeneratorFunctions({ integer: myInt4.id }),
  ...idGeneratorFunctionBindings({ text: [MY_TEXT_CODEC_ID] }),
],
```

`integer` is the id of your target's 32-bit integer data type. An argument such as the `7` of `uuid(7)` is read and cast as a value of that type, as a column default is, then checked by the function: `uuid` takes 4 or 7, `cuid` takes 2, and `nanoid` takes 2 through 255. The `gen` helpers of a TypeScript contract keep their argument types.

## `generator-signature-from-data-types`

```ts
// Before
const arm = funcCall(contribution.name, contribution.signature as FuncCallSig);

// After
import { generatorFunctionCall } from '@prisma/orm-framework/psl-parser';

const arm = generatorFunctionCall(contribution.name, contribution.signature, dataTypes);
```

A function you declare can keep a plain `FuncCallSig`. Write it as `(dataTypes) => FuncCallSig` when an argument is a value of a data type, read with `dataTypeValue(type, dataTypes)`.

## `generator-function-field-length`

```ts
// Before
generatorFunctions.resolve(call, { codecId, typeParams });

// After
import { sqlCodecColumnLength } from '@prisma/orm-family-sql/contract/data-type';

generatorFunctions.resolve(call, {
  codecId,
  typeParams,
  length: sqlCodecColumnLength(dataTypes, codecId, typeParams),
});
```

A binding of your own reads the length:

```ts
const binding: GeneratorFunctionBinding = {
  codecIds: ['pg/text@1', 'sql/char@1'],
  generatorIds: ['slugid'],
  resolve: ({ field }) =>
    field.length !== undefined && field.length < 22
      ? { ok: false, message: `slugid() writes 22 characters, which does not fit a column of ${field.length} characters.` }
      : { ok: true, generator: { kind: 'generator', id: 'slugid' } },
  printArguments: () => ({ args: {}, text: '' }),
};
```

## `build-contract-definition-takes-lookups`

```ts
// Before
const definition = buildContractDefinition({ family, target, createNamespace, models });

// After
const definition = buildContractDefinition({
  family,
  target,
  createNamespace,
  codecLookup,
  dataTypeLookup,
  models,
});
```

## `arg-binding-spec-label`

```ts
// Before
interpretArgs(args, { name: 'rel', positional, named }, ctx, span, node);

// After
interpretArgs(args, { label: 'Attribute "rel"', positional, named }, ctx, span, node);
```

## `one-of-refuses-data-type-value`

```ts
// Before
type: oneOf(str(), dataTypeValue(pgInt4.id, dataTypes)),

// After: a value of a data type is its own parameter
type: dataTypeValue(pgInt4.id, dataTypes),
```

## `text-data-types`

```ts
authoring: {
  textDataTypes: [citext.id],
},
```
