import { assembleDataTypes, type DataType } from '@internal/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import {
  checkRawTypeText,
  dataTypeParams,
  isSqlDataType,
  type ResolvedSqlType,
  renderSqlCatalogText,
  resolveWrittenSqlTypes,
  type SqlTypeLookups,
  sqlDataTypeOfCodec,
  unquotedSqlBaseName,
} from '@internal/sql-contract/data-type';
import type { StorageColumn, StorageTypeInstance } from '@internal/sql-contract/types';
import { postgresError } from '../errors';
import { DEFAULT_NAMESPACE_ID } from '../namespace-ids';
import { postgresCreateNamespace } from '../postgres-schema';
import { quoteIdentifierWhereNeeded } from '../sql-utils';
import { autoincrementWidthOfPseudoType } from './autoincrement-widths';
import { resolveColumnTypeMetadata } from './planner-type-resolution';

/**
 * String-keyed entry points the migration ops use to render
 * schema-qualified DDL and catalog checks. The `schema` argument is
 * interpreted as a namespace coordinate: the framework `__unbound__`
 * sentinel resolves to the late-bound `PostgresUnboundSchema` singleton
 * (which elides the qualifier so `search_path` decides at runtime); any
 * other id materialises a `PostgresSchema(id)` whose qualifier is the
 * named schema. Helpers route through these `Namespace` concretions so
 * the unbound branch lives in the polymorphic override, not the call
 * site.
 */
export function qualifyTableName(schema: string, table: string): string {
  return postgresCreateNamespace({ id: schema, entries: { table: {} } }).qualifyTable(table);
}

/**
 * The type `format_type` prints, for the column's ALTER COLUMN TYPE postcheck: the catalog text of
 * its data type with normalised parameters, or for an enum its name, quoted where Postgres quotes
 * it.
 */
export function buildExpectedFormatType(
  column: Pick<StorageColumn, 'codecId' | 'typeParams' | 'typeRef'>,
  types: SqlTypeLookups,
  storageTypes: Record<string, StorageTypeInstance> = {},
): string {
  const resolved = resolveColumnTypeMetadata(column, storageTypes);
  const dataType = sqlDataTypeOfCodec(resolved.codecId, types);
  const params = dataTypeParams(dataType, resolved.typeParams);
  if (dataType.sql.claimsKind !== undefined) {
    return unquotedSqlBaseName(dataType, params)
      .split('.')
      .map(quoteIdentifierWhereNeeded)
      .join('.');
  }
  return renderSqlCatalogText(dataType, params);
}

/** The data types the components of a stack register. */
export function stackDataTypes(
  frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>,
): readonly DataType[] {
  return assembleDataTypes(frameworkComponents).declared.map(({ type }) => type);
}

const ARRAY_SUFFIX = /^(.*?)(?:\s*\[\s*\])+$/s;
const QUOTED_SEGMENT = /^"((?:[^"]|"")+)"/;

/** The segments of a name written as one or two double-quoted identifiers, `"Mood"` or `"app"."status"`. */
function quotedName(text: string): readonly string[] | undefined {
  const segments: string[] = [];
  let rest = text;
  while (rest !== '') {
    const match = QUOTED_SEGMENT.exec(rest);
    if (match === null) return undefined;
    segments.push((match[1] ?? '').replaceAll('""', '"'));
    rest = rest.slice(match[0].length);
    if (rest.startsWith('.')) rest = rest.slice(1);
    else if (rest !== '') return undefined;
  }
  return segments.length === 1 || segments.length === 2 ? segments : undefined;
}

function catalogTextOf(resolved: ResolvedSqlType, dataTypes: readonly DataType[]): string {
  const type = dataTypes.filter(isSqlDataType).find(({ id }) => id === resolved.dataType);
  return type === undefined ? resolved.dataType : renderSqlCatalogText(type, resolved.typeParams);
}

function columnTypeUnreadable(type: string, where: string, reason: string): never {
  throw postgresError('MIGRATION.COLUMN_TYPE_UNREADABLE', `${where}: ${reason}`, {
    why: 'A column type change checks afterwards that the column has the new type as the database prints it, and finds that text through the data types the configured stack registers.',
    fix: 'Write the type as a migration writes it, for example int4 or varchar(20), or an enum by its quoted name, such as "Mood". If the type comes from an extension, add that extension to the configuration.',
    meta: { type, where },
  });
}

/**
 * The type `format_type` prints for a column altered to `type`, written as a migration writes it:
 * for a raw type, which the call marks with `raw` (ADR 273), the text as written; otherwise the
 * catalog text of the one data type of `dataTypes` that reads it, or for an enum, named by its
 * quoted name, that name quoted where Postgres quotes it, without the `public` schema, which
 * `format_type` leaves out as the planner's own enum names do. A list type keeps one `[]`, as
 * `format_type` prints it. The planner and the `alterColumnType` facade both check the alter with
 * this text, so re-running a migration reproduces its operations. `where` names the call in the
 * error a type no data type reads raises.
 */
export function alterTypeCheckText(
  type: string,
  dataTypes: readonly DataType[],
  where: string,
  raw = false,
): string {
  if (raw) return rawTypeCheckText(type, where);
  const read = readCatalogTypeText(type, dataTypes);
  return read.ok ? read.text : columnTypeUnreadable(type, where, read.reason);
}

function rawTypeCheckText(type: string, where: string): string {
  const trimmed = type.trim();
  const array = ARRAY_SUFFIX.exec(trimmed);
  const base = array?.[1] ?? trimmed;
  const suffix = array === null ? '' : '[]';
  const refused = checkRawTypeText(base);
  return refused === undefined
    ? `${base}${suffix}`
    : columnTypeUnreadable(type, where, `the raw type "${type}" is refused: ${refused}`);
}

/**
 * The type `format_type` prints for a column of `type`, read as {@link alterTypeCheckText} reads it, or `undefined` when the stack's data types do not read `type`, as for a raw column.
 */
export function catalogTypeTextIfReadable(
  type: string,
  dataTypes: readonly DataType[],
): string | undefined {
  const read = readCatalogTypeText(type, dataTypes);
  return read.ok ? read.text : undefined;
}

function readCatalogTypeText(
  type: string,
  dataTypes: readonly DataType[],
): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string } {
  const trimmed = autoincrementWidthOfPseudoType(type)?.sequenceType ?? type.trim();
  const array = ARRAY_SUFFIX.exec(trimmed);
  const base = array?.[1] ?? trimmed;
  const suffix = array === null ? '' : '[]';
  const texts = [
    ...new Set(
      resolveWrittenSqlTypes(base, dataTypes).map((resolved) => catalogTextOf(resolved, dataTypes)),
    ),
  ];
  const [only] = texts;
  if (only !== undefined && texts.length === 1) return { ok: true, text: `${only}${suffix}` };
  if (texts.length > 1) {
    return {
      ok: false,
      reason: `more than one data type of the configured stack reads the type "${type}", as ${texts.join(' and ')}`,
    };
  }
  const name = quotedName(base);
  const namesItself = dataTypes.some(
    (dataType) => isSqlDataType(dataType) && dataType.sql.claimsKind !== undefined,
  );
  if (name !== undefined && namesItself) {
    const [schema, ...rest] = name;
    const unqualified = rest.length > 0 && schema === DEFAULT_NAMESPACE_ID ? rest : name;
    return { ok: true, text: `${unqualified.map(quoteIdentifierWhereNeeded).join('.')}${suffix}` };
  }
  return { ok: false, reason: `no data type of the configured stack reads the type "${type}"` };
}
