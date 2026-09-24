# Welcome to Prisma ORM 8!

Prisma ORM lets you query your database in simple, easy-to-read TypeScript. This project keeps its Prisma 7 schema and migrations, and Prisma 8 reads that schema as its contract source, so both run side by side while you move your code over.

{{requirements}}

## Your contract source

Your contract source is your Prisma 7 schema at [`{{schemaPath}}`]({{schemaPath}}). Prisma 7 keeps owning it: edit it as before and migrate with `prisma7 migrate dev`. Prisma 8 compiles it into two companion files under `{{outputDir}}/`:

- **`contract.json`** — this tells your application what models exist, just like `package-lock.json` tells your package manager what dependencies your project has
- **`contract.d.ts`** — this powers autocomplete and type checking in your editor

Commit both files to git. When the schema changes, run `{{pkgRun}} contract emit` to update them.

Every model in your schema can be queried from your app through the Prisma 8 client:

```typescript
import { db } from '{{dbImportPath}}';

const user = await db.orm.public.User
  .where({ email: 'alice@example.com' })
  .first();
```

## Configuration

[`prisma.config.ts`](prisma.config.ts) tells the Prisma 8 CLI where your contract source lives and how to connect to your database.{{prisma7ConfigSentence}}

```typescript
import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig, prisma7Schema } from '{{configEntrypoint}}';

export default definePrismaConfig({
  orm: ormConfig({
    contract: prisma7Schema('{{schemaPath}}'),
    output: '{{outputDir}}',
    db: {
      connection: process.env['DATABASE_URL']!,
    },
  }),
});
```

`DATABASE_URL` is read from your [`.env`](./.env) file:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/mydb"
```

## The transition loop

1. Run `{{pkgRun}} db sign` once so Prisma 8 knows the database matches the contract.
2. Move your routes to the Prisma 8 client in [`{{outputDir}}/db.ts`]({{outputDir}}/db.ts) one at a time.
3. After each `prisma7 migrate dev`, run `{{pkgRun}} contract emit` and then `{{pkgRun}} db sign`.

## Quick reference

### Commands

```bash
{{pkgRun}} contract emit       # Update contract.json and contract.d.ts from the schema
{{pkgRun}} db sign             # Record that the database matches the contract
prisma7 migrate dev            # Migrate with Prisma 7, as before
```

### Files

| File | Purpose |
|---|---|
| [`{{schemaPath}}`]({{schemaPath}}) | Your Prisma 7 schema — the contract source |
| [`prisma.config.ts`](prisma.config.ts) | Prisma 8 CLI configuration |{{prisma7ConfigRow}}
| [`{{outputDir}}/db.ts`]({{outputDir}}/db.ts) | Database client — `import { db } from '{{dbImportPath}}'` |
| `{{outputDir}}/contract.json` | Compiled contract (generated) |
| `{{outputDir}}/contract.d.ts` | Contract types (generated) |

## Monorepo notes (pnpm workspaces)

If this project lives inside a pnpm workspace, `pnpm-workspace.yaml` catalogs for `prisma` or `{{pkg}}` take precedence over `latest`; update or remove the catalog entry and re-run `pnpm install` if you wanted the published version.
