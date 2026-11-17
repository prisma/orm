---
from: "0.11"
to: "0.12"
changes:
  - id: expr-visitor-add-window-func-method
    summary: |
      The `ExprVisitor<R>` interface in `@internal/sql-relational-core/ast` gained a required `windowFunc(expr: WindowFuncExpr): R` method (added to support `ROW_NUMBER() OVER (…)` lowering for `.distinct(cols)`). Every `ExprVisitor<R>` implementation in your extension — typically the object literal you pass to `expr.accept({ … })` — must add the new method or TypeScript will refuse the literal. The right body depends on what the visitor does: binding/encoding/transforming visitors usually treat `WindowFuncExpr` similarly to `AggregateExpr`; visitors that reject unsupported kinds in restricted contexts (e.g. grouped `HAVING`) should reject window functions there too. No automated codemod — author the body per visitor by hand.
    detection:
      glob: "**/*.ts"
      contains:
        - "ExprVisitor"
        - "aggregate"
      anyMatch: false
  - id: any-expression-exhaustive-switch-add-window-func-case
    summary: |
      The `AnyExpression` discriminated union in `@internal/sql-relational-core/ast` gained a `WindowFuncExpr` variant (`kind: 'window-func'`). Exhaustive switches over `expr.kind` that use the `satisfies never` exhaustiveness pattern — typically in SQL renderers, AST walkers, and analysis passes — will fail to compile until they add a `case 'window-func':` arm. The arm's body depends on the switch's purpose; the most common shape is "render the window function as `fn() OVER (…)`" (matching Postgres/SQLite syntax) or "reject as unsupported in this context".
    detection:
      glob: "**/*.ts"
      contains:
        - "case 'aggregate':"
        - "satisfies never"
      anyMatch: false
  - id: distinct-cols-now-collapses-by-specified-columns
    summary: |
      `.distinct(cols)` on `@internal/sql-orm-client` `Collection` (and on nested `.include(…, c => c.distinct(cols)…)`) now keeps **one representative row per `(cols)` group**, matching Prisma semantics. Prior to 0.12, `.distinct(cols)` did not actually collapse rows on the specified columns — when the projection contained any other distinguishing column (typically `id`), rows that differed only in those other columns were all returned. No code change is required for consumer call sites, but any extension tests or fixtures that asserted the pre-0.12 no-collapse output will fail and need updating to reflect the new collapsed shape. The representative within each partition is picked by the user's `.orderBy(…)` (if any); when the orderBy doesn't fully order rows in a partition the pick is implementation-defined, matching Prisma's documented behaviour.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - ".distinct("
      anyMatch: true
  - id: replace-runtime-verify-options-with-verify-marker
    summary: |
      The `@internal/sql-runtime` export `RuntimeVerifyOptions` is removed; replaced by `VerifyMarkerOption = 'onFirstUse' | false`. Extension convenience wrappers that expose a `*OptionsBase` interface must rename `verify?: RuntimeVerifyOptions` to `verifyMarker?: VerifyMarkerOption`, drop the hard-coded `verify: { mode: 'onFirstUse', requireMarker: false }` default in the wrapper's `createRuntime(...)` call, and thread the caller's value through via `...ifDefined('verifyMarker', options.verifyMarker)` so the runtime's own default (`'onFirstUse'`) applies when the option is omitted. The runtime no longer throws `CONTRACT.MARKER_MISMATCH` / `CONTRACT.MARKER_MISSING` on drift — it emits a structured `warn`-level log line once per runtime instance (single-flighted under concurrent first queries) and proceeds.
    detection:
      glob: "**/*.ts"
      contains:
        - "RuntimeVerifyOptions"
        - "verify: {"
      anyMatch: true
  - id: define-contract-drop-capabilities-generic
    summary: |
      The `Capabilities` type parameter is removed from the framework `baseDefineContract` factory and from `ContractInput` in `@internal/contract`. Extension authors who ship their own target-facade-style `defineContract` (a thin wrapper that re-exports `baseDefineContract` with `family` / `target` pre-bound) must drop the `Capabilities` generic from every facade type alias (`*Result`, `*BaseScaffold`, `*Definition`, `*Scaffold`) and from every overload signature; the corresponding `ContractInput<…, Capabilities>` and `baseDefineContract<…, Capabilities>` instantiations lose their trailing argument. Extensions that don't ship a facade have no source change — their emitted `contract.json` / `contract.d.ts` will pick up two new auto-contributed capabilities (`postgres.distinctOn`, `sql.lateral`) on re-emit; re-run `pnpm fixtures:emit` (or the equivalent for your extension) to refresh fixtures.
    detection:
      glob: "**/*.ts"
      contains:
        - "baseDefineContract"
        - "Capabilities"
      anyMatch: false
  - id: strip-migration-labels-hints
    summary: |
      The 0.12 migration manifest schema is closed (`'+': 'reject'`) and the metadata model no longer carries `labels` or `hints`; any on-disk `migration.json` your extension ships (e.g. an install-extension migration under `migrations/`) still holding either key fails to load with `INVALID_MANIFEST` naming the offending key. Both fields are also dropped from the content-addressed migration identity, so `migrationHash` is now computed over `{ from, to, providedInvariants, createdAt }` plus the sibling `ops.json`. Run the colocated codemod to strip both keys from every `migration.json` and recompute its `migrationHash` over the slimmed envelope.
    detection:
      glob: "**/migration.json"
      contains:
        - '"labels"'
        - '"hints"'
      anyMatch: true
    script: ./strip-migration-labels-hints.ts
  - id: extension-public-default-baseline
    summary: |
      Published Postgres extension packs' empty default namespace flips `__unbound__` → `public` (`postgres-unbound-schema` → `postgres-schema`), changing the extension's `storageHash`, `migrations/refs/head.json` hash, and each baseline `migration.json` `to` / `migrationHash`. Migration ops are unchanged. Re-emit the contract-space (`pnpm build:contract-space` / `prisma-next contract emit`) and regenerate the install migration baseline so the head ref matches the new contract hash.
    detection:
      glob: "**/contract.json"
      contains:
        - '"kind": "postgres-unbound-schema"'
      anyMatch: true
    script: ./regenerate-extension-public-baseline.ts
  - id: domain-plane-spi-and-testing-subpath
    summary: |
      Contract SPI is namespaced: read models/value objects through `contract.domain.namespaces.<ns>` (helpers: `domainModelsAtDefaultNamespace(contract.domain)`, `ContractModelDefinitions`) instead of flat `contract.models`. The `@internal/contract/testing` subpath export was removed — test factories (`createContract`, `createSqlContract`, `DUMMY_HASH`, `applicationDomainOf`) now live in `@repo/test-utils`. Run the colocated import codemod and update SPI consumption to the namespaced contract shape.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "@internal/contract/testing"
      anyMatch: true
    script: ./migrate-contract-testing-imports.ts
  - id: default-namespace-domain-access-retire-projection-helpers
    summary: |
      The transitional `@internal/contract` helpers `contractModels`, `contractValueObjects`, `resolveSingleDomainNamespaceId`, `ContractModelsMap`, and `ContractValueObjectsMap` are removed. Read models/value objects through `domainModelsAtDefaultNamespace(contract.domain)` / `domainValueObjectsAtDefaultNamespace(contract.domain)` (these read the contract's sole namespace and throw on a multi-namespace contract). Typed model shapes use `ContractModelDefinitions<Contract>`. SQL namespace concretions must expose `qualifyTable`; hydrate migration scaffolds with `PostgresContractSerializer` (not `structuredClone`) so `qualifyTable` survives. Runtime SQL is namespace-qualified on Postgres.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "contractModels"
      anyMatch: true
---

# 0.11 → 0.12 — Extension-author upgrade instructions

## `expr-visitor-add-window-func-method`

Starting at the 0.12 release, the framework `ExprVisitor<R>` interface in `@internal/sql-relational-core/ast` gained a required method:

```ts
windowFunc(expr: WindowFuncExpr): R;
```

This method was added to support `WindowFuncExpr` — the new AST node for window functions, currently lowering `ROW_NUMBER() OVER (PARTITION BY … ORDER BY …)` used by `.distinct(cols)` (and reserved for `RANK` / `DENSE_RANK` as future additions).

Every `ExprVisitor<R>` implementation needs to add the new method. The natural body depends on what the visitor does:

- **Binding / encoding / transforming visitors** — usually treat `WindowFuncExpr` the same way they treat `AggregateExpr` (recurse into `args`, `partitionBy`, and `orderBy`).
- **Validating visitors** that restrict which expression kinds are allowed in a given context (e.g. grouped `HAVING` clauses) — typically reject window functions just like they reject aggregates in unrelated contexts.

### Before 0.12

```ts
expr.accept<AnyExpression>({
  columnRef: (e) => bindExpression(contract, e),
  identifierRef: (e) => e,
  subquery: (e) => bindExpression(contract, e),
  operation: (e) => bindExpression(contract, e),
  aggregate: (e) => bindExpression(contract, e),
  // … other methods …
});
```

### Starting at 0.12

```ts
expr.accept<AnyExpression>({
  columnRef: (e) => bindExpression(contract, e),
  identifierRef: (e) => e,
  subquery: (e) => bindExpression(contract, e),
  operation: (e) => bindExpression(contract, e),
  aggregate: (e) => bindExpression(contract, e),
  windowFunc: (e) => bindExpression(contract, e), // ← new: required
  // … other methods …
});
```

### Or, for a context that rejects unsupported kinds

```ts
expr.accept<AnyExpression>({
  // …
  aggregate: rejectInThisContext,
  windowFunc: rejectInThisContext, // ← new: required
  // …
});
```

TypeScript will report missing-property errors on every visitor literal after the bump; that's a reliable compile-time signal for every affected site. No automated codemod — the right body depends on what your visitor does, so author each one by hand.

## `any-expression-exhaustive-switch-add-window-func-case`

Starting at the 0.12 release, the `AnyExpression` discriminated union in `@internal/sql-relational-core/ast` gained `WindowFuncExpr` (`kind: 'window-func'`). Exhaustive switches over `expr.kind` that use the `satisfies never` exhaustiveness pattern will fail to compile until they add a matching arm.

The most common case is in SQL renderers — Postgres and SQLite both render `WindowFuncExpr` as `fn() OVER (PARTITION BY … ORDER BY …)` (the syntax is identical across the two targets we ship).

### Before 0.12

```ts
function renderExpr(expr: AnyExpression): string {
  switch (expr.kind) {
    case 'column-ref':
      return renderColumn(expr);
    case 'aggregate':
      return renderAggregate(expr);
    // … other cases …
    // v8 ignore next 4
    default:
      throw new Error(
        `Unsupported expression node kind: ${(expr satisfies never as { kind: string }).kind}`,
      );
  }
}
```

### Starting at 0.12

```ts
function renderExpr(expr: AnyExpression): string {
  switch (expr.kind) {
    case 'column-ref':
      return renderColumn(expr);
    case 'aggregate':
      return renderAggregate(expr);
    case 'window-func':
      return renderWindowFunc(expr); // ← new: required
    // … other cases …
    default:
      throw new Error(
        `Unsupported expression node kind: ${(expr satisfies never as { kind: string }).kind}`,
      );
  }
}

function renderWindowFunc(expr: WindowFuncExpr): string {
  const fn = expr.fn.toUpperCase();
  const args = expr.args.map(renderExpr).join(', ');
  const partition =
    expr.partitionBy && expr.partitionBy.length > 0
      ? `PARTITION BY ${expr.partitionBy.map(renderExpr).join(', ')}`
      : '';
  const order =
    expr.orderBy && expr.orderBy.length > 0
      ? `ORDER BY ${expr.orderBy.map((o) => `${renderExpr(o.expr)} ${o.dir.toUpperCase()}`).join(', ')}`
      : '';
  const over = [partition, order].filter((s) => s.length > 0).join(' ');
  return `${fn}(${args}) OVER (${over})`;
}
```

If your switch builds an `isAtomicExpressionKind` predicate or anything similar (used to decide whether the rendered expression needs surrounding parentheses), treat `'window-func'` as atomic — `fn() OVER (…)` is self-delimited by its own parentheses.

No automated codemod — the body of the new arm depends on what the switch does. TypeScript pinpoints every site at compile time.

## `distinct-cols-now-collapses-by-specified-columns`

Starting at the 0.12 release, `.distinct(cols)` on the `@internal/sql-orm-client` `Collection` API — at the top level (`db.Post.distinct('title')`), on leaf includes (`include('posts', p => p.distinct('title'))`), and on non-leaf includes (`include('posts', p => p.distinct('title').include('comments'))`) — keeps one representative row per `(cols)` group, matching Prisma's documented semantics.

Prior to 0.12, `.distinct(cols)` did not actually collapse rows on the specified columns: when the projection contained any other distinguishing column (typically `id`), rows that differed only in those other columns were all returned. From 0.12 onwards, `.distinct(cols)` keeps one representative row per `(cols)` group, matching the way Prisma documents `distinct`.

### No code change for consumer call sites

```ts
// Both 0.11 and 0.12 — same call site, different runtime behaviour:
const posts = await db.Post
  .orderBy([(p) => p.title.asc(), (p) => p.id.asc()])
  .distinct('title')
  .all();

// 0.11: returns every post (if seed has 3 posts including two sharing title='A',
// you get 3 back).
// 0.12: returns one post per title (you get 2 back — title='A' picks the
// lower-id row per the orderBy; title='B' is unaffected).
```

The API surface is unchanged. Type-level signatures are unchanged. Only the SQL produced and the rows returned differ.

### Tests and fixtures that assert pre-0.12 output

Any extension test that exercises `.distinct(cols)` and asserts the result set will fail under 0.12. Updates needed:

- **Seed data with duplicates** on every column passed to `.distinct(...)` so the test actually exercises dedup (a test with no duplicates is a no-op assertion in either era).
- **Pair `.distinct(...)` with an `.orderBy(...)`** that fully orders rows within each partition (e.g. `[distinctCol.asc(), id.asc()]`) so the picked representative is deterministic. When the orderBy doesn't fully order a partition the choice is implementation-defined — matches Prisma's behaviour, but makes assertions flaky.
- **Update `expect(rows).toEqual([…])` shapes** to match the post-collapse output. The dropped row's grandchildren (where `.distinct(cols).include(grandchild)` is in play) do not appear in the output either.

### Representative-selection behaviour

The user's `.orderBy(…)` drives the OVER ORDER BY of the underlying `ROW_NUMBER()` — the row with rank 1 in each partition wins. When the orderBy doesn't fully order rows within a partition, the choice between tied rows is implementation-defined (Postgres and SQLite are each entitled to pick any row in the tie). This matches Prisma's documented behaviour; if your extension needs deterministic picks across partition ties, add a primary-key tiebreaker to the orderBy.

### Validation

After updating fixture / test data, run your extension's standard `pnpm test` (or `pnpm test:integration` for tests that exercise live SQL). No type-level changes — TypeScript will not pinpoint sites; runtime assertions are the signal.

## `replace-runtime-verify-options-with-verify-marker`

Starting at the 0.12 release, `@internal/sql-runtime` simplifies marker verification. The previous `RuntimeVerifyOptions` type and the `verify: { mode; requireMarker }` field on `RuntimeOptions` are removed; replaced by a single optional field `verifyMarker?: VerifyMarkerOption` where `VerifyMarkerOption = 'onFirstUse' | false` and `'onFirstUse'` is the runtime default.

If your extension ships a convenience wrapper around `createRuntime(...)` — the pattern used by `@internal/sqlite`, `@internal/postgres`, and `@internal/postgres/serverless` — you need four mechanical edits in the wrapper source:

1. Rename the type import from `RuntimeVerifyOptions` to `VerifyMarkerOption`.
2. Rename the option on your `*OptionsBase` interface from `verify?` to `verifyMarker?`.
3. Drop the hard-coded default literal in the `createRuntime(...)` call.
4. Thread the caller's value through with `ifDefined` so omitted options defer to the runtime default.

The runtime's read-side behaviour also changes: it no longer throws `CONTRACT.MARKER_MISMATCH` or `CONTRACT.MARKER_MISSING` when the database marker is absent or drifted. Instead, on the first `execute()` call per runtime instance, it emits one structured `warn`-level log line (payload includes `code`, `scope`, `expected`, `actual`, `message`) and proceeds with the query. Extension authors do not need to implement this behaviour — it lives inside `@internal/sql-runtime` — but tests that previously asserted thrown errors need retargeting (see *Tests and fixtures* below).

### Before 0.12 — type import and options interface

```ts
import type {
  ExecutionContext,
  Runtime,
  RuntimeVerifyOptions,
  SqlExecutionStackWithDriver,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
} from '@internal/sql-runtime';

export interface MyTargetOptionsBase {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<MyTargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verify?: RuntimeVerifyOptions;
}
```

### Starting at 0.12 — type import and options interface

```ts
import type {
  ExecutionContext,
  Runtime,
  SqlExecutionStackWithDriver,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
  VerifyMarkerOption,
} from '@internal/sql-runtime';
import { ifDefined } from '@internal/utils/defined';

export interface MyTargetOptionsBase {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<MyTargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verifyMarker?: VerifyMarkerOption;
}
```

Import `ifDefined` from `@internal/utils/defined` if your wrapper does not already use it for other optional fields.

### Before 0.12 — `createRuntime(...)` call inside the wrapper

```ts
const runtime = createRuntime({
  stackInstance,
  context,
  driver,
  verify: options.verify ?? { mode: 'onFirstUse', requireMarker: false },
  ...ifDefined('middleware', options.middleware),
});
```

The hard-coded `{ mode: 'onFirstUse', requireMarker: false }` default duplicated what the runtime already applied when `verify` was omitted. From 0.12 the wrapper should not inject a default — let the runtime's `'onFirstUse'` default stand.

### Starting at 0.12 — `createRuntime(...)` call inside the wrapper

```ts
const runtime = createRuntime({
  stackInstance,
  context,
  driver,
  ...ifDefined('verifyMarker', options.verifyMarker),
  ...ifDefined('middleware', options.middleware),
});
```

When the caller omits `verifyMarker`, the spread adds nothing and the runtime default (`'onFirstUse'`) applies. When the caller passes `verifyMarker: false`, verification is skipped entirely.

### Semantics mapping for callers of your wrapper

| Before 0.12 (`verify`) | Starting at 0.12 (`verifyMarker`) |
| --- | --- |
| `{ mode: 'onFirstUse', requireMarker: false }` (or omitted — your wrapper defaulted to this) | omit `verifyMarker` (runtime default `'onFirstUse'`) |
| `{ mode: 'onFirstUse', requireMarker: true }` | `verifyMarker: 'onFirstUse'` — but the throw-on-missing-marker semantics are removed; use the `db-verify` CLI for fail-fast deploy checks |
| `{ mode: 'always', requireMarker: ... }` | `verifyMarker: 'onFirstUse'` — `'always'` mode is dropped; verification is once-per-runtime |
| `{ mode: 'startup', requireMarker: ... }` | `verifyMarker: 'onFirstUse'` — `'startup'` mode is dropped for the same reason |
| Explicit skip | `verifyMarker: false` |

### Tests and fixtures

Extension wrapper tests that exercised the old surface need two kinds of updates:

**Option-forwarding tests** — rename the option and adjust assertions about defaults:

```ts
// Before 0.12
it('forwards verify option to createRuntime', async () => {
  const verify = { mode: 'always', requireMarker: true } as const;
  const db = myTarget({ contract, verify });
  await db.connect(/* … */);
  expect(mocks.createRuntime).toHaveBeenCalledWith(expect.objectContaining({ verify }));
});

it('defaults verify to onFirstUse without requireMarker', async () => {
  const db = myTarget({ contract });
  await db.connect(/* … */);
  expect(mocks.createRuntime).toHaveBeenCalledWith(
    expect.objectContaining({ verify: { mode: 'onFirstUse', requireMarker: false } }),
  );
});

// Starting at 0.12
it('forwards verifyMarker option to createRuntime', async () => {
  const db = myTarget({ contract, verifyMarker: false });
  await db.connect(/* … */);
  expect(mocks.createRuntime).toHaveBeenCalledWith(
    expect.objectContaining({ verifyMarker: false }),
  );
});

it('omits verifyMarker from createRuntime when not provided (runtime default applies)', async () => {
  const db = myTarget({ contract });
  await db.connect(/* … */);
  expect(mocks.createRuntime).toHaveBeenCalledTimes(1);
  const callArg = mocks.createRuntime.mock.calls[0]?.[0] as Record<string, unknown>;
  expect(callArg).not.toHaveProperty('verifyMarker');
});
```

**Drift / missing-marker integration tests** — grep for `rejects.toMatchObject({ code: 'CONTRACT.MARKER_MISSING' })` or `rejects.toMatchObject({ code: 'CONTRACT.MARKER_MISMATCH' })`. These patterns no longer apply: the runtime logs instead of throwing. Retarget to assert on the `Log.warn` sink:

```ts
// Before 0.12
await expect(runtime.execute(plan).toArray()).rejects.toMatchObject({
  code: 'CONTRACT.MARKER_MISSING',
});

// Starting at 0.12
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Log;
const runtime = createRuntime({ stackInstance, context, driver, log });

const rows = await runtime.execute(plan).toArray();
expect(rows).toEqual(/* expected rows — query proceeds */);
expect(log.warn).toHaveBeenCalledOnce();
expect(log.warn).toHaveBeenCalledWith({
  code: 'CONTRACT.MARKER_MISSING',
  scope: 'marker-verification',
  expected: { storageHash: contract.storage.storageHash, profileHash: contract.profileHash ?? null },
  actual: null,
  message: 'Contract marker not found in database',
});
```

Pass a `log` object into `createRuntime(...)` (or through your wrapper if you expose a `log` option) so tests can spy on `warn` without touching stdout.

### Validation

After applying the edits above, run `pnpm typecheck` on your extension package. TypeScript flags every remaining `RuntimeVerifyOptions` import and every `verify?:` field on your options interface. Then run your extension's test suite — option-forwarding unit tests and any marker-drift integration tests are the sites most likely to need the retargeting described above.

## `define-contract-drop-capabilities-generic`

Starting at the 0.12 release, the framework `baseDefineContract` factory in `@internal/contract` drops its `Capabilities` type parameter, and the `ContractInput<Family, Target, Types, Models, ExtensionPacks, Capabilities>` shape loses its trailing argument. Capabilities are no longer declared at authoring time — they are contributed automatically by target components and extension packs, and flow into the emitted `contract.json` / `contract.d.ts` from there.

There are two kinds of impact on an extension, depending on what your extension ships:

- **Extensions that ship their own target-facade `defineContract`** (the pattern used by `@internal/postgres`, `@internal/sqlite`, and any third-party adapter that pre-binds `family` + `target` for its consumers): you need to drop the `Capabilities` generic from every facade type alias and overload signature. TypeScript will pinpoint every site once you bump.
- **Extensions that only contribute pack metadata + emit fixtures** (the more common shape — `@internal/pgvector`, `@internal/paradedb`, etc.): no source change. Re-emit your contract fixtures (`pnpm fixtures:emit` or the equivalent script for your package) so the regenerated `contract.json` / `contract.d.ts` picks up the new auto-contributed capability keys — in the 0.12 line, `postgres.distinctOn: true` and `sql.lateral: true` appear in every SQL-target fixture that loads the relevant adapter.

### Facade-style extensions — drop the generic

If your extension ships a `defineContract` that wraps `baseDefineContract` with `family` / `target` pre-bound, walk every type alias and every overload signature in your facade and remove the `Capabilities` parameter.

#### Before 0.12

```ts
import { defineContract as baseDefineContract } from '@internal/contract';
import type { ContractInput, ExtensionPackRef } from '@internal/contract';

type MyTargetResult<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined,
> = Omit<
  ReturnType<
    typeof baseDefineContract<
      MyFamily,
      MyTargetPack,
      Types,
      Models,
      ExtensionPacks,
      Capabilities
    >
  >,
  'target' | 'targetFamily'
> & {
  readonly target: MyTargetPack['targetId'];
  readonly targetFamily: MyFamily['familyId'];
};

type MyTargetBaseScaffold<
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined,
> = Omit<
  ContractInput<
    MyFamily,
    MyTargetPack,
    Record<never, never>,
    Record<never, never>,
    ExtensionPacks,
    Capabilities
  >,
  'family' | 'target' | 'types' | 'models'
>;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const ExtensionPacks extends
    | Record<string, ExtensionPackRef<'sql', string>>
    | undefined = undefined,
  const Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
>(
  definition: MyTargetDefinition<Types, Models, ExtensionPacks, Capabilities>,
): MyTargetResult<Types, Models, ExtensionPacks, Capabilities>;
```

#### Starting at 0.12

```ts
import { defineContract as baseDefineContract } from '@internal/contract';
import type { ContractInput, ExtensionPackRef } from '@internal/contract';

type MyTargetResult<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = Omit<
  ReturnType<
    typeof baseDefineContract<MyFamily, MyTargetPack, Types, Models, ExtensionPacks>
  >,
  'target' | 'targetFamily'
> & {
  readonly target: MyTargetPack['targetId'];
  readonly targetFamily: MyFamily['familyId'];
};

type MyTargetBaseScaffold<
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = Omit<
  ContractInput<
    MyFamily,
    MyTargetPack,
    Record<never, never>,
    Record<never, never>,
    ExtensionPacks
  >,
  'family' | 'target' | 'types' | 'models'
>;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const ExtensionPacks extends
    | Record<string, ExtensionPackRef<'sql', string>>
    | undefined = undefined,
>(
  definition: MyTargetDefinition<Types, Models, ExtensionPacks>,
): MyTargetResult<Types, Models, ExtensionPacks>;
```

Drop the same parameter from every other overload signature (the factory-form overload, any convenience overload). Drop the matching entry from the type alias for `*Definition` and `*Scaffold` shapes. Drop the `Capabilities` argument from every internal `baseDefineContract<…, Capabilities>` instantiation and every internal `ContractInput<…, Capabilities>` instantiation. TypeScript will flag any remaining occurrence after the bump.

### Type tests that asserted authoring-time capability literals

If your facade ships a `define-contract.test-d.ts` (or similar) that asserts a `capabilities` literal is acceptable as an input to your `defineContract` — flip the assertion. The literal is now refused at the type level:

```ts
// Starting at 0.12
// @ts-expect-error — capabilities are contributed by components, not authoring input
defineContract({ capabilities: { sql: { lateral: true } } });
```

### Extensions that only emit fixtures — re-emit

If your extension does not ship a facade, you have no source change. The contract fixtures your extension emits as part of its test suite will, however, gain new capability keys after the bump. Re-run your fixture-emit script (commonly `pnpm fixtures:emit` or `pnpm test:fixtures:emit`) and commit the regenerated `contract.json` / `contract.d.ts`. Expect to see:

- `postgres.distinctOn: true` (added when a Postgres adapter is in the component graph)
- `sql.lateral: true` (added when the SQL family + a supporting adapter is in the component graph)

No fixture-shape changes other than capability additions; if your re-emit produces diffs in other sections of `contract.json`, that's a separate framework change, not this entry.

### Validation

After applying the edits, run `pnpm typecheck` and the matching test suite for your extension package. For facade-style extensions, the typecheck pinpoints every remaining occurrence of the `Capabilities` generic at compile time. For fixture-only extensions, the regenerated `contract.json` / `contract.d.ts` diff is the signal — review it to confirm the new capability keys landed where you expect.

## `strip-migration-labels-hints`

Starting at the 0.12 release, the migration manifest schema is closed (`'+': 'reject'`) and the metadata model no longer carries `labels` or `hints`. If your extension ships on-disk migration packages — for example an install-extension migration (`migrations/<timestamp>_install_…/migration.json`) that provisions your extension's database objects — any manifest that still holds either key fails to load: the loader rejects it with `INVALID_MANIFEST`, naming the first offending key (`labels` or `hints`). The two fields are also removed from the content-addressed migration identity — `migrationHash` is now computed over `{ from, to, providedInvariants, createdAt }` plus the sibling `ops.json` — so every migrated manifest additionally needs its hash recomputed over the slimmed envelope, or it fails hash verification on the next load.

Run the colocated codemod from your extension's package root:

```bash
pnpm exec tsx ./strip-migration-labels-hints.ts
```

It walks every `migration.json` that has a sibling `ops.json` (a complete on-disk migration package), removes the `labels` and `hints` keys, and recomputes `migrationHash` over the slimmed metadata plus the operations. The edit is format-preserving — only the two key lines are removed and the hash value is swapped in place, so the rest of each manifest (key order, indentation, inline-vs-expanded arrays) is left untouched and the diff stays minimal. The codemod is idempotent: re-running it over already-migrated manifests makes no further changes.

### Confirm every manifest is migrated

Run the codemod in dry-run mode to confirm no committed manifest still carries the removed keys or a stale hash:

```bash
pnpm exec tsx ./strip-migration-labels-hints.ts --check
```

`--check` lists every manifest that still needs fixing and exits non-zero if any remain, so wire it into your extension's CI alongside `prisma-8-check-pins`. A fully migrated tree reports `0 needing fix` and exits `0`.

### Validation

After running the codemod, run your extension's migration-loading tests (the integration suite that applies your install migration, or whatever exercises the on-disk packages). The loader recomputes and verifies each manifest's `migrationHash` on read: a manifest that still carried `labels`/`hints` would have thrown `INVALID_MANIFEST`, and a manifest with a stale hash would fail verification. Once the codemod has run, every manifest loads cleanly and its recomputed hash verifies against the slimmed envelope.

## `extension-public-default-baseline`

Starting at the 0.12 release, Postgres extension packs whose contract-space declares only storage types (no tables) emit their empty default namespace under `public` / `postgres-schema` instead of `__unbound__` / `postgres-unbound-schema`. The on-disk migration ops (`CREATE EXTENSION …`, invariant registration, etc.) are unchanged — only the contract hash envelope moves. Expect diffs in:

- `src/contract.json` / `src/contract.d.ts` — new `storageHash` and namespace keys
- `migrations/<baseline>/migration.json` — updated `to` and `migrationHash`
- `migrations/<baseline>/end-contract.json` / `end-contract.d.ts` — regenerated snapshots
- `migrations/<baseline>/migration.ts` — updated `describe().to` storage hash literal
- `migrations/refs/head.json` — updated `hash`

### Regenerate contract-space and baseline

Run the colocated script from your extension package root (or monorepo root if it hosts multiple extension packs):

```bash
pnpm exec tsx ./regenerate-extension-public-baseline.ts
```

For each extension root whose `src/contract.json` still carries `"kind": "postgres-unbound-schema"`, the script runs `pnpm build:contract-space`, copies `src/contract.{json,d.ts}` into each baseline migration directory as `end-contract.{json,d.ts}`, patches the baseline `migration.ts` `to` hash, self-emits the migration (`pnpm exec tsx migrations/.../migration.ts`), and updates `migrations/refs/head.json`.

Use `--check` to list packs that still need regeneration:

```bash
pnpm exec tsx ./regenerate-extension-public-baseline.ts --check
```

Path B baselines (hand-authored install migrations with no planner scaffold) follow the same loop documented in your extension README: edit `describe().to`, then self-emit.

### Validation

Run your extension's test suite and any migration-loading integration tests. Confirm `migrations/refs/head.json` `hash` matches `src/contract.json` `storage.storageHash`, and that the baseline `migration.json` `to` field matches as well.

## `domain-plane-spi-and-testing-subpath`

Starting at the 0.12 release, two SPI changes affect extension authors:

1. **Namespaced domain plane** — stop reading flat `contract.models` / `contract.valueObjects`. Models and value objects live under `contract.domain.namespaces.<ns>`. Use `domainModelsAtDefaultNamespace(contract.domain)` (reads the contract's sole namespace; throws on a multi-namespace contract — select explicitly per TML-2550) and `ContractModelDefinitions<C>` from `@internal/contract/types` for typed access. Storage remains under `contract.storage.namespaces.<ns>` (unchanged shape).

2. **Removed `@internal/contract/testing` subpath** — test factories moved to `@repo/test-utils`. Add `@repo/test-utils` to your extension's `devDependencies` at the same version pin as your other `@internal/*` packages if it is not already present.

### Migrate test imports

Run the colocated codemod from your extension root:

```bash
pnpm exec tsx ./migrate-contract-testing-imports.ts
```

It rewrites every `@internal/contract/testing` import to `@repo/test-utils`. Use `--check` for a dry-run:

```bash
pnpm exec tsx ./migrate-contract-testing-imports.ts --check
```

Exports are unchanged — only the package path moves:

```diff
-import { createContract, createSqlContract } from '@internal/contract/testing';
+import { createContract, createSqlContract } from '@repo/test-utils';
```

Subpath imports such as `@repo/test-utils/typed-expectations` were already on `@repo/test-utils` and are unaffected.

### Update SPI reads to the namespaced domain shape

Walk extension source that constructs or reads contracts directly (tests, control adapters, planners). TypeScript will flag most stale reads after the bump; the mechanical rewrites are:

**Reading models** — resolve through the target's default domain namespace:

```diff
-const models = contract.models;
+import { domainModelsAtDefaultNamespace } from '@internal/contract/types';
+
+const models = domainModelsAtDefaultNamespace(contract.domain);
```

**Patching models in tests** — nest under the domain namespace:

```diff
 return {
   ...contract,
-  models: patch({ ...contract.models }),
+  domain: {
+    namespaces: {
+      ...contract.domain.namespaces,
+      [namespaceId]: {
+        ...namespace,
+        models: patch({ ...domainModelsAtDefaultNamespace(contract.domain) }),
+      },
+    },
+  },
 };
```

**Hard-coded `__unbound__` namespace lookups for table resolution** — scan all storage namespaces (a table name is unique within the contract's default resolution path):

```diff
-const table = contract.storage.namespaces['__unbound__']?.tables[tableName];
+const table = Object.values(contract.storage.namespaces).find(
+  (ns) => ns.tables[tableName] !== undefined,
+)?.tables[tableName];
```

After source updates, re-emit fixture contracts (`pnpm fixtures:emit` or your package's equivalent) so committed `contract.json` / `contract.d.ts` under `test/` pick up `domain.namespaces`.

### Validation

Run `pnpm typecheck && pnpm test` on your extension package. The import codemod is deterministic; remaining errors indicate hand-edits for namespaced domain reads. Regenerated fixture diffs should show `domain.namespaces` and `ContractModelDefinitions` (or the emitted `Models` infer alias) in types.

## `default-namespace-domain-access-retire-projection-helpers`

Starting at the 0.12 release (runtime qualification, [ADR 223](../../../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md)), the foundation `contract` package retires the transitional projection helpers introduced during the symmetric domain-plane migration. Extension code that still calls them will fail to compile after the bump.

The default namespace a bare name resolves through is **inferred** from the contract (sole namespace, else insertion order) — there are no `…ForSqlTarget` / `…ForMongo` helpers to import. A target's default namespace is declared on its descriptor (`defaultNamespaceId`) and consumed only by authoring; runtime code resolves target-agnostically.

### Removed exports (old → new)

| Removed | Replacement |
|---|---|
| `contractModels(contract)` | `domainModelsAtDefaultNamespace(contract.domain)` (reads the sole namespace; throws on multi-namespace) |
| `contractValueObjects(contract)` | `domainValueObjectsAtDefaultNamespace(contract.domain)` |
| `resolveSingleDomainNamespaceId(domain)` | `soleDomainNamespaceId(domain)` (same fail-loud single-namespace behaviour) |
| `ContractModelsMap<C>` | `ContractModelDefinitions<C>` |
| `ContractValueObjectsMap<C>` | Read `contract.domain.namespaces[ns].valueObjects` for a specific namespace, or `domainValueObjectsAtDefaultNamespace(contract.domain)` for the default slot |

Import the replacements from `@internal/contract/types`.

### `qualifyTable` on SQL namespace concretions

Storage namespace envelopes in SQL-family contracts must carry a `qualifyTable(tableName: string): string` method. The Postgres and SQLite packs in this repo already implement it on bound/unbound namespace concretions; custom serializers or hand-built namespace objects in tests must include it or rendering falls back incorrectly.

### Hydrating contracts in tests

Do not `structuredClone` hydrated contracts — it strips functions such as `qualifyTable`. Round-trip through the target serializer instead:

```ts
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';

const serializer = new PostgresContractSerializer();
const hydrated = serializer.deserializeContract(serializer.serializeContract(rawContract));
```

### Namespace-qualified runtime SQL

Postgres query renderers now emit `"<schema>"."<table>"` (default schema `public`). Update extension integration tests that assert raw SQL strings (`FROM "user"` → `FROM "public"."user"`). SQLite remains unqualified. Application/extension call sites for `db.sql.*` / `db.*` are unchanged.

### Emitter guard (unchanged for multi-namespace extensions)

`assertSingleDomainNamespaceForEmission` still fails when emitting `contract.d.ts` for contracts with multiple domain namespaces ([TML-2550](https://linear.app/prisma-company/issue/TML-2550)). Runtime execution does not throw for multi-namespace contracts; only emission stays fail-loud.

### Validation

Run `pnpm typecheck && pnpm test` on your extension package. Grep for the removed symbol names should return no hits outside historical upgrade prose.

## Validation by execution

Apart from `strip-migration-labels-hints` (which ships the colocated codemod described above, validated against the migration manifests under `packages/3-extensions/`), these entries are prose-only (no codemod scripts). The substrate diffs inside `packages/3-extensions/` in this transition are the same code translations downstream extension authors will replicate by hand:

- The `windowFunc` method literally added to `bindWhereExprNode`'s `ExprVisitor` literal in `where-binding.ts`.
- The `windowFunc: rejectHavingExpr` literally added to `validateGroupedHavingExpr`'s `ExprVisitor` literal in `query-plan-aggregate.ts`.
- The `case 'window-func':` arms in the Postgres and SQLite adapter renderers.
- Flipped fixture row counts in the distinct integration tests.
- The `RuntimeVerifyOptions` → `VerifyMarkerOption` import rename, `verify?` → `verifyMarker?` on `*OptionsBase`, and `...ifDefined('verifyMarker', options.verifyMarker)` thread-through in `packages/3-extensions/sqlite/src/runtime/sqlite.ts`, `packages/3-extensions/postgres/src/runtime/postgres.ts`, and `packages/3-extensions/postgres/src/runtime/postgres-serverless.ts`.
- Retargeted option-forwarding and marker-drift tests in `packages/3-extensions/postgres/test/postgres-serverless.test.ts`.

There is no scriptable transform — the right body for the `ExprVisitor` method and the right arm for the exhaustive switch depend on what the consumer's visitor / switch does; the right test retargeting for marker drift depends on whether the test asserted throws or option forwarding. The release-pipeline gate (`pnpm check:upgrade-coverage`) is satisfied by this directory existing with at least one entry; the substantive verification of the consumer-facing translation lives in the published extension-upgrade skill's per-step bump-install-instructions-validate-commit loop, which runs in extension authors' own CI.
