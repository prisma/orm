# @internal/extension-postgis

Geospatial data for Prisma 8 on PostgreSQL, powered by [PostGIS](https://postgis.net).

Model points, lines, and polygons as first-class columns, query them with a type-safe DSL (`distance`, `containment`, `intersection`, `bounding-box`), and let the framework handle the wire format, SRID metadata, and `CREATE EXTENSION postgis` for you.

## What you get

- **`Geometry` column type** — store Points, LineStrings, Polygons, and their Multi-\* variants as a single `geometry` column. Optional SRID parameter (e.g. `Geometry(4326)` for WGS84 lng/lat) flows through to `contract.d.ts` and DDL.
- **GeoJSON-shaped runtime values** — read and write geometries as plain `{ type, coordinates }` objects. No PostGIS-specific client APIs to learn.
- **Seven query operations** on geometry columns: `distance`, `distanceSphere`, `dwithin`, `contains`, `within`, `intersects`, `intersectsBbox`.
- **Automatic `CREATE EXTENSION`** — the control descriptor declares `postgis` as a database dependency, so `prisma db init` ensures the server has it enabled before the first migration runs.
- **Both authoring paths** — works with PSL schemas and the TypeScript contract builder.

## Prerequisites

The PostGIS extension must be installable on your PostgreSQL server. Most managed providers (RDS, Cloud SQL, Supabase, Neon, …) include it; for local development the easiest route is the `postgis/postgis` Docker image, or a multi-arch fork like `imresamu/postgis` on Apple Silicon hosts.

## Installation

```bash
pnpm add @internal/extension-postgis
```

## Quick start

A complete five-step example — see [`examples/prisma-8-postgis-demo`](../../../examples/prisma-8-postgis-demo) for the full version with a seeded database, a Next.js UI, and e2e tests.

**1. Register the extension in `prisma.config.ts`:**

```typescript
import { defineConfig } from '@internal/cli/config-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import postgis from '@internal/extension-postgis/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [postgis],
});
```

**2. Declare a geometry column in your schema (PSL):**

```prisma
// use prisma-8

types {
  WgsGeometry = postgis.Geometry(4326)
}

model Cafe {
  id       Char(36)    @id @default(uuid())
  name     String
  location WgsGeometry
  @@map("cafe")
}
```

**3. Emit the contract and apply the migration:**

```bash
pnpm prisma contract emit   # generates contract.json + contract.d.ts
pnpm prisma db init         # CREATE EXTENSION postgis + CREATE TABLE
```

**4. Wire the extension into the runtime:**

```typescript
// src/prisma/db.ts
import postgres from '@internal/postgres/runtime';
import postgis from '@internal/extension-postgis/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({
  contractJson,
  extensions: [postgis],
  url: process.env['DATABASE_URL']!,
});
```

**5. Query:**

```typescript
import { point } from '@internal/extension-postgis/geojson';
import { db } from './prisma/db';

const ferryBuilding = point(-122.3937, 37.7955, 4326);

// Five nearest cafes, with their distance in metres.
const closest = await db.runtime().execute(
  db.sql.cafe
    .select('id', 'name')
    .select('meters', (f, fns) => fns.distanceSphere(f.location, ferryBuilding))
    .orderBy((f, fns) => fns.distanceSphere(f.location, ferryBuilding), { direction: 'asc' })
    .limit(5)
    .build(),
);
```

## Authoring schemas

### PSL

`postgis.Geometry(srid)` declares an SRID-constrained `geometry` column. Aliasing it via a `types {}` block keeps the SRID in one place when you have several geometry fields.

```prisma
types {
  WgsGeometry = postgis.Geometry(4326)
}

model Route {
  id   Char(36)    @id @default(uuid())
  name String
  path WgsGeometry        // LineStrings, polygons, points — all valid runtime values
  @@map("route")
}
```

`Geometry` without an SRID (`postgis.Geometry()`) is also valid for schemas that mix SRIDs at the row level.

### TypeScript contract builder

```typescript
import { textColumn, varcharColumn } from '@internal/adapter-postgres/column-types';
import sqlFamily from '@internal/family-sql/pack';
import { defineContract, field, model } from '@internal/sql-contract-ts/contract-builder';
import { geometry, geometryColumn } from '@internal/extension-postgis/column-types';
import postgis from '@internal/extension-postgis/pack';
import postgres from '@internal/target-postgres/pack';

export const contract = defineContract({
  family: sqlFamily,
  target: postgres,
  extensions: { postgis },
  models: {
    Cafe: model('Cafe', {
      fields: {
        id: field.column(varcharColumn).id(),
        name: field.column(textColumn),
        location: field.column(geometry({ srid: 4326 })), // SRID-constrained
      },
    }).sql({ table: 'cafe' }),
  },
});
```

`geometry({ srid })` is the dimensioned form (emits `geometry(Geometry, 4326)` in DDL). `geometryColumn` is the unconstrained form for schemas that need flexibility.

## Geometry values

Runtime geometries are GeoJSON-shaped objects: `{ type, coordinates, srid? }`. Build them with the constructors from `@internal/extension-postgis/geojson` rather than constructing the literals by hand — the constructors keep the coordinate ordering straight (`[lng, lat]`) and attach SRID metadata in one place.

```typescript
import { bboxPolygon, point, polygon } from '@internal/extension-postgis/geojson';

// Point — note: longitude first, latitude second.
const sightglass = point(-122.4106, 37.7765, 4326);

// Polygon — outer ring, optionally followed by holes. First point must equal last.
const soma = polygon(
  [
    [-122.418, 37.77],
    [-122.4, 37.77],
    [-122.4, 37.785],
    [-122.418, 37.785],
    [-122.418, 37.77],
  ],
  4326,
);

// Axis-aligned bbox polygon — handy for "what's in this map viewport?" queries.
const downtownViewport = bboxPolygon([-122.425, 37.775, -122.4, 37.8], 4326);
```

For `LineString`, `MultiPoint`, `MultiLineString`, and `MultiPolygon`, build the object literally:

```typescript
const route: Geometry = {
  type: 'LineString',
  coordinates: [[-122.4194, 37.7749], [-122.4106, 37.7765]],
  srid: 4326,
};
```

## Querying

All seven operations are available on any `geometry` column inside the SQL DSL's `.where()`, `.select()`, and `.orderBy()` callbacks via the `fns` argument:

```typescript
// Within radius — uses ST_DistanceSphere for sphere-accurate metres.
db.sql.cafe
  .select('id', 'name')
  .where((f, fns) => fns.distanceSphere(f.location, ferryBuilding) <= 2_000)
  .build();

// Point-in-polygon — "which neighborhood contains this point?"
db.sql.neighborhood
  .select('id', 'name')
  .where((f, fns) => fns.contains(f.boundary, sightglass))
  .build();

// Index-friendly bounding-box filter for map viewport queries.
db.sql.cafe
  .select('id', 'name')
  .where((f, fns) => fns.intersectsBbox(f.location, downtownViewport))
  .build();

// Routes that cross an arbitrary geometry (e.g. a road-closure polygon).
db.sql.route
  .select('id', 'name')
  .where((f, fns) => fns.intersects(f.path, closurePolygon))
  .build();
```

User-supplied geometries (the second argument to each operation) are bound as parameters, not interpolated. The codec encodes them as EWKT on the wire — see [Wire format](#wire-format) below.

## Operations reference

| Method | SQL | Returns | Use when |
| --- | --- | --- | --- |
| `distance(other)` | `ST_Distance(self, other)` | `float8` | Cartesian distance in the geometry's native units (degrees for SRID 4326). |
| `distanceSphere(other)` | `ST_DistanceSphere(self, other)` | `float8` | Sphere-accurate metres between two lng/lat geometries. |
| `dwithin(other, distance)` | `ST_DWithin(self, other, distance)` | `boolean` | Index-friendly "are these within X of each other?" — `distance` is in the geometry's native units. |
| `contains(other)` | `ST_Contains(self, other)` | `boolean` | Point-in-polygon and polygon-contains-polygon checks. |
| `within(other)` | `ST_Within(self, other)` | `boolean` | The inverse of `contains` — `A within B` ⇔ `B contains A`. |
| `intersects(other)` | `ST_Intersects(self, other)` | `boolean` | Any kind of overlap between two geometries. |
| `intersectsBbox(other)` | `self && other` | `boolean` | Cheap 2-D bounding-box overlap — fast viewport filtering. |

### Picking the right distance op

For SRID 4326 (WGS84) lng/lat data, `distance` returns **degrees**, which is rarely what you want. Use `distanceSphere` for human-friendly metres, or cast to `geography` upstream if you need ellipsoidal accuracy. `dwithin` interprets its `distance` argument in whatever units the inputs use — pair it with a projected SRS (or use `geography`) if you want metres directly.

## SRID and units

- Declare an SRID at the column level (`postgis.Geometry(4326)` / `geometry({ srid: 4326 })`) to constrain the column and have the runtime preserve the SRID through writes.
- `point(lng, lat, srid)`, `polygon(rings, srid)`, and `bboxPolygon(box, srid)` attach the SRID to the value; the codec emits it as `SRID=4326;…` on the wire.
- `distance` and `dwithin` are not unit-aware — they return whatever the SRS uses. If you need metres on WGS84 data, prefer `distanceSphere`.

## Wire format

- **JS → SQL**: values are emitted as EWKT (`SRID=4326;POINT(-122.39 37.79)`) and cast to `::geometry`. SRID is preserved through the `SRID=…;` prefix.
- **SQL → JS**: `node-postgres` returns `geometry` columns as hex-encoded EWKB. The codec parses Point, LineString, Polygon, MultiPoint, MultiLineString, and MultiPolygon. Z and M coordinates are **not** supported in this release; if a column carries them, decoding throws so the mismatch is visible rather than silent.

## Capabilities

The extension declares a single capability flag:

- `postgis.geometry` — gating signal for the `geometry` codec and the seven operations above.

Features that require it should declare a `requires: ['postgis.geometry']` constraint in their capability gate.

## Types

For consumers that need to reference the value or operation shapes directly:

```typescript
import type { CodecTypes, Geometry } from '@internal/extension-postgis/codec-types';
import type { OperationTypes, QueryOperationTypes } from '@internal/extension-postgis/operation-types';

// CodecTypes['pg/geometry@1']['output'] = Geometry (the GeoJSON union)
// Geometry<4326> is the SRID-branded form rendered into contract.d.ts.
```

## Demo

The end-to-end demo in [`examples/prisma-8-postgis-demo`](../../../examples/prisma-8-postgis-demo) walks through:

- Schema with three geometry shapes (`Point`, `LineString`, `Polygon`).
- Seeded data (five SF cafes, two delivery routes, three neighborhood polygons).
- One query file per operation — distance, radius, point-in-polygon, intersection, and bbox.
- A Next.js App Router UI that runs the queries as server components and renders the results on a Leaflet map.
- Vitest e2e tests that exercise the full pipeline against a local PostGIS container.

## References

- [PostGIS documentation](https://postgis.net/docs/)
- [Prisma 8 Architecture Overview](../../../docs/Architecture%20Overview.md)
- [Extension Packs Guide](../../../docs/reference/Extension-Packs-Naming-and-Layout.md)
