# @prisma/orm-framework

The target-agnostic core of Prisma 8: the contract model, the component/registry system, and the authoring surface that emitted contracts and application code reach at runtime.

Most applications never install this package directly — it arrives as an exact-pinned dependency of a database facade (`@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/orm-mongo`), which is the package app developers should install. Extension authors and decomposed installs (applications replacing part of the default wiring) depend on it directly.

## Entrypoints

Each subpath namespace consolidates one internal framework module; a bare namespace import (e.g. `@prisma/orm-framework/contract`) aggregates that module's full surface, and deeper paths (e.g. `@prisma/orm-framework/contract/hashing`) select individual modules.

| Namespace | Surface |
| --- | --- |
| `/contract` | contract types, validation, hashing, domain resolution |
| `/components` | component descriptors, control stack, registries, codecs |
| `/contract-authoring` | authoring-time contract construction |
| `/psl-parser`, `/psl-printer` | PSL parsing, formatting, printing |
| `/config` | configuration types and validation |
| `/errors` | control, execution, and migration error types |
| `/ids`, `/operations`, `/ts-render`, `/utils` | identifiers, operation model, TypeScript rendering, shared utilities |
| `/type-implementations` | value logic that more than one target's codecs, data types and `now()` generators share |
| `/target-package-config` | what a target package uses to restate its components' type declarations with its own module |

## Holding contract hashes fixed

Prisma records a contract's storage, profile and execution hashes in files and databases, and the rules that compute them do not change within a major version. A family or target built outside this repository can check that its own contracts keep their hashes: save a few emitted `contract.json` files, write down their hashes, and call `assertContractHashes` from a test with the family's canonicalization hooks. If the family computes the profile hash from other capabilities than the contract's `capabilities`, pass them as `profileHashCapabilities`, a function from the saved contract to the capabilities hashed. The SQL family hashes none, so a SQL target passes the SQL family's hooks and `sqlProfileHashCapabilities`, as below; without it, the check computes a profile hash other than the one Prisma writes. It throws a `CONTRACT.HASH_MISMATCH` error naming each contract and hash that differs; the hashes the files store are ignored.

```ts
import { readFileSync } from 'node:fs';
import {
  sqlContractCanonicalizationHooks,
  sqlProfileHashCapabilities,
} from '@prisma/orm-family-sql/contract/canonicalization-hooks';
import { assertContractHashes } from '@prisma/orm-framework/contract/hashing';

const contract = JSON.parse(readFileSync(new URL('fixtures/users.json', import.meta.url), 'utf8'));

assertContractHashes({
  contracts: [{ name: 'users', contract, storageHash: '…', profileHash: '…', executionHash: '…' }],
  ...sqlContractCanonicalizationHooks,
  profileHashCapabilities: sqlProfileHashCapabilities,
});
```

A family outside the SQL family passes its own canonicalization hooks the same way, and leaves out `profileHashCapabilities` when its profile hash covers the contract's `capabilities`.

## Responsibilities

Everything runtime and authoring code needs independently of a concrete database: contract representation and validation, component wiring, PSL handling, and shared utilities. No database drivers, no build tooling (that is `@prisma/orm-toolchain`).
