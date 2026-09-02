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
         dependencies, and rewrite scripts: `prisma-next <subcommand>` becomes
         `prisma-cli <subcommand>` (`migration apply` becomes `migrate`; `init` alone moves
         under the orm group as `prisma-cli orm init`).
      5. Run `prisma-cli contract emit` to confirm the config loads and to regenerate the
         artifacts (their generated-file headers change with this release).
    detection:
      glob: "**/prisma-next.config.ts"
  - id: raw-moves-to-its-own-lane
    summary: |
      Whole-query raw SQL moves address: ``db.sql.raw`SELECT ...` `` becomes
      ``db.raw.sql`SELECT ...` ``. Everything after the template is unchanged.
      `.returnsRow(spec)`, `.affectedCount()`, `.returns(codecId)`, and splicing a
      row-returning statement into another template all behave as they did.

      The client's `raw` property changes shape in the same move. It was a tagged template you
      could call directly for an expression fragment. It is now the raw lane, an object whose
      `sql` key holds the statement tag.

      An author who called `db.raw` as a fragment tag has two replacements. Use `fns.raw`
      inside a builder callback, which is where fragments belong. Or terminate the lane's tag
      with `.returns(codecId)` for the same expression, now bound to the contract.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      regex:
        # The old whole-query address, on any receiver.
        - '\.sql\.raw`'
        # The client tag being repurposed. `fns.raw` is a fragment call site and
        # is deliberately excluded: fragments are unchanged by this release.
        - '(?<!(?<![\w$])fns)\.raw`'
      anyMatch: true
  - id: raw-is-no-longer-a-reserved-namespace
    summary: |
      A storage namespace named `raw` is allowed again. 8.0.0-rc.2 and 8.0.0-rc.3 refused such a contract when
      the client was built, with `ORM.NAMESPACE_RESERVED`, because the SQL surface answered
      `db.sql.raw` with the raw tag. The tag has moved to `db.raw.sql`, so nothing a contract
      declares can collide with it.

      If you renamed a namespace to get past that error, you may rename it back:
      `@@schema("raw")` is an ordinary name, reachable as `db.sql.raw.<table>`. Re-emit the
      contract afterwards, then plan the rename against the database as you would any other
      namespace rename. The physical schema keeps the name it has until a plan moves it.
      Renaming back is optional: a namespace you renamed away stays valid.
    detection:
      glob: "**/*.{prisma,json}"
      contains:
        - "ORM.NAMESPACE_RESERVED"
        - '@@schema("raw")'
      anyMatch: true
  - id: contract-artifacts-restamp
    summary: |
      The emitted `contract.json` / `contract.d.ts` embed the toolchain version, which moves
      to 8.0.0-rc.4. Run `contract emit` once after upgrading so the emitted artifacts match
      the installed toolchain. This applies even to projects whose config needed no
      migration — the restamp is independent of the config changes above.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.3"'
---

# 8.0.0-rc.3 → 8.0.0-rc.4 — User upgrade instructions

## `raw-moves-to-its-own-lane`

Whole-query raw SQL has its own front door. The tag that sat inside the namespace map is now a
lane on the client:

```ts
// Before
const plan = db.sql.raw`SELECT id, email FROM users WHERE id = ${1}`
  .returnsRow({ id: users.columns.id, email: users.columns.email })
  .build();

// After
const plan = db.raw.sql`SELECT id, email FROM users WHERE id = ${1}`
  .returnsRow({ id: users.columns.id, email: users.columns.email })
  .build();
```

Everything after the template is unchanged: the terminators, the row specs they take, the plans
they build, and splicing a row-returning statement into another template.

The client's `raw` property changes shape in the same move. It was the expression tag you could
call directly; it is now the lane, whose `sql` key holds the statement tag:

```ts
// Before: `raw` is a tag
const upper = db.raw`UPPER(${email})`.returns('pg/text@1');

// After, inside a builder callback — where fragments belong
const rows = db.sql.public.users
  .select((f, fns) => ({ upper: fns.raw`UPPER(${f.email})`.returns('pg/text@1') }))
  .build();

// After, from the lane, for a fragment you hold on its own
const upper = db.raw.sql`UPPER(${email})`.returns('pg/text@1');
```

The detector looks for the old address and for `raw` used as a tag. It skips the receiver `fns`
exactly, including `x.fns.raw`, because that is a fragment call site and needs no change. A
receiver that merely ends in those letters, such as `myfns.raw`, still matches. So does a
builder callback that names its functions object something else. Check whether the receiver is
a client before you change anything.

## `raw-is-no-longer-a-reserved-namespace`

8.0.0-rc.2 and 8.0.0-rc.3 refused a contract whose storage declared a namespace named `raw`, because that was
the key the SQL surface answered with the raw tag:

```text
ORM.NAMESPACE_RESERVED: The SQL surface exposes the raw statement tag as "db.raw", so a storage
namespace named "raw" cannot be reached through it. Rename the namespace in the schema.
```

That constraint is gone. `db.sql` is a namespace map and nothing else, and the lane is composed
by the client rather than derived from your contract, so the two cannot collide.

If you renamed a namespace to get past the error, you may rename it back:

```prisma
model Event {
  id String @id
  @@schema("raw")
}
```

Its tables are then reachable as `db.sql.raw.<table>`, like any other namespace. Re-emit the
contract, and plan the rename against the database as you would any other namespace rename —
the physical schema carries the old name until a plan moves it. Renaming back is optional; the
name you moved to stays valid.
