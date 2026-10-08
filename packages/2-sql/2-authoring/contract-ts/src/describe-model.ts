import {
  asNamespaceId,
  type ContractField,
  type ExecutionMutationDefault,
} from '@internal/contract/types';
import type { ForeignKeyDefaultsState } from '@internal/contract-authoring';
import type { ForeignKeyAuthoringInput } from '@internal/sql-contract/foreign-key-materialization';
import { type AuthoredStorageTypeInstance, applyFkDefaults } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import {
  type FieldNode,
  type ForeignKeyNode,
  isValueObjectMember,
  type ModelNode,
  storedAsListColumn,
  type ValueObjectFieldNode,
} from './contract-definition';
import { contractError } from './contract-errors';
import { buildDomainField } from './domain-fields';
import {
  assertKnownTargetModel,
  assertTargetTableMatches,
  type ModelLookups,
  modelNamespaceId,
} from './model-references';
import { lowerRelations } from './model-relations';
import type { ColumnDescription, ModelComponents, ModelStorage } from './storage-description';
import { type ColumnTypeQualifier, resolveColumnDescriptor } from './target-authoring-hooks';

export interface ModelDescriptionContext extends ModelLookups {
  readonly foreignKeyDefaults: ForeignKeyDefaultsState | undefined;
  readonly storageTypes: Record<string, AuthoredStorageTypeInstance>;
  readonly qualifyColumnType: ColumnTypeQualifier | undefined;
}

type ModelField = FieldNode | ValueObjectFieldNode;

/**
 * Converts one model into the storage it implies and its domain model. Other models are read only to resolve the references this one makes to them.
 */
export function describeModel(model: ModelNode, context: ModelDescriptionContext): ModelComponents {
  const namespaceId = modelNamespaceId(model, context.defaultNamespaceId);
  const { tableName } = model;

  const fieldToColumn: Record<string, string> = {};
  const domainFields: Record<string, ContractField> = {};
  const executionDefaults: ExecutionMutationDefault[] = [];
  for (const field of model.fields) {
    const executionDefault = executionDefaultOf(model.modelName, field);
    fieldToColumn[field.fieldName] = field.columnName;
    domainFields[field.fieldName] = buildDomainField(
      isValueObjectMember(field)
        ? field
        : {
            ...field,
            descriptor: resolveColumnDescriptor(
              field.descriptor,
              namespaceId,
              context.qualifyColumnType,
            ),
          },
      context.defaultNamespaceId,
      context.storageTypes,
    );
    if (executionDefault) {
      executionDefaults.push({
        ref: { namespace: namespaceId, entry: tableName, field: field.columnName },
        ...ifDefined('onCreate', executionDefault.onCreate),
        ...ifDefined('onUpdate', executionDefault.onUpdate),
      });
    }
  }

  const foreignKeys = (model.foreignKeys ?? []).map((fk) =>
    resolveForeignKey(fk, model, namespaceId, context),
  );
  const storage = describeModelStorage(model, namespaceId, foreignKeys);

  const storageFields: Record<string, { readonly column: string }> = {};
  for (const [fieldName, columnName] of Object.entries(fieldToColumn)) {
    storageFields[fieldName] = { column: columnName };
  }
  const columnToField = new Map(Object.entries(fieldToColumn).map(([field, col]) => [col, field]));

  return {
    storage,
    domain: {
      namespaceId,
      modelName: model.modelName,
      model: {
        storage: { table: tableName, namespaceId, fields: storageFields },
        fields: domainFields,
        relations: lowerRelations(model, columnToField, context),
      },
      executionDefaults,
    },
  };
}

/**
 * Single-table-inheritance variants share their base model's table: the variant adds its columns to that table and has no table of its own. That leaves an authored check nowhere to attach, so it is refused here as a backstop; the PSL surface refuses it earlier, at interpretation, with a diagnostic that names the base model.
 */
function describeModelStorage(
  model: ModelNode,
  namespaceId: string,
  foreignKeys: readonly ForeignKeyAuthoringInput[],
): ModelStorage {
  const { tableName } = model;
  const columns = model.fields.map((field) => describeColumn(model.modelName, field));
  if (model.sharesBaseTable) {
    if (model.checks && model.checks.length > 0) {
      throw contractError(
        'CONTRACT.CHECK_ON_STI_VARIANT',
        `Model "${model.modelName}" declares a check constraint but shares its base model's storage table (single-table inheritance) and has no table of its own to declare it on. Declare the check on the base model instead.`,
        { meta: { tableName, modelName: model.modelName } },
      );
    }
    return { kind: 'baseTable', namespaceId, tableName, columns };
  }
  return {
    kind: 'ownTable',
    table: {
      namespaceId,
      tableName,
      columns,
      control: model.control,
      primaryKey: model.id,
      uniques: model.uniques ?? [],
      indexes: model.indexes ?? [],
      checks: model.checks ?? [],
      foreignKeys,
    },
  };
}

function describeColumn(modelName: string, field: ModelField): ColumnDescription {
  const typedByValueObject = isValueObjectMember(field);
  return {
    columnName: field.columnName,
    descriptor: field.descriptor,
    nullable: field.nullable,
    many: storedAsListColumn({ list: field.many === true, typedByValueObject })
      ? { elementNullable: field.elementNullable === true }
      : false,
    default: field.default,
    noCheck: typedByValueObject ? undefined : field.noCheck,
    domainEnum: typedByValueObject ? undefined : field.enumTypeHandle,
    site: { modelName, fieldName: field.fieldName },
  };
}

/** The phases a generated default fills the field on, refused alongside a default or on an optional field. */
function executionDefaultOf(
  modelName: string,
  field: ModelField,
): ModelField['executionDefaults'] | undefined {
  const phases =
    field.executionDefaults?.onCreate || field.executionDefaults?.onUpdate
      ? field.executionDefaults
      : undefined;
  if (phases === undefined) return undefined;
  if (field.default !== undefined) {
    throw contractError(
      'CONTRACT.DEFAULT_INVALID',
      `Field "${modelName}.${field.fieldName}" cannot define both default and executionDefaults.`,
      {
        meta: {
          modelName,
          fieldName: field.fieldName,
          reason: 'default-and-executionDefaults',
        },
      },
    );
  }
  if (field.nullable) {
    throw contractError(
      'CONTRACT.DEFAULT_INVALID',
      `Field "${modelName}.${field.fieldName}" is filled on write by a generated default (a preset such as temporal.createdAt() or an id generator), so it cannot be optional; remove .optional().`,
      {
        meta: {
          modelName,
          fieldName: field.fieldName,
          reason: 'nullable-with-executionDefaults',
        },
      },
    );
  }
  return phases;
}

/** Resolves a foreign key's target. A cross-space key keeps its foreign space; a local key must name a model of this definition and that model's table. */
function resolveForeignKey(
  fk: ForeignKeyNode,
  model: ModelNode,
  namespaceId: string,
  context: ModelDescriptionContext,
): ForeignKeyAuthoringInput {
  const source = {
    namespaceId: asNamespaceId(namespaceId),
    tableName: model.tableName,
    columns: fk.columns,
  };
  const options = {
    ...applyFkDefaults(
      {
        ...ifDefined('constraint', fk.constraint),
        ...ifDefined('index', fk.index),
      },
      context.foreignKeyDefaults,
    ),
    ...ifDefined('name', fk.name),
    ...ifDefined('onDelete', fk.onDelete),
    ...ifDefined('onUpdate', fk.onUpdate),
  };
  if (fk.references.spaceId !== undefined) {
    return {
      source,
      target: {
        namespaceId: asNamespaceId(fk.references.namespaceId ?? context.defaultNamespaceId),
        tableName: fk.references.table,
        columns: fk.references.columns,
        spaceId: fk.references.spaceId,
      },
      ...options,
    };
  }

  const targetModel = assertKnownTargetModel(
    context.modelsByName,
    context.modelsByCoordinate,
    model.modelName,
    fk.references.model,
    fk.references.namespaceId,
    'Foreign key',
  );
  assertTargetTableMatches(model.modelName, targetModel, fk.references.table, 'Foreign key');
  return {
    source,
    target: {
      namespaceId: asNamespaceId(
        fk.references.namespaceId ?? modelNamespaceId(targetModel, context.defaultNamespaceId),
      ),
      tableName: fk.references.table,
      columns: fk.references.columns,
    },
    ...options,
  };
}
