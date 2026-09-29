/**
 * Database-backed conformance harness for SQLite codec JSON projections.
 *
 * For one codec descriptor and one representative application value the harness
 * encodes the value through the codec, stores it in a column of the case's
 * storage type, projects the stored column through `descriptor.projectJson()`,
 * renders the projection inside a JSON constructor, executes it, and parses the
 * JSON text the database produced.
 *
 * A projection conforms when both of these hold:
 *
 * 1. the parsed value deep-equals `codec.encodeJson(value)` — the codec's
 *    current `encodeJson` is the yardstick and the projection is its SQL
 *    realization; and
 * 2. `codec.decodeJson` turns the parsed value back into the application value
 *    the case started from.
 *
 * Both conditions are measured against the codec's methods as they stand.
 * Conformance is therefore agreement with today's `encodeJson` / `decodeJson`,
 * not a claim that either is already in its final form: a codec that still owes
 * a change to its own JSON representation conforms here until that change
 * lands.
 *
 * The second condition is what makes the harness an oracle rather than a
 * tautology: a codec whose `encodeJson` loses information the same way the
 * database's native JSON conversion does satisfies condition 1 while still
 * failing to carry the value.
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

import { isDeepStrictEqual } from 'node:util';
import { renderLoweredSql } from '@internal/adapter-sqlite/sql-renderer';
import type { SqliteContract } from '@internal/adapter-sqlite/types';
import { computeProfileHash, computeStorageHash } from '@internal/contract/hashing';
import type { JsonValue } from '@internal/contract/types';
import { UNBOUND_DOMAIN_NAMESPACE_ID } from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import { validateCodecTypeParams } from '@internal/framework-components/codec';
import { SqlStorage } from '@internal/sql-contract/types';
import {
  ColumnRef,
  JsonObjectExpr,
  NativeJsonValueProjection,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { AnySqliteCodecDescriptor } from '@internal/target-sqlite/codec-descriptor';
import { sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import { ifDefined } from '@internal/utils/defined';
import { structuredError } from '@internal/utils/structured-error';

/**
 * Minimal execution surface the harness needs from a live database. A caller
 * adapts whichever client it already owns.
 */
export interface ConformanceConnection {
  query(sql: string, params?: readonly unknown[]): Promise<ReadonlyArray<Record<string, unknown>>>;
}

/**
 * How a projection can disagree with its codec's current `encodeJson` /
 * `decodeJson`. The kinds are materially different — a projection whose SQL
 * will not execute and one that merely rounds a digit are not the same defect —
 * so a case that records one kind is not satisfied by another.
 */
export type ProjectionFailureKind =
  /** The projection SQL did not execute. */
  | 'execution'
  /** `encodeJson` refused the application value. */
  | 'encode-json-rejects'
  /** The parsed value disagrees with `encodeJson`. */
  | 'mismatch'
  /** `decodeJson` refused the projected value. */
  | 'decode-json-rejects'
  /** The parsed value agrees with `encodeJson` but does not carry the application value back. */
  | 'lossy-round-trip';

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
  /** Application-level value handed to `codec.encode` and `codec.encodeJson`. */
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
   * The runtime never calls `decodeJson` for a null (`collection-dispatch`
   * short-circuits it), so neither does the harness; what a null case measures
   * is that the projection carries absence through as absence.
   */
  readonly nullValue?: true;
  /**
   * How this case's projection currently disagrees with the codec's
   * `encodeJson` / `decodeJson`, when it does. The suite asserts that a marked
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
  /** What `codec.encodeJson` specifies the projected value must equal. */
  readonly expected: JsonValue | undefined;
  /**
   * How the projection disagreed with the codec's current `encodeJson` /
   * `decodeJson`, or `undefined` when it agreed and the value round-tripped.
   */
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
    const wire = await codec.encode(conformanceCase.value, {});
    await connection.query(`INSERT INTO "${STORAGE_TABLE}" ("${VALUE_COLUMN}") VALUES (?)`, [wire]);
  }

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
      expected: undefined,
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

  if (conformanceCase.nullValue === true) {
    const nullBase = { sql, rawJson, projected, expected: null } as const;
    return projected === null
      ? { ...nullBase, failure: undefined }
      : {
          ...nullBase,
          failure: {
            kind: 'mismatch',
            detail: `a NULL column projected as ${JSON.stringify(projected)} rather than null`,
          },
        };
  }

  let expected: JsonValue;
  try {
    expected = codec.encodeJson(conformanceCase.value);
  } catch (error) {
    return {
      sql,
      rawJson,
      projected,
      expected: undefined,
      failure: {
        kind: 'encode-json-rejects',
        detail: `encodeJson rejects the value: ${describeError(error)}`,
      },
    };
  }

  const base = { sql, rawJson, projected, expected } as const;

  if (!isDeepStrictEqual(projected, expected)) {
    return {
      ...base,
      failure: {
        kind: 'mismatch',
        detail: `projected ${JSON.stringify(projected)} but encodeJson specifies ${JSON.stringify(expected)}`,
      },
    };
  }

  let roundTripped: unknown;
  try {
    roundTripped = codec.decodeJson(projected);
  } catch (error) {
    return {
      ...base,
      failure: {
        kind: 'decode-json-rejects',
        detail: `decodeJson rejects the projected value: ${describeError(error)}`,
      },
    };
  }

  if (!isDeepStrictEqual(roundTripped, conformanceCase.value)) {
    return {
      ...base,
      failure: {
        kind: 'lossy-round-trip',
        detail: `the projection loses information: decodeJson returned ${String(roundTripped)} for an application value of ${String(conformanceCase.value)}`,
      },
    };
  }

  return { ...base, failure: undefined };
}
