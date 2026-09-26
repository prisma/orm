---
changes:
  - id: mongo-codec-subpaths-move-to-target
    summary: |
      The Mongo codec subpaths moved from the adapter to the target:
      `adapter/codec-types`, `adapter/codecs`, `adapter/codec-ids` and `adapter/data-types` under
      `@prisma/orm-mongo` and `@prisma/orm-target-mongo` are now `target/...`. Emitted
      `contract.d.ts` files, including migration snapshots, import `adapter/codec-types` and no
      longer compile until rewritten or re-emitted.
    detection:
      glob: "**/*.{ts,mts,cts,md}"
      matches:
        - '@prisma/orm-(?:target-)?mongo/adapter/(?:codec-types|codecs|codec-ids|data-types)(?![\w-])'
  - id: create-mongo-runner-deps-removed
    summary: |
      `createMongoRunnerDeps(...)` is removed from `@prisma/orm-mongo/adapter/control`. Build the
      runner dependencies with `new MongoControlAdapterImpl().createRunnerDependencies(controlDriver)`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bcreateMongoRunnerDeps\b'
  - id: mongo-runner-dependency-types-move-to-family
    summary: |
      `MongoRunnerDependencies` and `MarkerOperations` are no longer exported from
      `adapter/control` or `target/control`; import them from `@prisma/orm-mongo/family/control-adapter`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:MongoRunnerDependencies|MarkerOperations)\b[^;]*?from\s*[''"]@prisma/orm-(?:target-)?mongo/(?:adapter|target)/control[''"]'
  - id: mongo-create-runner-needs-adapter-on-stack
    summary: |
      `mongoTargetDescriptor.migrations.createRunner(family)` now reaches the database through the
      control adapter on the family's control stack. A family instance created from an empty
      stack (`createMongoFamilyInstance({} as ...)`), or from a `createControlStack(...)` with no
      `adapter`, fails with "Mongo family requires an adapter descriptor in ControlStack" when the
      runner executes.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'createMongoFamilyInstance\(\s*\{\s*\}'
        - 'createControlStack\(\s*\{(?:(?!adapter)[^}])*mongoTargetDescriptor(?:(?!adapter)[^}])*\}\s*\)'
  - id: mongo-psl-scalar-names
    summary: |
      Four Mongo PSL scalar names are deprecated in favour of the name of the BSON type they store:
      `Int` → `Int32`, `Float` → `Double`, `Boolean` → `Bool`, `DateTime` → `Date`. The old names
      are still accepted, with a `PSL_DEPRECATED_SCALAR_NAME` warning, and will be removed in a later
      release; rename them now. Codec ids, `contract.json` and every hash are unchanged.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?:^|\n)[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]+(?:Int|Float|Boolean|DateTime)(?:\[\])?\??(?![ \t]*\{)(?=\s|$)'
---

## `mongo-codec-subpaths-move-to-target`

The Mongo target package owns the codecs now. Rewrite each specifier, in every file that names it (source, emitted `contract.d.ts`, the `contract.d.ts` in each `migrations/snapshots/<hash>/` directory, and docs):

| Before | After |
| --- | --- |
| `@prisma/orm-mongo/adapter/codec-types` | `@prisma/orm-mongo/target/codec-types` |
| `@prisma/orm-mongo/adapter/codecs` | `@prisma/orm-mongo/target/codecs` |
| `@prisma/orm-mongo/adapter/codec-ids` | `@prisma/orm-mongo/target/codec-ids` |
| `@prisma/orm-mongo/adapter/data-types` | `@prisma/orm-mongo/target/data-types` |
| `@prisma/orm-target-mongo/adapter/<same four>` | `@prisma/orm-target-mongo/target/<same four>` |

The exported names are unchanged. For the application's own `contract.d.ts`, running `prisma contract emit` produces the same result as the rewrite. Snapshot `contract.d.ts` files under `migrations/snapshots/` are not re-emitted, so rewrite them. The contract JSON and every hash stay the same.

## `create-mongo-runner-deps-removed`

```ts
// before
import { createMongoRunnerDeps, extractDb } from '@prisma/orm-mongo/adapter/control';
import { MongoDriverImpl } from '@prisma/orm-mongo/driver';
const runner = new MongoMigrationRunner(
  createMongoRunnerDeps(controlDriver, MongoDriverImpl.fromDb(extractDb(controlDriver)), family),
);

// after
import { MongoControlAdapterImpl } from '@prisma/orm-mongo/adapter/control';
const runner = new MongoMigrationRunner(
  new MongoControlAdapterImpl().createRunnerDependencies(controlDriver),
);
```

Drop imports that are now unused (`extractDb`, `MongoDriverImpl`, `createMongoFamilyInstance`) and any family instance built only to pass as the third argument.

## `mongo-runner-dependency-types-move-to-family`

Change the import of `MongoRunnerDependencies` or `MarkerOperations` to `@prisma/orm-mongo/family/control-adapter`. The shapes are unchanged.

## `mongo-create-runner-needs-adapter-on-stack`

Build the family instance from a control stack that includes the Mongo adapter:

```ts
import mongoAdapter from '@prisma/orm-mongo/adapter/control';
import { createMongoFamilyInstance, mongoFamilyDescriptor } from '@prisma/orm-mongo/family/control';
import { createControlStack } from '@prisma/orm-mongo/components/control';
import { mongoTargetDescriptor } from '@prisma/orm-mongo/target/control';

const family = createMongoFamilyInstance(
  createControlStack({ family: mongoFamilyDescriptor, target: mongoTargetDescriptor, adapter: mongoAdapter }),
);
```

Code that goes through the CLI or `defineConfig` already has the adapter on the stack and needs no change.

## `mongo-psl-scalar-names`

`Int`, `Float`, `Boolean` and `DateTime` are deprecated in Mongo schemas. They are still accepted, and they produce the same contract as the new names, but `prisma contract emit` and the language server report a `PSL_DEPRECATED_SCALAR_NAME` warning for each use, and a later release removes them. Rename them now.

Apply this only in a schema whose `prisma.config.ts` uses `@prisma/orm-mongo`. The detection pattern also matches Postgres and SQLite schemas, whose scalar names do not change in this release.

In each field whose type is one of the deprecated names, replace the type name, keeping any `[]` and `?`:

| Deprecated | Use | Stored as |
| --- | --- | --- |
| `Int` | `Int32` | BSON int |
| `Float` | `Double` | BSON double |
| `Boolean` | `Bool` | BSON bool |
| `DateTime` | `Date` | BSON date |

```prisma
// before
model Post {
  id        ObjectId  @id @map("_id")
  views     Int
  rating    Float?
  published Boolean
  createdAt DateTime
  tags      Int[]
}

// after
model Post {
  id        ObjectId  @id @map("_id")
  views     Int32
  rating    Double?
  published Bool
  createdAt Date
  tags      Int32[]
}
```

This includes the `contract.prisma` copies under `migrations/app/<migration>/`. Then run `prisma contract emit`: `contract.json` and `contract.d.ts` come out the same as before, so no migration or `db sign` is needed. Until the rename, each use reports `warning <file>:<line>:<column> PSL_DEPRECATED_SCALAR_NAME Scalar type "Int" is deprecated and will be removed; use "Int32" (stored as BSON int).`

Docs: list only `Int32`, `Double`, `Bool`, `Date`; the old names must not appear in the scalar tables.
