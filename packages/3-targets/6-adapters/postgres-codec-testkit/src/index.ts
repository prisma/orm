/**
 * Database-backed conformance harness for PostgreSQL codec JSON projections.
 *
 * For one codec descriptor and one representative application value the harness
 * writes the value through the codec's `toWire`, stores it in a column of the
 * codec's native type, and reads the column back twice: as an ordinary row, and
 * through `descriptor.projectJson()` inside a JSON constructor, the way an
 * `include` reads it.
 *
 * A projection conforms when the codec's `fromWire` reads the projected value to
 * the same application value it reads the ordinary row's value to (ADR 254,
 * "Rows the database returns as JSON"), and that value is the one the case
 * started from. Each comparison uses the case's `valueEquality` when it has one.
 *
 * For every case the harness also checks that `toDataTypeValue(fromDataTypeValue(v))`
 * equals `v`, where `v` is the value `toDataTypeValue` gives for the case.
 *
 * `projectJson()` is called directly rather than reached through a
 * query-planning or rendering path, which is what lets the harness measure
 * projections that no production query reaches.
 *
 * The API is framework-independent and takes a caller-supplied connection, so
 * assertion style and case enumeration stay with the caller.
 */

import { inspect, isDeepStrictEqual } from 'node:util';
import { postgresAdapterCapabilities } from '@internal/adapter-postgres/adapter';
import { renderLoweredSql } from '@internal/adapter-postgres/sql-renderer';
import type { PostgresContract } from '@internal/adapter-postgres/types';
import { computeProfileHash, computeStorageHash } from '@internal/contract/hashing';
import { isPlainRecord } from '@internal/contract/is-plain-record';
import type { JsonValue } from '@internal/contract/types';
import { UNBOUND_DOMAIN_NAMESPACE_ID } from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import {
  createDataTypeLookup,
  type DataType,
  type DataTypeValue,
  dataTypeValuesEqual,
  validateCodecTypeParams,
} from '@internal/framework-components/codec';
import { dataTypeParams, sqlBaseName, sqlDataTypeOfCodec } from '@internal/sql-contract/data-type';
import { SqlStorage } from '@internal/sql-contract/types';
import {
  CastExpr,
  ColumnRef,
  JsonObjectExpr,
  NativeJsonValueProjection,
  ProjectionItem,
  SelectAst,
  type SqlCodecCallContext,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { AnyPostgresCodecDescriptor } from '@internal/target-postgres/codec-descriptor';
import {
  parsePostgresListText,
  postgresCodecDescriptorRegistry,
} from '@internal/target-postgres/codecs';
import {
  createPostgresBuiltinDataTypeLookup,
  postgresDataTypes,
} from '@internal/target-postgres/data-types';
import { ifDefined } from '@internal/utils/defined';
import { structuredError } from '@internal/utils/structured-error';

/**
 * Minimal execution surface the harness needs from a live database. A caller
 * adapts whichever client it already owns, as long as each row carries its
 * values as the runtime driver returns them: the wire values `fromWire` reads,
 * PostgreSQL's text for every type.
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

export interface PostgresCodecConformanceCase {
  /** Codec id, resolved against the target's built-in registry unless `descriptor` is given. */
  readonly codecId: string;
  /**
   * Descriptor to project through, for a codec an extension contributes rather
   * than the target registering. The registry only knows the built-ins.
   */
  readonly descriptor?: AnyPostgresCodecDescriptor;
  /** The data type `descriptor` represents, when the target does not register it. */
  readonly dataType?: DataType;
  /** The column type to store the value in, for a codec whose data type is never written (`pg/text-array`). */
  readonly columnType?: string;
  /** Identifies the value under test within its codec's cases. */
  readonly label: string;
  /** Application-level value handed to `codec.toWire` and `codec.toDataTypeValue`. */
  readonly value: unknown;
  /** Codec type params, for parameterized codecs. */
  readonly typeParams?: JsonValue;
  /** SQL executed before the storage table is created — e.g. `CREATE TYPE` for a native enum. */
  readonly setupSql?: readonly string[];
  /**
   * Stores the value in a column of the codec's native array type and projects
   * it through the descriptor's inherited array lift. `value` is then an array
   * whose elements are application values, or `null` for a null array.
   */
  readonly many?: true;
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
  /** Compares two application values of the codec, for a value that is not deep-equal to its copy. */
  readonly valueEquality?: (left: unknown, right: unknown) => boolean;
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
function buildConformanceContract(): PostgresContract {
  const target = 'postgres';
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

const conformanceContract: PostgresContract = buildConformanceContract();

/**
 * Widens a codec's wire value to the shape `pg` serializes unambiguously: a
 * `Buffer` for binary, and a UTC ISO string for a `Date` so the parameter's
 * wall-clock reading does not depend on the machine's time zone.
 */
function toDriverParam(wire: unknown): unknown {
  if (wire instanceof Uint8Array && !Buffer.isBuffer(wire)) return Buffer.from(wire);
  if (wire instanceof Date) return wire.toISOString();
  return wire;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function codecRefOf(conformanceCase: PostgresCodecConformanceCase): CodecRef {
  return {
    codecId: conformanceCase.codecId,
    ...ifDefined('typeParams', conformanceCase.typeParams),
    ...ifDefined('many', conformanceCase.many),
  };
}

function descriptorFor(conformanceCase: PostgresCodecConformanceCase) {
  const descriptor =
    conformanceCase.descriptor ??
    postgresCodecDescriptorRegistry.descriptorFor(conformanceCase.codecId);
  if (descriptor === undefined) {
    throw structuredError(
      'TESTKIT.CODEC_DESCRIPTOR_MISSING',
      `No PostgreSQL codec descriptor for '${conformanceCase.codecId}'.`,
      {
        why: 'The harness projects and decodes through the codec descriptor under test.',
        fix: 'Supply the extension codec descriptor on the case.',
        meta: { codecId: conformanceCase.codecId },
      },
    );
  }
  return descriptor;
}

/**
 * Builds `SELECT CAST(json_build_object('value', <projection>) AS text)`, so the
 * document arrives as text and the harness — not the driver — owns the parse.
 */
const postgresDataTypeLookup = createPostgresBuiltinDataTypeLookup();

/** The base name of the data type the case's codec represents, for the storage column. */
function columnBaseName(
  conformanceCase: PostgresCodecConformanceCase,
  descriptor: AnyPostgresCodecDescriptor,
): string {
  const dataType = sqlDataTypeOfCodec(descriptor.codecId, {
    codecLookup: { descriptorFor: () => descriptor },
    dataTypeLookup: createDataTypeLookup([
      ...postgresDataTypes,
      ...(conformanceCase.dataType === undefined ? [] : [conformanceCase.dataType]),
    ]),
  });
  return sqlBaseName(
    dataType,
    dataTypeParams(
      dataType,
      isPlainRecord(conformanceCase.typeParams) ? conformanceCase.typeParams : undefined,
    ),
  );
}

export function buildProjectionSql(conformanceCase: PostgresCodecConformanceCase): string {
  const descriptor = descriptorFor(conformanceCase);
  const projection = descriptor.projectJson(
    ColumnRef.of(STORAGE_TABLE, VALUE_COLUMN),
    codecRefOf(conformanceCase),
  );
  const document = JsonObjectExpr.fromEntries([
    JsonObjectExpr.entry(DOCUMENT_KEY, new NativeJsonValueProjection(projection)),
  ]);
  const select = SelectAst.from(TableSource.named(STORAGE_TABLE)).withProjection([
    ProjectionItem.of(DOCUMENT_ALIAS, CastExpr.as(document, 'text')),
  ]);

  return renderLoweredSql(
    select,
    conformanceContract,
    postgresCodecDescriptorRegistry,
    postgresDataTypeLookup,
    postgresAdapterCapabilities,
  ).sql;
}

const CALL_CONTEXT: SqlCodecCallContext = { column: { table: STORAGE_TABLE, name: VALUE_COLUMN } };

type ElementCodec = {
  readonly dataType: DataType;
  toWire(value: unknown, ctx: Record<string, never>): Promise<unknown>;
  fromWire(wire: unknown, ctx: SqlCodecCallContext): Promise<unknown>;
  toDataTypeValue(value: unknown): DataTypeValue;
  fromDataTypeValue(value: DataTypeValue): unknown;
};

/** Maps `mapper` over an array case's elements, leaving nulls alone; a null array stays null. */
function overElements<T>(value: unknown, mapper: (element: unknown) => T): T[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) {
    throw structuredError(
      'TESTKIT.CONFORMANCE_CASE_INVALID',
      'A `many` conformance case must carry an array value or null.',
      { fix: 'Give the case an array of element values, or null.' },
    );
  }
  return value.map((element) => mapper(element));
}

async function encodeValue(
  codec: ElementCodec,
  conformanceCase: PostgresCodecConformanceCase,
): Promise<unknown> {
  if (conformanceCase.many !== true) return codec.toWire(conformanceCase.value, {});
  if (conformanceCase.value === null) return null;
  const elements = overElements(conformanceCase.value, (element) => element) ?? [];
  return Promise.all(
    elements.map(async (element) =>
      element === null ? null : toDriverParam(await codec.toWire(element, {})),
    ),
  );
}

/** The case's values that `toDataTypeValue(fromDataTypeValue(v))` does not give back, as text for a report. */
function valuesNotRoundTripped(
  codec: ElementCodec,
  conformanceCase: PostgresCodecConformanceCase,
): readonly string[] {
  const elements =
    conformanceCase.many === true
      ? (overElements(conformanceCase.value, (element) => element) ?? [])
      : [conformanceCase.value];
  return elements.flatMap((element) => {
    if (element === null && conformanceCase.many === true) return [];
    const value = codec.toDataTypeValue(element);
    const again = codec.toDataTypeValue(codec.fromDataTypeValue(value));
    return dataTypeValuesEqual(again, value)
      ? []
      : [`${JSON.stringify(value.value)} came back as ${JSON.stringify(again.value)}`];
  });
}

/**
 * Reads a wire value with `fromWire`, element by element for an array case. `elements` gives the
 * elements of an array value: the ordinary row carries PostgreSQL's array text, the projection a
 * JSON array.
 */
async function readWire(
  codec: ElementCodec,
  conformanceCase: PostgresCodecConformanceCase,
  wire: unknown,
  elements: (wire: unknown) => readonly unknown[],
): Promise<unknown> {
  if (conformanceCase.many !== true) return codec.fromWire(wire, CALL_CONTEXT);
  if (wire === null) return null;
  return Promise.all(
    elements(wire).map((element) =>
      element === null ? null : codec.fromWire(element, CALL_CONTEXT),
    ),
  );
}

function projectedElements(projected: unknown): readonly unknown[] {
  if (!Array.isArray(projected)) {
    throw structuredError(
      'TESTKIT.PROJECTION_MALFORMED',
      'An array projection must produce a JSON array or null.',
      { why: 'The projected JSON does not have the shape the codec descriptor declares.' },
    );
  }
  return projected;
}

function valuesAgree(
  conformanceCase: PostgresCodecConformanceCase,
  left: unknown,
  right: unknown,
): boolean {
  return conformanceCase.valueEquality === undefined
    ? isDeepStrictEqual(left, right)
    : conformanceCase.valueEquality(left, right);
}

export async function runPostgresCodecProjection(
  connection: ConformanceConnection,
  conformanceCase: PostgresCodecConformanceCase,
): Promise<CodecProjectionOutcome> {
  const descriptor = descriptorFor(conformanceCase);
  const ref = codecRefOf(conformanceCase);
  const params = validateCodecTypeParams(descriptor, ref);
  const codec = descriptor.factory(params)({ name: VALUE_COLUMN });

  // Each case starts from default session state, so a case that sets `TimeZone`
  // or another GUC in `setupSql` to prove session independence cannot change
  // what a later case measures.
  await connection.query('RESET ALL');
  await connection.query(`DROP TABLE IF EXISTS "${STORAGE_TABLE}"`);
  for (const statement of conformanceCase.setupSql ?? []) {
    await connection.query(statement);
  }
  const elementType = conformanceCase.columnType ?? columnBaseName(conformanceCase, descriptor);
  const columnType = conformanceCase.many === true ? `${elementType}[]` : elementType;
  await connection.query(`CREATE TABLE "${STORAGE_TABLE}" ("${VALUE_COLUMN}" ${columnType})`);

  if (conformanceCase.nullValue === true) {
    await connection.query(`INSERT INTO "${STORAGE_TABLE}" ("${VALUE_COLUMN}") VALUES (NULL)`);
  } else {
    const wire = await encodeValue(codec, conformanceCase);
    await connection.query(`INSERT INTO "${STORAGE_TABLE}" ("${VALUE_COLUMN}") VALUES ($1)`, [
      conformanceCase.many === true ? wire : toDriverParam(wire),
    ]);
  }

  const [row] = await connection.query(`SELECT "${VALUE_COLUMN}" FROM "${STORAGE_TABLE}"`);
  const rowWire = row?.[VALUE_COLUMN];
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

  let notRoundTripped: readonly string[];
  try {
    notRoundTripped = valuesNotRoundTripped(codec, conformanceCase);
  } catch (error) {
    return {
      ...base,
      failure: {
        kind: 'to-data-type-value-rejects',
        detail: `toDataTypeValue rejects the value: ${describeError(error)}`,
      },
    };
  }
  if (notRoundTripped.length > 0) {
    return {
      ...base,
      failure: {
        kind: 'value-round-trip',
        detail: `toDataTypeValue(fromDataTypeValue(v)) is not v: ${notRoundTripped.join('; ')}`,
      },
    };
  }

  let fromRow: unknown;
  try {
    fromRow = await readWire(codec, conformanceCase, rowWire, parsePostgresListText);
  } catch (error) {
    return {
      ...base,
      failure: {
        kind: 'row-from-wire-rejects',
        detail: `fromWire rejects the row's ${inspect(rowWire)}: ${describeError(error)}`,
      },
    };
  }
  if (!valuesAgree(conformanceCase, fromRow, conformanceCase.value)) {
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
    fromProjection = await readWire(codec, conformanceCase, projected, projectedElements);
  } catch (error) {
    return {
      ...base,
      failure: {
        kind: 'projection-from-wire-rejects',
        detail: `fromWire rejects the projected ${inspect(projected)}: ${describeError(error)}`,
      },
    };
  }
  if (!valuesAgree(conformanceCase, fromProjection, fromRow)) {
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
