import type { ColumnDefault, ColumnDefaultLiteralInputValue } from '@internal/contract/types';
import {
  type ColumnTypeOf,
  type DefaultMappingOptions,
  mapDefault,
} from '@internal/family-sql/psl-build';
import type { RelationField } from '@internal/family-sql/psl-infer';
import { toFieldName, toModelName } from '@internal/family-sql/psl-infer';
import type {
  PslAttributeArgument,
  PslField,
  PslFieldAttribute,
  PslModel,
  PslModelAttribute,
  PslTypeConstructorCall,
} from '@internal/framework-components/psl-ast';
import { escapePslString } from '@internal/sql-contract/data-type-support';
import { sqlTextsReadBack } from '@internal/sql-contract/sql-expression';
import {
  composeCheckWirePrefix,
  computeCheckContentHash,
  formatWireName,
} from '@internal/sql-schema-ir/naming';
import type { SqlColumnIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import { postgresRenderCheckExpressions } from '../check-expressions';
import {
  buildCheckAttribute,
  buildIndexAttribute,
  buildModelConstraintAttribute,
} from '../psl-build/index-attributes';
import {
  buildAttribute,
  buildMapAttribute,
  buildSimpleConstraintFieldAttribute,
  namedArg,
  parseDefaultAttributeString,
  positionalArg,
  SYNTHETIC_SPAN,
} from '../psl-build/psl-literals';
import { createUniqueFieldName } from '../psl-build/unique-name';
import type { InferredColumnDefaults } from './infer-default-codec';
import { buildDanglingForeignKeyWarning, type DanglingForeignKeyInfo } from './infer-foreign-keys';
import { resolveColumnFieldName, type TableColumnFieldNameMap } from './infer-names';
import type { InferredDefaultOf } from './infer-read-defaults';
import {
  defaultDoesNotReadBackNote,
  printableIndex,
  SQL_DOES_NOT_READ_BACK,
} from './infer-sql-text';

export function buildModel(
  table: SqlTableIR,
  columnTypes: ColumnTypeOf,
  enumNameOf: (column: SqlColumnIR) => string | undefined,
  fieldNamesByTable: ReadonlyMap<string, TableColumnFieldNameMap>,
  defaultMapping: DefaultMappingOptions | undefined,
  defaultOf: InferredDefaultOf,
  columnDefaults: InferredColumnDefaults,
  relationFields: readonly RelationField[],
  danglingForeignKeys: readonly DanglingForeignKeyInfo[],
  rlsEnabled = false,
  policySkipNotes: readonly string[] = [],
): PslModel {
  const { name: modelName, map: mapName } = toModelName(table.name);
  const fieldNameMap = fieldNamesByTable.get(table.name);

  const pkColumns = new Set(table.primaryKey?.columns ?? []);
  const isSinglePk = pkColumns.size === 1;
  const singlePkConstraintName = isSinglePk ? table.primaryKey?.name : undefined;

  const uniqueColumns = new Map<string, string | undefined>();
  for (const unique of table.uniques) {
    if (unique.columns.length === 1) {
      const [columnName = ''] = unique.columns;
      const existingConstraintName = uniqueColumns.get(columnName);
      if (!uniqueColumns.has(columnName) || (existingConstraintName === undefined && unique.name)) {
        uniqueColumns.set(columnName, unique.name);
      }
    }
  }

  const derivedCheckNames = computeDerivedCheckNames(table);

  const defaultNotes: string[] = [];
  const fields: PslField[] = [];
  for (const column of Object.values(table.columns)) {
    fields.push(
      buildScalarField(
        column,
        table,
        columnTypes,
        enumNameOf,
        fieldNameMap,
        defaultMapping,
        defaultOf,
        columnDefaults,
        pkColumns,
        isSinglePk,
        singlePkConstraintName,
        uniqueColumns,
        derivedCheckNames,
        () => defaultNotes.push(defaultDoesNotReadBackNote(column.name)),
      ),
    );
  }

  const usedFieldNames = new Set(fields.map((field) => field.name));
  for (const rel of relationFields) {
    fields.push(buildRelationField(rel, table.name, fieldNamesByTable, usedFieldNames));
  }

  const modelAttributes: PslModelAttribute[] = [];

  if (table.primaryKey && table.primaryKey.columns.length > 1) {
    const pkFieldNames = table.primaryKey.columns.map((columnName) =>
      resolveColumnFieldName(fieldNamesByTable, table.name, columnName),
    );
    modelAttributes.push(buildModelConstraintAttribute('id', pkFieldNames, table.primaryKey.name));
  }

  for (const unique of table.uniques) {
    if (unique.columns.length > 1) {
      const uniqueFieldNames = unique.columns.map((columnName) =>
        resolveColumnFieldName(fieldNamesByTable, table.name, columnName),
      );
      modelAttributes.push(buildModelConstraintAttribute('unique', uniqueFieldNames, unique.name));
    }
  }

  const sqlSkipNotes: string[] = [];
  const skipNote = (kind: 'index' | 'check', name: string) =>
    sqlSkipNotes.push(`// prisma: skipped ${kind} "${name}": ${SQL_DOES_NOT_READ_BACK}`);

  for (const index of table.indexes) {
    const printable = printableIndex(index);
    if (printable === undefined) {
      skipNote('index', index.name);
      continue;
    }
    const indexFieldNames = printable.columns?.map((columnName) =>
      resolveColumnFieldName(fieldNamesByTable, table.name, columnName),
    );
    modelAttributes.push(buildIndexAttribute(printable, indexFieldNames));
  }

  for (const check of table.checks ?? []) {
    if (derivedCheckNames.has(check.name)) continue;
    if (!sqlTextsReadBack([check.expression])) {
      skipNote('check', check.name);
      continue;
    }
    modelAttributes.push(buildCheckAttribute(check));
  }

  if (mapName) {
    modelAttributes.push(buildMapAttribute('model', mapName));
  }

  // `@@rls` records the live `ENABLE ROW LEVEL SECURITY` state; it goes last
  // so the emitted line position matches the previous out-of-band appender.
  if (rlsEnabled) {
    modelAttributes.push(buildAttribute('model', 'rls', []));
  }

  // Surface introspection advisories the user would otherwise have no way to
  // discover from the emitted PSL alone. Both warnings are part of the
  // emitted SQL output and are asserted byte-for-byte, so keep the exact
  // wording; a table hitting both is combined onto the single comment line
  // `PslModel.comment` supports.
  const warnings: string[] = [];
  if (!table.primaryKey) {
    // Tables without a primary key cannot serve as the right-hand side of a
    // `findUnique`-style query downstream, so the user should add an `@id`.
    warnings.push('This table has no primary key in the database');
  }
  if (danglingForeignKeys.length > 0) {
    warnings.push(
      buildDanglingForeignKeyWarning(danglingForeignKeys, fieldNamesByTable, table.name),
    );
  }
  const commentLines = [
    ...(warnings.length > 0 ? [`// WARNING: ${warnings.join(' ')}`] : []),
    ...policySkipNotes,
    ...sqlSkipNotes,
    ...defaultNotes,
  ];
  const comment = commentLines.length > 0 ? commentLines.join('\n') : undefined;

  return {
    kind: 'model',
    name: modelName,
    fields,
    attributes: modelAttributes,
    span: SYNTHETIC_SPAN,
    ...(comment !== undefined ? { comment } : {}),
  };
}

/**
 * The live check names that are derived: a live check's name matches `formatWireName(composeCheckWirePrefix(table, column, kind), computeCheckContentHash(expression))` for some column of the table and some candidate `postgresRenderCheckExpressions` would render for that column. Never by comparing expressions — the live body is a Postgres reprint, never the authored text. One set serves both the element nullability of list fields and `@@check` exclusion in `buildModel`, so the two decisions cannot drift apart.
 *
 * `membership` is unreachable here today: infer never emits domain enums (`enumType()` is not inferred), so no inferred column has member values and no membership check is ever derived. Inferring domain enums would mean threading the column's member values through here.
 */
function computeDerivedCheckNames(table: SqlTableIR): ReadonlySet<string> {
  const liveCheckNames = new Set((table.checks ?? []).map((check) => check.name));
  const derivedCheckNames = new Set<string>();
  for (const column of Object.values(table.columns)) {
    for (const candidate of postgresRenderCheckExpressions({
      tableName: table.name,
      columnName: column.name,
      many: column.many === true ? { elementNullable: false } : false,
      memberValues: undefined,
      valueObject: undefined,
    })) {
      const derivedName = formatWireName(
        composeCheckWirePrefix(table.name, column.name, candidate.kind),
        computeCheckContentHash(candidate.expression),
      );
      if (liveCheckNames.has(derivedName)) {
        derivedCheckNames.add(derivedName);
      }
    }
  }
  return derivedCheckNames;
}

function buildScalarField(
  column: SqlColumnIR,
  table: SqlTableIR,
  columnTypes: ColumnTypeOf,
  enumNameOf: (column: SqlColumnIR) => string | undefined,
  fieldNameMap: TableColumnFieldNameMap | undefined,
  defaultMapping: DefaultMappingOptions | undefined,
  defaultOf: InferredDefaultOf,
  columnDefaults: InferredColumnDefaults,
  pkColumns: ReadonlySet<string>,
  isSinglePk: boolean,
  singlePkConstraintName: string | undefined,
  uniqueColumns: ReadonlyMap<string, string | undefined>,
  derivedCheckNames: ReadonlySet<string>,
  noteDefaultThatDoesNotReadBack: () => void,
): PslField {
  const resolvedField = fieldNameMap?.get(column.name);
  const fieldName = resolvedField?.fieldName ?? toFieldName(column.name).name;
  const fieldMap = resolvedField?.fieldMap;

  // An enum-typed column emits the `pg.enum(<Name>)` type-constructor call —
  // the Phase-1 authoring form a `native_enum` ref field takes — not a bare
  // name substitution. The printer renders `typeConstructor` when present and
  // composes `?`/`[]` exactly like any other field type.
  const enumPslName = enumNameOf(column);
  const pslType =
    enumPslName === undefined
      ? columnTypes(table.name, column.name)
      : { path: [enumPslName], args: [], values: [] };
  const typeName = pslType.path.join('.');
  const typeConstructor: PslTypeConstructorCall | undefined =
    enumPslName !== undefined
      ? {
          kind: 'typeConstructor',
          path: ['pg', 'enum'],
          args: [positionalArg(enumPslName)],
          span: SYNTHETIC_SPAN,
        }
      : pslType.args.length > 0 || pslType.path.length > 1
        ? {
            kind: 'typeConstructor',
            path: pslType.path,
            args: pslType.args.map(positionalArg),
            span: SYNTHETIC_SPAN,
          }
        : undefined;

  const attributes: PslFieldAttribute[] = [];
  const isId = isSinglePk && pkColumns.has(column.name);
  if (isId) {
    attributes.push(buildSimpleConstraintFieldAttribute('id', singlePkConstraintName));
  }

  const isEnumColumn = enumPslName !== undefined;
  const defaultAttribute = inferDefaultAttribute(
    column,
    defaultOf(table.name, column),
    {
      ...defaultMapping,
      ...ifDefined('columnCodec', columnDefaults.codecOf(pslType, isEnumColumn)),
      ...ifDefined('typeParams', columnDefaults.typeParamsOf(pslType, isEnumColumn)),
      list: column.many === true,
    },
    (value) => columnDefaults.readsBack(value, pslType, isEnumColumn, column.many === true),
    noteDefaultThatDoesNotReadBack,
  );
  if (defaultAttribute !== undefined) {
    attributes.push(parseDefaultAttributeString(defaultAttribute));
  }

  if (uniqueColumns.has(column.name) && !isId) {
    const uniqueConstraintName = uniqueColumns.get(column.name);
    attributes.push(buildSimpleConstraintFieldAttribute('unique', uniqueConstraintName));
  }

  if (fieldMap !== undefined) {
    attributes.push(buildMapAttribute('field', fieldMap));
  }

  return {
    kind: 'field',
    name: fieldName,
    typeName,
    ...ifDefined('typeConstructor', typeConstructor),
    optional: column.nullable,
    list: column.many === true,
    ...ifDefined(
      'elementOptional',
      column.many === true && !enforcesElementNotNull(table, column, derivedCheckNames)
        ? true
        : undefined,
    ),
    attributes,
    span: SYNTHETIC_SPAN,
  };
}

function enforcesElementNotNull(
  table: SqlTableIR,
  column: SqlColumnIR,
  derivedCheckNames: ReadonlySet<string>,
): boolean {
  return postgresRenderCheckExpressions({
    tableName: table.name,
    columnName: column.name,
    many: { elementNullable: false },
    memberValues: undefined,
    valueObject: undefined,
  }).some(
    (candidate) =>
      candidate.kind === 'elementNotNull' &&
      derivedCheckNames.has(
        formatWireName(
          composeCheckWirePrefix(table.name, column.name, candidate.kind),
          computeCheckContentHash(candidate.expression),
        ),
      ),
  );
}

/**
 * A literal default prints as the PSL literal the column's data type takes. A literal that has no
 * such PSL literal prints as a `sql` tagged literal holding the expression Postgres reported.
 */
function inferDefaultAttribute(
  column: SqlColumnIR,
  read: ColumnDefault | undefined,
  defaultMapping: DefaultMappingOptions,
  readsBack: (value: ColumnDefaultLiteralInputValue) => boolean,
  noteTextThatDoesNotReadBack: () => void,
): string | undefined {
  if (
    column.default === undefined &&
    column.resolvedDefault?.kind === 'function' &&
    column.resolvedDefault.expression === 'autoincrement()'
  ) {
    // An identity column: a `resolvedDefault` with no raw `default` is the
    // only introspected shape the control adapter produces for
    // `GENERATED ... AS IDENTITY` (Postgres reports no `column_default`;
    // the adapter stamps `autoincrement()` directly). There is no
    // `identity` field on the column IR — this pairing is the marker.
    return '@default(autoincrement())';
  }
  if (read === undefined) return undefined;
  if (read.kind === 'function') {
    return mappedAttribute(read, defaultMapping, noteTextThatDoesNotReadBack);
  }
  if (column.many === true && !Array.isArray(read.value)) return undefined;
  return literalOrRawAttribute(
    read,
    column,
    defaultMapping,
    readsBack,
    noteTextThatDoesNotReadBack,
  );
}

/**
 * A literal no data type the column takes writes, or that the column's codec does not read back,
 * has no PSL literal, so the raw database default prints instead.
 */
function literalOrRawAttribute(
  columnDefault: ColumnDefault,
  column: SqlColumnIR,
  defaultMapping: DefaultMappingOptions,
  readsBack: (value: ColumnDefaultLiteralInputValue) => boolean,
  noteTextThatDoesNotReadBack: () => void,
): string | undefined {
  const printed = columnDefault;
  const result =
    printed.kind === 'literal' && !readsBack(printed.value)
      ? undefined
      : mapDefault(printed, defaultMapping);
  if (result !== undefined) return result.attribute;
  return typeof column.default === 'string'
    ? mappedAttribute(
        { kind: 'function', expression: column.default },
        defaultMapping,
        noteTextThatDoesNotReadBack,
      )
    : undefined;
}

/**
 * A default expression prints even when its `sql` literal reads back as different text: dropping it
 * would let the next plan drop the default. The caller notes it instead.
 */
function mappedAttribute(
  columnDefault: ColumnDefault,
  defaultMapping: DefaultMappingOptions | undefined,
  noteTextThatDoesNotReadBack: () => void,
): string | undefined {
  if (columnDefault.kind === 'function' && !sqlTextsReadBack([columnDefault.expression])) {
    noteTextThatDoesNotReadBack();
  }
  return mapDefault(columnDefault, defaultMapping)?.attribute;
}

export function buildRelationField(
  rel: RelationField,
  hostTableName: string,
  fieldNamesByTable: ReadonlyMap<string, TableColumnFieldNameMap>,
  usedFieldNames: Set<string>,
): PslField {
  const fieldName = createUniqueFieldName(rel.fieldName, usedFieldNames);
  usedFieldNames.add(fieldName);

  const args: PslAttributeArgument[] = [];

  if (rel.fields && rel.references) {
    if (rel.relationName) {
      args.push(namedArg('name', `"${escapePslString(rel.relationName)}"`));
    }
    args.push(
      namedArg(
        'fields',
        `[${rel.fields
          .map((columnName) => resolveColumnFieldName(fieldNamesByTable, hostTableName, columnName))
          .join(', ')}]`,
      ),
    );
    args.push(
      namedArg(
        'references',
        `[${rel.references
          .map((columnName) =>
            resolveColumnFieldName(fieldNamesByTable, rel.referencedTableName ?? '', columnName),
          )
          .join(', ')}]`,
      ),
    );
    if (rel.onDelete) {
      args.push(namedArg('onDelete', rel.onDelete));
    }
    if (rel.onUpdate) {
      args.push(namedArg('onUpdate', rel.onUpdate));
    }
    if (rel.fkName) {
      args.push(namedArg('map', `"${escapePslString(rel.fkName)}"`));
    }
    if (rel.index === false) {
      args.push(namedArg('index', 'false'));
    } else if (rel.index !== undefined) {
      args.push(namedArg('index', `"${escapePslString(rel.index)}"`));
    }
  } else if (rel.relationName) {
    args.push(namedArg('name', `"${escapePslString(rel.relationName)}"`));
  }

  const attrs: PslFieldAttribute[] =
    args.length > 0 ? [buildAttribute('field', 'relation', args)] : [];

  return {
    kind: 'field',
    name: fieldName,
    typeName: rel.typeName,
    ...ifDefined('typeNamespaceId', rel.typeNamespaceId),
    ...ifDefined('typeContractSpaceId', rel.typeContractSpaceId),
    optional: rel.optional,
    list: rel.list,
    attributes: attrs,
    span: SYNTHETIC_SPAN,
  };
}
