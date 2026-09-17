import type { Contract, ContractField, ExecutionMutationDefault } from '@internal/contract/types';
import type {
  PslDocumentAst,
  PslExtensionBlock,
  PslField,
  PslFieldAttribute,
  PslModel,
  PslModelAttribute,
  PslNamespace,
} from '@internal/framework-components/psl-ast';
import { makePslNamespace, makePslNamespaceEntries } from '@internal/framework-components/psl-ast';
import type { SqlStorage, StorageColumn } from '@internal/sql-contract/types';
import { pslFieldMapName, pslModelMapName } from '@internal/sql-contract-psl/resolution';
import { ifDefined } from '@internal/utils/defined';
import { postgresError } from '../errors';
import { PostgresNativeEnum } from '../postgres-native-enum';
import {
  buildCheckAttribute,
  buildIndexAttribute,
  buildModelConstraintAttribute,
} from '../psl-infer/infer-index-attributes';
import { createPostgresTypeMap } from '../psl-infer/postgres-type-map';
import {
  buildAttribute,
  buildMapAttribute,
  positionalArg,
  SYNTHETIC_SPAN,
} from '../psl-infer/psl-literals';
import {
  indexContractModels,
  type ModelEntry,
  modelCoordinate,
  modelsByCoordinate,
} from './contract-model-index';
import { printColumnDefault } from './print-column-default';
import { printColumnType } from './print-column-type';
import { buildNativeEnumBlocksForNamespace, type NativeEnumEmission } from './print-enum-blocks';
import { printExecutionDefault, temporalPresetArguments } from './print-execution-defaults';
import {
  collectRelations,
  isOwningRelation,
  junctionParentRelation,
  owningPartner,
  printRelationField,
  type RelationEntry,
  relationKey,
  relationName,
} from './print-relation-fields';

function executionDefaultsByColumn(
  contract: Contract<SqlStorage>,
): ReadonlyMap<string, ExecutionMutationDefault> {
  const byColumn = new Map<string, ExecutionMutationDefault>();
  for (const entry of contract.execution?.mutations.defaults ?? []) {
    byColumn.set(`${entry.ref.namespace}\u0000${entry.ref.table}\u0000${entry.ref.column}`, entry);
  }
  return byColumn;
}

function scalarFieldAttributes(input: {
  readonly column: StorageColumn;
  readonly fieldName: string;
  readonly namespaceId: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly isSingleColumnId: boolean;
  readonly pslTypeName: string;
  readonly isEnum: boolean;
  readonly generatedDefault: PslFieldAttribute | undefined;
}): readonly PslFieldAttribute[] {
  const attributes: PslFieldAttribute[] = [];
  if (input.isSingleColumnId) {
    attributes.push(buildAttribute('field', 'id', []));
  }
  const columnDefault =
    input.generatedDefault ??
    printColumnDefault({
      column: input.column,
      pslTypeName: input.pslTypeName,
      isEnum: input.isEnum,
      namespaceId: input.namespaceId,
      tableName: input.tableName,
      columnName: input.columnName,
    });
  if (columnDefault !== undefined) {
    attributes.push(columnDefault);
  }
  for (const kind of input.column.noCheck ?? []) {
    attributes.push(buildAttribute('field', 'noCheck', [positionalArg(kind)]));
  }
  const mapName = pslFieldMapName(input.fieldName, input.columnName);
  if (mapName !== undefined) {
    attributes.push(buildMapAttribute('field', mapName));
  }
  return attributes;
}

/**
 * Stops the conversion at a list column the printed file cannot carry without
 * changing the contract: the printer package writes `Type[]` or `Type?` but
 * never both, and the PSL source drops a list field's type parameters from the
 * domain field it reads back. A converted file must never read back as a
 * different contract, so both are refused rather than written.
 */
function refuseLossyListColumn(input: {
  readonly column: StorageColumn;
  readonly field: ContractField | undefined;
  readonly coordinate: string;
}): void {
  const { column, field, coordinate } = input;
  if (column.many !== true) return;

  if (column.nullable) {
    throw postgresError(
      'CONTRACT.CONVERT_UNSUPPORTED',
      `contract convert: column ${coordinate} is a nullable list, which cannot be written in Prisma 8 PSL.`,
      {
        why: 'A field type is written as a list or as optional, never as both, so the written column would read back as a list that cannot be null.',
        fix: 'Make the column not null before converting, or author the Prisma 8 contract by hand for this model.',
        meta: { coordinate },
      },
    );
  }

  const typeParams = field?.type.kind === 'scalar' ? field.type.typeParams : undefined;
  if (typeParams !== undefined && Object.keys(typeParams).length > 0) {
    throw postgresError(
      'CONTRACT.CONVERT_UNSUPPORTED',
      `contract convert: column ${coordinate} is a list whose type parameters cannot be written in Prisma 8 PSL.`,
      {
        why: "The PSL source keeps a list column's type parameters on the storage column but drops them from the field it reads back, so the written column would read back with a different type.",
        fix: 'Author the Prisma 8 contract by hand for this model.',
        meta: { coordinate, typeParams },
      },
    );
  }
}

function buildScalarFields(input: {
  readonly entry: ModelEntry;
  readonly enums: NativeEnumEmission;
  readonly executionDefaults: ReadonlyMap<string, ExecutionMutationDefault>;
}): readonly PslField[] {
  const { entry, enums, executionDefaults } = input;
  const typeMap = createPostgresTypeMap();
  const primaryKeyColumns = entry.table.primaryKey?.columns ?? [];
  const fields: PslField[] = [];

  for (const [fieldName, fieldStorage] of Object.entries(entry.storage.fields)) {
    const columnName = fieldStorage.column;
    const column = entry.table.columns[columnName];
    if (column === undefined) continue;
    const coordinate = `"${entry.namespaceId}"."${entry.tableName}"."${columnName}"`;
    refuseLossyListColumn({ column, field: entry.model.fields[fieldName], coordinate });

    const columnType = printColumnType({
      column,
      typeMap,
      enumBlockNames: enums.blockNamesByTypeName,
      coordinate,
    });
    let { typeName, typeConstructor } = columnType;

    const execution = executionDefaults.get(
      `${entry.namespaceId}\u0000${entry.tableName}\u0000${columnName}`,
    );
    let generatedDefault: PslFieldAttribute | undefined;
    if (execution !== undefined) {
      const printed = printExecutionDefault({
        executionDefault: execution,
        codecId: column.codecId,
        coordinate,
      });
      if (printed.kind === 'temporal') {
        typeName = `temporal.${printed.phases.presetName}`;
        typeConstructor = {
          kind: 'typeConstructor',
          path: ['temporal', printed.phases.presetName],
          args: temporalPresetArguments({
            phases: printed.phases,
            precision: column.typeParams?.['precision'],
          }),
          span: SYNTHETIC_SPAN,
        };
      } else {
        generatedDefault = printed.attribute;
      }
    }

    fields.push({
      kind: 'field',
      name: fieldName,
      typeName,
      ...ifDefined('typeConstructor', typeConstructor),
      optional: column.nullable,
      list: column.many === true,
      attributes: scalarFieldAttributes({
        column,
        fieldName,
        namespaceId: entry.namespaceId,
        tableName: entry.tableName,
        columnName,
        isSingleColumnId: primaryKeyColumns.length === 1 && primaryKeyColumns[0] === columnName,
        pslTypeName: columnType.typeName,
        isEnum: column.codecId === 'pg/enum@1',
        generatedDefault,
      }),
      span: SYNTHETIC_SPAN,
    });
  }

  return fields;
}

function buildModelAttributes(entry: ModelEntry): readonly PslModelAttribute[] {
  const attributes: PslModelAttribute[] = [];
  const fieldNameOf = (column: string): string => entry.fieldNamesByColumn.get(column) ?? column;
  const primaryKeyColumns = entry.table.primaryKey?.columns ?? [];
  if (primaryKeyColumns.length > 1) {
    attributes.push(buildModelConstraintAttribute('id', primaryKeyColumns.map(fieldNameOf)));
  }
  for (const unique of entry.table.uniques) {
    attributes.push(
      buildModelConstraintAttribute('unique', unique.columns.map(fieldNameOf), unique.name),
    );
  }
  for (const check of entry.table.checks ?? []) {
    attributes.push(buildCheckAttribute(check));
  }
  for (const index of entry.table.indexes) {
    attributes.push(
      buildIndexAttribute(
        index,
        index.columns?.map((column) => entry.fieldNamesByColumn.get(column) ?? column),
      ),
    );
  }
  const mapName = pslModelMapName(entry.name, entry.tableName);
  if (mapName !== undefined) {
    attributes.push(buildMapAttribute('model', mapName));
  }
  return attributes;
}

/**
 * The relation names to pin. A pair needs one when either of its models
 * carries more than one relation to the other; a many-to-many list field
 * additionally pins the junction-side relation it travels through, so that
 * relation is named too.
 */
function resolvePinnedRelations(
  relations: readonly RelationEntry[],
  relationsByModel: ReadonlyMap<string, readonly RelationEntry[]>,
): ReadonlySet<string> {
  const pairCounts = new Map<string, number>();
  for (const entry of relations) {
    const key = `${modelCoordinate(entry.owner.namespaceId, entry.owner.name)}\u0000${entry.targetCoordinate}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  const ambiguous = (entry: RelationEntry): boolean => {
    const ownerCoordinate = modelCoordinate(entry.owner.namespaceId, entry.owner.name);
    const forward = pairCounts.get(`${ownerCoordinate}\u0000${entry.targetCoordinate}`) ?? 0;
    const backward = pairCounts.get(`${entry.targetCoordinate}\u0000${ownerCoordinate}`) ?? 0;
    return forward > 1 || backward > 1;
  };

  const pinned = new Set<string>();
  for (const entry of relations) {
    if (!ambiguous(entry)) continue;
    const owning = isOwningRelation(entry)
      ? entry
      : entry.relation.cardinality === 'N:M'
        ? junctionParentRelation(entry, relationsByModel)
        : owningPartner(entry, relationsByModel);
    if (owning !== undefined) {
      pinned.add(relationKey(owning));
    }
  }
  return pinned;
}

/**
 * Relation fields in the order their foreign keys appear in storage, so the
 * `foreignKeys` the PSL source derives come back in the same order. A relation
 * that owns no foreign key keeps its place at the end.
 */
function orderedByForeignKey(
  entry: ModelEntry,
  relations: readonly RelationEntry[],
): readonly RelationEntry[] {
  const positions = new Map<RelationEntry, number>();
  for (const relation of relations) {
    const target = relation.relation.on.localFields.map(
      (fieldName) => relation.owner.storage.fields[fieldName]?.column ?? fieldName,
    );
    const position = entry.table.foreignKeys.findIndex(
      (fk) =>
        fk.source.columns.length === target.length &&
        fk.source.columns.every((column, index) => column === target[index]),
    );
    positions.set(
      relation,
      isOwningRelation(relation) && position >= 0 ? position : relations.length,
    );
  }
  return [...relations].sort((a, b) => (positions.get(a) ?? 0) - (positions.get(b) ?? 0));
}

function buildRelationFields(input: {
  readonly entry: ModelEntry;
  readonly relations: readonly RelationEntry[];
  readonly relationsByModel: ReadonlyMap<string, readonly RelationEntry[]>;
  readonly modelsByCoordinate: ReadonlyMap<string, ModelEntry>;
  readonly pinned: ReadonlySet<string>;
}): readonly PslField[] {
  const fields: PslField[] = [];
  for (const relationEntry of orderedByForeignKey(input.entry, input.relations)) {
    const target = input.modelsByCoordinate.get(relationEntry.targetCoordinate);
    if (target === undefined) continue;
    const owning = isOwningRelation(relationEntry)
      ? relationEntry
      : relationEntry.relation.cardinality === 'N:M'
        ? junctionParentRelation(relationEntry, input.relationsByModel)
        : owningPartner(relationEntry, input.relationsByModel);
    const name =
      owning !== undefined && input.pinned.has(relationKey(owning))
        ? relationName(owning)
        : undefined;
    fields.push(printRelationField({ entry: relationEntry, target, name }));
  }
  return fields;
}

/**
 * The Prisma 8 PSL source resolves a relation's target by model name alone, so
 * two models sharing a name in different namespaces would be read as one.
 */
function refuseDuplicateModelNames(models: readonly ModelEntry[]): void {
  const namespacesByName = new Map<string, string[]>();
  for (const entry of models) {
    const namespaces = namespacesByName.get(entry.name) ?? [];
    namespaces.push(entry.namespaceId);
    namespacesByName.set(entry.name, namespaces);
  }
  for (const [name, namespaces] of namespacesByName) {
    if (namespaces.length > 1) {
      throw postgresError(
        'CONTRACT.CONVERT_UNSUPPORTED',
        `contract convert: model "${name}" is declared in more than one namespace (${namespaces.join(', ')}), which Prisma 8 PSL cannot express: it resolves a relation's target by model name alone.`,
        {
          why: 'Two models sharing a name would be read back as one model, so the relations between them would resolve to the wrong tables.',
          fix: 'Rename one of the models before converting.',
          meta: { modelName: name, namespaces },
        },
      );
    }
  }
}

/**
 * Prints the Prisma 8 PSL document a Postgres contract was, or would have
 * been, authored as: every model with its columns, keys, indexes and
 * relations, and every native enum, in the namespace block that carries it.
 *
 * Read back by the PSL contract source, the document yields the contract it
 * was printed from.
 */
export function printPostgresPslContract(contract: Contract<SqlStorage>): PslDocumentAst {
  const models = indexContractModels(contract);
  refuseDuplicateModelNames(models);
  const byCoordinate = modelsByCoordinate(models);
  const relations = collectRelations(models);
  const relationsByModel = new Map<string, RelationEntry[]>();
  for (const entry of relations) {
    const key = modelCoordinate(entry.owner.namespaceId, entry.owner.name);
    const bucket = relationsByModel.get(key) ?? [];
    bucket.push(entry);
    relationsByModel.set(key, bucket);
  }
  const pinned = resolvePinnedRelations(relations, relationsByModel);
  const executionDefaults = executionDefaultsByColumn(contract);

  const namespaces: PslNamespace[] = [];
  for (const [namespaceId, namespace] of Object.entries(contract.storage.namespaces)) {
    const nativeEnums = new Map<string, PostgresNativeEnum>();
    for (const [name, entity] of Object.entries(namespace.entries['native_enum'] ?? {})) {
      if (PostgresNativeEnum.is(entity)) {
        nativeEnums.set(name, entity);
      }
    }
    const enums = buildNativeEnumBlocksForNamespace({
      namespaceId,
      nativeEnums,
      valueSets: new Map(
        Object.entries(namespace.entries.valueSet ?? {}).map(([name, valueSet]) => [
          name,
          valueSet.values,
        ]),
      ),
      columns: models
        .filter((entry) => entry.namespaceId === namespaceId)
        .flatMap((entry) => Object.values(entry.table.columns)),
    });

    const namespaceModels: PslModel[] = [];
    for (const entry of models) {
      if (entry.namespaceId !== namespaceId) continue;
      namespaceModels.push({
        kind: 'model',
        name: entry.name,
        fields: [
          ...buildScalarFields({ entry, enums, executionDefaults }),
          ...buildRelationFields({
            entry,
            relations: relationsByModel.get(modelCoordinate(namespaceId, entry.name)) ?? [],
            relationsByModel,
            modelsByCoordinate: byCoordinate,
            pinned,
          }),
        ],
        attributes: buildModelAttributes(entry),
        span: SYNTHETIC_SPAN,
      });
    }

    const blocks: readonly PslExtensionBlock[] = enums.blocks;
    if (namespaceModels.length === 0 && blocks.length === 0) continue;
    namespaces.push(
      makePslNamespace({
        kind: 'namespace',
        name: namespaceId,
        entries: makePslNamespaceEntries(namespaceModels, [], blocks),
        span: SYNTHETIC_SPAN,
      }),
    );
  }

  return {
    kind: 'document',
    sourceId: '<contract>',
    namespaces,
    span: SYNTHETIC_SPAN,
  };
}
