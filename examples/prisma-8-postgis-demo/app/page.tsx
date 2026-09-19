import { point, polygon } from '@prisma/orm-extension-postgis/geojson';
import Link from 'next/link';
import { findCafesInBbox } from '../src/queries/find-cafes-in-bbox';
import { findCafesInNeighborhood } from '../src/queries/find-cafes-in-neighborhood';
import { findCafesNearPoint } from '../src/queries/find-cafes-near-point';
import { findCafesWithinRadius } from '../src/queries/find-cafes-within-radius';
import { findNeighborhoodForPoint } from '../src/queries/find-neighborhood-for-point';
import { findRoutesIntersecting } from '../src/queries/find-routes-intersecting';
import { cafes, neighborhoods, routes } from '../src/seed-data';
import { PostgisMap } from './components/map-client';
import { getPostgisVersion, getRuntime } from './lib/db';
import {
  parseQueryId,
  QUERY_GROUPS,
  QUERY_IDS,
  QUERY_META,
  type QueryId,
  type QueryKind,
  type QueryMeta,
} from './lib/queries-meta';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FERRY_BUILDING: readonly [number, number] = [-122.3937, 37.7955];
const DOWNTOWN_BBOX: readonly [number, number, number, number] = [-122.425, 37.775, -122.4, 37.8];
const CLOSURE_RING: ReadonlyArray<[number, number]> = [
  [-122.415, 37.78],
  [-122.405, 37.78],
  [-122.405, 37.79],
  [-122.415, 37.79],
  [-122.415, 37.78],
];

const PRESETS: ReadonlyArray<{ label: string; lng: number; lat: number }> = [
  { label: 'Ferry Building', lng: -122.3937, lat: 37.7955 },
  { label: 'Sightglass (SoMa)', lng: -122.4106, lat: 37.7765 },
  { label: 'Ritual (Mission)', lng: -122.4234, lat: 37.7615 },
  { label: 'Andytown (Sunset)', lng: -122.4955, lat: 37.7464 },
];

function num(value: string | string[] | undefined, fallback: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

type CafeRow = { id: string; name: string };
type NearRow = CafeRow & { meters: number };

type ActiveResult =
  | { kind: 'near'; rows: NearRow[] }
  | { kind: 'within'; rows: CafeRow[] }
  | { kind: 'contains'; rows: { id: string; name: string }[] }
  | { kind: 'soma'; rows: CafeRow[] }
  | { kind: 'intersect'; rows: { id: string; name: string }[] }
  | { kind: 'bbox'; rows: CafeRow[] };

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const active = parseQueryId(params['q']);
  const lng = num(params['lng'], FERRY_BUILDING[0]);
  const lat = num(params['lat'], FERRY_BUILDING[1]);
  const radius = num(params['radius'], 2_000);
  const limit = num(params['limit'], 5);

  const queryPoint = point(lng, lat, 4326);
  const closurePolygon = polygon(CLOSURE_RING.slice(), 4326);
  const soma = neighborhoods.find((n) => n.name === 'SoMa');
  if (!soma) throw new Error('SoMa neighborhood missing from seed data');

  const [version, result] = await Promise.all([
    getPostgisVersion(),
    runActive(active, { queryPoint, radius, limit, closurePolygon, somaBoundary: soma.boundary }),
  ]);

  const meta = QUERY_META[active];
  const highlight = highlightFor(result);

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <h1>Prisma 8 · PostGIS</h1>
          <p>
            Six geospatial queries over five SF cafes, three neighborhoods, two routes. Pick a query
            on the left to see what it does and which features it highlights.
          </p>
        </div>
        <div className="badges">
          <span className={`badge ${version ? 'badge-ok' : 'badge-warn'}`} title="PostGIS server">
            <span className="dot" />
            {version ? `PostGIS ${version}` : 'PostGIS — not detected'}
          </span>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          {QUERY_GROUPS.map((group) => (
            <div className="tab-group" key={group.id}>
              <div className="tab-group-label">{group.label}</div>
              {QUERY_IDS.filter((id) => QUERY_META[id].group === group.id).map((id) => (
                <TabLink
                  key={id}
                  meta={QUERY_META[id]}
                  active={id === active}
                  params={params}
                  queryId={id}
                />
              ))}
            </div>
          ))}

          <section className="panel">
            <div className="panel-head">
              <h2>{meta.title}</h2>
              <p>{meta.blurb}</p>
            </div>

            {needsPointForm(active) ? (
              <div className="section">
                <div className="section-label">Inputs</div>
                <form className="inline" action="/" method="GET">
                  <input type="hidden" name="q" value={active} />
                  <label>
                    <span>Lng</span>
                    <input name="lng" defaultValue={lng} step="any" type="number" />
                  </label>
                  <label>
                    <span>Lat</span>
                    <input name="lat" defaultValue={lat} step="any" type="number" />
                  </label>
                  {active === 'within' ? (
                    <label>
                      <span>Radius (m)</span>
                      <input name="radius" defaultValue={radius} step="any" type="number" />
                    </label>
                  ) : null}
                  {active === 'near' ? (
                    <label>
                      <span>Limit</span>
                      <input name="limit" defaultValue={limit} step="1" min="1" type="number" />
                    </label>
                  ) : null}
                  <button type="submit">Run</button>
                </form>
                <div className="presets">
                  {PRESETS.map((p) => (
                    <PresetLink
                      key={p.label}
                      preset={p}
                      active={active}
                      radius={radius}
                      limit={limit}
                    />
                  ))}
                  <span className="presets-hint">or click the map</span>
                </div>
              </div>
            ) : null}

            <div className="section">
              <div className="section-label">Result</div>
              <Results result={result} />
            </div>

            <details className="snippet">
              <summary>Show query builder code</summary>
              <p className="meta">
                <code>{meta.fn}()</code>
                <span className="op">{meta.postgis}</span>
              </p>
              <pre>{meta.snippet}</pre>
            </details>
          </section>
        </aside>

        <div className="map-wrap">
          {needsPointForm(active) ? (
            <div className="map-hint">Click the map to move the query point</div>
          ) : null}
          <PostgisMap
            cafes={[...cafes]}
            neighborhoods={[...neighborhoods]}
            routes={[...routes]}
            activeQuery={active}
            highlight={highlight}
            queryPoint={[lng, lat]}
            radiusMeters={active === 'within' ? radius : undefined}
            bbox={active === 'bbox' ? DOWNTOWN_BBOX : undefined}
            closurePolygon={active === 'intersect' ? CLOSURE_RING : undefined}
            somaBoundary={
              active === 'soma'
                ? (soma.boundary.coordinates[0]?.map((p) => [p[0], p[1]] as const) ?? undefined)
                : undefined
            }
          />
          <div className="map-meta">
            <Legend active={active} />
            <span>Tiles © OpenStreetMap contributors · CARTO</span>
          </div>
        </div>
      </div>
    </main>
  );
}

function needsPointForm(q: QueryId): boolean {
  return q === 'near' || q === 'within' || q === 'contains';
}

function TabLink({
  meta,
  active,
  params,
  queryId,
}: {
  meta: QueryMeta;
  active: boolean;
  params: Record<string, string | string[] | undefined>;
  queryId: QueryId;
}) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      const first = v[0];
      if (first !== undefined) next.set(k, first);
    } else {
      next.set(k, v);
    }
  }
  next.set('q', queryId);
  return (
    <Link href={`/?${next.toString()}`} className={active ? 'tab tab-active' : 'tab'}>
      <span className="tab-glyph" aria-hidden>
        <KindGlyph kind={meta.kind} />
      </span>
      <span className="tab-body">
        <span className="tab-title">{meta.title}</span>
        <span className="tab-tagline">{meta.tagline}</span>
      </span>
    </Link>
  );
}

function PresetLink({
  preset,
  active,
  radius,
  limit,
}: {
  preset: { label: string; lng: number; lat: number };
  active: QueryId;
  radius: number;
  limit: number;
}) {
  const next = new URLSearchParams({
    q: active,
    lng: String(preset.lng),
    lat: String(preset.lat),
  });
  if (active === 'within') next.set('radius', String(radius));
  if (active === 'near') next.set('limit', String(limit));
  return (
    <Link className="preset" href={`/?${next.toString()}`}>
      {preset.label}
    </Link>
  );
}

function Results({ result }: { result: ActiveResult }) {
  if (result.kind === 'near') {
    if (result.rows.length === 0)
      return <p className="empty">No cafes. Did you run `pnpm seed`?</p>;
    return (
      <table className="results">
        <thead>
          <tr>
            <th>#</th>
            <th>Cafe</th>
            <th className="num">Metres</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={row.id}>
              <td className="num">{i + 1}</td>
              <td>{row.name}</td>
              <td className="num">{Math.round(row.meters).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (result.rows.length === 0) {
    return <p className="empty">No matches.</p>;
  }
  return (
    <ul className="results-list">
      {result.rows.map((row) => (
        <li key={row.id}>{row.name}</li>
      ))}
    </ul>
  );
}

function KindGlyph({ kind }: { kind: QueryKind }) {
  if (kind === 'cafe') {
    return (
      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" focusable="false">
        <title>Cafe</title>
        <circle cx="9" cy="9" r="6" fill="#4f46e5" fillOpacity="0.15" stroke="#4f46e5" />
      </svg>
    );
  }
  if (kind === 'neighborhood') {
    return (
      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" focusable="false">
        <title>Neighborhood</title>
        <path
          d="M3 5 L13 3 L15 11 L8 15 L2 12 Z"
          fill="#7c3aed"
          fillOpacity="0.18"
          stroke="#7c3aed"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" focusable="false">
      <title>Route</title>
      <path
        d="M2 14 C 5 8, 9 14, 12 8 S 15 4, 16 4"
        stroke="#ea580c"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Legend({ active }: { active: QueryId }) {
  const showQueryPoint = active === 'near' || active === 'within' || active === 'contains';
  const showRadius = active === 'within';
  return (
    <div className="map-legend">
      <span className="legend-item">
        <span className="legend-glyph">
          <KindGlyph kind="cafe" />
        </span>
        Cafe
      </span>
      <span className="legend-item">
        <span className="legend-glyph">
          <KindGlyph kind="neighborhood" />
        </span>
        Neighborhood
      </span>
      <span className="legend-item">
        <span className="legend-glyph">
          <KindGlyph kind="route" />
        </span>
        Route
      </span>
      {showQueryPoint ? (
        <span className="legend-item">
          <span className="legend-glyph">
            <svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
              <title>Query point</title>
              <circle cx="9" cy="9" r="4" fill="#ea580c" stroke="#fff" strokeWidth="2" />
            </svg>
          </span>
          Query point
        </span>
      ) : null}
      {showRadius ? (
        <span className="legend-item">
          <span className="legend-glyph">
            <svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
              <title>Radius</title>
              <circle
                cx="9"
                cy="9"
                r="6"
                fill="none"
                stroke="#ea580c"
                strokeDasharray="2 2"
                opacity="0.7"
              />
            </svg>
          </span>
          Radius
        </span>
      ) : null}
    </div>
  );
}

function highlightFor(result: ActiveResult): {
  cafeIds?: ReadonlySet<string>;
  neighborhoodIds?: ReadonlySet<string>;
  routeIds?: ReadonlySet<string>;
} {
  if (
    result.kind === 'near' ||
    result.kind === 'within' ||
    result.kind === 'soma' ||
    result.kind === 'bbox'
  ) {
    return { cafeIds: new Set(result.rows.map((r) => r.id)) };
  }
  if (result.kind === 'contains') {
    return { neighborhoodIds: new Set(result.rows.map((r) => r.id)) };
  }
  return { routeIds: new Set(result.rows.map((r) => r.id)) };
}

async function runActive(
  active: QueryId,
  ctx: {
    queryPoint: ReturnType<typeof point>;
    radius: number;
    limit: number;
    closurePolygon: ReturnType<typeof polygon>;
    somaBoundary: (typeof neighborhoods)[number]['boundary'];
  },
): Promise<ActiveResult> {
  // Ensure the singleton `db` is connected before any query runs; the
  // query helpers go through `db.orm` / `db.runtime()` and rely on the
  // connection being open.
  await getRuntime();
  switch (active) {
    case 'near': {
      const rows = await findCafesNearPoint(ctx.queryPoint, ctx.limit);
      return { kind: 'near', rows };
    }
    case 'within': {
      const rows = await findCafesWithinRadius(ctx.queryPoint, ctx.radius, 50);
      return { kind: 'within', rows };
    }
    case 'contains': {
      const rows = await findNeighborhoodForPoint(ctx.queryPoint);
      return { kind: 'contains', rows };
    }
    case 'soma': {
      const rows = await findCafesInNeighborhood(ctx.somaBoundary);
      return { kind: 'soma', rows };
    }
    case 'intersect': {
      const rows = await findRoutesIntersecting(ctx.closurePolygon);
      return { kind: 'intersect', rows };
    }
    case 'bbox': {
      const rows = await findCafesInBbox(DOWNTOWN_BBOX);
      return { kind: 'bbox', rows };
    }
  }
}
