# Slice 1: clients take a typed contract value

Ticket: TML-3602. Branch: `tml-3602-clients-take-a-typed-contract-value` from `main`. Project: [../../spec.md](../../spec.md). Decision: ADR 274.

## At a glance

```ts
import { contractFromJson } from '@prisma/orm-postgres/static';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);
export const db = postgres({ contract, url: process.env['DATABASE_URL']! });
```

`postgres<Contract>({ contractJson })` no longer compiles.

## Chosen design

1. **`contractFromJson<TContract>(json: unknown): TContract`** is exported from the `/static` entry point of `@internal/postgres`, `@internal/sqlite` and `@internal/mongo` (published as `@prisma/orm-postgres/static`, `@prisma/orm-sqlite/static`, `@prisma/orm-mongo/static`). It validates and hydrates with the target's existing contract serializer, exactly as the clients do today, and returns the result typed as `TContract`. `TContract` is constrained like each client's contract parameter (`Contract<SqlStorage>` for SQL, the Mongo contract type for Mongo). Supabase applications use the Postgres one.
2. **Every client and static entry takes `{ contract }` only.** `postgres()`, `postgresServerless()`, `sqlite()`, `supabase()`, `mongo()`, `postgresStatic()`, `sqliteStatic()`, `mongoStatic()`, and `mongoQuery()` lose the `contractJson` option, the `_contract` / `__contractPhantom` phantom fields, and the overload that took them. Each infers its contract type from `contract`.
3. **A contract value is validated once.** A value returned by `contractFromJson`, or one a client has already validated, is not validated again when another client or static entry is built from it. The mark that records "already validated" must work across a facade's entry points after bundling (`/static` and `/runtime` are separate bundles), so it cannot be module-local state such as a `WeakSet` in one file. A value that was not validated (for example a `defineContract` result passed straight to a client) is still validated, once.
4. **Every call site moves** to `contractFromJson` plus `{ contract }`, or to `{ contract }` alone where the code already has a typed value:
   - package tests, `test/integration`, `test/e2e`, example tests;
   - examples, `apps/telemetry-backend`, the `orm init` templates and their snapshots;
   - package READMEs, JSDoc on the factories, `docs/` (including ADR examples that show current usage: ADR 159, 230, 263, 266, 272), and the skills under `skills/prisma-8/` except the frozen upgrade guides under `skills/prisma-8/upgrading/**/upgrades/**`;
   - the rule in `AGENTS.md` ("name the `contract.d.ts` type where the JSON enters"), which now names `contractFromJson`. `.agents/rules/typed-contract-in-tests.mdc` keeps `validateSqlContractFully<Contract>(json)` for tests that need a contract without a client, and adds the client form.
5. **Upgrade instructions** for both audiences under `upgrade-instructions/pending/`, following the `record-upgrade-instructions` skill: applications move `db.ts`; extension authors move any call that passes `contractJson`.

## Coherence rationale

One reviewer can hold this in one sitting: one new function, one option removed from every factory, and a mechanical move of call sites. The call-site move is large but uniform.

## Scope

**In:** everything above.

**Out:**
- `collections` (slice 2). This slice only makes the client call free of explicit type arguments.
- Any change to the contract IR, emitted files or hashing.
- `validateSqlContractFully` and the serializers themselves: they stay as they are.
- Frozen upgrade guides under `skills/prisma-8/upgrading/**/upgrades/**`, and `projects/` planning documents of other projects.

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| `postgres({ contract })` with a value typed as the emitted `Contract` (a `ContractWithTypeMaps`) | Must infer the full type, including type maps. No type test covers this today; add one per client. |
| The serverless client validates at factory time, then each `connect()` reuses the resolved contract | Keep it: one validation per serverless client. |
| Supabase deserializes its own extension contract internally | Not an application contract; leave it. |
| Mongo passes `contract` straight to `deserializeContract` with no serialize step | Keep Mongo's behaviour; apply the validate-once mark the same way. |
| `contractFromJson` given invalid JSON | Throws the same structured error the clients throw today. |
| The Cloudflare Worker example builds two serverless clients from one contract | Both built from one `contractFromJson` value; validation runs once in total. |

## Slice-specific done conditions

- No client, static entry or `mongoQuery` accepts `contractJson`; a negative type test proves it for `postgres()`.
- A type test per client shows the contract type inferred from a `contractFromJson` value.
- A test shows that building two clients from one `contractFromJson` value validates once.
- A test shows that importing each `/static` entry does not load `pg`, `node:sqlite` or `mongodb`.
- `git grep` finds no `contractJson` option passed to a factory outside frozen upgrade guides and other projects' `projects/` folders.

## Dispatch plan

### D1. The function and the new client option

- **Outcome:** `contractFromJson` exists on the three `/static` entries; every factory and static entry takes `{ contract }` only and validates a contract once; the facade packages' own tests pass using the new form, with the new type tests, negative type test, validate-once test and driver-free import test.
- **Builds on:** `main`.
- **Hands to D2:** the new API, built (`pnpm build` for the facade packages), so dependent packages can be migrated.
- **Focus:** `packages/3-extensions/{postgres,sqlite,mongo,supabase}`.

### D2. Move every call site

- **Outcome:** every call site in the list under "Chosen design" item 4 uses the new form, the `AGENTS.md` rule and test rule are updated, and the touched tests pass.
- **Builds on:** D1.
- **Hands to D3:** a repository with no `contractJson` factory option in use.
- **Focus:** mechanical fan-out. No design judgement; anything that is not a straight move is reported back.

### D3. Upgrade instructions and repository checks

- **Outcome:** upgrade instructions for applications and extension authors; `pnpm check:upgrade-coverage`, `pnpm lint:throws`, `pnpm fixtures:check`, `pnpm lint:deps`, `pnpm typecheck`, `pnpm test:packages` and per-package coverage pass.
- **Builds on:** D2.
- **Hands to:** PR open.
