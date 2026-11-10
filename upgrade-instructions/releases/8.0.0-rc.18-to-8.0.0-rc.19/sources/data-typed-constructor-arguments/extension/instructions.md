---
changes:
  - id: value-arguments-name-a-data-type
    summary: |
      A type constructor's argument that is a value is declared `{ kind: 'value', dataType }`,
      naming the data type the argument's value belongs to, such as `pg/int4` for a Postgres length,
      precision, scale or SRID. The argument kinds `string`, `boolean` and `stringArray` are
      removed, and a type constructor's `number` argument becomes a `value` argument. Drop
      `integer`, `minimum` and `maximum`: the data type's parameter schema checks the value.
      Assembly refuses a type constructor argument of any other kind, `option` and `object`
      included. A field preset keeps its `number`, `option` and `object` arguments, so a match
      inside a field preset needs no change.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'kind:\s*[''"](?:number|string|boolean|stringArray)[''"](?=[^}]*\b(?:name|integer|minimum|maximum|optional)\s*:)'
        - '\b(?:name|integer|minimum|maximum|optional)\s*:[^{}]*\bkind:\s*[''"](?:number|string|boolean|stringArray)[''"]'
        - '\{\s*kind:\s*[''"](?:number|string|boolean|stringArray)[''"]\s*\}'
  - id: value-argument-types-in-typescript
    summary: |
      The TypeScript builder types a `value` argument through `__dataTypeArguments`, a map a pack
      declares in its type from each data type it registers to `{ argument, parameter }`: the
      TypeScript value an author passes, and the type parameter it gives. A pack that registers a
      data type its own type constructors take must declare it, or the argument types as `never`.
      The TypeScript builder reads value arguments only with the data types and authoring entries
      the composed packs register, so every data type an argument takes must be registered, with
      a writable `authoring.dataTypes` entry, by some pack in the stack: the family, the target or
      an extension. An extension whose arguments take a target's data type, such as `pg/int4`,
      registers nothing; registering it again is refused as a duplicate.
  - id: psl-and-print-helpers-take-data-types
    summary: |
      `mapPslHelperArgs` and `instantiatePslFieldPreset` take the stack's `dataTypes`;
      `parsePslPositionalArgs` and `pslTypeArgumentText` are removed. `inferColumnTypes` takes
      `dataTypes`, and its `PslTypeCall` carries the argument `values`. `writtenTypeArguments` writes
      a call's arguments as literals of their data types. `sql.String` is no longer in the SQL
      family pack: a SQL target contributes it with `sqlTargetTypeConstructors({ sizeType })` from
      `family/pack`, and `temporalCodecPresetWithPrecision` takes `sizeType` too.
      `temporalCodecPresetWithPrecision` and `temporalStringAuthoringPresets` move from
      `family/control` to `family/pack`, so a target pack does not load the family's control
      entry point. `assembleAuthoringDataTypes` moves from `components/control` to
      `components/authoring`, beside `assembleDataTypeSupport`, which builds a `DataTypeSupport`
      from a list of components and checks their value arguments.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'parsePslPositionalArgs|pslTypeArgumentText'
        - 'import\s*(?:type\s*)?\{[^}]*\b(?:assembleAuthoringDataTypes|temporalCodecPresetWithPrecision|temporalStringAuthoringPresets)\b[^}]*\}\s*from\s*[''"][^''"]*/(?:components|family|family-sql)/control[''"]'
  - id: composed-helpers-take-no-data-type-lookup
    summary: |
      `createComposedAuthoringHelpers` no longer takes `dataTypeLookup`. It builds its data types
      from the family, target and extension packs it is given, with `assembleDataTypeSupport`.
      Remove the option. Every data type an argument takes must be registered, with an
      `authoring.dataTypes` entry, by some pack in the stack; an extension whose arguments take a
      target's data type, such as `pg/int4`, registers nothing.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'createComposedAuthoringHelpers\(\{[^}]*\bdataTypeLookup\b'
  - id: helper-codec-invariants
    summary: |
      `enforceDataTypeInvariants` is renamed `enforceHelperCodecInvariants`, and
      `DataTypeInvariantInput` is renamed `HelperCodecInvariantInput`. It now checks only type
      constructors and field presets against the stack's codecs, and takes `lookup`, `helpers`
      (formerly `constructors`) and `codecDescriptorFor`. `declaredTypes`, `codecs` and
      `authoringEntries` are removed: `assembleDataTypeSupport` checks data types, their entries,
      casts and written forms, through `enforceDataTypeAssemblyInvariants`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'enforceDataTypeInvariants|DataTypeInvariantInput'
---

# Type-constructor arguments are values of data types

## `value-arguments-name-a-data-type`

An argument is read as a value of its data type, through the same read and cast as an attribute argument (ADR 254), in PSL and in the TypeScript builder. Name the data type the argument takes:

```ts
// Before
Vector: {
  kind: 'typeConstructor',
  args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, maximum: 16000 }],
  output: { codecId: 'pg/vector@1', typeParams: { length: { kind: 'arg', index: 0 } } },
},

// After
Vector: {
  kind: 'typeConstructor',
  args: [{ kind: 'value', dataType: 'pg/int4', name: 'length' }],
  output: { codecId: 'pg/vector@1', typeParams: { length: { kind: 'arg', index: 0 } } },
},
```

Move any bound the argument carried to the data type's `params` schema, which the codec's `paramsSchema` references. A string argument becomes a value of the data type it names; an argument that holds SQL, such as a type name, is a value of `sql/expression`, written ``sql`...` ``. The data type must be registered in the stack and written by some authoring entry, itself or through a type it casts from: assembly refuses a value argument otherwise, with `CONTRACT.DATA_TYPE_UNREGISTERED` or `CONTRACT.DATA_TYPE_NOT_WRITABLE`. A type constructor argument still declared with another kind, `option` and `object` included, is refused when the stack is assembled, with `CONTRACT.PACK_CONTRIBUTION_INVALID` naming the constructor and the argument.

A field preset's `number`, `option` and `object` arguments are unchanged; convert only a type constructor's arguments. Detection cannot tell the two apart, so it also reports a field preset's arguments: leave those as they are, including the properties of an `object` argument.

## `value-argument-types-in-typescript`

A target or extension that registers a data type its arguments take declares the TypeScript value in its pack's type, beside `__codecTypes`:

```ts
export const myTargetPack: typeof myTargetPackBase & {
  readonly __codecTypes?: CodecTypes;
  readonly __dataTypeArguments?: {
    readonly 'my/int': { readonly argument: number; readonly parameter: number };
  };
} = myTargetPackBase;
```

`argument` is what an author passes to the helper, and `parameter` is the type parameter the data type's reader gives for it, which the column's type is built from. An extension whose arguments take the target's types, such as `pg/int4`, declares nothing.

To type a descriptor of a value argument on its own, use `AuthoringValueArgument` from `components/authoring`; it now includes `name` and `optional`.

## `psl-and-print-helpers-take-data-types`

Pass the stack's `DataTypeSupport` to `mapPslHelperArgs({ ..., dataTypes })` and `instantiatePslFieldPreset({ ..., dataTypes })`. Replace `parsePslPositionalArgs` with the values of the call you built, and `pslTypeArgumentText` with `writtenTypeArguments(descriptor, args, dataTypes)`. A SQL target spreads `sqlTargetTypeConstructors({ sizeType: '<its size data type>' })` from `@prisma/orm-family-sql/family/pack` into its type namespace, and passes the same `sizeType` to `temporalCodecPresetWithPrecision`. Import `temporalCodecPresetWithPrecision` and `temporalStringAuthoringPresets` from `family/pack` too; `family/control` no longer exports them. The size type is the data type of a length or a precision: `pg/int4` on Postgres.

Import `assembleAuthoringDataTypes` from `components/authoring` instead of `components/control`. To build the data types a set of components reads values with, call `assembleDataTypeSupport(components, dataTypeOfCodec)`; it refuses a duplicate data type or entry, and a value argument whose data type is unregistered or that nothing writes.

## `composed-helpers-take-no-data-type-lookup`

Drop `dataTypeLookup` from the options of `createComposedAuthoringHelpers`:

```ts
// Before
createComposedAuthoringHelpers({ family, target, extensions, codecLookup, dataTypeLookup });

// After
createComposedAuthoringHelpers({ family, target, extensions, codecLookup });
```

The helpers read value arguments, and build entity helpers, with the data types the packs register. An argument whose data type no pack in the stack registers now fails with `CONTRACT.DATA_TYPE_UNREGISTERED`. Register it, with an `authoring.dataTypes` entry, in the pack that owns it. An extension whose arguments take a target's data type, such as `pg/int4`, registers nothing: the target already does, and a second registration is refused as a duplicate.

## `helper-codec-invariants`

Rename the call and pass the type constructors and field presets as `helpers`:

```ts
// Before
enforceDataTypeInvariants({ lookup, declaredTypes, codecs, authoringEntries, constructors, codecDescriptorFor });

// After
enforceHelperCodecInvariants({ lookup, helpers, codecDescriptorFor });
```

The checks on data types, entries, casts and written forms now run when you build data types with `assembleDataTypeSupport(components, dataTypeOfCodec)` from `components/authoring`; call it with the same components instead of passing `declaredTypes`, `codecs` and `authoringEntries`.

