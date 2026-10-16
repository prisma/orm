/**
 * How `contract infer` reads the defaults the database reports: with the codec of the type constructor it prints for the column (`fromWire` of the literal's body, then `toDataTypeValue`), as `db verify` reads them with the contract column's codec. `contract infer` has no contract, so the constructor it prints stands in for one.
 */

import { type ColumnDefault, isColumnDefault } from '@internal/contract/types';
import {
  type ReportedBody,
  type ReportedLiteralDefault,
  readReportedDefault,
  type SqlPslBuildContext,
} from '@internal/family-sql/control';
import type { ColumnTypeOf } from '@internal/family-sql/psl-build';
import { type Codec, codecForRef } from '@internal/framework-components/codec';
import type { SqlColumnIR, SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { isInternalError } from '@internal/utils/internal-error';
import { pgJson, pgJsonb } from '../data-types';
import { readPostgresDefault } from '../default-normalizer';
import { inferredCodecRef } from './infer-default-codec';
import { jsonKeepsEveryNumber } from './json-exact-numbers';

/** The default `contract infer` prints for a column: what it read, keyed by table and column. */
export type InferredDefaultOf = (
  tableName: string,
  column: SqlColumnIR,
) => ColumnDefault | undefined;

/** For tables whose columns carry no default to read, such as a many-to-many junction table. */
export const noInferredDefaults: InferredDefaultOf = () => undefined;

function key(tableName: string, columnName: string): string {
  return JSON.stringify([tableName, columnName]);
}

/**
 * Reads each column's reported default. A function default, SQL NULL and a literal the codec reads are the default; a literal the codec cannot read, or one on a column whose constructor names no codec, is the raw expression as reported.
 */
export async function readInferredDefaults(
  schema: SqlSchemaIR,
  columnTypes: ColumnTypeOf,
  isEnumColumn: (column: SqlColumnIR) => boolean,
  context: SqlPslBuildContext,
): Promise<InferredDefaultOf> {
  const read = new Map<string, ColumnDefault>();
  for (const table of Object.values(schema.tables)) {
    for (const column of Object.values(table.columns)) {
      const columnDefault = await readColumnDefault(
        column,
        () => columnTypes(table.name, column.name),
        isEnumColumn(column),
        context,
      );
      if (columnDefault !== undefined) read.set(key(table.name, column.name), columnDefault);
    }
  }
  return (tableName, column) => read.get(key(tableName, column.name));
}

async function readColumnDefault(
  column: SqlColumnIR,
  pslType: () => ReturnType<ColumnTypeOf>,
  isEnum: boolean,
  context: SqlPslBuildContext,
): Promise<ColumnDefault | undefined> {
  const raw: unknown = column.default;
  if (typeof raw !== 'string') return isColumnDefault(raw) ? raw : undefined;
  return readDefaultWithCodec(
    raw,
    column.many === true ? `${column.nativeType}[]` : column.nativeType,
    codecOf(pslType, isEnum, context),
  );
}

/**
 * Reads one reported default, `nativeType` ending in `[]` for a list column, with `codec`: a function default and SQL NULL as themselves, a literal the codec reads as its stored JSON, and anything else as the raw expression as reported.
 */
export async function readDefaultWithCodec(
  raw: string,
  nativeType: string,
  codec: Codec | undefined,
): Promise<ColumnDefault> {
  const reported = readPostgresDefault(raw, nativeType);
  if (reported.kind === 'function') return reported;
  if (reported.kind === 'null') return { kind: 'literal', value: null };
  const rawExpression: ColumnDefault = { kind: 'function', expression: raw.trim() };
  if (codec === undefined) return rawExpression;
  if (
    reported.literal.kind === 'list' &&
    reported.literal.elements.includes(null) &&
    holdsNull(codec)
  ) {
    return rawExpression;
  }
  if (JSON_TYPES.has(codec.dataType.id) && !bodiesOf(reported.literal).every(jsonBodyIsExact)) {
    return rawExpression;
  }
  const read = await readReportedDefault(codec, reported.literal, raw);
  return 'resolvedDefault' in read ? read.resolvedDefault : rawExpression;
}

const JSON_TYPES: ReadonlySet<string> = new Set([pgJson.id, pgJsonb.id]);

function bodiesOf(literal: ReportedLiteralDefault): readonly (ReportedBody | null)[] {
  return literal.kind === 'value' ? [literal.body] : literal.elements;
}

function jsonBodyIsExact(body: ReportedBody | null): boolean {
  return typeof body !== 'string' || jsonKeepsEveryNumber(body);
}

/**
 * Whether the codec's type has a value null, as a JSON type does. A list element that is SQL NULL would then print as that value, which reads back as something else, so such a list keeps its raw expression.
 */
function holdsNull(codec: Codec): boolean {
  try {
    codec.dataType.fromContract(null, {});
    return true;
  } catch (error) {
    if (isInternalError(error)) throw error;
    return false;
  }
}

function codecOf(
  pslType: () => ReturnType<ColumnTypeOf>,
  isEnum: boolean,
  context: SqlPslBuildContext,
) {
  try {
    const ref = inferredCodecRef(context, isEnum ? { path: [] } : pslType(), isEnum);
    return ref === undefined ? undefined : codecForRef(context.codecLookup, ref);
  } catch (error) {
    if (isInternalError(error)) throw error;
    return undefined;
  }
}
