---
changes:
  - id: client-takes-contract-value
    summary: |
      Every client and static entry takes the contract only as a value, `{ contract }`. The `contractJson` option is removed, and so is the type argument on the client call: `postgres<Contract>({ contractJson, url })` no longer compiles. Turn the emitted JSON into a typed value once with `contractFromJson<Contract>(contractJson)` from the facade's `/static` entry (`@prisma/orm-postgres/static`, `@prisma/orm-sqlite/static`, `@prisma/orm-mongo/static`; Supabase uses the Postgres one), export it from the module that creates the client, and pass `{ contract }`. This applies to `postgres()`, `postgresServerless()`, `sqlite()`, `supabase()`, `mongo()`, `postgresStatic()`, `sqliteStatic()`, `mongoStatic()` and `mongoQuery()`. Extension packages that build a client, static entry or `mongoQuery` in their code, examples or tests move the same way. The colocated script moves source files; move test files by hand.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\w$.])(?:postgres|postgresServerless|sqlite|supabase|mongo|postgresStatic|sqliteStatic|mongoStatic|mongoQuery)(?:<[^>()]*(?:<[^>()]*>[^>()]*)*>)?\(\s*\{(?:(?:[^{}]|\{[^{}]*\})*?,)?\s*contractJson\s*[,}:]'
    script: ./scripts/contract-from-json.ts
---

# A client takes a typed contract value

A client, static entry or `mongoQuery()` no longer takes `contractJson` or a type argument. If your extension's code, examples or tests build one from emitted JSON, turn the JSON into a typed value with `contractFromJson<Contract>(json)` from the facade's `/static` entry and pass `{ contract }`:

```ts
// Before
const db = postgres<Contract>({ contractJson, extensions: [myPack] });

// After
import { contractFromJson } from '@prisma/orm-postgres/static';

const db = postgres({ contract: contractFromJson<Contract>(contractJson), extensions: [myPack] });
```

A value is validated once however many clients use it, so build it once per module and share it. A contract written with `defineContract` is already a value: keep passing it as `{ contract }`.

`mongoQuery()` takes `{ contract }`, a value typed as the contract, and infers the type from it: `mongoQuery({ contract }).from('orders')`. A test that only needs the types can declare the value: `declare const contract: Contract;`.

## Run the script

Run `node <path to this guide>/scripts/contract-from-json.ts <package root>`. The script reads source files with the TypeScript compiler from the package's `typescript`; if there is none, it changes nothing, says so and exits 1. It moves each source file that passes `contractJson` to a client, static entry or `mongoQuery`: it adds the `contractFromJson` import, declares `export const contract = contractFromJson<Contract>(contractJson);` after the imports (`const contract` without `export` in a module with a default export, with a note), removes the type argument and passes `{ contract }`. It prints each file it moved, and prints to stderr with the reason, then exits 1, each file it did not move: a test file, a file that already has a binding named `contract`, a file whose clients use different contracts, a file whose `contractJson` value uses a binding declared after the imports, or a call it cannot read.

## Then, by hand

1. **Tests.** Move each test that passes `contractJson` the same way: `postgres({ contract: contractFromJson<Contract>(contractJson) })`, or one `const contract = contractFromJson<Contract>(contractJson);` per file when several clients share it.
2. **Types.** The option types `PostgresOptionsWithContract`, `PostgresOptionsWithContractJson`, `PostgresServerlessOptionsWithContract`, `PostgresServerlessOptionsWithContractJson`, `SqliteOptionsWithContract`, `SqliteOptionsWithContractJson`, `MongoOptionsWithContract`, `MongoOptionsWithContractJson`, `SupabaseOptionsWithContract` and `SupabaseOptionsWithContractJson` are removed. Use `PostgresOptions<Contract>`, `PostgresServerlessOptions<Contract>`, `SqliteOptions<Contract>`, `MongoOptions<Contract>` or `SupabaseOptions<Contract>`.
3. **READMEs and JSDoc** that show a client called with `contractJson`: rewrite them to the new form.
