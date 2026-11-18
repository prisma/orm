---
changes:
  - id: client-takes-contract-value
    summary: |
      Every client and static entry takes the contract only as a value, `{ contract }`. The `contractJson` option is removed, and so is the type argument on the client call: `postgres<Contract>({ contractJson, url })` no longer compiles. Turn the emitted JSON into a typed value once with `contractFromJson<Contract>(contractJson)` from the facade's `/static` entry (`@prisma/orm-postgres/static`, `@prisma/orm-sqlite/static`, `@prisma/orm-mongo/static`; Supabase uses the Postgres one), export it from the module that creates the client, and pass `{ contract }`. This applies to `postgres()`, `postgresServerless()`, `sqlite()`, `supabase()`, `mongo()`, `postgresStatic()`, `sqliteStatic()`, `mongoStatic()` and `mongoQuery()`. The colocated script moves source files; move test files by hand.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\w$.])(?:postgres|postgresServerless|sqlite|supabase|mongo|postgresStatic|sqliteStatic|mongoStatic|mongoQuery)(?:<[^>()]*(?:<[^>()]*>[^>()]*)*>)?\(\s*\{(?:(?:[^{}]|\{[^{}]*\})*?,)?\s*contractJson\s*[,}:]'
    script: ./scripts/contract-from-json.ts
---

# A client takes a typed contract value

A client no longer takes `contractJson` or a type argument. The emitted JSON becomes a typed value in one call, and every client infers its contract type from that value:

```ts
// Before
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({ contractJson, url: process.env['DATABASE_URL']! });

// After
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export const db = postgres({ contract, url: process.env['DATABASE_URL']! });
```

A contract value is validated once, however many clients are built from it. A contract written in TypeScript with `defineContract` is already a value: keep passing it as `{ contract }`.

## Run the script

Run `node <path to this guide>/scripts/contract-from-json.ts <project root>`. The script reads source files with the TypeScript compiler from the project's `typescript` package; if the project has none, it changes nothing, says so and exits 1. In each source file that passes `contractJson` to a client, static entry or `mongoQuery`, it:

- adds `import { contractFromJson } from '<facade>/static';`, or adds `contractFromJson` to an existing import of that entry, in the file's quote, semicolon and line-ending style;
- declares `export const contract = contractFromJson<Contract>(contractJson);` after the imports. In a module with a default export, such as a Worker entry, it declares `const contract` without `export` and prints a note: a Worker treats every named export of its entry module as an entrypoint, so a module that needs the value gets it from a separate module (see step 2 below);
- removes the type argument from the call and replaces the `contractJson` property with `contract`.

It prints each file it moved. It prints to stderr, with the reason, each file that passes `contractJson` but that it did not move, and then exits 1: a test file, a file that already has a binding named `contract` (rename that binding and run the script again), a file whose clients use different contracts, a file whose `contractJson` value uses a binding the file declares after its imports, and a call it cannot read. Move those by hand in the same way.

## Then, by hand

1. **Tests and other modules.** Where a test or another module builds a client or static entry from `contractJson`, import the exported `contract` from the module that creates the client instead of calling `contractFromJson` again:

   ```ts
   // Before
   const db = postgres<Contract>({ contractJson, url });

   // After
   import { contract } from '../src/prisma/db';

   const db = postgres({ contract, url });
   ```

2. **Browser modules.** If a module that browser code imports (for example a file a `'use client'` component imports, to read `enums`) also needs the contract, it must not import the module that creates the client, because that module loads the database driver. Move the declaration into a module that imports no driver, and import it from both:

   ```ts
   // src/contract-value.ts
   import { contractFromJson } from '@prisma/orm-mongo/static';
   import type { Contract } from './contract';
   import contractJson from './contract.json' with { type: 'json' };

   export const contract = contractFromJson<Contract>(contractJson);
   ```

   ```ts
   // src/db.ts
   import mongo from '@prisma/orm-mongo/runtime';
   import { contract } from './contract-value';

   // src/enums.ts
   import mongoStatic from '@prisma/orm-mongo/static';
   import { contract } from './contract-value';

   export const enums = mongoStatic({ contract }).enums;
   ```

3. **Several clients from one contract**, such as two serverless clients in a Worker, take the same `contract` value; the script already gives a file one value for all its clients.

4. **Types.** The option types `PostgresOptionsWithContract`, `PostgresOptionsWithContractJson`, `PostgresServerlessOptionsWithContract`, `PostgresServerlessOptionsWithContractJson`, `SqliteOptionsWithContract`, `SqliteOptionsWithContractJson`, `MongoOptionsWithContract`, `MongoOptionsWithContractJson`, `SupabaseOptionsWithContract` and `SupabaseOptionsWithContractJson` are removed. Use `PostgresOptions<Contract>`, `PostgresServerlessOptions<Contract>`, `SqliteOptions<Contract>`, `MongoOptions<Contract>` or `SupabaseOptions<Contract>`.

5. **Docs and comments** in the project that show `postgres<Contract>({ contractJson })` or another client called with `contractJson`: rewrite them to the new form.
