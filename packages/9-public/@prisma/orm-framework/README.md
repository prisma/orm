# @prisma/orm-framework

The target-agnostic core of Prisma 8: the contract model, the component/registry system, and the authoring surface that emitted contracts and application code reach at runtime.

Every application lists this package beside its database package (`@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/orm-mysql`, `@prisma/orm-mariadb`, `@prisma/orm-mongo`), at the same version, because the database package and every other Prisma package name it as a peer dependency; `prisma orm init` writes that list. Application code imports from the database package, not from this package. Extension authors and decomposed installs (applications replacing part of the default wiring) import it directly.

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
| `/target-package-config` | what a database package uses to restate its components' type declarations with its own module |

## Holding contract hashes fixed

Prisma records a contract's storage, profile and execution hashes in files and databases, and the rules that compute them do not change within a major version. A family or target built outside this repository can check that its own contracts keep their hashes: save a few emitted `contract.json` files, write down their hashes, and call `assertContractHashes` from a test with the family's canonicalization hooks. The storage hash covers the contract's `storage`, the profile hash its `capabilities` and the execution hash its `execution`, each with its `target` and `targetFamily`. A SQL target passes the SQL family's hooks, as below. It throws a `CONTRACT.HASH_MISMATCH` error naming each contract and hash that differs; the hashes the files store are ignored.

```ts
import { readFileSync } from 'node:fs';
import { sqlContractCanonicalizationHooks } from '@prisma/orm-family-sql/contract/canonicalization-hooks';
import { assertContractHashes } from '@prisma/orm-framework/contract/hashing';

const contract = JSON.parse(readFileSync(new URL('fixtures/users.json', import.meta.url), 'utf8'));

assertContractHashes({
  contracts: [{ name: 'users', contract, storageHash: '…', profileHash: '…', executionHash: '…' }],
  ...sqlContractCanonicalizationHooks,
});
```

A family outside the SQL family passes its own canonicalization hooks the same way.

## Responsibilities

Everything runtime and authoring code needs independently of a concrete database: contract representation and validation, component wiring, PSL handling, and shared utilities. No database drivers, no build tooling (that is `@prisma/orm-toolchain`).
