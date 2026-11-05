---
changes:
  - id: mongo-result-shapes-read-storage
    summary: |
      `contractModelToMongoResultShape` and `contractFieldToMongoFieldShape` from `@prisma/orm-mongo/query-builder` take the contract's storage, `{ storage: contract.storage }` and `contract.storage`, instead of its value objects. `compileMongoQuery` from `@prisma/orm-mongo/orm` takes the contract's storage as its fifth argument. `MongoValueObjects` is removed. This replaces the rc.14 advice to pass `valueObjects`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bMongoValueObjects\b'
        - '\bcontractModelToMongoResultShape\s*\([\s\S]*?\bvalueObjects\b'
        - '\bcontractFieldToMongoFieldShape\s*\('
        - '\bcompileMongoQuery\s*\('
  - id: postgres-check-expression-types-move
    summary: |
      `PostgresCheckKind`, `PostgresCheckExpressionInput` and `PostgresCheckExpressionCandidate` are removed from `@prisma/orm-postgres/target/types`. Use `CheckExpressionInput` and `CheckExpressionCandidate` from `@prisma/orm-postgres/family-contract/check-expressions` (also exported at the same path by `@prisma/orm-mysql` and `@prisma/orm-sqlite`). A candidate's `kind` is `'membership'`, `'elementNotNull'` or the new `'shape'`, the check of a value object column's shape.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bPostgresCheck(?:Kind|ExpressionInput|ExpressionCandidate)\b'
  - id: field-types-read-storage-value-objects
    summary: |
      In `@prisma/orm-framework/contract/types`, `ValueObjectTypesFromDomain` is now `ValueObjectTypesFromStorage`, which takes the contract's storage namespaces. `FieldTypesFromDomain` takes the storage namespaces as a new, required sixth argument, `Contract['storage']['namespaces']`, since it reads both planes. An override for a value object field is keyed by the value object's storage namespace, at `[storage namespace]['valueObjects'][valueObject][field]`, while a model field's override stays keyed by its domain namespace.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bValueObjectTypesFromDomain\b'
        - '\bFieldTypesFromDomain\s*<'
  - id: value-object-reference-type
    summary: |
      In `@prisma/orm-framework/contract/types`, `ValueObjectFieldType` is renamed `ValueObjectReference`: the type of a field that refers to a value object, which is now the value object's storage coordinate. `ContractValueObjectField` stays the type of a value object's own field.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bValueObjectFieldType\b'
  - id: postgres-codec-json-type
    summary: |
      A PostgreSQL codec descriptor declares `jsonType`: the JSON type the codec's value is written as inside a JSON document, one of `'string'`, `'number'`, `'boolean'`, `'object'`, `'array'` or `'any'`. `'any'` means any JSON value, including `null`, as for a JSON codec. The derived check of a value object column requires a member to be of its codec's JSON type, and a required member is never JSON `null` unless its codec's type is `'any'`. A class that extends `PostgresCodecDescriptor`, or an object that implements `AnyPostgresCodecDescriptor`, declares it as a property. `postgresCodec(template, options)` reads it from the template, so a family codec template declares it. A registry accepts a descriptor without it, but a contract build that derives the check of a value object whose member uses such a codec refuses it with `CONTRACT.CODEC_JSON_TYPE_MISSING`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bextends\s+PostgresCodecDescriptor\b'
        - '\bAnyPostgresCodecDescriptor\b'
        - '\bpostgresCodec\s*\('
---

# Value objects are storage entities

A contract keeps its value objects in storage, at `storage.namespaces.<ns>.entries.valueObject`, and a domain field names its value object by a storage coordinate. Code that read `domain.namespaces.<ns>.valueObjects` reads the storage namespaces instead.

## `mongo-result-shapes-read-storage`

```ts
// before
contractModelToMongoResultShape(model, { includes: { author: authorShape }, valueObjects });
contractFieldToMongoFieldShape(field, valueObjects);
compileMongoQuery(collection, state, storageHash, model, valueObjects);

// after
contractModelToMongoResultShape(model, { includes: { author: authorShape }, storage: contract.storage });
contractFieldToMongoFieldShape(field, contract.storage);
compileMongoQuery(collection, state, storageHash, model, contract.storage);
```

A value object field's shape is a document of its fields when `storage` holds the value object the field's coordinate names. Drop any `MongoValueObjects` type annotation; each parameter takes an object with the contract's storage `namespaces`.

## `postgres-check-expression-types-move`

```ts
// before
import type { PostgresCheckExpressionInput } from '@prisma/orm-postgres/target/types';

// after
import type { CheckExpressionInput } from '@prisma/orm-postgres/family-contract/check-expressions';
```

`postgresRenderCheckExpressions` stays in `@prisma/orm-postgres/target/types`. Its input also takes `valueObject`, a `ResolvedColumnValueObject` (the column's nullability, whether its JSON value is an array, and the value object), or `undefined`.

## `field-types-read-storage-value-objects`

```ts
// before
import type { FieldTypesFromDomain, ValueObjectTypesFromDomain } from '@prisma/orm-framework/contract/types';
type Fields = FieldTypesFromDomain<Contract['domain']['namespaces'], CodecTypes, Parameterized, Overrides, 'output'>;
type ValueObjects = ValueObjectTypesFromDomain<Contract['domain']['namespaces'], CodecTypes, Parameterized, Overrides, 'output'>;

// after
import type { FieldTypesFromDomain, ValueObjectTypesFromStorage } from '@prisma/orm-framework/contract/types';
type Fields = FieldTypesFromDomain<Contract['domain']['namespaces'], CodecTypes, Parameterized, Overrides, 'output', Contract['storage']['namespaces']>;
type ValueObjects = ValueObjectTypesFromStorage<Contract['storage']['namespaces'], CodecTypes, Parameterized, Overrides, 'output'>;
```

Pass the sixth argument for every contract, with value objects or without. `FieldTypeOverrides` has two kinds of key at its top level. Under `models`, the key is the domain namespace of the model. Under `valueObjects`, the key is the storage namespace that holds the value object. These can differ. On SQL every value object is stored in the default storage namespace, such as `public` on Postgres, whatever the namespace of the model that holds it. On MongoDB it is `__unbound__`.

```ts
// a model `User` in the PSL namespace `billing`, with an `Address` field, on Postgres
type FieldTypeOverrides = {
  readonly billing: { readonly models: { readonly User: { readonly status: { readonly output: 'active' | 'closed' } } } };
  readonly public: { readonly valueObjects: { readonly Address: { readonly kind: { readonly output: 'home' | 'work' } } } };
};
```

## `value-object-reference-type`

```ts
// before
import type { ValueObjectFieldType } from '@prisma/orm-framework/contract/types';
const reference: ValueObjectFieldType = { kind: 'valueObject', name: 'Address' };

// after
import type { ValueObjectReference } from '@prisma/orm-framework/contract/types';
const reference: ValueObjectReference = {
  kind: 'valueObject',
  plane: 'storage',
  namespaceId: 'public',
  entityKind: 'valueObject',
  entityName: 'Address',
};
```

## `postgres-codec-json-type`

```ts
// before
export class CitextDescriptor extends PostgresCodecDescriptor<void> {
  override readonly codecId = 'citext/text@1';
  // ...
}

// after
export class CitextDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'string' as const;
  override readonly codecId = 'citext/text@1';
  // ...
}
```

Declare the type the codec's value is written as when the application value is turned into JSON: a vector is `'array'`, a geometry and bytes are `'object'`, and a JSON codec is `'any'`. A template passed to `postgresCodec(template, options)` declares `jsonType` itself, as the `sql/*` family codecs do.
