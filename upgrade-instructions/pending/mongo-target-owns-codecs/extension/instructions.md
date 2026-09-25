---
changes:
  - id: mongo-codec-subpaths-move-to-target
    summary: |
      The Mongo codecs moved from `@internal/adapter-mongo` to `@internal/target-mongo`: the
      `codec-types`, `codecs`, `codec-ids` and `data-types` subpaths of the adapter are gone and
      live under the target. The same move applies to the published `adapter/*` subpaths of
      `@prisma/orm-mongo` and `@prisma/orm-target-mongo`, which are now `target/*`.
    detection:
      glob: "**/*.{ts,mts,cts,md}"
      matches:
        - '@internal/adapter-mongo/(?:codec-types|codecs|codec-ids|data-types)(?![\w-])'
        - '@prisma/orm-(?:target-)?mongo/adapter/(?:codec-types|codecs|codec-ids|data-types)(?![\w-])'
  - id: create-mongo-runner-deps-removed
    summary: |
      `createMongoRunnerDeps(...)` is removed from `@internal/adapter-mongo/control`. Build the
      runner dependencies with `new MongoControlAdapterImpl().createRunnerDependencies(controlDriver)`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bcreateMongoRunnerDeps\b'
  - id: mongo-runner-dependency-types-move-to-family
    summary: |
      `MongoRunnerDependencies` and `MarkerOperations` are exported from
      `@internal/family-mongo/control-adapter`, no longer from `@internal/adapter-mongo/control` or
      `@internal/target-mongo/control`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:MongoRunnerDependencies|MarkerOperations)\b[^;]*?from\s*[''"]@internal/(?:adapter|target)-mongo/control[''"]'
        - '\b(?:MongoRunnerDependencies|MarkerOperations)\b[^;]*?from\s*[''"]@prisma/orm-(?:target-)?mongo/(?:adapter|target)/control[''"]'
  - id: mongo-control-adapter-creates-runner-dependencies
    summary: |
      The `MongoControlAdapter` SPI gains `createRunnerDependencies(driver)`, and
      `MongoControlFamilyInstance` gains `createRunnerDependencies({ driver })`. A custom
      implementation of either must add the method.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bimplements\s+(?:[\w.]+\s*,\s*)*MongoControlAdapter\b'
        - ':\s*MongoControlFamilyInstance\s*=\s*\{'
  - id: mongo-create-runner-needs-adapter-on-stack
    summary: |
      `mongoTargetDescriptor.migrations.createRunner(family)` reaches the database through the
      control adapter on the family's control stack. A family instance created from an empty stack,
      or from a `createControlStack(...)` with no `adapter`, fails with "Mongo family requires an
      adapter descriptor in ControlStack" when the runner executes.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'createMongoFamilyInstance\(\s*\{\s*\}'
        - 'createControlStack\(\s*\{(?:(?!adapter)[^}])*mongoTargetDescriptor(?:(?!adapter)[^}])*\}\s*\)'
---

## `mongo-codec-subpaths-move-to-target`

Rewrite each specifier. The exported names are unchanged.

| Before | After |
| --- | --- |
| `@internal/adapter-mongo/codec-types` | `@internal/target-mongo/codec-types` |
| `@internal/adapter-mongo/codecs` | `@internal/target-mongo/codecs` |
| `@internal/adapter-mongo/codec-ids` | `@internal/target-mongo/codec-ids` |
| `@internal/adapter-mongo/data-types` | `@internal/target-mongo/data-types` |
| `@prisma/orm-mongo/adapter/<same four>` | `@prisma/orm-mongo/target/<same four>` |
| `@prisma/orm-target-mongo/adapter/<same four>` | `@prisma/orm-target-mongo/target/<same four>` |

Then re-sort the import block with the package's formatter (the new specifier sorts after `@internal/mongo-*`). A package that imports from `@internal/target-mongo` for the first time needs it in `dependencies`. A pack that emits a Mongo `contract.d.ts` re-emits it with `prisma contract emit`, or applies the same rewrite to the committed file; the contract JSON and hashes do not change.

`@internal/target-mongo/codecs` also exports `mongoStandardCodecs` and `buildStandardCodecRegistry`, which the adapter used internally before.

## `create-mongo-runner-deps-removed`

```ts
// before
import { createMongoRunnerDeps, extractDb } from '@internal/adapter-mongo/control';
import { MongoDriverImpl } from '@internal/driver-mongo';
const deps = createMongoRunnerDeps(controlDriver, MongoDriverImpl.fromDb(extractDb(controlDriver)), family);

// after
import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
const deps = new MongoControlAdapterImpl().createRunnerDependencies(controlDriver);
```

Drop imports that are now unused and any family instance built only to pass as the third argument.

## `mongo-runner-dependency-types-move-to-family`

Change the import of `MongoRunnerDependencies` or `MarkerOperations` to `@internal/family-mongo/control-adapter`. The shapes are unchanged.

## `mongo-control-adapter-creates-runner-dependencies`

Add the method to a custom control adapter. It returns the `MongoRunnerDependencies` the migration runner uses for that driver:

```ts
createRunnerDependencies(driver: ControlDriverInstance<'mongo', 'mongo'>): MongoRunnerDependencies
```

A custom family instance forwards `createRunnerDependencies({ driver })` to the control adapter it resolves from the stack.

## `mongo-create-runner-needs-adapter-on-stack`

Create the family instance from a control stack that includes the Mongo adapter:

```ts
createMongoFamilyInstance(
  createControlStack({ family: mongoFamilyDescriptor, target: mongoTargetDescriptor, adapter: mongoAdapterDescriptor }),
);
```
