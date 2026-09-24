import {
  type Contract,
  type ContractEnum,
  type ExecutionMutationDefault,
  effectiveControlPolicy,
} from '@internal/contract/types';
import type { SqlPslPrintContext } from '@internal/family-sql/control';
import type { PslTypeMap } from '@internal/family-sql/psl-ast';
import type {
  PslDocumentAst,
  PslExtensionBlock,
  PslModel,
  PslNamespace,
} from '@internal/framework-components/psl-ast';
import {
  makePslNamespace,
  makePslNamespaceEntries,
  UNSPECIFIED_PSL_NAMESPACE_ID,
} from '@internal/framework-components/psl-ast';
import type { ForeignKey, SqlStorage } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import { DEFAULT_NAMESPACE_ID } from '../namespace-ids';
import { PostgresNativeEnum } from '../postgres-native-enum';
import { createPostgresTypeMap } from '../psl-ast/postgres-type-map';
import { SYNTHETIC_SPAN } from '../psl-ast/psl-literals';
import {
  indexContractModels,
  type ModelWithTable,
  modelCoordinate,
  modelsByCoordinate,
  pslNamespaceName,
  type VariantInfo,
  variantInfo,
} from './contract-model-index';
import { buildCompositeTypes, buildTypesBlock } from './domain-types';
import {
  buildDomainEnumBlocks,
  buildNativeEnumBlocksForNamespace,
  type NativeEnumEmission,
} from './enum-blocks';
import { buildModelAttributes, derivedChecks } from './model-attributes';
import {
  refuseContractMeta,
  refuseDuplicateModelNames,
  refuseEnumAndNativeEnumSharingName,
  refuseEnumsOutsideDefaultNamespace,
  refuseInvalidEntry,
  refuseModelOwner,
  refuseModelsOutsideTableNamespace,
  refuseNonIdentifier,
  refuseRlsWithoutModel,
  refuseUnderivedChecks,
  refuseUnderivedRoots,
  refuseUnderivedValueSets,
  refuseUnderivedVariantLink,
  refuseUnmodelledTablesAndColumns,
  refuseUnprintedEntryKinds,
  refuseUntravelledForeignKeys,
  refuseUnwrittenExecutionDefaults,
  refuseUnwrittenNamespaces,
} from './refusals';
import {
  buildRelationFields,
  collectRelations,
  foreignKeyFor,
  type ModelRelation,
  relationsByModel,
  resolvePinnedRelations,
} from './relation-fields';
import { buildPolicyBlocks, buildRoleBlocks, rlsEnabledTables } from './row-level-security';
import { buildScalarFields, executionDefaultsByColumn } from './scalar-fields';

/** What building every model needs from the whole contract, computed once. */
interface ContractModels {
  readonly contract: Contract<SqlStorage>;
  readonly context: SqlPslPrintContext;
  readonly typeMap: PslTypeMap;
  readonly models: readonly ModelWithTable[];
  readonly byCoordinate: ReadonlyMap<string, ModelWithTable>;
  readonly variants: ReadonlyMap<ModelWithTable, VariantInfo | undefined>;
  readonly relationsByModel: ReadonlyMap<string, readonly ModelRelation[]>;
  readonly pinned: ReadonlySet<string>;
  readonly executionDefaults: ReadonlyMap<string, ExecutionMutationDefault>;
  readonly writtenExecutionDefaults: Set<ExecutionMutationDefault>;
  readonly defaultDomainEnums: Readonly<Record<string, ContractEnum>>;
  readonly domainEnumValues: ReadonlyMap<string, readonly unknown[]>;
}

/** The native enums of one namespace, keyed as the contract keys them. */
function nativeEnumsOf(
  namespaceId: string,
  entries: SqlStorage['namespaces'][string]['entries'],
): ReadonlyMap<string, PostgresNativeEnum> {
  const nativeEnums = new Map<string, PostgresNativeEnum>();
  for (const [name, entity] of Object.entries(entries['native_enum'] ?? {})) {
    if (!PostgresNativeEnum.is(entity)) refuseInvalidEntry(namespaceId, 'native_enum', name);
    nativeEnums.set(name, entity);
  }
  return nativeEnums;
}

/** The value sets the PSL source derives for a namespace from the enum blocks written for it. */
function derivedValueSetsOf(
  namespaceId: string,
  enums: NativeEnumEmission,
  defaultDomainEnums: Readonly<Record<string, ContractEnum>>,
): ReadonlyMap<string, readonly unknown[]> {
  const derived = new Map<string, readonly unknown[]>(enums.derivedValueSets);
  if (namespaceId !== DEFAULT_NAMESPACE_ID) return derived;
  for (const [name, domainEnum] of Object.entries(defaultDomainEnums)) {
    if (derived.has(name)) refuseEnumAndNativeEnumSharingName(namespaceId, name);
    derived.set(
      name,
      domainEnum.members.map((member) => member.value),
    );
  }
  return derived;
}

/** One model of a namespace, with its fields and attributes. */
function buildModel(
  all: ContractModels,
  entry: ModelWithTable,
  enums: NativeEnumEmission,
  rlsTables: ReadonlySet<string>,
): PslModel {
  const { models, variants, relationsByModel, byCoordinate } = all;
  refuseNonIdentifier('model', entry.name);
  refuseModelOwner(entry);
  const variant = variants.get(entry);
  if (variant !== undefined && !variant.singleTable) refuseUnderivedVariantLink(entry, variant);
  const singleTableVariants = models.filter(
    (other) =>
      other !== entry &&
      variants.get(other)?.singleTable === true &&
      variants.get(other)?.base === entry,
  );
  const travelledForeignKeys = new Set<ForeignKey>();
  const fields = [
    ...buildScalarFields({
      entry,
      variant,
      enums,
      domainEnums: all.contract.domain.namespaces[entry.namespaceId]?.enum ?? {},
      typeMap: all.typeMap,
      context: all.context,
      executionDefaults: all.executionDefaults,
      writtenExecutionDefaults: all.writtenExecutionDefaults,
      defaultDomainEnumNames: new Set(Object.keys(all.defaultDomainEnums)),
    }),
    ...buildRelationFields({
      entry,
      variant,
      relations: relationsByModel.get(modelCoordinate(entry.namespaceId, entry.name)) ?? [],
      relationsByModel,
      modelsByCoordinate: byCoordinate,
      pinned: all.pinned,
      travelledForeignKeys,
    }),
  ];
  if (variant?.singleTable !== true) {
    for (const other of singleTableVariants) {
      for (const relation of relationsByModel.get(modelCoordinate(entry.namespaceId, other.name)) ??
        []) {
        const target = byCoordinate.get(relation.targetCoordinate);
        const fk = target === undefined ? undefined : foreignKeyFor(relation, target);
        if (fk !== undefined) travelledForeignKeys.add(fk);
      }
    }
  }
  refuseUntravelledForeignKeys(entry, variant, travelledForeignKeys);
  const checks = derivedChecks({
    table: entry.table,
    tableName: entry.tableName,
    managed:
      effectiveControlPolicy(entry.table.control, all.contract.defaultControlPolicy) === 'managed',
    domainEnumValues: all.domainEnumValues,
  });
  if (variant?.singleTable !== true) refuseUnderivedChecks(entry, checks);
  return {
    kind: 'model',
    name: entry.name,
    fields,
    attributes: buildModelAttributes({
      entry,
      variant,
      singleTableVariants,
      derivedChecksByName: checks,
      rlsEnabled: rlsTables.has(entry.tableName),
    }),
    span: SYNTHETIC_SPAN,
  };
}

/**
 * The namespace block of one storage namespace: its models, value objects, enum blocks, roles and
 * policies. `undefined` when the namespace holds none of them.
 */
function buildNamespace(
  all: ContractModels,
  namespaceId: string,
  namespace: SqlStorage['namespaces'][string],
): PslNamespace | undefined {
  const { contract, models, variants } = all;
  refuseUnprintedEntryKinds(namespaceId, namespace.entries);
  const valueSets = new Map(
    Object.entries(namespace.entries.valueSet ?? {}).map(([name, valueSet]) => [
      name,
      valueSet.values,
    ]),
  );
  const enums = buildNativeEnumBlocksForNamespace({
    namespaceId,
    nativeEnums: nativeEnumsOf(namespaceId, namespace.entries),
    valueSets,
    columns: models
      .filter((entry) => entry.namespaceId === namespaceId)
      .flatMap((entry) => Object.values(entry.table.columns)),
  });
  refuseUnderivedValueSets({
    namespaceId,
    actual: valueSets,
    derived: derivedValueSetsOf(namespaceId, enums, all.defaultDomainEnums),
  });

  const rlsTables = rlsEnabledTables(namespaceId, namespace.entries['rls']);
  const namespaceModels = models
    .filter((entry) => entry.namespaceId === namespaceId)
    .map((entry) => buildModel(all, entry, enums, rlsTables));
  const compositeTypes = buildCompositeTypes({
    contract,
    namespaceId,
    typeMap: all.typeMap,
    context: all.context,
    enumBlockNames: enums.blockNamesByTypeName,
  });
  const modelNameForTable = (tableName: string): string | undefined =>
    models.find(
      (entry) =>
        entry.namespaceId === namespaceId &&
        entry.tableName === tableName &&
        variants.get(entry)?.singleTable !== true,
    )?.name;
  for (const tableName of rlsTables) {
    if (modelNameForTable(tableName) === undefined) refuseRlsWithoutModel(namespaceId, tableName);
  }
  const blocks: readonly PslExtensionBlock[] = [
    ...enums.blocks,
    ...buildRoleBlocks(namespaceId, namespace.entries['role']),
    ...buildPolicyBlocks({
      namespaceId,
      entries: namespace.entries['policy'],
      modelNameForTable,
      rlsTables,
    }),
  ];
  if (namespaceModels.length === 0 && blocks.length === 0 && compositeTypes.length === 0) {
    return undefined;
  }
  return makePslNamespace({
    kind: 'namespace',
    name: pslNamespaceName(namespaceId),
    entries: makePslNamespaceEntries(namespaceModels, compositeTypes, blocks),
    span: SYNTHETIC_SPAN,
  });
}

/**
 * Builds the Prisma 8 PSL document a Postgres contract was, or would have been, authored as: every
 * model with its columns, keys, indexes and relations, every value object, every named type and
 * every native enum, in the namespace block that carries it.
 *
 * Read back by the PSL contract source with the same stack, the document yields the contract it was
 * built from. Anything the language cannot carry is refused by name.
 */
export function buildPostgresPslContract(
  contract: Contract<SqlStorage>,
  context: SqlPslPrintContext,
): PslDocumentAst {
  refuseModelsOutsideTableNamespace(contract);
  const models = indexContractModels(contract);
  refuseDuplicateModelNames(models);
  const byCoordinate = modelsByCoordinate(models);
  const relations = collectRelations(models);
  const byModel = relationsByModel(relations);
  const defaultDomainEnums = contract.domain.namespaces[DEFAULT_NAMESPACE_ID]?.enum ?? {};
  const all: ContractModels = {
    contract,
    context,
    typeMap: createPostgresTypeMap(),
    models,
    byCoordinate,
    variants: new Map(models.map((entry) => [entry, variantInfo(entry, byCoordinate)])),
    relationsByModel: byModel,
    pinned: resolvePinnedRelations(relations, byModel),
    executionDefaults: executionDefaultsByColumn(contract),
    writtenExecutionDefaults: new Set<ExecutionMutationDefault>(),
    defaultDomainEnums,
    domainEnumValues: new Map(
      Object.entries(defaultDomainEnums).map(([name, domainEnum]) => [
        name,
        domainEnum.members.map((member) => member.value),
      ]),
    ),
  };

  const namespaces: PslNamespace[] = [];
  refuseEnumsOutsideDefaultNamespace(contract);
  const topLevelEnums = buildDomainEnumBlocks(defaultDomainEnums);
  if (topLevelEnums.length > 0) {
    namespaces.push(
      makePslNamespace({
        kind: 'namespace',
        name: UNSPECIFIED_PSL_NAMESPACE_ID,
        entries: makePslNamespaceEntries([], [], topLevelEnums),
        span: SYNTHETIC_SPAN,
      }),
    );
  }
  const writtenStorageNamespaces = new Set<string>();
  for (const [namespaceId, namespace] of Object.entries(contract.storage.namespaces)) {
    const built = buildNamespace(all, namespaceId, namespace);
    if (built === undefined) continue;
    writtenStorageNamespaces.add(namespaceId);
    namespaces.push(built);
  }

  refuseUnmodelledTablesAndColumns(contract, models, all.variants);
  refuseUnwrittenNamespaces({ contract, models, writtenStorageNamespaces });
  refuseUnwrittenExecutionDefaults(contract, all.writtenExecutionDefaults);
  refuseContractMeta(contract);
  refuseUnderivedRoots(contract, models, all.variants);

  const types = buildTypesBlock(contract, all.typeMap, context);
  return {
    kind: 'document',
    sourceId: '<contract>',
    namespaces,
    ...ifDefined('types', types),
    span: SYNTHETIC_SPAN,
  };
}
