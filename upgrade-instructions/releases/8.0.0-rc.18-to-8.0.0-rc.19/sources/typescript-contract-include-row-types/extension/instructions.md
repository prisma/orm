---
changes:
  - id: typescript-contract-pack-type-slots
    summary: |
      A contract built with `defineContract` reads its types from the packs in it. A third-party SQL pack is typed fully for such a contract only when it declares what an emitted `contract.d.ts` would get from its codecs and descriptors: `__queryOperationTypes` for its query operations, `__parameterizedOutputTypes` for codecs whose output type depends on their type parameters, literal-typed `types.aggregateDescriptors` for its aggregates, and exports from its `/pack` entry for the types an application's exported contract names. Nothing breaks for a pack that does none of this; its operations, refined output types and aggregates are missing from a `defineContract` contract's types, as before. The detection matches SQL pack metadata that declares codec types.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '__codecTypes\?:'
  - id: parameterized-output-types-declared-once
    summary: |
      A codec whose output type depends only on its column's type parameters, such as `Vector<3>` for `vector(3)`, declares that type once, as a type function the pack exports, and no longer implements `renderOutputType`. The emitted `contract.d.ts` applies the type function, and so does a contract built with `defineContract`. A pack must name the function twice: in its codec types' metadata as `types.codecTypes.parameterizedOutputTypes`, an import spec like `types.codecTypes.import`, which the emitter reads, and in its pack metadata's type as `__parameterizedOutputTypes`, which `defineContract` reads; if one is missing, that path types the column by the codec's plain output type without an error. `ParameterizedOutputTypesFunction` comes from `@prisma/orm-framework/contract/types`. A `renderOutputType` that writes such a type still works for the emitted file but is ignored by `defineContract`; remove it, with the `typeImports` entry it needed, once the type function exists. Keep `renderOutputType` only for a type no type function can compute, such as an arktype schema's text. The detection matches codec descriptors that implement `renderOutputType`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'renderOutputType\('
        - 'renderOutputType:'
  - id: psl-interpreter-contract-capabilities
    summary: |
      `interpretPslDocumentToSqlContract` now writes the enabled capabilities it is given in `capabilities` into the contract it returns, joined with the target's and the extensions', so a contract read from PSL carries its adapter's capabilities as one built with `defineContract` does. Before, it used them only to check the schema and left them out of the contract. Code that called it directly and compared the contract's `capabilities` to the target's and extensions' alone now also sees the ones it passed in. The detection matches calls of the interpreter.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'interpretPslDocumentToSqlContract\('
---

# Make a SQL pack fully typed for contracts written in TypeScript

A contract built with `defineContract` now has the same types as the `contract.d.ts` that `prisma contract emit` writes for it. The emitter reads a pack's codecs and descriptors at run time. A contract written in TypeScript has only the pack's types, so a pack states as types what the emitter derives. `QueryOperationTypesFunction` is exported from `@prisma/orm-family-sql/contract/types`, and `ParameterizedOutputTypesFunction` from `@prisma/orm-framework/contract/types`.

## Query operations: `__queryOperationTypes`

If your pack contributes query operations and exports a `QueryOperationTypes<CodecTypes>` type for its emitted `contract.d.ts`, declare it as a type-level function of the contract's codec types and add it to the pack metadata's type:

```ts
import type { QueryOperationTypesFunction } from '@prisma/orm-family-sql/contract/types';

export interface QueryOperationTypesForCodecs extends QueryOperationTypesFunction {
  readonly queryOperationTypes: QueryOperationTypes<this['codecTypes']>;
}

export const myPackMeta: typeof myPackMetaBase & {
  readonly __codecTypes?: CodecTypes;
  readonly __queryOperationTypes?: QueryOperationTypesForCodecs;
} = myPackMetaBase;
```

## Output types that depend on type parameters: one type function

If a codec's output type depends on the column's type parameters, such as `Vector<3>` for `vector(3)`, write that mapping once, as a type-level function of the type parameters, and export it from your pack's `codec-types` entry:

```ts
import type { ParameterizedOutputTypesFunction } from '@prisma/orm-framework/contract/types';

type OutputTypeMap<TypeParams> = {
  readonly 'my/vector@1': TypeParams extends { readonly length: infer N extends number }
    ? Vector<N>
    : never;
};

export interface ParameterizedOutputTypesForTypeParams extends ParameterizedOutputTypesFunction {
  readonly outputTypes: OutputTypeMap<this['typeParams']>;
}
```

Name it in two places:

- In the pack metadata's type, as `readonly __parameterizedOutputTypes?: ParameterizedOutputTypesForTypeParams`. A contract built with `defineContract` reads it there.
- In the metadata of the component that contributes the codecs, as `types.codecTypes.parameterizedOutputTypes: { package: '<your package>/codec-types', named: 'ParameterizedOutputTypesForTypeParams', alias: 'MyParameterizedOutputTypes' }`. The emitted `contract.d.ts` imports it and types each column with type parameters through it.

Declare both. With only `__parameterizedOutputTypes`, the emitted `contract.d.ts` types such a column by the codec's plain output type; with only `types.codecTypes.parameterizedOutputTypes`, a contract built with `defineContract` does. Nothing reports the gap, so check a column on both paths.

Then delete the codec's `renderOutputType`, and the `typeImports` entry that existed only so the emitted file could name its result (such as `Vector`). A codec the map leaves out, or maps to `never` for some type parameters, keeps its plain output type. Keep `renderOutputType` only for a type that no type function can compute from the type parameters, such as the text of an arktype schema.

```diff
  class MyVectorDescriptor extends PostgresCodecDescriptor<{ readonly length: number }> {
    override readonly codecId = 'my/vector@1' as const;
-   override renderOutputType({ length }: { length: number }) {
-     return `Vector<${length}>`;
-   }
  }
```

A column helper that returns a column spec, built with `column(factory, codecId, typeParams)`, needs no entry: a `defineContract` contract reads the field's output type and codec id from the codec the factory builds.

## Aggregates: literal `types.aggregateDescriptors`

The aggregate result types of a `defineContract` contract are settled from the `types.aggregateDescriptors` of the target, the adapter and every extension, against the contract's codecs, as emission settles them. Only descriptors whose `operation`, input codec ids or traits, output codec id and `nullable` are literal types take part. Declare the list with `as const` and no annotation that widens it:

```ts
export const myAggregateDescriptors = [
  {
    operation: 'bitOr',
    input: { kind: 'codec', codecId: 'pg/int4@1' },
    output: { kind: 'codec', codecId: 'pg/int8@1' },
    nullable: true,
  },
] as const;
```

If you build descriptors with helper functions, make the helpers generic with `const` type parameters and do not use `satisfies` inside them: TypeScript widens a generic helper's result to its constraint when its returned object has a `satisfies` clause. Check the list against the descriptor type where you use it, for example `types: { aggregateDescriptors: myAggregateDescriptors satisfies ReadonlyArray<SqlAggregateDescriptor> }`.

## Index helpers: say what the build writes

A contract built with `defineContract` types each index from the `IndexConstraint` a helper returns, so code reads it by name and passes it to query operations. `IndexConstraint` takes a third type parameter, the index's `map` name, type and options as the build writes them. If your pack adds an index helper, return `IndexConstraint<FieldNames, Name, { readonly map: Map; readonly type: 'yourType'; readonly options: Options }>` with literal types. When the options name fields that the build turns into column names, give an interface extending `IndexOptionsFunction` from `@prisma/orm-family-sql/contract-ts/contract-builder`, whose `options` reads `this['columnOf']`, the model's field-to-column map. See `fullTextIndex` in the Postgres pack.

## Declaration output: export what a contract names

An application that exports a contract and builds with `declaration: true` needs TypeScript to name every type the contract's inferred type mentions. Export from your pack's `/pack` entry, as types, the types that end up there: your `CodecTypes`, the output types your type function gives (such as `Vector`), `QueryOperationTypesForCodecs`, `ParameterizedOutputTypesForTypeParams`, and the value types your codec types name (such as a GeoJSON `Geometry`). Naming `CodecTypes` also keeps TypeScript from inlining codec classes with private members, which fails with TS4094. Compile a small application that imports only your published package and the public `@prisma/orm-postgres` with `declaration: true` to check.

## PSL contracts carry the capabilities they are read with

`interpretPslDocumentToSqlContract` puts the enabled capabilities you pass in `capabilities`, usually the composed stack's, into the contract's `capabilities`, together with the target's and the extensions'. If you call it directly, expect the adapter's capabilities in the result, and pass the stack's capabilities if you build a contract to compare with one written in TypeScript or emitted by `prisma contract emit`.
