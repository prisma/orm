---
changes:
  - id: field-types-expression-removed
    summary: |
      The emitter now writes `FieldOutputTypes` and `FieldInputTypes` for every family as `FieldTypesFromDomain` applied to the emitted contract, so the `fieldTypesExpression` hook of `EmissionSpi` is removed. A family emitter that implemented it must delete it; the framework declares `FieldTypeOverrides` and `ParameterizedOutputTypeFunctions` itself. The detection matches implementations of the hook.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bfieldTypesExpression\b'
  - id: field-types-generic-moved
    summary: |
      `FieldTypesFromDomain` and `ValueTypeSide` moved from the SQL family contract types entry to `@prisma/orm-framework/contract/types`, and the generic now types value object and union fields itself, from the namespace's `valueObjects`. Its arguments are `FieldTypesFromDomain<DomainNamespaces, CodecTypes, ParameterizedOutputs, Overrides, Side>`, where `Overrides` is one map keyed like the domain, `[namespace]['models' | 'valueObjects'][owner][field]`, each entry `{ output?, input? }`; `ValueObjectTypesFromDomain` takes the same map. A storage type map can type one entry with `StoredValueType` from the same entry. `ColumnTypesFromStorage` stays in the SQL family. Update imports. The detection matches imports of the generic from the SQL family.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'import type \{[^}]*\b(FieldTypesFromDomain|ValueTypeSide)\b[^}]*\} from ''[^'']*(sql-contract|family-sql/contract|family-contract)/types'''
  - id: resolve-field-value-set-renamed
    summary: |
      `EmissionSpi.resolveFieldValueSet` is renamed `resolveStorageValueSet`. The framework emitter now reads a field's value set itself when the field references a domain enum (`valueSet.plane` is `'domain'`), for model and value object fields alike, and no longer calls the hook for those fields. It calls `resolveStorageValueSet` only for other model fields, whose values the family keeps in its storage, such as a SQL column's value set. Rename the hook in a family emitter, and drop any handling of domain enum references from it. The detection matches implementations of the old hook.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bresolveFieldValueSet\s*[(:?]'
  - id: mongo-parameterized-output-types
    summary: |
      A Mongo-family pack whose codec output type depends only on a field's type parameters, such as `Vector<3>` for a vector of length 3, declares it once as a type function, as SQL packs do: export a `ParameterizedOutputTypesForTypeParams` interface extending `ParameterizedOutputTypesFunction` from its `codec-types` entry, name it in `types.codecTypes.parameterizedOutputTypes` where the codec types import is declared, and add `__parameterizedOutputTypes` to the pack metadata's type. `renderOutputType` is no longer used for such codecs: Mongo's vector codec no longer implements it, and a Mongo `defineContract` contract ignores it. Export the types the pack metadata names from its `/pack` entry, so an application that exports a contract can build declarations. The detection matches files that import a Mongo package and implement `renderOutputType`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@prisma/orm-(mongo|family-mongo|target-mongo)\b)[\s\S]*renderOutputType'
---

# One field type generic for every family

The emitted `contract.d.ts` of every family, and a contract built with `defineContract` in either family, now type their fields with one generic, `FieldTypesFromDomain` from `@prisma/orm-framework/contract/types`.

## Family emitters

Delete `fieldTypesExpression` from your `EmissionSpi`. The framework writes:

```ts
type FieldTypeOverrides = {
  readonly public: {
    readonly models: { readonly User: { readonly role: { readonly output: 'admin' | 'user'; readonly input: 'admin' | 'user' } } };
    readonly valueObjects: { readonly Address: { readonly kind: { readonly output: 'home' | 'work'; readonly input: 'home' | 'work' } } };
  };
};
export type FieldOutputTypes = FieldTypesFromDomain<ContractBase['domain']['namespaces'], CodecTypes, ParameterizedOutputTypeFunctions, FieldTypeOverrides, 'output'>;
```

Import `FieldTypesFromDomain` and `ValueTypeSide` from `@prisma/orm-framework/contract/types`. For a storage map, apply `StoredValueType` to each entry, as `ColumnTypesFromStorage` does.

## Mongo-family packs with parameterized output types

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

Name it next to the codec types import:

```ts
types: {
  codecTypes: {
    import: { package: 'my-pack/codec-types', named: 'CodecTypes', alias: 'MyTypes' },
    parameterizedOutputTypes: {
      package: 'my-pack/codec-types',
      named: 'ParameterizedOutputTypesForTypeParams',
      alias: 'MyParameterizedOutputTypes',
    },
  },
},
```

Add `readonly __parameterizedOutputTypes?: ParameterizedOutputTypesForTypeParams` to the pack metadata's type, remove the codec's `renderOutputType` and any `typeImports` entry it needed, and export `CodecTypes`, `ParameterizedOutputTypesForTypeParams` and the types they name from the pack's `/pack` entry.
