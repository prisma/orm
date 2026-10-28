---
changes:
  - id: authoring-field-namespace-removed
    summary: |
      A component's `authoring.field` namespace and the `fieldPreset` descriptor kind are removed. A component whose `authoring` still has a `field` key is refused with `CONTRACT.PACK_CONTRIBUTION_INVALID` when the stack is assembled. Contribute a type alias (`kind: 'typeAlias'`) or a type constructor in `authoring.type` instead. The detection matches files that declare a field preset or read or set `authoring.field`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'kind:\s*[\x27"]fieldPreset[\x27"]'
        - '(?<![\w$])authoring\??\.field(?![\w$])'
        - '(?<![\w$.])field\s*:\s*\w*[Ff]ieldPresets(?![\w$])'
  - id: argument-kinds-removed
    summary: |
      An authoring argument has one kind, `value`. The `number`, `object` and `option` argument kinds, the `select` template node, and the `path` and `default` of an `arg` template reference are removed, with the types `AuthoringOption`, `AuthoringValueArgument` and `AuthoringSelectRef`. Write each argument as `{ kind: 'value', dataType }` and use `AuthoringArgumentDescriptor` where you used `AuthoringValueArgument`. The detection matches authoring code that uses one of the removed kinds or types.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\b[Aa]uthoring)[\s\S]*kind:\s*[\x27"](?:option|number|object|select)[\x27"]'
        - '(?<![\w$])Authoring(?:Option|ValueArgument|SelectRef)(?![\w$])'
        - '(?<![\w$])isAuthoringSelectRef(?![\w$])'
  - id: preset-builders-removed
    summary: |
      The helpers that built and read field presets are removed: `instantiateAuthoringFieldPreset`, `isAuthoringFieldPresetDescriptor`, `getAuthoringFieldPreset`, `fieldPresetSpellings`, `instantiatePslFieldPreset`, `reportPresetNotCalled`, `temporalAuthoringPresets`, `temporalCodecPreset`, `temporalCodecPresetWithPrecision`, `temporalStringAuthoringPresets`, `temporalPhaseTemplate`, `temporalPhaseTemplateWithParams`, `TEMPORAL_ON_CREATE_ARG`, `TEMPORAL_ON_UPDATE_ARG`, `createFieldHelpersFromNamespace`, the types `PresetStorageTemplate`, `AuthoringFieldPresetDescriptor`, `AuthoringFieldPresetOutput`, `AuthoringFieldNamespace`, `AuthoringColumnDefaultTemplate`, `ObjectArgumentType`, `OptionalObjectArgumentKeys` and `GeneratedColumnSpec`, and the spec helpers `uuidv4`, `uuidv7`, `ulid`, `nanoid`, `cuid2` and `ksuid` of `@prisma/orm-framework/ids`. `assertNoCrossRegistryCollisions` no longer takes a field namespace. The detection matches files that use one of them.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?:instantiateAuthoringFieldPreset|isAuthoringFieldPresetDescriptor|getAuthoringFieldPreset|fieldPresetSpellings|instantiatePslFieldPreset|reportPresetNotCalled|temporalAuthoringPresets|temporalCodecPreset|temporalCodecPresetWithPrecision|temporalStringAuthoringPresets|temporalPhaseTemplate|temporalPhaseTemplateWithParams|TEMPORAL_ON_CREATE_ARG|TEMPORAL_ON_UPDATE_ARG|createFieldHelpersFromNamespace|PresetStorageTemplate|AuthoringFieldPresetDescriptor|AuthoringFieldPresetOutput|AuthoringFieldNamespace|AuthoringColumnDefaultTemplate|ObjectArgumentType|OptionalObjectArgumentKeys|GeneratedColumnSpec)(?![\w$])'
        - 'import\s*(?:type\s*)?\{[^}]*(?<![\w$])(?:uuidv4|uuidv7|ulid|nanoid|cuid2|ksuid)(?![\w$])[^}]*\}\s*from\s*[\x27"]@prisma/orm-framework/ids[\x27"]'
        - '(?<![\w$])assertNoCrossRegistryCollisions\('
  - id: preset-diagnostics-removed
    summary: |
      The PSL diagnostics `PSL_PRESET_NOT_CALLED`, `PSL_PRESET_NOT_LIST`, `PSL_PRESET_NOT_OPTIONAL`, `PSL_PRESET_AND_ID_CONFLICT`, `PSL_PRESET_AND_DEFAULT_CONFLICT` and `PSL_PRESET_WITHOUT_EFFECT` are removed, and MongoDB's `PSL_PRESET_ON_VARIANT_FIELD` and `PSL_PRESET_CONFLICT` are renamed `PSL_GENERATOR_ON_VARIANT_FIELD` and `PSL_GENERATOR_CONFLICT`. A preset call is now reported as `PSL_UNRESOLVED_REFERENCE`. The detection matches files that name a `PSL_PRESET_` code.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'PSL_PRESET_'
  - id: field-presets-in-extension-code
    summary: |
      Code and documentation in an extension that calls a field preset, such as `field.id.uuidv4String()` in a test contract, a README or a message, uses the replacement of the app guide's tables: `field.column(type.UuidString()).id().onCreate(gen.uuid())`. A package that exports `field` and `gen` built by `createComposedAuthoringHelpers` for use outside a contract also exports `type` from the same call. The detection matches files that call a preset.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,md}"
      matches:
        - '(?<![\w$.])field\.(?:id|temporal)\.'
        - '(?<![\w$.])field\.(?:text|int|bigint|float|decimal|boolean|bytes|dateTime|uuidString|uuidNative|ulid|nanoid|cuid2|ksuid|generated)\('
---

# Field presets are removed

This guide replaces two pieces of advice from the 8.0.0-rc.19 upgrade guide. That guide said that a field preset keeps its `number`, `option` and `object` arguments, and showed field presets built with `instantiatePslFieldPreset` and `temporalCodecPresetWithPrecision`. Neither holds any more: this release removes field presets, the `authoring.field` namespace and every argument kind except `value`.

A pack now contributes what a schema writes in a field's type position only through `authoring.type`: a type constructor, such as `Char(36)`, or a type alias, such as `temporal.CreatedAt`. Generated values and the identity are written by the user as attributes (`@id`, `@onCreate(...)`, `@onUpdate(...)` in PSL; `.id()`, `.onCreate(gen.fn())`, `.onUpdate(gen.fn())` in TypeScript), or set by a type alias. The upgrade guide for apps lists the replacement of every preset Prisma contributed.

## `authoring-field-namespace-removed`

Move each field preset out of `authoring.field`. A preset that stored a column with fixed type parameters and generated values becomes a type alias in `authoring.type`, as the targets' `temporal.CreatedAt` is:

```ts
// Before
authoring: {
  field: {
    temporal: {
      createdAt: {
        kind: 'fieldPreset',
        output: {
          codecId: 'pg/timestamptz-temporal@1',
          executionDefaults: { onCreate: { kind: 'generator', id: 'instantNow' } },
        },
      },
    },
  },
},

// After
authoring: {
  type: {
    temporal: {
      CreatedAt: {
        kind: 'typeAlias',
        documentation: 'A timestamp the client sets to now when a row is created.',
        output: {
          type: { codecId: 'pg/timestamptz-temporal@1' },
          onCreate: { name: 'now', args: {} },
        },
      },
    },
  },
},
```

`temporalTypeAliases(type, value)` from `@prisma/orm-framework/components/authoring` builds the `CreatedAt` and `UpdatedAt` pair for a timestamp type. A type alias calls a generator function by name, as `@onCreate(now())` does, and the stack's bindings pick the generator for the alias's codec. A preset that took arguments becomes a type constructor in `authoring.type`, and the user writes the generated values and `@id` as attributes. A preset whose only job was `@id` plus a generator, such as `id.uuidv4String()`, has no replacement in the pack: the user writes the SQL family's identifier alias with the attributes, `UuidString @id @onCreate(uuid())`.

Remove the `field` key from `authoring` on both the pack ref and the control descriptor. Then assemble the stack: if any `field` key is left, the control stack and the TypeScript builders throw `CONTRACT.PACK_CONTRIBUTION_INVALID` with `Component "<id>" contributes authoring.field, which Prisma 8 removed with field presets. Contribute a type alias (kind: 'typeAlias') or a type constructor in authoring.type.`

## `argument-kinds-removed`

`AuthoringArgumentDescriptor` is now `{ kind: 'value'; dataType: string; name?: string; optional?: boolean }`. A type constructor already took only `value` arguments; the other kinds were left only for field presets. Replace `AuthoringValueArgument` with `AuthoringArgumentDescriptor`, and delete code that builds or reads `option`, `number`, `object` or `select` descriptors and templates, and the `path` and `default` of a `{ kind: 'arg' }` template reference. A template refers to a whole argument by its index: `{ kind: 'arg', index: 0 }`.

## `preset-builders-removed`

Delete each use of the removed helpers and types with the preset it built or read. `temporalTypeAliases`, `TIMESTAMP_NOW_GENERATOR_ID` and `timestampNowControlDescriptor` stay. `generatedLength` stays in `@prisma/orm-framework/ids`; the spec helpers `uuidv4()` and the others fed only `field.generated(...)`, which is removed too.

`assertNoCrossRegistryCollisions` takes the type namespace, then the entity type, PSL block and model attribute namespaces. Remove the field namespace argument you passed second:

```ts
// Before
assertNoCrossRegistryCollisions(typeNamespace, fieldNamespace, entityTypeNamespace);

// After
assertNoCrossRegistryCollisions(typeNamespace, entityTypeNamespace);
```

## `preset-diagnostics-removed`

Code that matches a diagnostic by code: a preset call is now `PSL_UNRESOLVED_REFERENCE`, with the message `<call> was a field preset, and Prisma 8 removed field presets. Write <replacement>.` The other `PSL_PRESET_*` codes cannot occur, so remove the code that handles them. Rename `PSL_PRESET_ON_VARIANT_FIELD` to `PSL_GENERATOR_ON_VARIANT_FIELD` and `PSL_PRESET_CONFLICT` to `PSL_GENERATOR_CONFLICT`. Their messages now start `Generated value on`, and they are reported for `@onCreate(...)`, `@onUpdate(...)` and type aliases that generate a value.

## `field-presets-in-extension-code`

Rewrite every preset call in the extension's code, test contracts, messages, doc comments and documentation with the tables of the app upgrade guide. In a `defineContract` callback, take `gen` and `type` from the callback's argument where the rewritten fields use them, adding each missing name at the end of the destructuring, `gen` before `type`. A preset named in a message or doc comment as an example, such as `field.text()` or `field.temporal.timestamptz()`, becomes its replacement, such as `field.column(type.String())` or `field.column(type.TimestamptzTemporal())`. A sentence that describes the presets themselves, such as one saying a `field` export has the same presets as the callback, says instead that the export gives the same `field` and `type` as the callback. If a callback renames `field`, as in `({ field: f })`, the detection does not see `f.id.uuidv4String()`; search for it yourself.

If your package exports `field` and `gen` from a `createComposedAuthoringHelpers(...)` call so that code outside a contract, such as a query fragment, can declare fields, export that call's `type` too, with a doc comment that names an example such as `type.TimestamptzTemporal()`:

```ts
export const type: Helpers['type'] = helpers.type;
```

Add it wherever the package re-exports `field` and `gen`, and replace the preset examples in the doc comment of `field` with `field.column(type.X())` examples. The app upgrade guide's section `ts-field-presets-removed` covers the rest of a `defineContract` callback: a name `type` that is already bound, code that does not know its target, and a `field` imported outside a callback.
