import {
  buildExecutionSection,
  computeProfileHash,
  computeStorageHash,
} from '@internal/contract/hashing';
import {
  type Contract,
  type ContractEnum,
  type ContractModel,
  type ContractValueObject,
  type CrossReference,
  coreHash,
  crossRef,
  type ExecutionMutationDefault,
  effectiveControlPolicy,
  type StorageBase,
  type StorageHashBase,
} from '@internal/contract/types';
import { encodeEnumTypeMembers } from '@internal/contract-authoring';
import {
  type AuthoringWarning,
  flushAuthoringWarnings,
} from '@internal/framework-components/authoring';
import type {
  CodecLookupWithDescriptors,
  DataTypeLookup,
  TypeLookups,
} from '@internal/framework-components/codec';
import { mergeCapabilityMatrices } from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import {
  type CheckExpressionRenderer,
  discriminatorValueSet,
} from '@internal/sql-contract/check-expressions';
import { sqlDataTypeOfCodec } from '@internal/sql-contract/data-type';
import { validateIndexTypes } from '@internal/sql-contract/index-type-validation';
import { type IndexTypeRegistry, indexTypeRegistryOf } from '@internal/sql-contract/index-types';
import {
  CheckConstraint,
  type SqlNamespaceInput,
  SqlStorage,
  type SqlStorageInput,
  type StorageTableInput,
  type StorageTypeInstance,
  type StorageValueSetInput,
  toStorageTypeInstance,
} from '@internal/sql-contract/types';
import { validateStorageSemantics } from '@internal/sql-contract/validators';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { ContractDefinition } from './contract-definition';
import { contractError } from './contract-errors';
import { describeModel, type ModelDescription } from './describe-model';
import { describeTableNode } from './describe-table-node';
import { buildValueObjectMember } from './domain-fields';
import { lowerRenderedChecks } from './lower-column';
import { inCanonicalOrder, lowerTable, type TableLoweringContext } from './lower-table';
import { mergeTables } from './merge-tables';
import { modelLookupsOf, modelNamespaceId } from './model-references';
import { namespaceIdOrDefault } from './namespace-id';
import {
  assertNoManagedEntityKinds,
  type CollectedColumnEntities,
  collectEntityTypeDescriptorsByDiscriminator,
  deriveEntityValueSets,
  mergeColumnAndAttachedEntities,
  mergeNamespaceValueSets,
} from './pack-entities';
import { refuseTypesKey } from './refuse-types-key';
import { tableKey } from './storage-description';
import {
  resolveCheckExpressionRenderer,
  resolveColumnTypeQualifier,
} from './target-authoring-hooks';
import { requiredUnmappedColumnWarnings } from './unmapped-column-warnings';

function assertStorageSemantics(
  contract: Contract<SqlStorage>,
  indexTypeRegistry: IndexTypeRegistry,
  codecLookup: CodecLookupWithDescriptors,
): void {
  const semanticErrors = validateStorageSemantics(contract.storage);
  if (semanticErrors.length > 0) {
    throw contractError(
      'CONTRACT.VALIDATION_FAILED',
      `Contract semantic validation failed: ${semanticErrors.join('; ')}`,
      { meta: { errors: semanticErrors } },
    );
  }
  validateIndexTypes(
    contract,
    indexTypeRegistry,
    (codecId) => codecLookup.descriptorFor(codecId)?.traits,
  );
}

function collectStorageNamespaceCoordinateIds(definition: ContractDefinition): Set<string> {
  const defaultNamespaceId = definition.target.defaultNamespaceId;
  const declared = [
    ...(definition.namespaces ?? []),
    ...definition.models.map((model) => model.namespaceId),
    ...(definition.tables ?? []).map((table) => table.namespaceId),
    ...Object.keys(definition.attachedEntities ?? {}),
  ];
  return new Set([
    defaultNamespaceId,
    ...declared.map((id) => namespaceIdOrDefault(id, defaultNamespaceId)),
  ]);
}

function ensureUnboundNamespaceSlot(
  namespaces: SqlStorageInput['namespaces'],
  createNamespace: ContractDefinition['createNamespace'],
): SqlStorageInput['namespaces'] {
  if (Object.hasOwn(namespaces, UNBOUND_NAMESPACE_ID)) {
    return namespaces;
  }
  const unboundInput: SqlNamespaceInput = {
    id: UNBOUND_NAMESPACE_ID,
    entries: { table: {} },
  };
  const unbound = createNamespace(unboundInput);
  return {
    [UNBOUND_NAMESPACE_ID]: unbound,
    ...namespaces,
  };
}

function declaredTableKeys(definition: ContractDefinition): ReadonlySet<string> {
  const defaultNamespaceId = definition.target.defaultNamespaceId;
  return new Set([
    ...definition.models.map((model) =>
      tableKey(modelNamespaceId(model, defaultNamespaceId), model.tableName),
    ),
    ...(definition.tables ?? []).map((table) =>
      tableKey(namespaceIdOrDefault(table.namespaceId, defaultNamespaceId), table.tableName),
    ),
  ]);
}

/**
 * Builds the contract in two stages. First each model is converted on its own into the table it describes and its domain model, and each table node into the table it describes. Then the tables are merged, each is lowered, and the contract is assembled.
 */
// A contract records enabled capabilities only, as its canonical form does: a disabled one is the same as an absent one.
function enabledCapabilities(
  matrix: Record<string, Record<string, boolean>>,
): Record<string, Record<string, true>> {
  const enabled: Record<string, Record<string, true>> = {};
  for (const [namespace, flags] of Object.entries(matrix)) {
    const enabledFlags = Object.fromEntries(
      Object.entries(flags)
        .filter(([, flag]) => flag)
        .map(([name]) => [name, true] as const),
    );
    if (Object.keys(enabledFlags).length > 0) {
      enabled[namespace] = enabledFlags;
    }
  }
  return enabled;
}

/** The value objects of a definition as storage entities, all in the default namespace; `undefined` when it has none. */
function valueObjectsFromDefinition(
  definition: ContractDefinition,
  defaultNamespaceId: string,
): Record<string, ContractValueObject> | undefined {
  if (definition.valueObjects === undefined || definition.valueObjects.length === 0) {
    return undefined;
  }
  return Object.fromEntries(
    definition.valueObjects.map((valueObject) => [
      valueObject.name,
      {
        fields: Object.fromEntries(
          valueObject.fields.map((field) => [
            field.fieldName,
            buildValueObjectMember(field, defaultNamespaceId),
          ]),
        ),
      },
    ]),
  );
}

/** The value objects and value sets storage will hold, in the shape storage readers take. */
function storageOf(
  defaultNamespaceId: string,
  valueObjects: Record<string, ContractValueObject> | undefined,
  storageValueSetsByNs: Readonly<Record<string, Record<string, StorageValueSetInput>>>,
): Pick<StorageBase, 'namespaces'> {
  const namespaceIds = new Set([defaultNamespaceId, ...Object.keys(storageValueSetsByNs)]);
  return {
    namespaces: Object.fromEntries(
      [...namespaceIds].map((id) => [
        id,
        {
          id,
          entries: {
            valueSet: storageValueSetsByNs[id] ?? {},
            ...(id === defaultNamespaceId ? { valueObject: valueObjects ?? {} } : {}),
          },
        },
      ]),
    ),
  };
}

/**
 * Writes the value set of each discriminator, keyed `<Base>.<field>` in the base table's namespace and holding the variants' values as the column stores them, sorted, and points the discriminator column at it (ADR 309). A column an enum types keeps the enum's value set. An enum with the same name in the same namespace is refused, since the two value sets would share one entry.
 */
function writeDiscriminatorValueSets(
  definition: ContractDefinition,
  tablesByNamespace: Record<string, Record<string, StorageTableInput>>,
  storageValueSetsByNs: Record<string, Record<string, StorageValueSetInput>>,
  checkRendererFor: (table: StorageTableInput) => CheckExpressionRenderer | undefined,
): void {
  const defaultNamespaceId = definition.target.defaultNamespaceId;
  for (const model of definition.models) {
    const { discriminator, variants } = model;
    if (discriminator === undefined || variants === undefined) continue;
    const namespaceId = modelNamespaceId(model, defaultNamespaceId);
    const table = tablesByNamespace[namespaceId]?.[model.tableName];
    const columnName = model.fields.find(
      (field) => field.fieldName === discriminator.field,
    )?.columnName;
    const column = columnName === undefined ? undefined : table?.columns[columnName];
    if (table === undefined || columnName === undefined || column === undefined) continue;
    if (column.valueSet !== undefined) continue;
    const { name: valueSetName, values } = discriminatorValueSet(
      model.modelName,
      discriminator.field,
      Object.keys(variants),
    );
    const namespaceValueSets = storageValueSetsByNs[namespaceId] ?? {};
    if (Object.hasOwn(namespaceValueSets, valueSetName)) {
      throw contractError(
        'CONTRACT.ENUM_INVALID',
        `enumType("${valueSetName}"): has the name of the value set that the discriminator field "${discriminator.field}" of model "${model.modelName}" writes. Rename the enum.`,
        {
          meta: {
            enumName: valueSetName,
            model: model.modelName,
            field: discriminator.field,
            reason: 'discriminator-value-set-name',
          },
        },
      );
    }
    namespaceValueSets[valueSetName] = { kind: 'valueSet', values };
    storageValueSetsByNs[namespaceId] = namespaceValueSets;
    const render = checkRendererFor(table);
    const derivedChecks =
      render === undefined
        ? []
        : lowerRenderedChecks(
            model.tableName,
            render({
              tableName: model.tableName,
              columnName,
              many: false,
              memberValues: values,
              valueObject: undefined,
            }),
          );
    const namespaceTables = tablesByNamespace[namespaceId] ?? {};
    namespaceTables[model.tableName] = {
      ...table,
      ...(derivedChecks.length > 0
        ? {
            checks: inCanonicalOrder([
              ...(table.checks ?? []).map((check) => CheckConstraint.from(check)),
              ...derivedChecks,
            ]),
          }
        : {}),
      columns: {
        ...table.columns,
        [columnName]: {
          ...column,
          valueSet: {
            plane: 'storage',
            entityKind: 'valueSet',
            namespaceId,
            entityName: valueSetName,
          },
        },
      },
    };
    tablesByNamespace[namespaceId] = namespaceTables;
  }
}

export function buildSqlContractFromDefinition(
  definition: ContractDefinition,
  codecLookup: CodecLookupWithDescriptors,
  dataTypeLookup: DataTypeLookup,
): Contract<SqlStorage> {
  refuseTypesKey(definition, 'buildSqlContractFromDefinition');
  const lookups: TypeLookups<CodecLookupWithDescriptors> = { codecLookup, dataTypeLookup };
  const target = definition.target.targetId;
  const defaultNamespaceId = definition.target.defaultNamespaceId;
  const indexTypeRegistry = indexTypeRegistryOf(
    definition.target,
    Object.values(definition.extensions ?? {}),
  );
  const qualifyColumnType = resolveColumnTypeQualifier(definition.target);
  const databaseTypes = definition.databaseTypes ?? {};
  const targetFamily = 'sql';

  // Build per-namespace registries for `enumType()` handles.
  // All authored enums target the contract's default namespace.
  const domainEnumsByNs: Record<string, Record<string, ContractEnum>> = {};
  const storageValueSetsByNs: Record<string, Record<string, StorageValueSetInput>> = {};
  for (const [enumName, handle] of Object.entries(definition.enums ?? {})) {
    if (enumName !== handle.enumName) {
      throw contractError(
        'CONTRACT.ENUM_INVALID',
        `enum declaration key "${enumName}" must match enumType name "${handle.enumName}". Aliases are not supported.`,
        {
          meta: {
            enumName: handle.enumName,
            declarationKey: enumName,
            reason: 'key-name-mismatch',
          },
        },
      );
    }
    const nsId = defaultNamespaceId;
    let domainSlot = domainEnumsByNs[nsId];
    if (domainSlot === undefined) {
      domainSlot = {};
      domainEnumsByNs[nsId] = domainSlot;
    }
    const storedMembers = encodeEnumTypeMembers(handle, codecLookup, 'the column');
    domainSlot[enumName] = {
      codecId: handle.codecId,
      members: storedMembers,
    };

    let storageSlot = storageValueSetsByNs[nsId];
    if (storageSlot === undefined) {
      storageSlot = {};
      storageValueSetsByNs[nsId] = storageSlot;
    }
    storageSlot[enumName] = {
      kind: 'valueSet',
      values: storedMembers.map((member) => member.value),
    };
  }

  const modelDescriptionContext = {
    ...modelLookupsOf(definition),
    declaredTables: declaredTableKeys(definition),
    foreignKeyDefaults: definition.foreignKeyDefaults,
    qualifyColumnType,
  };
  const components = definition.models.map((model) =>
    describeModel(model, modelDescriptionContext),
  );
  const tableNodes = (definition.tables ?? []).map((table) =>
    describeTableNode(table, modelDescriptionContext),
  );

  // Warnings collect across the whole build (seeded with the definition
  // producer's) and flush once, threshold-batched by code.
  const authoringWarnings: AuthoringWarning[] = [...(definition.warnings ?? [])];
  const collectedColumnEntities: CollectedColumnEntities = {};
  const valueObjects = valueObjectsFromDefinition(definition, defaultNamespaceId);
  const renderCheckExpressions = resolveCheckExpressionRenderer(definition.target);
  const tableLoweringContext: TableLoweringContext = {
    lookups,
    defaultNamespaceId,
    qualifyColumnType,
    renderCheckExpressions,
    storage: storageOf(defaultNamespaceId, valueObjects, storageValueSetsByNs),
    collectedColumnEntities,
    defaultControlPolicy: definition.defaultControlPolicy,
    indexTypeRegistry,
    warnings: authoringWarnings,
  };
  const tablesByNamespace: Record<string, Record<string, StorageTableInput>> = {};
  const modelStorages = components.map((c) => c.storage);
  const tables = mergeTables(modelStorages, tableNodes);
  authoringWarnings.push(...requiredUnmappedColumnWarnings(modelStorages, tables));
  for (const table of tables) {
    const namespaceTables = tablesByNamespace[table.namespaceId] ?? {};
    namespaceTables[table.tableName] = lowerTable(table, tableLoweringContext);
    tablesByNamespace[table.namespaceId] = namespaceTables;
  }
  writeDiscriminatorValueSets(definition, tablesByNamespace, storageValueSetsByNs, (table) =>
    renderCheckExpressions !== undefined &&
    effectiveControlPolicy(table.control, definition.defaultControlPolicy) === 'managed'
      ? renderCheckExpressions
      : undefined,
  );

  const executionDefaults: ExecutionMutationDefault[] = components.flatMap(
    (c) => c.domain.executionDefaults,
  );
  const modelsByNamespace: Record<string, Record<string, ContractModel>> = {};
  for (const { domain } of components) {
    const namespaceModels = modelsByNamespace[domain.namespaceId] ?? {};
    namespaceModels[domain.modelName] = domain.model;
    modelsByNamespace[domain.namespaceId] = namespaceModels;
  }
  const roots = buildRoots(components);

  // Normalise raw codec-triple inputs to the `kind: 'codec-instance'`
  // discriminator shape before hashing so the storageHash matches the
  // persisted JSON envelope produced from the SqlStorage class instance
  // (which always carries the discriminator). Each entry stores the data type
  // its codec represents.
  const documentTypes: Record<string, StorageTypeInstance> = Object.fromEntries(
    Object.entries(databaseTypes).map(([name, entry]) => [
      name,
      toStorageTypeInstance({
        codecId: entry.codecId,
        dataType: sqlDataTypeOfCodec(entry.codecId, lookups).id,
        typeParams: entry.typeParams,
      }),
    ]),
  );
  const namespaceCoordinateIds = collectStorageNamespaceCoordinateIds(definition);

  const { createNamespace } = definition;
  const entityTypesByDiscriminator = collectEntityTypeDescriptorsByDiscriminator(definition);
  const namespaces: SqlStorageInput['namespaces'] = Object.fromEntries(
    [...namespaceCoordinateIds].sort().map((id) => {
      const entitiesForNs = mergeColumnAndAttachedEntities(
        id,
        definition.attachedEntities?.[id],
        collectedColumnEntities[id],
      );
      assertNoManagedEntityKinds(id, entitiesForNs);

      const enumValueSetEntries = storageValueSetsByNs[id];
      const packValueSetEntries = deriveEntityValueSets(entitiesForNs, entityTypesByDiscriminator);
      const valueSetEntries =
        enumValueSetEntries !== undefined || packValueSetEntries !== undefined
          ? mergeNamespaceValueSets(id, enumValueSetEntries, packValueSetEntries)
          : undefined;

      const nsInput: SqlNamespaceInput = {
        id,
        entries: {
          table: tablesByNamespace[id] ?? {},
          ...entitiesForNs,
          ...(valueSetEntries !== undefined && Object.keys(valueSetEntries).length > 0
            ? { valueSet: valueSetEntries }
            : {}),
          ...(id === defaultNamespaceId && valueObjects !== undefined
            ? { valueObject: valueObjects }
            : {}),
        },
      };
      return [id, createNamespace(nsInput)];
    }),
  );
  const storageWithoutHash = {
    ...(Object.keys(documentTypes).length > 0 ? { types: documentTypes } : {}),
    namespaces:
      defaultNamespaceId === UNBOUND_NAMESPACE_ID
        ? ensureUnboundNamespaceSlot(namespaces, createNamespace)
        : namespaces,
  };
  const storageHash: StorageHashBase<string> = definition.storageHash
    ? coreHash(definition.storageHash)
    : computeStorageHash({
        target,
        targetFamily,
        storage: blindCast<
          Record<string, unknown>,
          'the storage envelope is a plain object of namespaces; hashing reads it as a record'
        >(storageWithoutHash),
        ...sqlContractCanonicalizationHooks,
      });
  const storage = new SqlStorage({ ...storageWithoutHash, storageHash });

  const extensionNamespaces = definition.extensions
    ? Object.values(definition.extensions).map((pack) => pack.id)
    : undefined;

  const extensions: Record<string, unknown> = { ...(definition.extensions || {}) };
  if (extensionNamespaces) {
    for (const namespace of extensionNamespaces) {
      if (!Object.hasOwn(extensions, namespace)) {
        extensions[namespace] = {};
      }
    }
  }

  const capabilities = enabledCapabilities(
    mergeCapabilityMatrices({}, [
      definition.target,
      ...(definition.capabilities ? [{ capabilities: definition.capabilities }] : []),
      ...Object.values(definition.extensions ?? {}),
    ]),
  );
  // Internal `profileHash` computation is unchanged from `origin/main`: it
  // continues to fingerprint the author-declared capability subset. With
  // `capabilities` removed from the `defineContract` input that subset is
  // now always empty, so the hash naturally stabilises at `hash({})`.
  const profileHash = computeProfileHash({
    target,
    targetFamily,
    capabilities: {},
  });

  const executionWithHash = buildExecutionSection({
    target,
    targetFamily,
    defaults: executionDefaults,
  });

  const domainNamespaceIds = new Set(Object.keys(modelsByNamespace));
  if (domainNamespaceIds.size === 0) {
    domainNamespaceIds.add(defaultNamespaceId);
  }
  for (const nsId of Object.keys(domainEnumsByNs)) {
    domainNamespaceIds.add(nsId);
  }
  const domainNamespaces = Object.fromEntries(
    [...domainNamespaceIds].sort().map((namespaceId) => {
      const modelsInNs = modelsByNamespace[namespaceId] ?? {};
      const enumsInNs = domainEnumsByNs[namespaceId];
      const namespaceSlice = {
        models: modelsInNs,
        ...(enumsInNs !== undefined && Object.keys(enumsInNs).length > 0
          ? { enum: enumsInNs }
          : {}),
      };
      return [namespaceId, namespaceSlice];
    }),
  );

  const contract: Contract<SqlStorage> = {
    target,
    targetFamily,
    ...ifDefined('defaultControlPolicy', definition.defaultControlPolicy),
    domain: { namespaces: domainNamespaces },
    roots,
    storage,
    ...(executionWithHash ? { execution: executionWithHash } : {}),
    extensions,
    capabilities,
    profileHash,
    meta: {},
  };

  assertStorageSemantics(contract, indexTypeRegistry, codecLookup);
  flushAuthoringWarnings(authoringWarnings);

  return contract;
}

/**
 * Aggregate roots, one per model that owns a table, keyed by bare storage table name. When two models in different namespaces map to the same bare table name, the bare key would collide, so those entries fall back to a namespace-qualified key. Single-namespace contracts never collide and keep their bare keys.
 */
function buildRoots(components: readonly ModelDescription[]): Record<string, CrossReference> {
  const rootEntries = components.flatMap(({ storage, domain }) =>
    storage.kind === 'ownTable'
      ? [
          {
            tableName: storage.table.tableName,
            namespaceId: domain.namespaceId,
            ref: crossRef(domain.modelName, domain.namespaceId),
          },
        ]
      : [],
  );
  const rootTableNameCounts = new Map<string, number>();
  for (const entry of rootEntries) {
    rootTableNameCounts.set(entry.tableName, (rootTableNameCounts.get(entry.tableName) ?? 0) + 1);
  }
  const roots: Record<string, CrossReference> = {};
  for (const entry of rootEntries) {
    const key =
      (rootTableNameCounts.get(entry.tableName) ?? 0) > 1
        ? `${entry.namespaceId}.${entry.tableName}`
        : entry.tableName;
    roots[key] = entry.ref;
  }
  return roots;
}
