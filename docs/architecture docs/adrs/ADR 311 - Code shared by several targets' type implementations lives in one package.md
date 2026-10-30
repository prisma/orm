# ADR 311 — Code shared by several targets' type implementations lives in one package

**Status:** Accepted
**Amends:** [ADR 278 — Each database's packages live in one folder](ADR%20278%20-%20Each%20database's%20packages%20live%20in%20one%20folder.md), [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20@prisma%20scope%20with%20consolidated%20publish%20packages.md)

## At a glance

```ts
// packages/3-targets/sqlite/1-target/src/core/require-temporal.ts
import { findTemporal, type TemporalImplementation } from '@internal/type-implementations/temporal';
import { errorTemporalUnavailable, errorTemporalUnavailableForDefault } from './errors';

export function requireTemporal(meta: TemporalUnavailableMeta): TemporalImplementation {
  const temporal = findTemporal();
  if (temporal !== undefined) {
    return temporal;
  }
  throw 'generatorId' in meta
    ? errorTemporalUnavailableForDefault(meta.generatorId)
    : errorTemporalUnavailable(meta.codecId, meta.operation);
}
```

`findTemporal` is the same on every database: it returns the global `Temporal`, else the fallback set once per process, else `undefined`. The error is the target's own. Code like `findTemporal`, which the codecs, data types and `now()` generators of more than one target use, lives in `@internal/type-implementations`.

## Decision

1. **`@internal/type-implementations` holds code that more than one target's type implementations use and that depends on no database and no family.** It lives at `packages/3-targets/0-shared/type-implementations`.
2. **It holds value logic, not wiring.** It builds no SQL and no BSON. It has no codec classes, error envelopes or generator descriptors. Codec classes belong to a family: the SQL codecs build SQL expressions the MongoDB codecs cannot use. Errors and generator descriptors are built with Prisma's error and component interfaces, which the package does not depend on (decision 3). A function that finds a failure returns it as data, and the target raises its own error, even where two targets raise the same one, such as `RUNTIME.TEMPORAL_UNAVAILABLE`; that costs each target a wrapper of a few lines.
3. **It depends on nothing from Prisma.** Its only dependency is `temporal-spec`, for types. A test in the package fails if its manifest gains another runtime dependency.
4. **It is registered in the `targets` domain, plane `shared`.** The adapters, which register the `now()` generators, are in the `targets` domain and may import only from the framework, the families and the `targets` domain. The target packs, in the `extensions` domain, may import from every domain.
5. **It is published inside `@prisma/orm-framework`,** as `@prisma/orm-framework/type-implementations/*`. This amends ADR 242, whose platform packages otherwise follow the domain folders: `@prisma/orm-framework` carries the framework's layers and this one package besides. Every internal package reaches the registry inside one published package, and every target's published package depends on `@prisma/orm-framework`, so a process holds one copy, and one fallback `Temporal`. Which tarball carries it does not change where it sits in the layering.
6. **`packages/3-targets/` holds one folder per database, plus `0-shared/`** for packages that several databases' packages share. The check that a database's packages depend only on lower-numbered packages of their own database walks the database folders and skips `0-shared/` by name. The top-level `packages/0-shared/` is a different folder: it holds repository tooling registered in the framework domain, such as the map of published packages.

Today it holds the date and time logic: finding `Temporal` (`./temporal`), the `now()` values and their generator ids (`./now`), reading and writing Temporal values as ISO text (`./temporal-text`), checks on a JavaScript `Date` (`./date`) and the ISO 8601 duration pattern (`./duration`).

## Why

The convenience date and time types (ADR 279, ADR 312) put the same value logic in every target: PostgreSQL, SQLite, MySQL and MongoDB each find `Temporal`, produce `now()` as a `Temporal.Instant` or an ISO date string, and check that a `Temporal` value is the kind its column holds. Copying it into each target makes four copies that drift apart when one is fixed.

The framework is not the place for it. The framework holds the affordances every target fills in: interfaces, base classes and service contracts. Code that is shared only because several targets need it would grow the core and blur that boundary. Nor is it family code, because both families' targets use it.

## Consequences

- A target's date and time codecs import the value logic and keep their own wiring and errors.
- More logic of the same kind can move here: the safe-integer range checks of the `number`-valued 64-bit integer codecs, decimal text, the plain-JSON check (which ADR 257 plans to share), and the ISO date and time text reader that the framework holds today.
- Code that only one family can use, such as anything that builds SQL expressions, stays in that family's packages.

## Alternatives considered

**Copy the code into each target.** Nothing new to place, but four copies of the same logic that drift apart.

**Put it in `@internal/framework-components`.** Every target already depends on it. Rejected: the framework would hold code that is there only to be reused, not an affordance targets fill in.

**A new published package.** It would name the code's owner on npm. Rejected for now: ADR 242 fixes the list of published packages, and the code needs one copy per process, which `@prisma/orm-framework` already gives.
