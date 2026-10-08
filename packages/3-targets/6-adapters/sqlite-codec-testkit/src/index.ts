/**
 * Database-backed conformance harness for SQLite codec JSON projections.
 *
 * For one codec descriptor and one representative application value the harness
 * writes the value through the codec's `toWire`, stores it in a column of the
 * case's storage type, and reads the column back twice: as an ordinary row, and
 * through `descriptor.projectJson()` inside a JSON constructor, the way an
 * `include` reads it.
 *
 * A projection conforms when the codec's `fromWire` reads the projected value to
 * the same application value it reads the ordinary row's value to (ADR 254,
 * "Rows the database returns as JSON"), and that value is the one the case
 * started from.
 *
 * For every case the harness also checks that `toDataTypeValue(fromDataTypeValue(v))`
 * equals `v`, where `v` is the value `toDataTypeValue` gives for the case.
 *
 * `projectJson()` is called directly rather than reached through a
 * query-planning or rendering path, which is what lets the harness measure
 * projections that no production query reaches.
 *
 * A SQLite codec descriptor carries no native type — the SQLite descriptor
 * protocol is `projectJson` alone — so each case states the storage type its
 * column is declared with.
 *
 * The API is framework-independent and takes a caller-supplied connection, so
 * assertion style and case enumeration stay with the caller.
 */

import { inspect, isDeepStrictEqual } from 'node:util';
import { renderLoweredSql } from '@internal/adapter-sqlite/sql-renderer';
import type { SqliteContract } from '@internal/adapter-sqlite/types';
import { computeProfileHash, computeStorageHash } from '@internal/contract/hashing';
import type { JsonValue } from '@internal/contract/types';
import { UNBOUND_DOMAIN_NAMESPACE_ID } from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import { dataTypeValuesEqual, validateCodecTypeParams } from '@internal/framework-components/codec';
import { SqlStorage } from '@internal/sql-contract/types';
import {
  ColumnRef,
  JsonObjectExpr,
  NativeJsonValueProjection,
  ProjectionItem,
  SelectAst,
  type SqlCodecCallContext,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { AnySqliteCodecDescriptor } from '@internal/target-sqlite/codec-descriptor';
import { sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import { ifDefined } from '@internal/utils/defined';
import { structuredError } from '@internal/utils/structured-error';

/**
 * Minimal execution surface the harness needs from a live database. A caller
 * adapts whichever client it already owns, as long as each row carries its
 * values as the runtime driver returns them: the wire values `fromWire` reads.
 */
export interface ConformanceConnection {
  query(sql: string, params?: readonly unknown[]): Promise<ReadonlyArray<Record<string, unknown>>>;
}

/**
 * How a case can fail. The kinds are materially different — a projection whose SQL
 * will not execute and one that merely rounds a digit are not the same defect —
 * so a case that records one kind is not satisfied by another.
 */
export type ProjectionFailureKind =
  /** The projection SQL did not execute. */
  | 'execution'
  /** `toDataTypeValue` refused the application value. */
  | 'to-data-type-value-rejects'
  /** `toDataTypeValue(fromDataTypeValue(v))` is not `v`. */
  | 'value-round-trip'
  /** The driver could not read the ordinary row, though `fromWire` reads the projected value to the application value the case wrote. */
  | 'row-execution'
  /** `fromWire` refused the ordinary row's value. */
  | 'row-from-wire-rejects'
  /** `fromWire` of the ordinary row's value is not the application value the case wrote. */
  | 'lossy-round-trip'
  /** `fromWire` refused the projected value. */
  | 'projection-from-wire-rejects'
  /** `fromWire` reads the projected value to another application value than the ordinary row's, or a NULL column projected as a value. */
  | 'mismatch';

export interface ProjectionFailure {
  readonly kind: ProjectionFailureKind;
  /** What went wrong, in enough detail to diagnose from a test report. */
  readonly detail: string;
}

/** The disagreement a case records, so the suite can assert the kind and not merely that something failed. */
export interface ExpectedProjectionFailure {
  readonly kind: ProjectionFailureKind;
  /** Why this case's projection disagrees with the codec's current methods. */
  readonly reason: string;
}

export interface SqliteCodecConformanceCase {
  /** Codec id, resolved against the target's built-in descriptor registry unless `descriptor` is given. */
  readonly codecId: string;
  /**
   * Descriptor to project through, for a codec an extension contributes rather
   * than the target registering. The registry only knows the built-ins.
   */
  readonly descriptor?: AnySqliteCodecDescriptor;
  /** Identifies the value under test within its codec's cases. */
  readonly label: string;
  /** Application-level value handed to `codec.toWire` and `codec.toDataTypeValue`. */
  readonly value: unknown;
  /** SQLite column type the value is stored in. */
  readonly storageType: string;
  /** Codec type params, for parameterized codecs. */
  readonly typeParams?: JsonValue;
  /**
   * Store SQL `NULL` instead of encoding `value`, and require the projection to
   * produce JSON `null`.
   *
   * SQL `NULL` is a state of the column, not a value the codec can be handed, so
   * no `value` denotes it. Most codecs reject `null` outright; the JSON codecs
   * accept it, but for them `value: null` means a JSON `null` *document* stored
   * in the column, which is a different thing from the column being empty. A
   * mode is the only shape that expresses the column state for every codec.
   *
   * The runtime never reads a null as a value of the column's type (`collection-dispatch`
   * short-circuits it), so neither does the harness; what a null case measures
   * is that the projection carries absence through as absence.
   */
  readonly nullValue?: true;
  /**
   * How this case currently fails, when it does. The suite asserts that a marked
   * case still fails *and still fails this way*, so neither the marker nor its
   * recorded kind can rot as projections change.
   */
  readonly notYetCanonical?: ExpectedProjectionFailure;
}

export interface CodecProjectionOutcome {
  /** The SELECT the harness executed. */
  readonly sql: string;
  /** The JSON document text the database produced, or `undefined` if the projection failed to execute. */
  readonly rawJson: string | undefined;
  /** The projected value parsed out of that document. */
  readonly projected: JsonValue | undefined;
  /** The value the ordinary row carried, as the connection returned it. */
  readonly rowWire: unknown;
  /** How the case failed, or `undefined` when it conforms. */
  readonly failure: ProjectionFailure | undefined;
}

const STORAGE_TABLE = 'codec_conformance';
const VALUE_COLUMN = 'value';
const DOCUMENT_ALIAS = 'document';
const DOCUMENT_KEY = 'value';

/**
 * A synthetic contract whose only role is to satisfy `renderLoweredSql`'s
 * signature: the harness renders a single unqualified table reference, so the
 * renderer never resolves a namespace out of `storage.namespaces`.
 */
function buildConformanceContract(): SqliteContract {
  const target = 'sqlite';
  const targetFamily = 'sql';
  const namespaces = {};
  const storage = new SqlStorage({
    namespaces,
    storageHash: computeStorageHash({ target, targetFamily, storage: { namespaces } }),
  });

  return {
    target,
    targetFamily,
    roots: {},
    domain: { namespaces: { [UNBOUND_DOMAIN_NAMESPACE_ID]: { models: {} } } },
    storage,
    capabilities: {},
    extensions: {},
    profileHash: computeProfileHash({ target, targetFamily, capabilities: {} }),
    meta: {},
  };
}

const conformanceContract: SqliteContract = buildConformanceContract();

const CALL_CONTEXT: SqlCodecCallContext = { column: { table: STORAGE_TABLE, name: VALUE_COLUMN } };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function codecRefOf(conformanceCase: SqliteCodecConformanceCase): CodecRef {
  return {
    codecId: conformanceCase.codecId,
    ...ifDefined('typeParams', conformanceCase.typeParams),
  };
}

function descriptorFor(conformanceCase: SqliteCodecConformanceCase) {
  const descriptor =
    conformanceCase.descriptor ??
    sqliteCodecDescriptorRegistry.descriptorFor(conformanceCase.codecId);
  if (descriptor === undefined) {
    throw structuredError(
      'TESTKIT.CODEC_DESCRIPTOR_MISSING',
      `No SQLite codec descriptor for '${conformanceCase.codecId}'.`,
      {
        why: 'The harness projects and decodes through the codec descriptor under test.',
        fix: 'Supply the extension codec descriptor on the case.',
        meta: { codecId: conformanceCase.codecId },
      },
    );
  }
  return descriptor;
}

/** Builds `SELECT json_object('value', <projection>)`, whose result is already text. */
export function buildProjectionSql(conformanceCase: SqliteCodecConformanceCase): string {
  const descriptor = descriptorFor(conformanceCase);
  const projection = descriptor.projectJson(
    ColumnRef.of(STORAGE_TABLE, VALUE_COLUMN),
    codecRefOf(conformanceCase),
  );
  const document = JsonObjectExpr.fromEntries([
    JsonObjectExpr.entry(DOCUMENT_KEY, new NativeJsonValueProjection(projection)),
  ]);
  const select = SelectAst.from(TableSource.named(STORAGE_TABLE)).withProjection([
    ProjectionItem.of(DOCUMENT_ALIAS, document),
  ]);

  return renderLoweredSql(select, conformanceContract, sqliteCodecDescriptorRegistry).sql;
}

type RowRead =
  | { readonly ok: true; readonly wire: unknown }
  | { readonly ok: false; readonly error: unknown };

async function readRow(connection: ConformanceConnection): Promise<RowRead> {
  try {
    const [row] = await connection.query(`SELECT "${VALUE_COLUMN}" FROM "${STORAGE_TABLE}"`);
    return { ok: true, wire: row?.[VALUE_COLUMN] };
  } catch (error) {
    return { ok: false, error };
  }
}

/** A row the driver cannot read still leaves the projection to check: the failure is the row's only when the projection reads to the value the case wrote. */
async function rowExecutionFailure(
  codec: { fromWire(wire: unknown, ctx: SqlCodecCallContext): Promise<unknown> },
  conformanceCase: SqliteCodecConformanceCase,
  projected: JsonValue,
  rowRead: { readonly error: unknown },
): Promise<ProjectionFailure> {
  let fromProjection: unknown;
  try {
    fromProjection = await codec.fromWire(projected, CALL_CONTEXT);
  } catch (error) {
    return {
      kind: 'projection-from-wire-rejects',
      detail: `fromWire rejects the projected ${inspect(projected)}: ${describeError(error)}`,
    };
  }
  if (!isDeepStrictEqual(fromProjection, conformanceCase.value)) {
    return {
      kind: 'mismatch',
      detail: `fromWire read the projected ${inspect(projected)} as ${inspect(fromProjection)} for an application value of ${inspect(conformanceCase.value)}`,
    };
  }
  return {
    kind: 'row-execution',
    detail: `the driver could not read the row: ${describeError(rowRead.error)}`,
  };
}

export async function runSqliteCodecProjection(
  connection: ConformanceConnection,
  conformanceCase: SqliteCodecConformanceCase,
): Promise<CodecProjectionOutcome> {
  const descriptor = descriptorFor(conformanceCase);
  const ref = codecRefOf(conformanceCase);
  const params = validateCodecTypeParams(descriptor, ref);
  const codec = descriptor.factory(params)({ name: VALUE_COLUMN });

  await connection.query(`DROP TABLE IF EXISTS "${STORAGE_TABLE}"`);
  await connection.query(
    `CREATE TABLE "${STORAGE_TABLE}" ("${VALUE_COLUMN}" ${conformanceCase.storageType})`,
  );

  if (conformanceCase.nullValue === true) {
    await connection.query(`INSERT INTO "${STORAGE_TABLE}" ("${VALUE_COLUMN}") VALUES (NULL)`);
  } else {
    const wire = await codec.toWire(conformanceCase.value, {});
    await connection.query(`INSERT INTO "${STORAGE_TABLE}" ("${VALUE_COLUMN}") VALUES (?)`, [wire]);
  }

  const rowRead = await readRow(connection);
  const rowWire = rowRead.ok ? rowRead.wire : undefined;
  const sql = buildProjectionSql(conformanceCase);

  let rawJson: string;
  try {
    const rows = await connection.query(sql);
    rawJson = String(rows[0]?.[DOCUMENT_ALIAS]);
  } catch (error) {
    return {
      sql,
      rawJson: undefined,
      projected: undefined,
      rowWire,
      failure: {
        kind: 'execution',
        detail: `the projection failed to execute: ${describeError(error)}`,
      },
    };
  }

  const document: { readonly [key: string]: JsonValue } = JSON.parse(rawJson);
  const projected = document[DOCUMENT_KEY];
  if (projected === undefined) {
    throw structuredError(
      'TESTKIT.PROJECTION_MALFORMED',
      `Projection for '${conformanceCase.codecId}' produced no document: ${rawJson}`,
      { meta: { codecId: conformanceCase.codecId } },
    );
  }

  const base = { sql, rawJson, projected, rowWire } as const;

  if (conformanceCase.nullValue === true) {
    return projected === null
      ? { ...base, failure: undefined }
      : {
          ...base,
          failure: {
            kind: 'mismatch',
            detail: `a NULL column projected as ${JSON.stringify(projected)} rather than null`,
          },
        };
  }

  let value: ReturnType<typeof codec.toDataTypeValue>;
  try {
    value = codec.toDataTypeValue(conformanceCase.value);
  } catch (error) {
    return {
      ...base,
      failure: {
        kind: 'to-data-type-value-rejects',
        detail: `toDataTypeValue rejects the value: ${describeError(error)}`,
      },
    };
  }

  const again = codec.toDataTypeValue(codec.fromDataTypeValue(value));
  if (!dataTypeValuesEqual(again, value)) {
    return {
      ...base,
      failure: {
        kind: 'value-round-trip',
        detail: `toDataTypeValue(fromDataTypeValue(v)) is not v: ${JSON.stringify(value.value)} came back as ${JSON.stringify(again.value)}`,
      },
    };
  }

  if (!rowRead.ok) {
    return {
      ...base,
      failure: await rowExecutionFailure(codec, conformanceCase, projected, rowRead),
    };
  }

  let fromRow: unknown;
  try {
    fromRow = await codec.fromWire(rowWire, CALL_CONTEXT);
  } catch (error) {
    return {
      ...base,
      failure: {
        kind: 'row-from-wire-rejects',
        detail: `fromWire rejects the row's ${inspect(rowWire)}: ${describeError(error)}`,
      },
    };
  }
  if (!isDeepStrictEqual(fromRow, conformanceCase.value)) {
    return {
      ...base,
      failure: {
        kind: 'lossy-round-trip',
        detail: `fromWire read the row's ${inspect(rowWire)} as ${inspect(fromRow)} for an application value of ${inspect(conformanceCase.value)}`,
      },
    };
  }

  let fromProjection: unknown;
  try {
    fromProjection = await codec.fromWire(projected, CALL_CONTEXT);
  } catch (error) {
    return {
      ...base,
      failure: {
        kind: 'projection-from-wire-rejects',
        detail: `fromWire rejects the projected ${inspect(projected)}: ${describeError(error)}`,
      },
    };
  }
  if (!isDeepStrictEqual(fromProjection, fromRow)) {
    return {
      ...base,
      failure: {
        kind: 'mismatch',
        detail: `fromWire read the projected ${inspect(projected)} as ${inspect(fromProjection)} and the row's ${inspect(rowWire)} as ${inspect(fromRow)}`,
      },
    };
  }

  return { ...base, failure: undefined };
}
