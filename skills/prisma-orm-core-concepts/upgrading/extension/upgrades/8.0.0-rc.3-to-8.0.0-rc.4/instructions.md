---
from: "8.0.0-rc.3"
to: "8.0.0-rc.4"
changes:
  - id: prisma-config-hard-cut-and-top-level-commands
    summary: |
      The deprecated fallbacks are gone: the CLI no longer reads
      `prisma-next.config.ts`, no longer accepts the flat (un-nested) config shape, and the
      `prisma-next` command no longer exists. The unified CLI (`@prisma/cli`, installed from
      the `next` dist-tag; its binary is currently `prisma-cli`) runs the ORM commands at the
      top level — `contract emit`, `db init`, `migration plan`, `migrate` — with only `init`
      under the `orm` group (`orm init`), and the only config it reads is `prisma.config.ts`
      in the engine envelope shape.

      1. Rename `prisma-next.config.ts` to `prisma.config.ts` if you have not already.
      2. Rewrite the export to the envelope shape. Old flat shape:
         `import { defineConfig } from '@prisma/orm-postgres/config';`
         `export default defineConfig({ contract: '…', db: { connection: … } });`
         New shape:
         `import { definePrismaConfig } from '@prisma/cli-engine';`
         `import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';`
         `export default definePrismaConfig({ orm: ormConfig({ contract: '…', db: { connection: … } }) });`
         The options object moves into the target helper unchanged. The same pattern applies
         to `@prisma/orm-sqlite/config` and `@prisma/orm-mongo/config`.
      3. If the config reads `process.env`, keep (or add) `import 'dotenv/config';` as the
         first import — the loader does not read `.env` for you.
      4. In `package.json`, replace the `prisma-next` devDependency with `@prisma/cli@next`
         plus `@prisma/cli-engine` at the exact version that `@prisma/cli` names in its own
         dependencies, and update your extension's contract-space
         build and emit scripts from `prisma-next contract emit` to `prisma-cli contract emit`.
      5. Run `prisma-cli contract emit` to confirm the config loads and to regenerate the
         artifacts (their generated-file headers change with this release).
    detection:
      glob: "**/prisma-next.config.ts"
  - id: facades-compose-the-raw-lane
    summary: |
      A facade no longer gets the whole-query raw tag from the builder. `Db<C>` is a pure
      namespace map now, so the `raw` key it used to answer is gone, and the tag is composed at
      client build instead.

      Build it with `createRawLane({ context, rawCodecInferer })` from
      `@internal/sql-builder/runtime`, typed `RawLane<TContract>` from
      `@internal/sql-builder/types`, and expose it as your client's `raw`. Callers then write
      ``client.raw.sql`SELECT ...` ``. A client that binds per role or per scope builds one lane
      per bound context, the way it already builds one `sql` per context. A static context —
      the no-runtime shape that returns `context`, `contract` and `sql` — builds one too and
      returns it as `raw`.

      If your `raw` property was the contract-free expression tag (`createRawSql(inferer)`), it
      changes shape from a callable to `{ sql }`. That breaks your own surface, so note it in
      your release.
    detection:
      glob: "**/*.{ts,mts,cts}"
      regex:
        - 'createRawSql\('
        - 'RawSqlTag'
        # `fns.raw` is a fragment call site and is deliberately excluded:
        # fragments are unchanged by this release.
        - '(?<!(?<![\w$])fns)\.raw`'
      anyMatch: true
  - id: reserved-raw-namespace-check-removed
    summary: |
      `sql()` no longer refuses a contract whose storage declares a namespace named `raw`, and
      `ORM.NAMESPACE_RESERVED` leaves the error catalogue. Nothing raises the code now, so drop
      any branch that matched it: a test asserting the refusal, a doc listing the code, an
      error mapping of your own.
    detection:
      glob: "**/*.{ts,mts,cts,md}"
      contains:
        - "ORM.NAMESPACE_RESERVED"
      anyMatch: true
  - id: contract-fixture-restamp
    summary: |
      Committed contract artifacts (`contract.json` / `contract.d.ts`, including test
      fixtures) embed the toolchain version, which moves to 8.0.0-rc.4. Regenerate them
      with your emit script (`build:contract-space` or equivalent) after upgrading, or
      fixture comparisons fail on the version stamp alone.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.3"'
---

# 8.0.0-rc.3 → 8.0.0-rc.4 — Extension-author upgrade instructions

## `facades-compose-the-raw-lane`

`Db<C>` is a namespace map and nothing else, so a facade composes the whole-query raw tag itself
and exposes it as the raw lane:

```ts
import { createRawLane, sql } from '@internal/sql-builder/runtime';
import type { Db, RawLane } from '@internal/sql-builder/types';

const sqlDb: Db<TContract> = sql<TContract>({ context, rawCodecInferer });
const raw: RawLane<TContract> = createRawLane<TContract>({ context, rawCodecInferer });
```

Callers reach the tag at `client.raw.sql`. A client that binds per role or per scope builds one
lane per bound context, exactly as it already builds one `sql` per context.

A static context does the same. If your facade ships a no-runtime surface — the shape that
returns `context`, `contract`, `sql` and friends without opening a connection — build the lane
there too and return it as `raw`:

```ts
export interface YourStaticContext<TContract extends Contract<SqlStorage>> {
  readonly sql: Db<TContract>;
  readonly raw: RawLane<TContract>;
  // …context, contract, enums
}

const raw: RawLane<TContract> = createRawLane<TContract>({ context, rawCodecInferer });
```

Its `raw` property changes type from the contract-free tag to `RawLane<TContract>`, the same
change the connected client makes, so a consumer reads both surfaces the same way.

Two shapes change for your consumers. Anyone who wrote ``client.sql.raw`...` `` writes
``client.raw.sql`...` ``. Anyone who called `client.raw` as an expression tag calls
`client.raw.sql`...`.returns(codecId)` instead, or `fns.raw` inside a builder callback. Both are
breaking changes to your own surface, so note them in your release.

The detector looks for `createRawSql(`, `RawSqlTag`, and `raw` used as a tag. It skips the
receiver `fns` exactly, including `x.fns.raw`, because that is a fragment call site and needs no
change. A receiver that merely ends in those letters, such as `myfns.raw`, still matches, as
does a functions object aliased to another name.

## `reserved-raw-namespace-check-removed`

`sql()` used to refuse a contract whose storage declared a namespace named `raw`, raising
`ORM.NAMESPACE_RESERVED` at client construction. The check is gone with the constraint it
enforced: the lane is composed by the client, not answered by the namespace map, so no contract
can shadow it.

Drop any branch that matched the code — a test asserting the refusal, an error mapping, a doc
that lists it. The code no longer exists in the catalogue, and nothing raises it.
