import {
  type AuthoringTypeNamespace,
  authoringTypeConstructorArguments,
  type DataTypeSupport,
  getAuthoringTypeChoice,
  getAuthoringTypeConstructor,
  writtenTypeArguments,
} from '@internal/framework-components/authoring';
import type { DataType } from '@internal/framework-components/codec';
import { resolveReportedSqlType } from '@internal/sql-contract/data-type';
import type { ReportedSqlType, SqlColumnIR } from '@internal/sql-schema-ir/types';
import { InternalError } from '@internal/utils/internal-error';
import { sqlFamilyError } from '../errors';
import {
  fewestArgumentsCall,
  type InferredTypeConstructor,
  type InferredTypeConstructors,
  type PslTypeArgument,
  sameInNormalForm,
  writtenTypeChoiceCall,
} from './inferred-type-constructors';

/** A type call as PSL writes it, and the explicit type constructor it becomes, with the value of each of its arguments. */
export interface PslTypeCall {
  readonly path: readonly string[];
  readonly args: readonly PslTypeArgument[];
  readonly explicit: { readonly path: readonly string[]; readonly values: readonly unknown[] };
}

/** The PSL type `contract infer` writes for a column that is not an enum, by table and column name. */
export type ColumnTypeOf = (tableName: string, columnName: string) => PslTypeCall;

/** Whether the codec of `type` reads the default the database reports for `column` as a row value. */
export type ColumnTypeReadsDefault = (
  tableName: string,
  column: SqlColumnIR,
  type: PslTypeCall,
) => Promise<boolean>;

/** One introspected table, with the schema it was read from. */
export interface IntrospectedTable {
  readonly schemaName: string;
  readonly tableName: string;
  readonly columns: readonly SqlColumnIR[];
}

/** The type the database reported for `column`, which introspection always records. */
function reportedTypeOf(column: SqlColumnIR, tableName: string): ReportedSqlType {
  if (column.reportedType === undefined) {
    throw new InternalError(
      `contract infer read column "${tableName}"."${column.name}" without the type the database reported for it.`,
    );
  }
  return column.reportedType;
}

/** The call to the type choice that becomes `marked` with every parameter in `params`, compared in the normal form, as `db verify` compares the column, with the explicit call it becomes. */
function convenienceCall(
  marked: InferredTypeConstructor,
  params: Readonly<Record<string, unknown>>,
  authoringTypes: AuthoringTypeNamespace,
  support: DataTypeSupport,
): PslTypeCall | undefined {
  const values = authoringTypeConstructorArguments(marked.descriptor, {
    codecId: marked.descriptor.output.codecId,
    typeParams: params,
  });
  const written =
    values &&
    writtenTypeChoiceCall({
      authoringTypes,
      call: { path: marked.path, args: values },
      dataTypes: support,
      sameOutput: sameInNormalForm(marked.dataType),
    });
  return (
    written && {
      path: written.path,
      args: written.args,
      explicit: { path: written.becomes.path, values: written.becomes.args },
    }
  );
}

/**
 * The first call to a row of the type choice `written` names whose type constructor represents the same data type, with the same parameters, and whose codec reads the column default.
 */
async function rowReadingDefault(
  written: PslTypeCall,
  marked: InferredTypeConstructor,
  params: Readonly<Record<string, unknown>>,
  authoringTypes: AuthoringTypeNamespace,
  support: DataTypeSupport,
  readsDefault: (type: PslTypeCall) => Promise<boolean>,
): Promise<PslTypeCall | undefined> {
  const choice = getAuthoringTypeChoice({ type: authoringTypes }, written.path);
  for (const row of choice?.descriptor.choices ?? []) {
    const path = [...written.path.slice(0, -1), row.type];
    const descriptor = getAuthoringTypeConstructor({ type: authoringTypes }, path);
    const call =
      descriptor !== undefined &&
      support.dataTypeOfCodec(descriptor.output.codecId) === marked.dataType.id
        ? convenienceCall({ ...marked, path, descriptor }, params, authoringTypes, support)
        : undefined;
    if (call !== undefined && (await readsDefault(call))) return call;
  }
  return undefined;
}

async function writtenCall(
  constructors: InferredTypeConstructors,
  dataTypes: readonly DataType[],
  authoringTypes: AuthoringTypeNamespace,
  support: DataTypeSupport,
  reported: ReportedSqlType,
  readsDefault: (type: PslTypeCall) => Promise<boolean>,
): Promise<PslTypeCall | undefined> {
  const resolved = resolveReportedSqlType(reported, dataTypes);
  const marked = resolved && constructors.get(resolved.dataType.id);
  if (resolved === undefined || marked === undefined) return undefined;
  const convenience = convenienceCall(marked, resolved.typeParams, authoringTypes, support);
  if (convenience !== undefined) {
    if (await readsDefault(convenience)) return convenience;
    const reading = await rowReadingDefault(
      convenience,
      marked,
      resolved.typeParams,
      authoringTypes,
      support,
      readsDefault,
    );
    return reading ?? convenience;
  }
  const call = fewestArgumentsCall(marked, resolved.typeParams);
  const args = call && writtenTypeArguments(marked.descriptor, call.args, support);
  return (
    call &&
    args && {
      path: call.path,
      args: args.map((text) => ({ name: undefined, text })),
      explicit: { path: call.path, values: call.args },
    }
  );
}

/**
 * The type of every column of `tables` that `isEnumColumn` does not claim, through the constructor marked `inferred` for the data type that claims the column's reported type: the type choice call that becomes it, with only the arguments that differ from the defaults, or else the call to it with the fewest arguments. When the codec of that type choice call cannot read the column default as a row, the first row of the same type choice whose codec can is written instead. When any column has no such call, throws `CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED` listing every one of them.
 */
export async function inferColumnTypes(input: {
  readonly tables: readonly IntrospectedTable[];
  readonly constructors: InferredTypeConstructors;
  /** The stack's type namespace, whose type choices infer writes where one becomes a marked constructor. */
  readonly authoringTypes: AuthoringTypeNamespace;
  /** The stack's data types, whose literals write each argument. */
  readonly dataTypes: DataTypeSupport;
  readonly isEnumColumn: (column: SqlColumnIR) => boolean;
  /** Whether a type's codec reads the column default; every type does when `undefined`. */
  readonly readsDefault: ColumnTypeReadsDefault | undefined;
}): Promise<ColumnTypeOf> {
  const dataTypes = [...input.constructors.values()].map((marked) => marked.dataType);
  const types = new Map<string, PslTypeCall>();
  const unclaimed: string[] = [];
  for (const { schemaName, tableName, columns } of input.tables) {
    for (const column of columns) {
      if (input.isEnumColumn(column)) continue;
      const reported = reportedTypeOf(column, tableName);
      const readsDefault = input.readsDefault;
      const call = await writtenCall(
        input.constructors,
        dataTypes,
        input.authoringTypes,
        input.dataTypes,
        reported,
        async (type) => (readsDefault === undefined ? true : readsDefault(tableName, column, type)),
      );
      if (call === undefined) {
        unclaimed.push(
          `${schemaName}.${tableName}.${column.name}: ${reported.text}${column.many === true ? '[]' : ''}`,
        );
        continue;
      }
      types.set(JSON.stringify([tableName, column.name]), call);
    }
  }
  if (unclaimed.length > 0) {
    const columns = unclaimed.sort();
    throw sqlFamilyError(
      'CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED',
      [
        'contract infer: Prisma 8 cannot write these column types with the configured stack:',
        ...columns.map((line) => `  ${line}`),
      ].join('\n'),
      {
        why: 'Prisma 8 reads a column type only through a data type that the target or an extension pack declares.',
        fix: `No configured pack has a type for these columns. If a type comes from a database extension that has a Prisma 8 pack, add the pack to extensions in prisma.config.ts. Otherwise, to keep such a column, write the schema by hand and declare its field as Raw(sql\`<type>\`) with the type as listed, or change the column's type or remove the column from the database.`,
        meta: { columns },
      },
    );
  }
  return (tableName, columnName) => {
    const type = types.get(JSON.stringify([tableName, columnName]));
    if (type === undefined) {
      throw new InternalError(
        `contract infer resolved no type for "${tableName}"."${columnName}".`,
      );
    }
    return type;
  };
}
