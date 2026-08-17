/**
 * Database-backed conformance harness for PostgreSQL codec JSON projections.
 *
 * For one codec descriptor and one representative application value the harness
 * encodes the value through the codec, stores it in a column of the codec's
 * native type, projects the stored column through `descriptor.projectJson()`,
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
 * failing to carry the value. Arbitrary-precision `numeric` is exactly that
 * case.
 *
 * `projectJson()` is called directly rather than reached through a
 * query-planning or rendering path, which is what lets the harness measure
 * projections that no production query reaches.
 *
 * The API is framework-independent and takes a caller-supplied connection, so
 * assertion style and case enumeration stay with the caller.
 */

import { isDeepStrictEqual } from 'node:util';
import { renderLoweredSql } from '@internal/adapter-postgres/sql-renderer';
import type { PostgresContract } from '@internal/adapter-postgres/types';
import { computeProfileHash, computeStorageHash } from '@internal/contract/hashing';
import type { JsonValue } from '@internal/contract/types';
import { UNBOUND_DOMAIN_NAMESPACE_ID } from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import { validateCodecTypeParams } from '@internal/framework-components/codec';
import { SqlStorage } from '@internal/sql-contract/types';
import {
  CastExpr,
  ColumnRef,
  JsonObjectExpr,
  NativeJsonValueProjection,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { AnyPostgresCodecDescriptor } from '@internal/target-postgres/codec-descriptor';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
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

export interface PostgresCodecConformanceCase {
  /** Codec id, resolved against the target's built-in registry unless `descriptor` is given. */
  readonly codecId: string;
  /**
   * Descriptor to project through, for a codec an extension contributes rather
   * than the target registering. The registry only knows the built-ins.
   */
  readonly descriptor?: AnyPostgresCodecDescriptor;
  /** Identifies the value under test within its codec's cases. */
  readonly label: string;
  /** Application-level value handed to `codec.encode` and `codec.encodeJson`. */
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
  /**
   * Judge this case by whether the value survives the round trip, comparing `decodeJson(projected)`
   * to `value` with this predicate, instead of requiring the projected JSON to equal `encodeJson`'s
   * output byte for byte.
   *
   * Byte equality is the right test only where `encodeJson` is identity — there, "the projected
   * bytes equal `encodeJson`'s bytes" and "`decodeJson` of the projection reconstructs the value"
   * are the same sentence. For a codec whose application value is not a string they come apart:
   * `encodeJson` produces the spelling PostgreSQL must **accept** on write, the projection produces
   * the spelling PostgreSQL **emits** on read, and PostgreSQL is under no obligation to emit what
   * it accepts. Both spellings are correct and neither is canonical.
   *
   * What the runtime depends on is the round trip, because the nested read path calls `decodeJson`
   * on the projected document and never calls `decode`. So that is what a case may ask to be judged
   * on. This is not a relaxation to make a red case pass: a case declaring it is still required to
   * project, still required to survive `decodeJson`, and still required to come back equal — only
   * "equal" is the codec's own notion rather than the bytes'.
   *
   * Prefer a predicate that rejects the wrong *type* as well as the wrong value. Structural
   * comparison of two values with no own enumerable properties — as `Temporal.*` instances have —
   * can report equality between genuinely different values.
   */
  readonly valueEquality?: (roundTripped: unknown, value: unknown) => boolean;
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

  return renderLoweredSql(select, conformanceContract, postgresCodecDescriptorRegistry).sql;
}

type ElementCodec = {
  encode(value: unknown, ctx: Record<string, never>): Promise<unknown>;
  encodeJson(value: unknown): JsonValue;
  decodeJson(json: JsonValue): unknown;
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
  if (conformanceCase.many !== true) return codec.encode(conformanceCase.value, {});
  if (conformanceCase.value === null) return null;
  const elements = overElements(conformanceCase.value, (element) => element) ?? [];
  return Promise.all(
    elements.map(async (element) =>
      element === null ? null : toDriverParam(await codec.encode(element, {})),
    ),
  );
}

function expectedJson(
  codec: ElementCodec,
  conformanceCase: PostgresCodecConformanceCase,
): JsonValue {
  if (conformanceCase.many !== true) return codec.encodeJson(conformanceCase.value);
  return overElements(conformanceCase.value, (element) =>
    element === null ? null : codec.encodeJson(element),
  );
}

function roundTripValue(
  codec: ElementCodec,
  conformanceCase: PostgresCodecConformanceCase,
  projected: JsonValue,
): unknown {
  if (conformanceCase.many !== true) return codec.decodeJson(projected);
  if (projected === null) return null;
  if (!Array.isArray(projected)) {
    throw structuredError(
      'TESTKIT.PROJECTION_MALFORMED',
      'An array projection must produce a JSON array or null.',
      { why: 'The projected JSON does not have the shape the codec descriptor declares.' },
    );
  }
  return projected.map((element) => (element === null ? null : codec.decodeJson(element)));
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
  const elementType = descriptor.nativeTypeFor(ref);
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
    expected = expectedJson(codec, conformanceCase);
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

  // A case judged on round-trip equality skips this gate by design: its two spellings are both
  // correct and differ, so comparing them would only ever report a disagreement that is not a defect.
  if (conformanceCase.valueEquality === undefined && !isDeepStrictEqual(projected, expected)) {
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
    roundTripped = roundTripValue(codec, conformanceCase, projected);
  } catch (error) {
    return {
      ...base,
      failure: {
        kind: 'decode-json-rejects',
        detail: `decodeJson rejects the projected value: ${describeError(error)}`,
      },
    };
  }

  const roundTripAgrees =
    conformanceCase.valueEquality === undefined
      ? isDeepStrictEqual(roundTripped, conformanceCase.value)
      : conformanceCase.valueEquality(roundTripped, conformanceCase.value);

  if (!roundTripAgrees) {
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
