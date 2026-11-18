# ADR 277 — An emitted contract gets its type from `contractFromJson`, not from a declaration file next to the JSON

**Status:** Accepted
**Date:** 2026-10-19
**Domain:** Contract emission, Adapters / Targets
**Builds on:** [ADR 274 — A client takes a typed contract value, so every other option is inferred](ADR%20274%20-%20A%20client%20takes%20a%20typed%20contract%20value%2C%20so%20every%20other%20option%20is%20inferred.md), [ADR 159 — Definition-only contracts and type-only codec-operation maps](ADR%20159%20-%20Definition-only%20contracts%20and%20type-only%20codec-operation%20maps.md)

---

## At a glance

The emitter writes an application's contract as two files: `contract.json`, the data, and `contract.d.ts`, its type. An application joins the two in one call:

```ts
// src/prisma/db.ts
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);
export const db = postgres({ contract, url: process.env['DATABASE_URL']! });
```

TypeScript could instead give the import its type by itself, with no call. This ADR records why we do not do that.

## Decision

1. **`contractFromJson<Contract>(json)` is the one way an application gives an emitted contract its type.** It validates the JSON and returns it typed as the `Contract` the application names.
2. **The emitter writes `contract.json` and `contract.d.ts`, and nothing that types the JSON import.** An application needs no compiler setting for Prisma 8 beyond `resolveJsonModule`, which importing JSON already requires.

## Why

### An imported JSON file has the right shape but loses its literal types

When TypeScript imports `contract.json`, it infers a type from the file's content but widens every literal. The contract's `storage.namespaces.public.id` is typed `string`, where the contract's type says `"public"`. The shape is right; the precise types the query builders depend on are gone.

So something has to restore the literal types by naming `Contract`. There are two places that can happen: in the application's code, as `contractFromJson<Contract>(json)` does, or in a declaration file the emitter writes next to the JSON.

### A declaration file next to the JSON would work

TypeScript looks for a declaration file for a JSON import when `allowArbitraryExtensions` is set. An import of `./contract.json` then resolves to `contract.d.json.ts`, if it exists:

```ts
// contract.d.json.ts, which the emitter would write
import type { Contract } from './contract.d';
declare const contract: Contract;
export = contract;
```

The import is typed as `Contract`, so the application needs no call at all:

```ts
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres({ contract: contractJson, url: process.env['DATABASE_URL']! });
```

This has a real benefit beyond the shorter code. The emitter writes the declaration file and the JSON in the same run, so each JSON file always carries its own type. With `contractFromJson`, an application with two contracts can pair a type with the wrong file, `contractFromJson<ContractA>(contractBJson)`, and nothing catches it.

### It would require a compiler setting in every application

This is the deciding reason.

Without `allowArbitraryExtensions`, TypeScript stops at the import with TS6263 ("was resolved to `contract.d.json.ts`, but `--allowArbitraryExtensions` is not set"). The error names the fix, but every new project and every framework guide would carry the step. Many applications do not own their `tsconfig.json` outright: Next.js, Nuxt, SvelteKit and Astro generate it or have it extend their own, and monorepos share one base config.

The setting is not enough under `moduleResolution: nodenext`, which TypeScript recommends for Node servers and libraries. There, the declaration file must use `export =`, which TypeScript accepts in an ES module declaration file only when `skipLibCheck` is on (TS1203 otherwise). A project that checks its declaration files would get an error in a file it did not write.

A requirement on every application's compiler configuration is a cost every user pays, to save one line of code.

### The call says where the type comes from

A reader of `db.ts` can see `contractFromJson<Contract>(contractJson)` and search for it. With a declaration file, the type of `contractJson` comes from a file that appears nowhere in the code. The declaration file is also one more generated file in the application's source tree, and every tool that type-checks the application would have to resolve `.d.json.ts` files the way TypeScript does.

### Both approaches assert the literal type without checking it

`contractFromJson` validates that the JSON is a well-formed contract. It cannot check that it is *this* `Contract`: the type argument is the application's claim, as a declaration file's type would be. So the declaration file would not be less safe on that count. The one difference is timing. A declaration file types the import as a contract before anything has validated it, which matters only to code that reads the import directly instead of through a client.

## Consequences

- **An application writes one call, `contractFromJson<Contract>(contractJson)`,** and every client built from its result infers its own options (ADR 274).
- **Applications need no extra compiler setting.**
- **Pairing a type with its JSON is the application's job.** Nothing at run time can catch a wrong pairing: `contract.d.ts` carries the contract's hash only as a type, and types are erased before the code runs.

## Alternatives considered

### `declare module './contract.json'` in `contract.d.ts`

This would type the import without a new file. TypeScript rejects it. An ambient module declaration cannot name a relative module (TS2436). Written as a module augmentation inside `contract.d.ts`, it fails because `./contract.json` resolves to a JSON file, which cannot be augmented (TS2671).

### A wildcard declaration such as `declare module '*/contract.json'`

TypeScript uses a wildcard declaration only when an import does not resolve to a real file. With `resolveJsonModule` on, which a JSON import needs, the real file always wins and the declaration is ignored. With it off, every `contract.json` in the program would share one type, so an application with two contracts could not type both.

### Emit `contract.d.json.ts` next to `contract.json`

Described under "Why", and rejected because it requires a compiler setting in every application.

### Emit `contract.d.json.ts` only when a project opts in

The emitter could write the declaration file when a configuration option asks for it, for teams that have the setting and want the shorter code. It would be a second way to type the same contract, and it could never be the default, because the file stops every project that lacks the setting. It is not adopted.

### Generate a TypeScript module that exports the typed contract

Many libraries generate a small module such as `export const contract = …` with the type attached. That needs no compiler setting and no call. Prisma 8 emits a contract only as data, `contract.json`, with its types in `contract.d.ts`, and generates no executable code for it (ADR 159).
