# ADR 255 — Mutation-default generators are a framework runtime concern

Status: **Accepted**

## Decision

The framework owns the runtime half of execution mutation defaults ([ADR 158](ADR%20158%20-%20Execution%20mutation%20defaults.md)): the generator contract, the registry of generators a runtime stack contributes, the check that every generator a contract names is available, and the loop that fills omitted fields on a write. It lives once, in [`framework-components/src/execution/mutation-defaults.ts`](../../../packages/1-framework/1-core/framework-components/src/execution/mutation-defaults.ts), exported through `@internal/framework-components/runtime`. The SQL and Mongo execution contexts call it; neither family has its own copy.

## The decision in code

A runtime target, adapter, or extension contributes generators, typed by the framework:

```ts
// packages/2-mongo-family/9-family/src/core/timestamp-now-runtime-generator.ts
import type { RuntimeMutationDefaultGenerator } from '@internal/framework-components/runtime';

export function timestampNowRuntimeGenerator(): RuntimeMutationDefaultGenerator {
  return { id: TIMESTAMP_NOW_GENERATOR_ID, generate: () => new Date(), stability: 'query' };
}
```

A family's execution context collects them from its stack, checks the contract against them, and exposes `applyMutationDefaults` bound to the contract:

```ts
// packages/2-mongo-family/7-runtime/src/mongo-execution-stack.ts
const generators = collectMutationDefaultGenerators(contributors);
const execution = executionOf(options.contract);
assertMutationDefaultGeneratorsAvailable(execution, generators);
// … codec collection …
return Object.freeze({
  contract: options.contract,
  codecs: registry,
  stack: options.stack,
  applyMutationDefaults: (mutation: MutationDefaultsOptions) =>
    applyMutationDefaults(execution, generators, mutation),
});
```

The ORM calls it once per written record and merges the result into the values it writes:

```ts
// packages/3-extensions/sql-orm-client/src/collection.ts
const applied = ctx.context.applyMutationDefaults({
  op: 'create',
  entry: tableName,
  namespace: namespaceId,
  values: row,
  defaultValueCache,
});
for (const def of applied) {
  row[def.field] = def.value;
}
```

## The generator contract

```ts
export type GeneratorStability = 'field' | 'row' | 'query';

export interface RuntimeMutationDefaultGenerator {
  readonly id: string;
  readonly generate: (params?: Record<string, unknown>) => unknown;
  readonly stability: GeneratorStability;
}
```

`id` is the generator id a contract names in `{ kind: 'generator', id, params? }`; `generate` receives the contract's `params`. The contract holds only the reference. The implementation comes from the runtime stack, so two stacks can serve the same contract with different implementations of the same id.

`stability` says how widely one generated value is shared. The framework derives the cache from it; a generator author never handles cache keys:

| Stability | One value per | Cache |
| --- | --- | --- |
| `'field'` | defaulted field of one record | none; `generate` runs for every field |
| `'row'` | record of one call, across its fields | a fresh cache per `applyMutationDefaults` call |
| `'query'` | ORM operation, across its records and fields | the caller's `defaultValueCache`, shared by every call of one operation |

`'field'` suits identifiers (`uuidv4`, `nanoid`, `cuid2`). `'row'` suits a correlation id stamped into several fields of one record; no built-in generator uses it yet. `'query'` suits `timestampNow`: a bulk `createAll` writes one timestamp into every record. A `'query'` generator called without a cache yields a value per field.

## The availability check

`collectMutationDefaultGenerators(contributors)` registers every generator by id and throws `RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR` with `{ id, existingOwner, incomingOwner }` when two contributors provide one id. `assertMutationDefaultGeneratorsAvailable(execution, registry)` runs when the execution context is created and throws `RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING` with `{ ids }`, listing every generator the contract names that no component provides:

```text
Contract requires mutation default generator(s) 'gen-a', 'gen-b', but no runtime component provides them.
```

A contract that cannot be served fails when the client is built, not on its first write. `applyMutationDefaults` raises the same code with `{ id }` if it meets an unregistered generator anyway.

Each family keeps the check where its context creation already had it: the SQL context runs it after codec collection, so a contract whose columns name an unknown codec reports `RUNTIME.CODEC_DESCRIPTOR_MISSING` first; the Mongo context runs it before codec collection. The functions depend only on the contract's execution section and the registry, so the position is the family's choice, and moving it would change which error a user sees first for a contract with several problems.

## Applying defaults

```ts
export interface MutationDefaultsOptions {
  readonly op: MutationDefaultsOp; // 'create' | 'update'
  readonly namespace: string;
  readonly entry: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly defaultValueCache?: Map<string, unknown>;
}

export interface AppliedMutationDefault {
  readonly field: string;
  readonly value: unknown;
}
```

For each default of `(namespace, entry)` with a phase for `op` (`onCreate` for `'create'`, `onUpdate` for `'update'`), `applyMutationDefaults` returns the generated value of every field `values` does not carry. The rules:

- **A key present in `values` is explicit, whatever its value.** The test is `Object.hasOwn(values, field)`, so `{ updatedAt: undefined }` and `{ updatedAt: null }` both keep the default out. Callers own `undefined` filtering: the SQL ORM drops `undefined` fields before it calls, and so does the Mongo ORM on its create paths; the Mongo ORM's update paths pass one key per field the update document touches.
- **An update with no keys applies nothing.** A write that changes nothing does not advance `updatedAt`.
- **A field is applied at most once per call**, even when two defaults name it.
- **`namespace` is required.** Refs are namespace-scoped, so only defaults declared for `(namespace, entry)` apply; that is what tells two same-named tables in different schemas apart. Requiring it keeps the coordinate part of every match: a missing namespace is a caller bug, not a quiet fallback to matching by entry name alone.

`MutationDefaults` is the interface an ORM depends on: `applyMutationDefaults(options): ReadonlyArray<AppliedMutationDefault>`. The SQL lane `ExecutionContext` and `MongoExecutionContext` extend it, and the Mongo ORM takes it as `mongoOrm({ contract, executor, mutationDefaults })`.

## The execution section

A default's `ref` is `{ namespace, entry, field }` ([ADR 158](ADR%20158%20-%20Execution%20mutation%20defaults.md)): `entry` is the table or collection and `field` the column or stored document field, so the runtime matches refs without knowing the family. Authoring builds the section with `buildExecutionSection({ target, targetFamily, defaults })` from `@internal/contract/hashing`. It sorts the defaults by namespace, then entry, then field, comparing names by UTF-16 code unit rather than locale collation (which varies with the host's locale and ICU build), and computes `executionHash` over the sorted section, so every authoring path (the SQL TypeScript builder, the Mongo PSL interpreter and TypeScript builder, the Prisma 6 MongoDB reader) emits the same section and hash for the same defaults.

## Consequences

- A new family gets mutation defaults by listing its contributors and calling the three functions; it writes no registry, check, or loop.
- Generators are portable across families: `timestampNow` has the same type and semantics in the SQL family and the Mongo family, and an extension's generator is typed identically in either family; its value must still suit the target field's codec.
- The explicit-key rule is one rule. A caller that wants `undefined` to mean "not set" filters before the call, where it knows what its payload means.
- The option and result names are family-neutral (`entry`, `field`), matching the contract ref.

## Alternatives considered

**A generator runtime per family.** Each family context carrying its own registry, check, and apply loop keeps the family packages self-contained, but two copies drift: they diverge on how `undefined` is treated, on whether a missing generator at apply time is a structured error or an assertion, and on the sort order of the section they hash. One implementation removes the class of drift.

**Treating `undefined` as absent inside the apply loop.** It saves callers a filter, but the loop cannot know what a caller's payload means. A SQL builder that sets a column to `undefined` and a Mongo update document that unsets a field are different writes, and only the caller can tell them apart.

**Checking availability lazily, on the first write.** It lets a client over a contract with an unavailable generator start, and then fail on a write. Checking at context creation reports every missing id at once, before any data is touched.
