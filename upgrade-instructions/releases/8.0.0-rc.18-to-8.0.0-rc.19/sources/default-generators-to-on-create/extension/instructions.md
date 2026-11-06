---
changes:
  - id: default-functions-lower-to-database-defaults-only
    summary: |
      A default function in `controlMutationDefaults.defaultFunctionRegistry` can no longer lower to a client generator: `LoweredDefaultValue` has only its `{ kind: 'storage' }` arm. A function that generated a value in the client, such as `slugid()`, becomes a generator function: contribute a `GeneratorFunctionContribution` in `generatorFunctions` on the pack ref and the control descriptor, with a binding for each codec it fills, and keep the generator descriptor. Users then write `@onCreate(slugid())` instead of `@default(slugid())`. The detection matches files that lower a default function to a generator.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - "kind:\\s*'execution'"
  - id: print-arguments-and-applicable-codec-ids-removed
    summary: |
      `ControlMutationDefaultEntry.printArguments` and `MutationDefaultGeneratorDescriptor.applicableCodecIds` and `buildPhases` are removed. A binding of a generator function declares the codecs it fills and the arguments `contract print` writes for each generator it produces. Delete the removed fields. The detection matches files that set them.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'printArguments\s*:'
        - 'applicableCodecIds\s*:'
        - 'buildPhases\s*:'
  - id: sql-family-registers-identifier-generators
    summary: |
      The SQL family now registers the identifier generators `uuidv4`, `uuidv7`, `cuid2`, `ulid`, `nanoid` and `ksuid`. A target, adapter or extension that registers one of them in `generatorDescriptors` must stop: two components that register one generator fail with `CONTRACT.PACK_CONTRIBUTION_INVALID`. An extension that binds `uuid` or another identifier function to its own codec keeps the binding and drops the registration. `builtinGeneratorRegistryMetadata` from `@prisma/orm-framework/ids` is removed; delete its use. The detection matches files that register the built-in identifier generators.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'builtinGeneratorRegistryMetadata'
        - "\\{\\s*id:\\s*['\"](?:uuidv4|uuidv7|cuid2|ulid|nanoid|ksuid)['\"]\\s*\\}"
---

# Client generators are generator functions

`@default(fn())` now means a database default only. A value the client generates is written `@onCreate(fn())` or `@onUpdate(fn())`, and in TypeScript `.onCreate(gen.fn())`. The function resolves through the stack's generator function registry, by the column's codec.

## `default-functions-lower-to-database-defaults-only`

A default function whose `lower` returned `{ kind: 'execution', generated }` no longer compiles. Move it to a generator function on the pack ref (`src/exports/pack.ts`) and the control descriptor of the extension. One component declares the function's `signature`, a `FuncCallSig` as for a default function. A binding maps codec ids to a `resolve` that turns the call's arguments and the column into a generator, and to `printArguments`, the reverse that `contract print` uses. `singleGeneratorBinding` from `@prisma/orm-framework/components/components` builds a binding for a function that takes no arguments:

```ts
// Before
const slugidEntry: ControlMutationDefaultEntry = {
  signature: { documentation: 'Generates a slug identifier when a field value is omitted.' },
  lower: () => ({
    ok: true,
    value: { kind: 'execution', generated: { kind: 'generator', id: 'slugid' } },
  }),
  usageSignatures: ['slugid()'],
};

const slugidPack = {
  // ...
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map([['slugid', slugidEntry]]),
    generatorDescriptors: [{ id: 'slugid', applicableCodecIds: ['pg/text@1'] }],
  },
};

// After
import {
  type ExtensionPackRef,
  singleGeneratorBinding,
} from '@prisma/orm-framework/components/components';

const slugidPack = {
  // ...
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: [{ id: 'slugid' }],
  },
  generatorFunctions: [
    {
      name: 'slugid',
      signature: { documentation: 'Generates a slug identifier when a field value is omitted.' },
      bindings: [singleGeneratorBinding({ codecIds: ['pg/text@1'], generatorId: 'slugid' })],
    },
  ],
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;
```

Put `generatorFunctions` and the generator descriptors on both the pack ref, which the TypeScript builder reads, and the control descriptor, which `contract emit`, `contract print` and the language server read. Every stack, the TypeScript builders included, checks that each binding produces a generator a descriptor registers. Declare the pack ref with `as const satisfies`, not a type annotation: the `gen` of a `defineContract` callback is built from the packs' declared functions and their signatures, so `gen.slugid()` exists only when the pack ref keeps its literal type. A binding's `resolve` may return only a generator id the binding lists in `generatorIds`; any other id throws `InternalError`. To bind a function another component declares, such as `uuid`, to a codec your extension adds, contribute a binding without a `signature`. Composing a stack fails with `CONTRACT.PACK_CONTRIBUTION_INVALID` when two components declare one function, when a binding names a function no component declares, when two bindings cover one function and codec, when two functions write one generator for one codec, when a binding produces a generator no generator descriptor registers, or when two components register one generator id.

## `sql-family-registers-identifier-generators`

The component that defines a generator registers it, and the SQL family now defines and registers `uuidv4`, `uuidv7`, `cuid2`, `ulid`, `nanoid` and `ksuid`. A SQL target, adapter or extension that registers any of them, for example by spreading `builtinGeneratorRegistryMetadata` into `generatorDescriptors`, must remove those entries; `builtinGeneratorRegistryMetadata` is removed. Two components that register one generator id make every stack fail with `CONTRACT.PACK_CONTRIBUTION_INVALID`: `Generator "uuidv4" is registered by both "sql" and "<your component>". Register each generator once, in the component that defines it.` An extension that binds `uuid` to a codec it adds keeps the binding and registers nothing for it. Register only the generators your component defines, such as `slugid`.

A default function that lowers to a database default, such as one that writes a SQL expression, does not change.

## `print-arguments-and-applicable-codec-ids-removed`

`printArguments` on a default function entry, which a pending upgrade note asked you to add, is removed before it shipped: `contract print` reads the `printArguments` of a generator function binding instead. `applicableCodecIds` on a generator descriptor is removed: a binding's `codecIds` say which codecs a generator fills. `buildPhases` had no caller. Delete all three.
