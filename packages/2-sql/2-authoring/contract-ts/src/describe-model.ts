import type {
  ContractField,
  ContractModel,
  ExecutionMutationDefault,
} from '@internal/contract/types';
import type { ForeignKeyAuthoringInput } from '@internal/sql-contract/foreign-key-materialization';
import type { AuthoredStorageTypeInstance } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import {
  type FieldNode,
  isValueObjectMember,
  type ModelNode,
  type ValueObjectFieldNode,
} from './contract-definition';
import { contractError } from './contract-errors';
import { describeColumn } from './describe-column';
import { buildDomainField } from './domain-fields';
import { modelNamespaceId } from './model-references';
import { lowerRelations } from './model-relations';
import { type ForeignKeyResolutionContext, resolveForeignKey } from './resolve-foreign-key';
import type { ColumnDescription, ModelStorage } from './storage-description';
import { type ColumnTypeQualifier, resolveColumnDescriptor } from './target-authoring-hooks';

export interface ModelDescriptionContext extends ForeignKeyResolutionContext {
  readonly storageTypes: Record<string, AuthoredStorageTypeInstance>;
  readonly qualifyColumnType: ColumnTypeQualifier | undefined;
}

type ModelField = FieldNode | ValueObjectFieldNode;

/** The domain a model implies: the domain model, with its field-to-column bridge and relations, and the execution defaults of its fields. */
export interface ModelDomain {
  readonly namespaceId: string;
  readonly modelName: string;
  readonly model: ContractModel;
  readonly executionDefaults: readonly ExecutionMutationDefault[];
}

/** A model converted on its own: the storage it implies and its domain. */
export interface ModelDescription {
  readonly storage: ModelStorage;
  readonly domain: ModelDomain;
}

/**
 * Converts one model into the storage it implies and its domain model. Other models are read only to resolve the references this one makes to them.
 */
export function describeModel(
  model: ModelNode,
  context: ModelDescriptionContext,
): ModelDescription {
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
    resolveForeignKey(
      fk,
      {
        namespaceId,
        tableName: model.tableName,
        owner: { kind: 'model', modelName: model.modelName },
      },
      context,
    ),
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
 * Single-table-inheritance variants share their base model's table: the variant's columns must already be on that table, and it has no table of its own. That leaves an authored check nowhere to attach, so it is refused here as a backstop; the PSL surface refuses it earlier, at interpretation, with a diagnostic that names the base model.
 */
function describeModelStorage(
  model: ModelNode,
  namespaceId: string,
  foreignKeys: readonly ForeignKeyAuthoringInput[],
): ModelStorage {
  const { tableName } = model;
  const columns = model.fields.map((field) => describeFieldColumn(model.modelName, field));
  if (model.sharesBaseTable) {
    if (model.checks && model.checks.length > 0) {
      throw contractError(
        'CONTRACT.CHECK_ON_STI_VARIANT',
        `Model "${model.modelName}" declares a check constraint but shares its base model's storage table (single-table inheritance) and has no table of its own to declare it on. Declare the check on the base model instead.`,
        { meta: { tableName, modelName: model.modelName } },
      );
    }
    return { kind: 'baseTable', modelName: model.modelName, namespaceId, tableName, columns };
  }
  return {
    kind: 'ownTable',
    modelName: model.modelName,
    table: {
      namespaceId,
      tableName,
      columns,
      control: model.control,
      id: model.id,
      uniques: model.uniques ?? [],
      indexes: model.indexes ?? [],
      checks: model.checks ?? [],
      foreignKeys,
    },
  };
}

function describeFieldColumn(modelName: string, field: ModelField): ColumnDescription {
  const site = { kind: 'field', modelName, fieldName: field.fieldName } as const;
  if (isValueObjectMember(field)) {
    return describeColumn(
      {
        columnName: field.columnName,
        descriptor: field.descriptor,
        nullable: field.nullable,
        ...ifDefined('default', field.default),
      },
      site,
    );
  }
  return describeColumn(field, site);
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
