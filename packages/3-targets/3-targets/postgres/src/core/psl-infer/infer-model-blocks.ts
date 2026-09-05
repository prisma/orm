import type {
  DefaultMappingOptions,
  PslPrinterOptions,
  PslTypeMap,
  RelationField,
} from '@internal/family-sql/psl-infer';
import { mapDefault, toFieldName, toModelName } from '@internal/family-sql/psl-infer';
import type {
  PslAttributeArgument,
  PslField,
  PslFieldAttribute,
  PslModel,
  PslModelAttribute,
  PslTypeConstructorCall,
} from '@internal/framework-components/psl-ast';
import {
  composeCheckWirePrefix,
  computeCheckContentHash,
  formatWireName,
} from '@internal/sql-schema-ir/naming';
import type { SqlColumnIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import { postgresRenderCheckExpressions } from '../check-expressions';
import { buildDanglingForeignKeyWarning, type DanglingForeignKeyInfo } from './infer-foreign-keys';
import {
  buildCheckAttribute,
  buildIndexAttribute,
  buildModelConstraintAttribute,
} from './infer-index-attributes';
import {
  createUniqueFieldName,
  resolveColumnFieldName,
  type TableColumnFieldNameMap,
} from './infer-names';
import {
  buildAttribute,
  buildMapAttribute,
  buildSimpleConstraintFieldAttribute,
  escapePslString,
  formatPslListLiteralValue,
  namedArg,
  parseColumnDefault,
  parseDefaultAttributeString,
  positionalArg,
  SYNTHETIC_SPAN,
} from './psl-literals';

/**
 * A recovered domain enum, keyed by column name per table: the allocated
 * top-level PSL block name the column's field is typed by, and the proven
 * member values `computeDerivedCheckNames` re-renders the membership check
 * from.
 */
export interface RecoveredEnumField {
  readonly pslName: string;
  readonly memberValues: readonly string[];
}

const NO_RECOVERED_ENUMS: ReadonlyMap<string, RecoveredEnumField> = new Map();

export function buildModel(
  table: SqlTableIR,
  typeMap: PslTypeMap,
  enumNameMap: ReadonlyMap<string, string>,
  fieldNamesByTable: ReadonlyMap<string, TableColumnFieldNameMap>,
  defaultMapping: DefaultMappingOptions | undefined,
  rawDefaultParser: PslPrinterOptions['parseRawDefault'],
  relationFields: readonly RelationField[],
  danglingForeignKeys: readonly DanglingForeignKeyInfo[],
  rlsEnabled = false,
  policySkipNotes: readonly string[] = [],
  recoveredEnums: ReadonlyMap<string, RecoveredEnumField> = NO_RECOVERED_ENUMS,
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

  const derivedCheckNames = computeDerivedCheckNames(table, recoveredEnums);

  const fields: PslField[] = [];
  for (const column of Object.values(table.columns)) {
    fields.push(
      buildScalarField(
        column,
        table,
        typeMap,
        enumNameMap,
        fieldNameMap,
        defaultMapping,
        rawDefaultParser,
        pkColumns,
        isSinglePk,
        singlePkConstraintName,
        uniqueColumns,
        derivedCheckNames,
        recoveredEnums.get(column.name),
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

  for (const index of table.indexes) {
    const indexFieldNames = index.columns?.map((columnName) =>
      resolveColumnFieldName(fieldNamesByTable, table.name, columnName),
    );
    modelAttributes.push(buildIndexAttribute(index, indexFieldNames));
  }

  for (const check of table.checks ?? []) {
    if (!derivedCheckNames.has(check.name)) {
      modelAttributes.push(buildCheckAttribute(check));
    }
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
 * The live check names that are derived: a live check's name matches
 * `formatWireName(composeCheckWirePrefix(table, column, kind), computeCheckContentHash(expression))`
 * for some column of the table and some candidate `postgresRenderCheckExpressions`
 * would render for that column. Never by comparing expressions — the live
 * body is a Postgres reprint, never the authored text. One set serves both
 * the `@noCheck` waiver below and `@@check` exclusion in `buildModel`, so the
 * two decisions cannot drift apart.
 *
 * A `membership` check is derived only for a column Path A recovery proved:
 * `recoveredEnums` carries its member values, so the re-render below produces
 * the exact authored predicate and the live check's wire name lands in the
 * derived set — which is what suppresses its `@@check` and its `@noCheck`
 * waiver with no recovery-specific exclusion code. A column with no
 * recovered enum renders no membership candidate at all.
 */
function computeDerivedCheckNames(
  table: SqlTableIR,
  recoveredEnums: ReadonlyMap<string, RecoveredEnumField>,
): ReadonlySet<string> {
  const liveCheckNames = new Set((table.checks ?? []).map((check) => check.name));
  const derivedCheckNames = new Set<string>();
  for (const column of Object.values(table.columns)) {
    for (const candidate of postgresRenderCheckExpressions({
      tableName: table.name,
      columnName: column.name,
      many: column.many === true,
      memberValues: recoveredEnums.get(column.name)?.memberValues,
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
  typeMap: PslTypeMap,
  enumNameMap: ReadonlyMap<string, string>,
  fieldNameMap: TableColumnFieldNameMap | undefined,
  defaultMapping: DefaultMappingOptions | undefined,
  rawDefaultParser: PslPrinterOptions['parseRawDefault'],
  pkColumns: ReadonlySet<string>,
  isSinglePk: boolean,
  singlePkConstraintName: string | undefined,
  uniqueColumns: ReadonlyMap<string, string | undefined>,
  derivedCheckNames: ReadonlySet<string>,
  recoveredEnum: RecoveredEnumField | undefined,
): PslField {
  const resolvedField = fieldNameMap?.get(column.name);
  const fieldName = resolvedField?.fieldName ?? toFieldName(column.name).name;
  const fieldMap = resolvedField?.fieldMap;

  const resolution = typeMap.resolve(column.nativeType, table.annotations);

  if ('unsupported' in resolution) {
    const attrs: PslFieldAttribute[] = [];
    if (fieldMap !== undefined) {
      attrs.push(buildMapAttribute('field', fieldMap));
    }
    return {
      kind: 'field',
      name: fieldName,
      typeName: `Unsupported("${escapePslString(resolution.nativeType)}")`,
      optional: column.nullable,
      list: column.many === true,
      attributes: attrs,
      span: SYNTHETIC_SPAN,
    };
  }

  // An enum-typed column emits the `pg.enum(<Name>)` type-constructor call —
  // the Phase-1 authoring form a `native_enum` ref field takes — not a bare
  // name substitution. The printer renders `typeConstructor` when present and
  // composes `?`/`[]` exactly like any other field type.
  let typeName = resolution.pslType.name;
  let typeConstructor: PslTypeConstructorCall | undefined = resolution.pslType.args
    ? {
        kind: 'typeConstructor',
        path: [resolution.pslType.name],
        args: resolution.pslType.args.map(positionalArg),
        span: SYNTHETIC_SPAN,
      }
    : undefined;
  const enumPslName = enumNameMap.get(column.nativeType);
  if (enumPslName) {
    typeName = enumPslName;
    typeConstructor = {
      kind: 'typeConstructor',
      path: ['pg', 'enum'],
      args: [positionalArg(enumPslName)],
      span: SYNTHETIC_SPAN,
    };
  }

  // A recovered domain-enum column takes the authored form: the enum's bare
  // top-level name, no type constructor — the storage type comes from the
  // enum block's `@@type`, not from the scalar resolution above.
  if (recoveredEnum !== undefined) {
    typeName = recoveredEnum.pslName;
    typeConstructor = undefined;
  }

  const attributes: PslFieldAttribute[] = [];
  const isId = isSinglePk && pkColumns.has(column.name);
  if (isId) {
    attributes.push(buildSimpleConstraintFieldAttribute('id', singlePkConstraintName));
  }

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
    attributes.push(parseDefaultAttributeString('@default(autoincrement())'));
  } else if (column.many === true && column.resolvedDefault?.kind === 'literal') {
    // A list column's default must print from `resolvedDefault`: the raw SQL
    // text (e.g. `'{}'::text[]`) only parses to `dbgenerated(...)`, which the
    // interpreter rejects on a list column (lists accept literal defaults
    // only). PSL literal-list elements are string/number/boolean only, so a
    // resolved value holding anything else has no spelling — the default is
    // then omitted, which verify reports as a live-only "extra", not a
    // false mismatch.
    const formatted = Array.isArray(column.resolvedDefault.value)
      ? formatPslListLiteralValue(column.resolvedDefault.value)
      : undefined;
    if (formatted !== undefined) {
      attributes.push(parseDefaultAttributeString(`@default(${formatted})`));
    }
  } else if (column.default !== undefined) {
    const parsed = parseColumnDefault(column.default, column.nativeType, rawDefaultParser);
    if (parsed) {
      const result = mapDefault(parsed, defaultMapping);
      if ('attribute' in result) {
        attributes.push(parseDefaultAttributeString(result.attribute));
      }
      // 'comment' fallback (unrecognized raw default) is dropped — the
      // M1 legacy path emitted a `// Raw default: ...` line above the field via
      // `PrinterField.comment`. M2 drops this since it would require comment
      // nodes in the AST.
    }
  }

  if (uniqueColumns.has(column.name) && !isId) {
    const uniqueConstraintName = uniqueColumns.get(column.name);
    attributes.push(buildSimpleConstraintFieldAttribute('unique', uniqueConstraintName));
  }

  if (column.many === true) {
    // Every list-column kind not covered by a derived live check (per
    // computeDerivedCheckNames) gets the opted-out form, so a pulled schema
    // verifies clean immediately.
    const waivedKinds = postgresRenderCheckExpressions({
      tableName: table.name,
      columnName: column.name,
      many: true,
      memberValues: recoveredEnum?.memberValues,
    })
      .filter(
        (candidate) =>
          !derivedCheckNames.has(
            formatWireName(
              composeCheckWirePrefix(table.name, column.name, candidate.kind),
              computeCheckContentHash(candidate.expression),
            ),
          ),
      )
      .map((candidate) => candidate.kind);
    if (waivedKinds.length > 0) {
      attributes.push(buildAttribute('field', 'noCheck', waivedKinds.map(positionalArg)));
    }
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
    attributes,
    span: SYNTHETIC_SPAN,
  };
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
