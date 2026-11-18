import { assembleDataTypes, type DataType } from '@internal/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import {
  checkRawTypeText,
  isSqlDataType,
  type ResolvedSqlType,
  renderSqlCatalogText,
  renderSqlTypeName,
  resolveReportedSqlType,
  resolveWrittenSqlTypes,
  type SqlDataType,
  type SqlTypeParams,
} from '@internal/sql-contract/data-type';
import type { SqlColumnType } from '@internal/sql-schema-ir/types';
import { postgresError } from '../errors';
import { postgresCreateNamespace } from '../postgres-schema';
import { autoincrementWidthOfPseudoType } from './autoincrement-widths';

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

function columnTypeUnreadable(type: string, where: string, reason: string): never {
  throw postgresError('MIGRATION.COLUMN_TYPE_UNREADABLE', `${where}: ${reason}`, {
    why: 'A column type change checks afterwards that the column has the new type, and finds the type through the data types the configured stack registers.',
    fix: 'Write the type as a migration writes it, for example int4 or varchar(20), or an enum by its quoted name, such as "Mood". If the type comes from an extension, add that extension to the configuration.',
    meta: { type, where },
  });
}

/**
 * How a postcheck recognises that a column has a type: by the text `format_type` prints for it, or, for a type that claims a kind such as an enum, by the type's identity, `to_regtype` of the name its data type renders, or that type's array type for a list. Design 12.3.
 */
export type ColumnTypeCheck =
  | { readonly kind: 'catalog-text'; readonly text: string }
  | { readonly kind: 'identity'; readonly typeName: string; readonly many: boolean };

/** How a postcheck's description names the type it checks: catalog text in double quotes, and an enum by its quoted name, which carries its own quotes. */
export function columnTypeCheckText(check: ColumnTypeCheck): string {
  return check.kind === 'catalog-text'
    ? `"${check.text}"`
    : `${check.typeName}${check.many ? '[]' : ''}`;
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
 * The postcheck for a column altered to `type`, written as a migration writes it: for a raw type, which the call marks with `raw` (ADR 273), the text as written, compared with the catalog text; otherwise read through the one data type of `dataTypes` that reads it. The planner and the `alterColumnType` facade both check the alter with it, so re-running a migration reproduces its operations. `where` names the call in the error a type no data type reads raises.
 */
export function alterTypeCheck(
  type: string,
  dataTypes: readonly DataType[],
  where: string,
  raw = false,
): ColumnTypeCheck {
  if (raw) return { kind: 'catalog-text', text: rawTypeCheckText(type, where) };
  const read = readColumnTypeCheck(type, dataTypes);
  return read.ok ? read.check : columnTypeUnreadable(type, where, read.reason);
}

/** The postcheck for a column of `type`, read as {@link alterTypeCheck} reads it, or `undefined` when the stack's data types do not read `type`, as for a raw column. */
export function columnTypeCheckIfReadable(
  type: string,
  dataTypes: readonly DataType[],
): ColumnTypeCheck | undefined {
  const read = readColumnTypeCheck(type, dataTypes);
  return read.ok ? read.check : undefined;
}

/**
 * The column type a migration's `type` names, as {@link alterTypeCheck} reads it: the one data type of `dataTypes` that reads it, or for an enum named by its quoted name, the type that claims enums, with the name as introspection would report it. `undefined` when no data type, or more than one, reads it.
 */
export function writtenColumnType(
  type: string,
  dataTypes: readonly DataType[],
): SqlColumnType | undefined {
  const read = readWrittenType(type, dataTypes);
  return read.ok
    ? { storedType: read.type, storedTypeParams: read.typeParams, many: read.many }
    : undefined;
}

type WrittenTypeRead =
  | {
      readonly ok: true;
      readonly type: SqlDataType;
      readonly typeParams: SqlTypeParams;
      readonly writtenTypeParams: SqlTypeParams;
      readonly many: boolean;
    }
  | { readonly ok: false; readonly reason: string };

function readWrittenType(type: string, dataTypes: readonly DataType[]): WrittenTypeRead {
  const trimmed = autoincrementWidthOfPseudoType(type)?.sequenceType ?? type.trim();
  const array = ARRAY_SUFFIX.exec(trimmed);
  const base = array?.[1] ?? trimmed;
  const sqlTypes = dataTypes.filter(isSqlDataType);
  const byText = resolveWrittenSqlTypes(base, sqlTypes);
  if (byText.length > 1) {
    const named = byText.map((resolved) => resolved.dataType.id).join(' and ');
    return {
      ok: false,
      reason: `more than one data type of the configured stack reads the type "${type}", as ${named}`,
    };
  }
  const [written] = byText;
  if (written !== undefined) {
    return {
      ok: true,
      type: written.dataType,
      typeParams: written.typeParams,
      writtenTypeParams: written.writtenTypeParams,
      many: array !== null,
    };
  }
  const byKind = resolvedByKind(base, sqlTypes);
  if (byKind === undefined) {
    return { ok: false, reason: `no data type of the configured stack reads the type "${type}"` };
  }
  return {
    ok: true,
    type: byKind.dataType,
    typeParams: byKind.typeParams,
    writtenTypeParams: byKind.typeParams,
    many: array !== null,
  };
}

function readColumnTypeCheck(
  type: string,
  dataTypes: readonly DataType[],
):
  | { readonly ok: true; readonly check: ColumnTypeCheck }
  | { readonly ok: false; readonly reason: string } {
  const read = readWrittenType(type, dataTypes);
  if (!read.ok) return read;
  if (read.type.sql.claimsKind !== undefined) {
    return {
      ok: true,
      check: {
        kind: 'identity',
        typeName: renderSqlTypeName(read.type, read.typeParams),
        many: read.many,
      },
    };
  }
  const text = renderSqlCatalogText(read.type, read.writtenTypeParams);
  return { ok: true, check: { kind: 'catalog-text', text: `${text}${read.many ? '[]' : ''}` } };
}

/** The type a quoted name names, read as the one data type that claims a kind reads a reported type of that kind. */
function resolvedByKind(
  base: string,
  dataTypes: readonly SqlDataType[],
): ResolvedSqlType | undefined {
  const name = quotedName(base);
  const kinds = dataTypes.flatMap(({ sql }) => sql.claimsKind ?? []);
  const [kind] = kinds;
  if (name === undefined || kind === undefined || kinds.length > 1) return undefined;
  const [schema, typeName] = name.length === 2 ? name : [undefined, name[0]];
  return resolveReportedSqlType({ text: base, kind, schema, name: typeName }, dataTypes);
}
