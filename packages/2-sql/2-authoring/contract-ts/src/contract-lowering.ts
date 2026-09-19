import { resolveToOneRelationNullable } from '@internal/contract-authoring';
import {
  type AuthoringEntityTypeNamespace,
  isAuthoringEntityTypeDescriptor,
} from '@internal/framework-components/authoring';
import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import type { ExtensionPackRef } from '@internal/framework-components/components';
import {
  providesEntityHandleLowering,
  type ResolvedEntityHandleRef,
  type ResolvedPackEntityHandle,
} from '@internal/sql-contract/entity-handle-lowering-hook';
import type { AuthoredIndexMethod } from '@internal/sql-contract/index-naming';
import type { StorageTypeInstance } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import type {
  AttachedEntities,
  CheckNode,
  ContractDefinition,
  FieldNode,
  ForeignKeyNode,
  IndexNode,
  ModelNode,
  PrimaryKeyNode,
  RelationNode,
  UniqueConstraintNode,
} from './contract-definition';
import {
  applyNaming,
  type ContractInput,
  type ContractModelBuilder,
  type FieldStateOf,
  type ForeignKeyConstraint,
  type IdConstraint,
  isCrossSpaceHandle,
  type ModelAttributesSpec,
  normalizeRelationFieldNames,
  type RelationBuilder,
  type RelationState,
  resolveRelationModelName,
  type ScalarFieldBuilder,
  type SqlStageSpec,
  type UniqueConstraint,
} from './contract-dsl';
import { contractError } from './contract-errors';
import {
  emitTypedCrossModelFallbackWarnings,
  emitTypedNamedTypeFallbackWarnings,
} from './contract-warnings';
import { isEnumTypeHandle } from './enum-type';
import { toOneNullabilityContradictionMessage } from './to-one-nullability-message';

type RuntimeModel = ContractModelBuilder<
  string | undefined,
  Record<string, ScalarFieldBuilder>,
  Record<string, RelationBuilder<RelationState>>,
  ModelAttributesSpec | undefined,
  SqlStageSpec | undefined
>;

type RuntimeModelSpec = {
  readonly modelName: string;
  readonly tableName: string;
  readonly namespace: string | undefined;
  readonly fieldBuilders: Record<string, ScalarFieldBuilder>;
  readonly fieldToColumn: Record<string, string>;
  readonly relations: Record<string, RelationBuilder<RelationState>>;
  readonly attributesSpec: ModelAttributesSpec | undefined;
  readonly sqlSpec: SqlStageSpec | undefined;
  readonly idConstraint: IdConstraint | undefined;
};

type RuntimeCollection = {
  readonly storageTypes: Record<string, StorageTypeInstance>;
  readonly models: Record<string, RuntimeModel>;
  readonly modelSpecs: ReadonlyMap<string, RuntimeModelSpec>;
};

function buildStorageTypeReverseLookup(
  storageTypes: Record<string, StorageTypeInstance>,
): ReadonlyMap<StorageTypeInstance, string> {
  const lookup = new Map<StorageTypeInstance, string>();
  for (const [key, instance] of Object.entries(storageTypes)) {
    lookup.set(instance, key);
  }
  return lookup;
}

function resolveFieldDescriptor(
  modelName: string,
  fieldName: string,
  fieldState: FieldStateOf<ScalarFieldBuilder>,
  storageTypes: Record<string, StorageTypeInstance>,
  storageTypeReverseLookup: ReadonlyMap<StorageTypeInstance, string>,
): ColumnTypeDescriptor {
  if ('descriptor' in fieldState && fieldState.descriptor) {
    return fieldState.descriptor;
  }

  if ('typeRef' in fieldState && fieldState.typeRef) {
    if (isEnumTypeHandle(fieldState.typeRef)) {
      return {
        codecId: fieldState.typeRef.codecId,
        nativeType: fieldState.typeRef.nativeType,
      };
    }

    const typeRef =
      typeof fieldState.typeRef === 'string'
        ? fieldState.typeRef
        : storageTypeReverseLookup.get(fieldState.typeRef as StorageTypeInstance);

    if (!typeRef) {
      throw contractError(
        'CONTRACT.TYPE_UNKNOWN',
        `Field "${modelName}.${fieldName}" references a storage type instance that is not present in definition.types`,
        { meta: { modelName, fieldName, reason: 'instance-not-in-definition-types' } },
      );
    }

    const referencedType = storageTypes[typeRef];
    if (!referencedType) {
      throw contractError(
        'CONTRACT.TYPE_UNKNOWN',
        `Field "${modelName}.${fieldName}" references unknown storage type "${typeRef}"`,
        { meta: { modelName, fieldName, typeRef } },
      );
    }

    return {
      codecId: referencedType.codecId,
      nativeType: referencedType.nativeType,
      typeRef,
    };
  }

  throw contractError(
    'CONTRACT.TYPE_UNKNOWN',
    `Field "${modelName}.${fieldName}" does not resolve to a storage descriptor`,
    { meta: { modelName, fieldName, reason: 'unresolved-storage-descriptor' } },
  );
}

function mapFieldNamesToColumnNames(
  modelName: string,
  fieldNames: readonly string[],
  fieldToColumn: Record<string, string>,
): readonly string[] {
  return fieldNames.map((fieldName) => {
    const columnName = fieldToColumn[fieldName];
    if (!columnName) {
      throw contractError(
        'CONTRACT.FIELD_UNKNOWN',
        `Unknown field "${modelName}.${fieldName}" in contract definition`,
        { meta: { modelName, fieldName } },
      );
    }
    return columnName;
  });
}

function assertRelationFieldArity(params: {
  readonly modelName: string;
  readonly relationName: string;
  readonly leftLabel: string;
  readonly leftFields: readonly string[];
  readonly rightLabel: string;
  readonly rightFields: readonly string[];
}): void {
  if (params.leftFields.length === params.rightFields.length) {
    return;
  }

  throw contractError(
    'CONTRACT.RELATION_INVALID',
    `Relation "${params.modelName}.${params.relationName}" maps ${params.leftFields.length} ${params.leftLabel} field(s) to ${params.rightFields.length} ${params.rightLabel} field(s).`,
    {
      meta: {
        modelName: params.modelName,
        relationName: params.relationName,
        reason: 'field-count-mismatch',
      },
    },
  );
}

function resolveInlineIdConstraint(
  spec: Pick<RuntimeModelSpec, 'modelName' | 'fieldBuilders'>,
): IdConstraint | undefined {
  const inlineIdFields: string[] = [];
  let idName: string | undefined;

  for (const [fieldName, fieldBuilder] of Object.entries(spec.fieldBuilders)) {
    const fieldState = fieldBuilder.build();
    if (!fieldState.id) {
      continue;
    }

    inlineIdFields.push(fieldName);
    if (fieldState.id.name) {
      idName = fieldState.id.name;
    }
  }

  if (inlineIdFields.length === 0) {
    return undefined;
  }

  if (inlineIdFields.length > 1) {
    throw contractError(
      'CONTRACT.IDENTITY_INVALID',
      `Model "${spec.modelName}" marks multiple fields with .id(). Use .attributes(...) for compound identities.`,
      {
        meta: { modelName: spec.modelName, reason: 'multiple-inline-ids', fields: inlineIdFields },
      },
    );
  }

  const [inlineIdField] = inlineIdFields;
  if (!inlineIdField) {
    return undefined;
  }

  return {
    kind: 'id',
    fields: [inlineIdField],
    ...(idName ? { name: idName } : {}),
  };
}

function collectInlineUniqueConstraints(spec: RuntimeModelSpec): readonly UniqueConstraint[] {
  const constraints: UniqueConstraint[] = [];

  for (const [fieldName, fieldBuilder] of Object.entries(spec.fieldBuilders)) {
    const fieldState = fieldBuilder.build();
    if (!fieldState.unique) {
      continue;
    }

    constraints.push({
      kind: 'unique',
      fields: [fieldName],
      ...(fieldState.unique.name ? { name: fieldState.unique.name } : {}),
    });
  }

  return constraints;
}

function resolveModelIdConstraint(
  spec: Pick<RuntimeModelSpec, 'modelName' | 'fieldBuilders' | 'attributesSpec'>,
): IdConstraint | undefined {
  const inlineId = resolveInlineIdConstraint(spec);
  const attributeId = spec.attributesSpec?.id;

  if (inlineId && attributeId) {
    throw contractError(
      'CONTRACT.IDENTITY_INVALID',
      `Model "${spec.modelName}" defines identity both inline and in .attributes(...). Pick one identity style.`,
      { meta: { modelName: spec.modelName, reason: 'inline-and-attributes' } },
    );
  }

  const resolvedId = attributeId ?? inlineId;
  if (resolvedId && resolvedId.fields.length === 0) {
    throw contractError(
      'CONTRACT.IDENTITY_INVALID',
      `Model "${spec.modelName}" defines an empty identity. Add at least one field.`,
      { meta: { modelName: spec.modelName, reason: 'empty-identity' } },
    );
  }

  return resolvedId;
}

function resolveModelUniqueConstraints(spec: RuntimeModelSpec): readonly UniqueConstraint[] {
  const attributeUniques = spec.attributesSpec?.uniques ?? [];
  for (const unique of attributeUniques) {
    if (unique.fields.length === 0) {
      throw contractError(
        'CONTRACT.CONSTRAINT_INVALID',
        `Model "${spec.modelName}" defines an empty unique constraint. Add at least one field.`,
        { meta: { modelName: spec.modelName } },
      );
    }
  }

  return [...collectInlineUniqueConstraints(spec), ...attributeUniques];
}

function resolveRelationForeignKeys(
  spec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
): readonly ForeignKeyConstraint[] {
  const foreignKeys: ForeignKeyConstraint[] = [];

  for (const [relationName, relationBuilder] of Object.entries(spec.relations)) {
    const relation = relationBuilder.build();
    if (relation.kind !== 'belongsTo' || !relation.sql?.fk) {
      continue;
    }

    const targetModelName = resolveRelationModelName(relation.toModel);

    // F-relfk: cross-space relations carry a spaceId; skip the local spec lookup
    // and include cross-space coordinates so resolveForeignKeyNodes routes the FK
    // through the cross-space path.
    if (relation.spaceId !== undefined) {
      const fields = normalizeRelationFieldNames(relation.from);
      const targetFields = normalizeRelationFieldNames(relation.to);
      assertRelationFieldArity({
        modelName: spec.modelName,
        relationName,
        leftLabel: 'source',
        leftFields: fields,
        rightLabel: 'target',
        rightFields: targetFields,
      });

      foreignKeys.push({
        kind: 'fk',
        fields,
        targetModel: targetModelName,
        targetFields,
        targetSpaceId: relation.spaceId,
        ...(relation.namespaceId !== undefined ? { targetNamespaceId: relation.namespaceId } : {}),
        ...(relation.tableName !== undefined ? { targetTableName: relation.tableName } : {}),
        ...(relation.sql.fk.name ? { name: relation.sql.fk.name } : {}),
        ...(relation.sql.fk.onDelete ? { onDelete: relation.sql.fk.onDelete } : {}),
        ...(relation.sql.fk.onUpdate ? { onUpdate: relation.sql.fk.onUpdate } : {}),
        ...(relation.sql.fk.constraint !== undefined
          ? { constraint: relation.sql.fk.constraint }
          : {}),
        ...(relation.sql.fk.index !== undefined ? { index: relation.sql.fk.index } : {}),
      });
      continue;
    }

    if (!allSpecs.has(targetModelName)) {
      throw contractError(
        'CONTRACT.MODEL_UNKNOWN',
        `Relation "${spec.modelName}.${relationName}" references unknown model "${targetModelName}"`,
        { meta: { sourceModel: spec.modelName, relationName, targetModel: targetModelName } },
      );
    }

    const fields = normalizeRelationFieldNames(relation.from);
    const targetFields = normalizeRelationFieldNames(relation.to);
    assertRelationFieldArity({
      modelName: spec.modelName,
      relationName,
      leftLabel: 'source',
      leftFields: fields,
      rightLabel: 'target',
      rightFields: targetFields,
    });

    foreignKeys.push({
      kind: 'fk',
      fields,
      targetModel: targetModelName,
      targetFields,
      ...(relation.sql.fk.name ? { name: relation.sql.fk.name } : {}),
      ...(relation.sql.fk.onDelete ? { onDelete: relation.sql.fk.onDelete } : {}),
      ...(relation.sql.fk.onUpdate ? { onUpdate: relation.sql.fk.onUpdate } : {}),
      ...(relation.sql.fk.constraint !== undefined
        ? { constraint: relation.sql.fk.constraint }
        : {}),
      ...(relation.sql.fk.index !== undefined ? { index: relation.sql.fk.index } : {}),
    });
  }

  return foreignKeys;
}

function resolveRelationAnchorFields(spec: RuntimeModelSpec): readonly string[] {
  const idFields = spec.idConstraint?.fields;
  if (idFields && idFields.length > 0) {
    return idFields;
  }

  if ('id' in spec.fieldToColumn) {
    return ['id'];
  }

  throw contractError(
    'CONTRACT.IDENTITY_INVALID',
    `Model "${spec.modelName}" needs an explicit id or an "id" field to anchor non-owning relations`,
    { meta: { modelName: spec.modelName, reason: 'missing-anchor-id' } },
  );
}

function belongsToNullable(
  relationName: string,
  declaredNullable: boolean | undefined,
  spec: RuntimeModelSpec,
  fieldNames: readonly string[],
): boolean {
  const { nullable, contradiction } = resolveToOneRelationNullable({
    declaredNullable,
    localFieldNullability: fieldNames.map(
      (fieldName) => spec.fieldBuilders[fieldName]?.build().nullable === true,
    ),
    ownsReference: true,
  });
  if (contradiction !== undefined) {
    throw contractError(
      'CONTRACT.RELATION_INVALID',
      toOneNullabilityContradictionMessage(
        `Relation "${spec.modelName}.${relationName}"`,
        contradiction,
      ),
      {
        meta: {
          modelName: spec.modelName,
          relationName,
          reason: 'to-one-nullability-mismatch',
        },
      },
    );
  }
  return nullable;
}

function lowerBelongsToRelation(
  relationName: string,
  relation: Extract<RelationState, { kind: 'belongsTo' }>,
  currentSpec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
  extensions?: Record<string, ExtensionPackRef<'sql', string>>,
): RelationNode {
  const targetModelName = resolveRelationModelName(relation.toModel);
  const fromFields = normalizeRelationFieldNames(relation.from);
  const toFields = normalizeRelationFieldNames(relation.to);

  assertRelationFieldArity({
    modelName: currentSpec.modelName,
    relationName,
    leftLabel: 'source',
    leftFields: fromFields,
    rightLabel: 'target',
    rightFields: toFields,
  });

  // Cross-space path: the target lives in a different contract space.
  // Resolve from the brand carried on the BelongsToRelation instead of
  // requiring a local model spec — matching how the FK lowering works.
  if (relation.spaceId !== undefined) {
    assertKnownExtensionPack(
      extensions,
      relation.spaceId,
      `Relation "${currentSpec.modelName}.${relationName}"`,
    );
    const targetTable = relation.tableName ?? targetModelName.toLowerCase();
    const parentColumns = mapFieldNamesToColumnNames(
      currentSpec.modelName,
      fromFields,
      currentSpec.fieldToColumn,
    );
    // For cross-space relations, the `to` field names map directly to column
    // names because we have no fieldToColumn map for the remote model.
    // (The brand carries the table name; field→column resolution on the remote
    // side is deferred to the planner which has access to the remote contract.)
    return {
      fieldName: relationName,
      toModel: targetModelName,
      toTable: targetTable,
      cardinality: 'N:1',
      nullable: belongsToNullable(relationName, relation.optional, currentSpec, fromFields),
      spaceId: relation.spaceId,
      ...(relation.namespaceId !== undefined ? { namespaceId: relation.namespaceId } : {}),
      on: {
        parentTable: currentSpec.tableName,
        parentColumns,
        childTable: targetTable,
        childColumns: toFields,
      },
    };
  }

  const targetSpec = allSpecs.get(targetModelName);
  if (!targetSpec) {
    throw contractError(
      'CONTRACT.MODEL_UNKNOWN',
      `Relation "${currentSpec.modelName}.${relationName}" references unknown model "${targetModelName}"`,
      { meta: { sourceModel: currentSpec.modelName, relationName, targetModel: targetModelName } },
    );
  }

  return {
    fieldName: relationName,
    toModel: targetModelName,
    toTable: targetSpec.tableName,
    cardinality: 'N:1',
    nullable: belongsToNullable(relationName, relation.optional, currentSpec, fromFields),
    on: {
      parentTable: currentSpec.tableName,
      parentColumns: mapFieldNamesToColumnNames(
        currentSpec.modelName,
        fromFields,
        currentSpec.fieldToColumn,
      ),
      childTable: targetSpec.tableName,
      childColumns: mapFieldNamesToColumnNames(
        targetSpec.modelName,
        toFields,
        targetSpec.fieldToColumn,
      ),
    },
  };
}

function lowerHasOwnershipRelation(
  relationName: string,
  relation: Extract<RelationState, { kind: 'hasMany' | 'hasOne' }>,
  currentSpec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
): RelationNode {
  const targetModelName = resolveRelationModelName(relation.toModel);
  const targetSpec = allSpecs.get(targetModelName);
  if (!targetSpec) {
    throw contractError(
      'CONTRACT.MODEL_UNKNOWN',
      `Relation "${currentSpec.modelName}.${relationName}" references unknown model "${targetModelName}"`,
      { meta: { sourceModel: currentSpec.modelName, relationName, targetModel: targetModelName } },
    );
  }

  const parentFields = resolveRelationAnchorFields(currentSpec);
  const childFields = normalizeRelationFieldNames(relation.by);
  assertRelationFieldArity({
    modelName: currentSpec.modelName,
    relationName,
    leftLabel: 'anchor',
    leftFields: parentFields,
    rightLabel: 'child',
    rightFields: childFields,
  });

  return {
    fieldName: relationName,
    toModel: targetModelName,
    toTable: targetSpec.tableName,
    ...(relation.kind === 'hasMany'
      ? { cardinality: '1:N' as const }
      : { cardinality: '1:1' as const, nullable: true }),
    on: {
      parentTable: currentSpec.tableName,
      parentColumns: mapFieldNamesToColumnNames(
        currentSpec.modelName,
        parentFields,
        currentSpec.fieldToColumn,
      ),
      childTable: targetSpec.tableName,
      childColumns: mapFieldNamesToColumnNames(
        targetSpec.modelName,
        childFields,
        targetSpec.fieldToColumn,
      ),
    },
  };
}

function lowerManyToManyRelation(
  relationName: string,
  relation: Extract<RelationState, { kind: 'manyToMany' }>,
  currentSpec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
): RelationNode {
  const targetModelName = resolveRelationModelName(relation.toModel);
  const targetSpec = allSpecs.get(targetModelName);
  if (!targetSpec) {
    throw contractError(
      'CONTRACT.MODEL_UNKNOWN',
      `Relation "${currentSpec.modelName}.${relationName}" references unknown model "${targetModelName}"`,
      { meta: { sourceModel: currentSpec.modelName, relationName, targetModel: targetModelName } },
    );
  }

  const throughModelName = resolveRelationModelName(relation.through);
  const throughSpec = allSpecs.get(throughModelName);
  if (!throughSpec) {
    throw contractError(
      'CONTRACT.MODEL_UNKNOWN',
      `Relation "${currentSpec.modelName}.${relationName}" references unknown through model "${throughModelName}"`,
      { meta: { sourceModel: currentSpec.modelName, relationName, targetModel: throughModelName } },
    );
  }

  const currentAnchorFields = resolveRelationAnchorFields(currentSpec);
  const targetAnchorFields = resolveRelationAnchorFields(targetSpec);
  const throughFromFields = normalizeRelationFieldNames(relation.from);
  const throughToFields = normalizeRelationFieldNames(relation.to);
  if (
    currentAnchorFields.length !== throughFromFields.length ||
    targetAnchorFields.length !== throughToFields.length
  ) {
    throw contractError(
      'CONTRACT.RELATION_INVALID',
      `Relation "${currentSpec.modelName}.${relationName}" has mismatched many-to-many field counts.`,
      {
        meta: {
          modelName: currentSpec.modelName,
          relationName,
          reason: 'many-to-many-field-count-mismatch',
        },
      },
    );
  }

  return {
    fieldName: relationName,
    toModel: targetModelName,
    toTable: targetSpec.tableName,
    cardinality: 'N:M',
    through: {
      table: throughSpec.tableName,
      ...ifDefined('namespaceId', throughSpec.namespace),
      parentColumns: mapFieldNamesToColumnNames(
        throughSpec.modelName,
        throughFromFields,
        throughSpec.fieldToColumn,
      ),
      childColumns: mapFieldNamesToColumnNames(
        throughSpec.modelName,
        throughToFields,
        throughSpec.fieldToColumn,
      ),
    },
    on: {
      parentTable: currentSpec.tableName,
      parentColumns: mapFieldNamesToColumnNames(
        currentSpec.modelName,
        currentAnchorFields,
        currentSpec.fieldToColumn,
      ),
      childTable: throughSpec.tableName,
      childColumns: mapFieldNamesToColumnNames(
        throughSpec.modelName,
        throughFromFields,
        throughSpec.fieldToColumn,
      ),
    },
  };
}

function resolveRelationNode(
  relationName: string,
  relation: RelationState,
  currentSpec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
  extensions?: Record<string, ExtensionPackRef<'sql', string>>,
): RelationNode {
  if (relation.kind === 'belongsTo') {
    return lowerBelongsToRelation(relationName, relation, currentSpec, allSpecs, extensions);
  }

  if (relation.kind === 'hasMany' || relation.kind === 'hasOne') {
    return lowerHasOwnershipRelation(relationName, relation, currentSpec, allSpecs);
  }

  return lowerManyToManyRelation(relationName, relation, currentSpec, allSpecs);
}

function lowerLocalForeignKeyNode(
  spec: RuntimeModelSpec,
  targetSpec: RuntimeModelSpec,
  foreignKey: {
    readonly fields: readonly string[];
    readonly targetFields: readonly string[];
    readonly name?: string | undefined;
    readonly onDelete?: ForeignKeyConstraint['onDelete'] | undefined;
    readonly onUpdate?: ForeignKeyConstraint['onUpdate'] | undefined;
    readonly constraint?: boolean | undefined;
    readonly index?: boolean | undefined;
  },
): ForeignKeyNode {
  return {
    columns: mapFieldNamesToColumnNames(spec.modelName, foreignKey.fields, spec.fieldToColumn),
    references: {
      model: targetSpec.modelName,
      table: targetSpec.tableName,
      columns: mapFieldNamesToColumnNames(
        targetSpec.modelName,
        foreignKey.targetFields,
        targetSpec.fieldToColumn,
      ),
    },
    ...(foreignKey.name ? { name: foreignKey.name } : {}),
    ...(foreignKey.onDelete ? { onDelete: foreignKey.onDelete } : {}),
    ...(foreignKey.onUpdate ? { onUpdate: foreignKey.onUpdate } : {}),
    ...(foreignKey.constraint !== undefined ? { constraint: foreignKey.constraint } : {}),
    ...(foreignKey.index !== undefined ? { index: foreignKey.index } : {}),
  };
}

function lowerCrossSpaceForeignKeyNode(
  spec: RuntimeModelSpec,
  foreignKey: {
    readonly fields: readonly string[];
    readonly targetFields: readonly string[];
    readonly targetModel: string;
    readonly targetSpaceId: string;
    readonly targetNamespaceId?: string;
    readonly targetTableName?: string;
    readonly name?: string | undefined;
    readonly onDelete?: ForeignKeyConstraint['onDelete'] | undefined;
    readonly onUpdate?: ForeignKeyConstraint['onUpdate'] | undefined;
    readonly constraint?: boolean | undefined;
    readonly index?: boolean | undefined;
  },
): ForeignKeyNode {
  return {
    columns: mapFieldNamesToColumnNames(spec.modelName, foreignKey.fields, spec.fieldToColumn),
    references: {
      model: foreignKey.targetModel,
      table: foreignKey.targetTableName ?? foreignKey.targetModel.toLowerCase(),
      columns: foreignKey.targetFields,
      ...(foreignKey.targetNamespaceId !== undefined
        ? { namespaceId: foreignKey.targetNamespaceId }
        : {}),
      spaceId: foreignKey.targetSpaceId,
    },
    ...(foreignKey.name ? { name: foreignKey.name } : {}),
    ...(foreignKey.onDelete ? { onDelete: foreignKey.onDelete } : {}),
    ...(foreignKey.onUpdate ? { onUpdate: foreignKey.onUpdate } : {}),
    ...(foreignKey.constraint !== undefined ? { constraint: foreignKey.constraint } : {}),
    ...(foreignKey.index !== undefined ? { index: foreignKey.index } : {}),
  };
}

function assertKnownExtensionPack(
  extensions: Record<string, ExtensionPackRef<'sql', string>> | undefined,
  spaceId: string,
  context: string,
): void {
  if (extensions !== undefined && Object.hasOwn(extensions, spaceId)) {
    return;
  }
  throw contractError(
    'CONTRACT.PACK_MISSING',
    `${context} references contract space "${spaceId}" but "${spaceId}" is not declared in extensions. Add the pack to extensions.`,
    { meta: { spaceId, context } },
  );
}

function resolveForeignKeyNodes(
  spec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
  extensions?: Record<string, ExtensionPackRef<'sql', string>>,
): readonly ForeignKeyNode[] {
  const relationForeignKeys = resolveRelationForeignKeys(spec, allSpecs).map((foreignKey) => {
    // F-relfk: relation-derived FKs for cross-space targets carry targetSpaceId;
    // route them through the cross-space path, just like explicit sql() FKs.
    if (foreignKey.targetSpaceId !== undefined) {
      assertKnownExtensionPack(
        extensions,
        foreignKey.targetSpaceId,
        `Relation-derived foreign key on "${spec.modelName}"`,
      );
      return lowerCrossSpaceForeignKeyNode(spec, {
        ...foreignKey,
        targetSpaceId: foreignKey.targetSpaceId,
      });
    }

    const targetSpec = allSpecs.get(foreignKey.targetModel);
    if (!targetSpec) {
      throw contractError(
        'CONTRACT.MODEL_UNKNOWN',
        `Foreign key on "${spec.modelName}" references unknown model "${foreignKey.targetModel}"`,
        { meta: { sourceModel: spec.modelName, targetModel: foreignKey.targetModel } },
      );
    }

    return lowerLocalForeignKeyNode(spec, targetSpec, foreignKey);
  });

  const sqlForeignKeys = (spec.sqlSpec?.foreignKeys ?? []).map((foreignKey) => {
    if (foreignKey.targetSpaceId !== undefined) {
      assertKnownExtensionPack(
        extensions,
        foreignKey.targetSpaceId,
        `Foreign key on "${spec.modelName}"`,
      );
      return lowerCrossSpaceForeignKeyNode(spec, {
        ...foreignKey,
        targetSpaceId: foreignKey.targetSpaceId,
      });
    }

    const targetSpec = allSpecs.get(foreignKey.targetModel);
    if (!targetSpec) {
      throw contractError(
        'CONTRACT.MODEL_UNKNOWN',
        `Foreign key on "${spec.modelName}" references unknown model "${foreignKey.targetModel}"`,
        { meta: { sourceModel: spec.modelName, targetModel: foreignKey.targetModel } },
      );
    }

    return lowerLocalForeignKeyNode(spec, targetSpec, foreignKey);
  });

  return [...relationForeignKeys, ...sqlForeignKeys];
}

function resolveModelNode(
  spec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
  storageTypes: Record<string, StorageTypeInstance>,
  storageTypeReverseLookup: ReadonlyMap<StorageTypeInstance, string>,
  extensions?: Record<string, ExtensionPackRef<'sql', string>>,
): ModelNode {
  const fields: FieldNode[] = [];

  for (const [fieldName, fieldBuilder] of Object.entries(spec.fieldBuilders)) {
    const fieldState = fieldBuilder.build();
    const descriptor = resolveFieldDescriptor(
      spec.modelName,
      fieldName,
      fieldState,
      storageTypes,
      storageTypeReverseLookup,
    );
    const columnName = spec.fieldToColumn[fieldName];
    if (!columnName) {
      throw new InternalError(`Column name resolution failed for "${spec.modelName}.${fieldName}"`);
    }

    const enumHandle =
      'typeRef' in fieldState && isEnumTypeHandle(fieldState.typeRef)
        ? fieldState.typeRef
        : undefined;

    fields.push({
      fieldName,
      columnName,
      descriptor,
      nullable: fieldState.nullable,
      ...(fieldState.many === true ? { many: true } : {}),
      ...(fieldState.noCheck !== undefined ? { noCheck: fieldState.noCheck } : {}),
      ...(fieldState.default ? { default: fieldState.default } : {}),
      ...(fieldState.executionDefaults ? { executionDefaults: fieldState.executionDefaults } : {}),
      ...(enumHandle !== undefined ? { enumTypeHandle: enumHandle } : {}),
    });
  }

  const { idConstraint } = spec;
  const uniques = resolveModelUniqueConstraints(spec).map((unique) => ({
    columns: mapFieldNamesToColumnNames(spec.modelName, unique.fields, spec.fieldToColumn),
    ...(unique.name ? { name: unique.name } : {}),
  })) satisfies readonly UniqueConstraintNode[];
  const indexes = (spec.sqlSpec?.indexes ?? []).map((index): IndexNode => {
    // Carried verbatim rather than narrowed: the constraint type already
    // forbids options without a type, but a caller that suppresses the
    // compile error still reaches here, and dropping the orphaned options
    // would hide it from lowerAuthoredIndex's runtime backstop.
    const method = blindCast<
      AuthoredIndexMethod,
      'the constraint type carries the union; reading the two fields separately loses the correlation'
    >({ type: index.type, options: index.options });
    const carried = {
      where: index.where,
      unique: index.unique,
      name: index.name,
      map: index.map,
      ...method,
    };
    return index.expression !== undefined
      ? { ...carried, expression: index.expression }
      : {
          ...carried,
          columns: mapFieldNamesToColumnNames(
            spec.modelName,
            index.fields ?? [],
            spec.fieldToColumn,
          ),
        };
  });
  const checks = (spec.sqlSpec?.checks ?? []).map(
    (authoredCheck): CheckNode => ({
      expression: authoredCheck.expression,
      name: authoredCheck.name,
      map: authoredCheck.map,
    }),
  );
  const foreignKeys = resolveForeignKeyNodes(spec, allSpecs, extensions);
  const relations = Object.entries(spec.relations).map(([relationName, relationBuilder]) =>
    resolveRelationNode(relationName, relationBuilder.build(), spec, allSpecs, extensions),
  );

  return {
    modelName: spec.modelName,
    tableName: spec.tableName,
    ...(spec.namespace !== undefined ? { namespaceId: spec.namespace } : {}),
    fields,
    ...(idConstraint
      ? {
          id: {
            columns: mapFieldNamesToColumnNames(
              spec.modelName,
              idConstraint.fields,
              spec.fieldToColumn,
            ),
            ...(idConstraint.name ? { name: idConstraint.name } : {}),
          } satisfies PrimaryKeyNode,
        }
      : {}),
    ...(uniques.length > 0 ? { uniques } : {}),
    ...(indexes.length > 0 ? { indexes } : {}),
    ...(checks.length > 0 ? { checks } : {}),
    ...(foreignKeys.length > 0 ? { foreignKeys } : {}),
    ...(relations.length > 0 ? { relations } : {}),
    ...ifDefined('control', spec.sqlSpec?.control),
  };
}

function collectRuntimeModelSpecs(definition: ContractInput): RuntimeCollection {
  const storageTypes = { ...(definition.types ?? {}) } as Record<string, StorageTypeInstance>;
  const models = { ...(definition.models ?? {}) } as Record<string, RuntimeModel>;

  emitTypedNamedTypeFallbackWarnings(models, storageTypes);

  const modelSpecs = new Map<string, RuntimeModelSpec>();
  const tableOwners = new Map<string, string>();

  for (const [modelName, modelDefinition] of Object.entries(models)) {
    const tokenModelName = modelDefinition.stageOne.modelName;
    if (tokenModelName && tokenModelName !== modelName) {
      throw contractError(
        'CONTRACT.MODEL_TOKEN_INVALID',
        `Model token "${tokenModelName}" must be assigned to models.${tokenModelName}. Received models.${modelName}.`,
        { meta: { tokenModelName, assignedKey: modelName } },
      );
    }

    const attributesSpec = modelDefinition.buildAttributesSpec();
    const sqlSpec = modelDefinition.buildSqlSpec();
    const tableName = sqlSpec?.table ?? applyNaming(modelName, definition.naming?.tables);
    // Table names are unique per namespace, not globally. Key the collision
    // check by a tuple so namespace/table boundaries remain unambiguous.
    const namespaceId = modelDefinition.stageOne.namespace ?? definition.target.defaultNamespaceId;
    const tableKey = JSON.stringify([namespaceId, tableName]);
    const existingModel = tableOwners.get(tableKey);
    if (existingModel) {
      throw contractError(
        'CONTRACT.NAME_DUPLICATE',
        `Models "${existingModel}" and "${modelName}" both map to table "${tableName}".`,
        { meta: { kind: 'table', name: tableName, first: existingModel, second: modelName } },
      );
    }
    tableOwners.set(tableKey, modelName);

    const fieldToColumn: Record<string, string> = {};
    const columnOwners = new Map<string, string>();

    for (const [fieldName, fieldBuilder] of Object.entries(modelDefinition.stageOne.fields)) {
      const fieldState = fieldBuilder.build();
      const columnName =
        fieldState.columnName ?? applyNaming(fieldName, definition.naming?.columns);
      const existingField = columnOwners.get(columnName);
      if (existingField) {
        throw contractError(
          'CONTRACT.NAME_DUPLICATE',
          `Model "${modelName}" maps both "${existingField}" and "${fieldName}" to column "${columnName}".`,
          { meta: { kind: 'column', name: columnName, first: existingField, second: fieldName } },
        );
      }
      columnOwners.set(columnName, fieldName);
      fieldToColumn[fieldName] = columnName;
    }

    const fieldBuilders = modelDefinition.stageOne.fields;
    const idConstraint = resolveModelIdConstraint({ modelName, fieldBuilders, attributesSpec });
    modelSpecs.set(modelName, {
      modelName,
      tableName,
      namespace: modelDefinition.stageOne.namespace,
      fieldBuilders,
      fieldToColumn,
      relations: modelDefinition.stageOne.relations,
      attributesSpec,
      sqlSpec,
      idConstraint,
    });
  }

  return {
    storageTypes,
    models,
    modelSpecs,
  };
}

function lowerModels(
  collection: RuntimeCollection,
  extensions?: Record<string, ExtensionPackRef<'sql', string>>,
): readonly ModelNode[] {
  emitTypedCrossModelFallbackWarnings(collection);

  const storageTypeReverseLookup = buildStorageTypeReverseLookup(collection.storageTypes);
  return Array.from(collection.modelSpecs.values()).map((spec) =>
    resolveModelNode(
      spec,
      collection.modelSpecs,
      collection.storageTypes,
      storageTypeReverseLookup,
      extensions,
    ),
  );
}

/**
 * Kind-agnostic walk over the author-declared `entities` handle list:
 *
 * 1. Index the bound packs' `entityTypes` contributions by discriminator so
 *    each handle's `entityKind` maps to the pack that registered it; a
 *    handle whose kind no composed pack registers is an error naming the
 *    kind.
 * 2. Resolve each handle's declared model refs (`handle.refs`, actual
 *    model-handle objects) to storage table coordinates — identity against
 *    the contract's `models` record first, then the handle's declared model
 *    name against the build's model specs; never by re-deriving a table
 *    name. A cross-space (extensionModel) handle resolves to its own
 *    coordinate annotated with `spaceId`.
 * 3. Call each owning pack's batch lowering hook once with all of its
 *    claimed handles, and fold the returned rows into the namespace-scoped
 *    attachments (namespace → kind → key), rejecting two different entities
 *    in one slot. The result becomes `ContractDefinition.attachedEntities`.
 *
 * No entity kind is named anywhere in this walk.
 */
function lowerPackEntityHandles(
  definition: ContractInput,
  modelSpecs: ReadonlyMap<string, RuntimeModelSpec>,
): AttachedEntities | undefined {
  const entities = definition.entities;
  if (entities === undefined || entities.length === 0) return undefined;

  const components: readonly {
    readonly authoring?: import('@internal/framework-components/authoring').AuthoringContributions;
  }[] = [
    definition.target,
    ...Object.values<ExtensionPackRef<'sql', string>>(definition.extensions ?? {}),
  ];
  const owningComponent = new Map<string, (typeof components)[number]>();
  const walkEntityTypes = (
    namespace: AuthoringEntityTypeNamespace,
    component: (typeof components)[number],
  ): void => {
    for (const value of Object.values(namespace)) {
      if (isAuthoringEntityTypeDescriptor(value)) {
        owningComponent.set(value.discriminator, component);
      } else {
        walkEntityTypes(value, component);
      }
    }
  };
  for (const component of components) {
    const entityTypes = component.authoring?.entityTypes;
    if (entityTypes !== undefined) walkEntityTypes(entityTypes, component);
  }

  const defaultNamespaceId = definition.target.defaultNamespaceId;
  const modelNamesByIdentity = new Map<unknown, string>();
  for (const [modelName, modelBuilder] of Object.entries(definition.models ?? {})) {
    modelNamesByIdentity.set(modelBuilder, modelName);
  }
  const coordinateOf = (modelName: string): ResolvedEntityHandleRef | undefined => {
    const spec = modelSpecs.get(modelName);
    if (spec === undefined) return undefined;
    return {
      kind: 'resolved',
      namespaceId: spec.namespace ?? defaultNamespaceId,
      tableName: spec.tableName,
      modelName,
    };
  };
  const declaredModelName = (value: unknown): string | undefined => {
    if (typeof value !== 'object' || value === null || !('stageOne' in value)) return undefined;
    const stageOne = value.stageOne;
    if (typeof stageOne !== 'object' || stageOne === null || !('modelName' in stageOne)) {
      return undefined;
    }
    return typeof stageOne.modelName === 'string' ? stageOne.modelName : undefined;
  };
  const resolveRef = (value: unknown): ResolvedEntityHandleRef => {
    const modelName = declaredModelName(value);
    if (isCrossSpaceHandle(value)) {
      const tableName = value.tableName;
      const namespaceId = value.stageOne.namespace;
      if (tableName !== undefined && namespaceId !== undefined) {
        return {
          kind: 'cross-space',
          spaceId: value.spaceId,
          namespaceId,
          tableName,
          ...ifDefined('modelName', modelName),
        };
      }
      return { kind: 'unresolved', ...ifDefined('modelName', modelName) };
    }
    const identityName = modelNamesByIdentity.get(value);
    const resolved =
      (identityName !== undefined ? coordinateOf(identityName) : undefined) ??
      (modelName !== undefined ? coordinateOf(modelName) : undefined);
    return resolved ?? { kind: 'unresolved', ...ifDefined('modelName', modelName) };
  };

  const claimed = new Map<(typeof components)[number], ResolvedPackEntityHandle[]>();
  for (const handle of entities) {
    const component = owningComponent.get(handle.entityKind);
    if (component === undefined) {
      throw contractError(
        'CONTRACT.ENTITY_KIND_UNKNOWN',
        `defineContract: entities contains a handle with entityKind "${handle.entityKind}", which no composed pack registers. Compose a pack whose entityTypes contribution claims "${handle.entityKind}", or remove the handle.`,
        { meta: { entityKind: handle.entityKind } },
      );
    }
    const refs: Record<string, ResolvedEntityHandleRef> = {};
    for (const [refName, refValue] of Object.entries(handle.refs ?? {})) {
      refs[refName] = resolveRef(refValue);
    }
    const forComponent = claimed.get(component) ?? [];
    forComponent.push({ handle, refs });
    claimed.set(component, forComponent);
  }

  const pack: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const [component, handles] of claimed) {
    const authoring = component.authoring;
    if (!providesEntityHandleLowering(authoring)) {
      const kinds = [...new Set(handles.map((entry) => entry.handle.entityKind))].sort();
      throw contractError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `defineContract: entityKind(s) ${kinds.map((kind) => `"${kind}"`).join(', ')} are registered by a pack that does not implement entity-handle lowering (no lowerEntityHandles on its authoring contributions).`,
        { meta: { entityKinds: kinds, reason: 'missing-lowerEntityHandles' } },
      );
    }
    for (const row of authoring.lowerEntityHandles({ handles, defaultNamespaceId })) {
      const forNamespace = pack[row.namespaceId] ?? {};
      pack[row.namespaceId] = forNamespace;
      const forKind = forNamespace[row.entityKind] ?? {};
      forNamespace[row.entityKind] = forKind;
      const existing = forKind[row.key];
      if (existing !== undefined && existing !== row.entity) {
        throw contractError(
          'CONTRACT.NAME_DUPLICATE',
          `defineContract: two different "${row.entityKind}" entities named "${row.key}" in namespace "${row.namespaceId}" — pack-entity names must be unique per namespace.`,
          { meta: { kind: row.entityKind, name: row.key, namespaceId: row.namespaceId } },
        );
      }
      forKind[row.key] = row.entity;
    }
  }
  return pack;
}

export function buildContractDefinition(definition: ContractInput): ContractDefinition {
  const collection = collectRuntimeModelSpecs(definition);
  const models = lowerModels(collection, definition.extensions);
  const attachedEntities = lowerPackEntityHandles(definition, collection.modelSpecs);

  return {
    target: definition.target,
    ...ifDefined('defaultControlPolicy', definition.defaultControlPolicy),
    ...(definition.extensions ? { extensions: definition.extensions } : {}),
    ...(definition.storageHash ? { storageHash: definition.storageHash } : {}),
    ...(definition.foreignKeyDefaults ? { foreignKeyDefaults: definition.foreignKeyDefaults } : {}),
    ...(Object.keys(collection.storageTypes).length > 0
      ? { storageTypes: collection.storageTypes }
      : {}),
    ...(definition.namespaces ? { namespaces: definition.namespaces } : {}),
    warnings: undefined,
    createNamespace: definition.createNamespace,
    ...(definition.enums && Object.keys(definition.enums).length > 0
      ? { enums: definition.enums }
      : {}),
    ...(attachedEntities && Object.keys(attachedEntities).length > 0 ? { attachedEntities } : {}),
    models,
  };
}
