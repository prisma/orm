---
changes:
  - id: default-functions-declare-print-arguments
    summary: |
      A default function an extension registers in `controlMutationDefaults.defaultFunctionRegistry` can now declare `printArguments`, the reverse of `lower`: for each generator id the function lowers to, a function that writes the arguments of the PSL call from the generator's params. `contract print` writes a generated value only through it, so add `printArguments` to each entry that lowers to an execution generator. Composing a stack now fails with `CONTRACT.PACK_CONTRIBUTION_INVALID` when two entries print the same generator id, or when an entry prints a generator id no generator descriptor in the stack registers. The detection matches a file that registers a default function.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'defaultFunctionRegistry\s*:'
  - id: field-presets-print-from-their-templates
    summary: |
      `contract print` now writes a generated value through a field preset whose option arguments select the generator, reading the codec, the type params and the phase arguments from the preset's own `args` and `output`. Composing a stack now fails with `CONTRACT.PACK_CONTRIBUTION_INVALID` when two such presets write the same codec with the same generator. The detection matches a file that declares a field preset.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - "kind:\\s*'fieldPreset'"
---

# Declare how `contract print` writes your generated values

## Default functions: `printArguments`

`contract print` writes a column with a generated value as the `@default(...)` call of a default function in the configured stack. It finds that call through the new optional `printArguments` field of `ControlMutationDefaultEntry`, the reverse of `lower`. A function without it still reads PSL as before, but `contract print` refuses a contract that uses one of its generators, unless a field preset writes the column, with `CONTRACT.PRINT_UNSUPPORTED` that names your component: `which "<component id>" registers, but no default function in the configured stack declares how contract print writes it, and the stack has no field preset for the column codec that contract print can write with it`.

For each entry whose `lower` returns `{ kind: 'execution', generated: { kind: 'generator', id } }`, add one key per generator id it can return. The value receives the generator's `params` from the contract and returns the text between the call's parentheses. The printer writes `<function name>(<arguments>)`, with the name the entry is registered under:

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

// After
const slugidEntry: ControlMutationDefaultEntry = {
  signature: { documentation: 'Generates a slug identifier when a field value is omitted.' },
  lower: () => ({
    ok: true,
    value: { kind: 'execution', generated: { kind: 'generator', id: 'slugid' } },
  }),
  usageSignatures: ['slugid()'],
  printArguments: { slugid: () => '' },
};
```

When the call takes arguments that become params, write them back from `params`, so the call lowers back to the same generator and params:

```ts
printArguments: {
  myId: (params) => (typeof params?.['size'] === 'number' ? String(params['size']) : ''),
},
```

An entry that lowers only to a database default, such as `now()`, needs no `printArguments`.

Each key must be a generator id that a generator descriptor in the composed stack registers (`controlMutationDefaults.generatorDescriptors`), and only one entry in the stack may print it. Otherwise composing the stack fails with `CONTRACT.PACK_CONTRIBUTION_INVALID`: `Duplicate PSL call for mutation default generator "<id>"` or `... writes a PSL call for generator "<id>", which no generator descriptor in the stack registers.`

## Field presets

You add nothing to a field preset. `contract print` reads how to write a column with a preset from the preset's `args` and `output`, when the preset has this shape:

- each phase in `output.executionDefaults` is a `select` on an option argument with a name, and each case is a generator;
- the `onCreate` and `onUpdate` phases read different option arguments, because one argument cannot select a generator for each phase independently;
- each entry of `output.typeParams` is a whole positional argument (`{ kind: 'arg', index }` with no `path` or `default`), and together they take the leading arguments `0, 1, …`;
- the output sets no `default`, `id`, `unique` or `nullable`.

```ts
const stamped: AuthoringFieldPresetDescriptor = {
  kind: 'fieldPreset',
  args: [
    { name: 'precision', kind: 'number', optional: true, integer: true },
    { name: 'onCreate', kind: 'option', values: ['now'], optional: true },
  ],
  output: {
    codecId: 'pg/timestamptz-temporal@1',
    typeParams: { precision: { kind: 'arg', index: 0 } },
    executionDefaults: {
      onCreate: { kind: 'select', index: 1, cases: { now: { kind: 'generator', id: 'clusterNow' } } },
    },
  },
};
// contract print writes a column of this preset as `clock.stamped(3, onCreate: now)`.
```

Presets built with `temporalCodecPreset` and `temporalCodecPresetWithPrecision` have this shape. A preset of any other shape is not used by `contract print`. For each column, `contract print` also checks that it can write the call and that the call reads back as the column. It writes a preset call only for a column that is not a list and whose PSL type stands for its data type, not a named type, a value object or an enum, which the call would replace. It checks the arguments as the PSL reader does, so a required argument without a value, or a value outside an argument's bounds, is refused. The call must read back with the column's codec, type params, generators and generator params. When the preset call fails these checks and the column has only a create generator, `contract print` writes the default function that declares `printArguments` for it instead. Otherwise it refuses the column with `CONTRACT.PRINT_UNSUPPORTED`, for example a `numeric(10, 2)` column whose preset writes only `precision`, or a column whose generator params come from an argument the call does not write. Only one preset in the stack may write a codec with a generator; composing the stack refuses a second one with `CONTRACT.PACK_CONTRIBUTION_INVALID`: `Field presets "<a>" and "<b>" both write codec "<codec>" with generator "<id>", so \`contract print\` cannot choose one.`
