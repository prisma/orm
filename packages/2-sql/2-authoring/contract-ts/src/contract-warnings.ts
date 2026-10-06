import type { AuthoredStorageTypeInstance } from '@internal/sql-contract/types';
import {
  type ContractModelBuilder,
  type ModelAttributesSpec,
  normalizeRelationFieldNames,
  type RelationBuilder,
  type RelationState,
  type ScalarFieldBuilder,
  type SqlStageSpec,
} from './contract-dsl';

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
  readonly relations: Record<string, RelationBuilder<RelationState>>;
  readonly sqlSpec: SqlStageSpec | undefined;
};

type RuntimeCollection = {
  readonly storageTypes: Record<string, AuthoredStorageTypeInstance>;
  readonly models: Record<string, RuntimeModel>;
  readonly modelSpecs: ReadonlyMap<string, RuntimeModelSpec>;
};

function hasNamedModelToken(models: Record<string, RuntimeModel>, modelName: string): boolean {
  return models[modelName]?.stageOne.modelName === modelName;
}

function formatFieldSelection(fieldNames: readonly string[]): string {
  if (fieldNames.length === 1) {
    return `'${fieldNames[0]}'`;
  }

  return `[${fieldNames.map((fieldName) => `'${fieldName}'`).join(', ')}]`;
}

function formatTokenFieldSelection(modelName: string, fieldNames: readonly string[]): string {
  if (fieldNames.length === 1) {
    return `${modelName}.refs.${fieldNames[0]}`;
  }

  return `[${fieldNames.map((fieldName) => `${modelName}.refs.${fieldName}`).join(', ')}]`;
}

function formatConstraintsRefCall(modelName: string, fieldNames: readonly string[]): string {
  if (fieldNames.length === 1) {
    return `constraints.ref('${modelName}', '${fieldNames[0]}')`;
  }

  return `[${fieldNames
    .map((fieldName) => `constraints.ref('${modelName}', '${fieldName}')`)
    .join(', ')}]`;
}

function formatRelationModelDisplay(
  relationModel:
    | RelationState['toModel']
    | Extract<RelationState, { kind: 'manyToMany' }>['through'],
): string {
  if (relationModel.kind === 'lazyRelationModelName') {
    return `() => ${relationModel.resolve()}`;
  }

  return relationModel.source === 'string'
    ? `'${relationModel.modelName}'`
    : relationModel.modelName;
}

function formatRelationCall(relation: RelationState, targetModelDisplay: string): string {
  if (relation.kind === 'belongsTo') {
    const from = formatFieldSelection(normalizeRelationFieldNames(relation.from));
    const to = formatFieldSelection(normalizeRelationFieldNames(relation.to));
    return `rel.belongsTo(${targetModelDisplay}, { from: ${from}, to: ${to} })`;
  }

  if (relation.kind === 'hasMany' || relation.kind === 'hasOne') {
    const by = formatFieldSelection(normalizeRelationFieldNames(relation.by));
    return `rel.${relation.kind}(${targetModelDisplay}, { by: ${by} })`;
  }

  const throughDisplay = formatRelationModelDisplay(relation.through);
  const from = formatFieldSelection(normalizeRelationFieldNames(relation.from));
  const to = formatFieldSelection(normalizeRelationFieldNames(relation.to));
  return `rel.manyToMany(${targetModelDisplay}, { through: ${throughDisplay}, from: ${from}, to: ${to} })`;
}

function formatManyToManyCallWithThrough(
  relation: Extract<RelationState, { kind: 'manyToMany' }>,
  throughDisplay: string,
): string {
  const targetDisplay = formatRelationModelDisplay(relation.toModel);
  const from = formatFieldSelection(normalizeRelationFieldNames(relation.from));
  const to = formatFieldSelection(normalizeRelationFieldNames(relation.to));
  return `rel.manyToMany(${targetDisplay}, { through: ${throughDisplay}, from: ${from}, to: ${to} })`;
}

const WARNING_BATCH_THRESHOLD = 5;

function flushWarnings(warnings: readonly string[]): void {
  if (warnings.length === 0) {
    return;
  }

  if (warnings.length <= WARNING_BATCH_THRESHOLD) {
    for (const message of warnings) {
      process.emitWarning(message, { code: 'PN_CONTRACT_TYPED_FALLBACK_AVAILABLE' });
    }
    return;
  }

  process.emitWarning(
    `${warnings.length} contract references use string fallbacks where typed alternatives are available. ` +
      'Use named model tokens and typed storage type refs for autocomplete and type safety.\n' +
      warnings.map((w) => `  - ${w}`).join('\n'),
    { code: 'PN_CONTRACT_TYPED_FALLBACK_AVAILABLE' },
  );
}

function formatFallbackWarning(location: string, current: string, suggested: string): string {
  return (
    `Contract ${location} uses ${current}. ` +
    `Use ${suggested} when the named model token is available in the same contract to keep typed relation targets and model refs.`
  );
}

export function emitTypedNamedTypeFallbackWarnings(
  models: Record<string, RuntimeModel>,
  storageTypes: Record<string, AuthoredStorageTypeInstance>,
): void {
  const warnings: string[] = [];
  const warnedFields = new Set<string>();

  for (const [modelName, modelDefinition] of Object.entries(models)) {
    for (const [fieldName, fieldBuilder] of Object.entries(modelDefinition.stageOne.fields)) {
      const fieldState = fieldBuilder.build();
      if (typeof fieldState.typeRef !== 'string' || !(fieldState.typeRef in storageTypes)) {
        continue;
      }

      const warningKey = `${modelName}.${fieldName}`;
      if (warnedFields.has(warningKey)) {
        continue;
      }
      warnedFields.add(warningKey);

      warnings.push(
        `Contract field "${modelName}.${fieldName}" uses field.namedType('${fieldState.typeRef}'). ` +
          `Use field.namedType(types.${fieldState.typeRef}) when the storage type is declared in the same contract to keep autocomplete and typed local refs.`,
      );
    }
  }

  flushWarnings(warnings);
}

export function emitTypedCrossModelFallbackWarnings(collection: RuntimeCollection): void {
  const warnings: string[] = [];
  const warnedKeys = new Set<string>();

  for (const spec of collection.modelSpecs.values()) {
    for (const [relationName, relationBuilder] of Object.entries(spec.relations)) {
      const relation = relationBuilder.build();

      if (
        relation.toModel.kind === 'relationModelName' &&
        relation.toModel.source === 'string' &&
        hasNamedModelToken(collection.models, relation.toModel.modelName)
      ) {
        const warningKey = `${spec.modelName}.${relationName}.toModel`;
        if (!warnedKeys.has(warningKey)) {
          warnedKeys.add(warningKey);

          const current = formatRelationCall(relation, `'${relation.toModel.modelName}'`);
          const suggested = formatRelationCall(relation, relation.toModel.modelName);
          warnings.push(
            formatFallbackWarning(
              `relation "${spec.modelName}.${relationName}"`,
              current,
              suggested,
            ),
          );
        }
      }

      if (
        relation.kind === 'manyToMany' &&
        relation.through.kind === 'relationModelName' &&
        relation.through.source === 'string' &&
        hasNamedModelToken(collection.models, relation.through.modelName)
      ) {
        const warningKey = `${spec.modelName}.${relationName}.through`;
        if (!warnedKeys.has(warningKey)) {
          warnedKeys.add(warningKey);

          const current = formatManyToManyCallWithThrough(
            relation,
            `'${relation.through.modelName}'`,
          );
          const suggested = formatManyToManyCallWithThrough(relation, relation.through.modelName);
          warnings.push(
            formatFallbackWarning(
              `relation "${spec.modelName}.${relationName}"`,
              current,
              suggested,
            ),
          );
        }
      }
    }

    for (const [foreignKeyIndex, foreignKey] of (spec.sqlSpec?.foreignKeys ?? []).entries()) {
      if (
        foreignKey.targetSource !== 'string' ||
        !hasNamedModelToken(collection.models, foreignKey.targetModel)
      ) {
        continue;
      }

      const warningKey = `${spec.modelName}.sql.foreignKeys.${foreignKeyIndex}`;
      if (warnedKeys.has(warningKey)) {
        continue;
      }
      warnedKeys.add(warningKey);

      const current = formatConstraintsRefCall(foreignKey.targetModel, foreignKey.targetFields);
      const suggested = formatTokenFieldSelection(foreignKey.targetModel, foreignKey.targetFields);
      warnings.push(
        formatFallbackWarning(`model "${spec.modelName}"`, `${current} in .sql(...)`, suggested),
      );
    }
  }

  flushWarnings(warnings);
}
