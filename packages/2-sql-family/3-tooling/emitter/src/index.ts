import type {
  Contract,
  ContractModel,
  ContractModelBase,
  JsonValue,
} from '@internal/contract/types';
import {
  generateValueObjectsDescriptorType,
  renderCodecTypeOverride,
  renderTypeOverridesMap,
  renderValueSetOverride,
  serializeNamespaceId,
  serializeObjectKey,
  serializeValue,
  type TypeOverride,
} from '@internal/emitter/domain-type-generation';
import type { CodecLookup } from '@internal/framework-components/codec';
import type { AggregateDescriptor } from '@internal/framework-components/components';
import { settleAggregateOverloads } from '@internal/framework-components/components';
import type {
  GenerateContractTypesOptions,
  ImportSpecifierResolver,
} from '@internal/framework-components/emission';
import { entityAt, type Namespace, UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  nonEmptyTypeParams,
  type SqlModelStorage,
  type SqlStorage,
  type StorageColumn,
  type StorageTable,
  type StorageTypeInstance,
  type StorageValueSet,
} from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { sqlEmitterError } from './errors';

/**
 * Render the aggregate result map from the overloads the stack contributes, settled against the codecs it contributes.
 *
 * Every emitted row is keyed by a contributed codec, whichever rung settled it. Trait fallbacks reach only the contributed codecs to begin with, and an exact overload naming an uncontributed codec is dropped here — settling keeps such a row, because naming a codec id is a claim that stands on its own and the runtime honours it for whatever ref reaches it, but a target may register codecs its adapter withholds, and an emitted type over one of those would advertise availability no contract can use.
 *
 * Only the two rungs that name a codec are materialized; the input-agnostic overload stays a single row, which a consumer reads when no per-codec row claims its input.
 */
function generateAggregateTypes(options?: GenerateContractTypesOptions): string {
  const descriptors = options?.aggregateDescriptors ?? [];
  const codecs = options?.codecDescriptors ?? [];
  if (descriptors.length === 0) return 'Record<string, never>';

  const contributedIds = new Set(codecs.map((codec) => codec.codecId));
  const settled = settleAggregateOverloads(descriptors, codecs);
  const ambiguity = settled.ambiguities[0];
  if (ambiguity !== undefined) {
    throw sqlEmitterError(
      'CONTRACT.AGGREGATE_DESCRIPTOR_AMBIGUOUS',
      `Aggregate '${ambiguity.operation}' has no single result type over codec '${ambiguity.codecId}': traits ${ambiguity.traits.join(', ')} all claim it.`,
      {
        why: 'Emitted result types must name one codec per aggregate and input.',
        fix: `Contribute an exact descriptor for '${ambiguity.operation}' over '${ambiguity.codecId}', or narrow the overlapping trait contributions.`,
        meta: {
          operation: ambiguity.operation,
          codecId: ambiguity.codecId,
          traits: ambiguity.traits,
        },
      },
    );
  }

  const operations = [...settled.operations].sort(([left], [right]) => left.localeCompare(right));
  const entries = operations.map(([operation, entry]) => {
    const rows = [...entry.byCodecId]
      .filter(([codecId]) => contributedIds.has(codecId))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([codecId, descriptor]) => {
        return `readonly ${serializeObjectKey(codecId)}: ${renderAggregateResult(descriptor, codecId, contributedIds)}`;
      });
    const members = [`readonly byCodec: { ${rows.join('; ')} }`];
    const withoutInput = entry.noInput ?? entry.anyInput;
    if (withoutInput !== undefined) {
      members.push(
        `readonly withoutInput: ${renderAggregateResult(withoutInput, undefined, contributedIds)}`,
      );
    }
    if (entry.anyInput !== undefined) {
      members.push(
        `readonly anyInput: ${renderAggregateResult(entry.anyInput, undefined, contributedIds)}`,
      );
    }
    return `readonly ${serializeObjectKey(operation)}: { ${members.join('; ')} }`;
  });

  return `{ ${entries.join('; ')} }`;
}

/** One row of the map: the codec the result carries, and whether it can be null. A `self` result carries the codec of the input it was resolved for. */
function renderAggregateResult(
  descriptor: AggregateDescriptor,
  inputCodecId: string | undefined,
  contributedIds: ReadonlySet<string>,
): string {
  const output = descriptor.output.kind === 'self' ? inputCodecId : descriptor.output.codecId;
  if (output === undefined) {
    throw sqlEmitterError(
      'CONTRACT.AGGREGATE_DESCRIPTOR_AMBIGUOUS',
      `Aggregate '${descriptor.operation}' declares its own input's codec as its result but answers calls that carry no input.`,
      {
        why: 'A result that reuses its input needs an input to reuse.',
        fix: 'Name the result codec on the descriptor.',
        meta: { operation: descriptor.operation },
      },
    );
  }
  if (!contributedIds.has(output)) {
    throw sqlEmitterError(
      'CONTRACT.AGGREGATE_OUTPUT_CODEC_MISSING',
      `Aggregate '${descriptor.operation}' names result codec '${output}', which the stack does not contribute.`,
      {
        why: 'An emitted result type names a codec in the contract codec map; a codec the stack does not contribute has no emitted type to name.',
        fix: 'Contribute the codec, or declare a result codec the stack contributes.',
        meta: { operation: descriptor.operation, outputCodecId: output },
      },
    );
  }
  return `{ readonly output: ${serializeValue(output)}; readonly nullable: ${descriptor.nullable} }`;
}

function serializeTypeParamsLiteral(params: Record<string, unknown> | undefined): string {
  if (!params || Object.keys(params).length === 0) {
    return 'Record<string, never>';
  }

  const entries: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    entries.push(`readonly ${serializeObjectKey(key)}: ${serializeValue(value)}`);
  }

  return `{ ${entries.join('; ')} }`;
}

export const sqlEmission = {
  id: 'sql',

  generateStorageType(contract: Contract, storageHashTypeName: string): string {
    const storage = contract.storage as unknown as SqlStorage;
    const namespacesType = generateStorageNamespacesType(storage.namespaces);
    const docTypes = generateDocumentScopedStorageTypesType(storage.types);
    const typesClause = docTypes === undefined ? '' : `; readonly types: ${docTypes}`;
    return `{ readonly namespaces: ${namespacesType}${typesClause}; readonly storageHash: ${storageHashTypeName} }`;
  },

  generateModelStorageType(_modelName: string, model: ContractModelBase): string {
    const sqlModel = model as ContractModel<SqlModelStorage>;
    const tableName = sqlModel.storage.table;
    const storageFields = sqlModel.storage.fields;

    const storageParts = [
      `readonly table: ${serializeValue(tableName)}`,
      `readonly namespaceId: ${serializeValue(sqlModel.storage.namespaceId)}`,
    ];
    if (Object.keys(storageFields).length > 0) {
      const fieldParts: string[] = [];
      for (const [fieldName, field] of Object.entries(storageFields)) {
        fieldParts.push(
          `readonly ${serializeObjectKey(fieldName)}: { readonly column: ${serializeValue(field.column)} }`,
        );
      }
      storageParts.push(`readonly fields: { ${fieldParts.join('; ')} }`);
    }

    return `{ ${storageParts.join('; ')} }`;
  },

  resolveStorageValueSet(
    _modelName: string,
    fieldName: string,
    model: ContractModelBase,
    contract: Contract,
  ): { readonly encodedValues: readonly JsonValue[]; readonly codecId: string } | undefined {
    const sqlModel = blindCast<
      ContractModel<SqlModelStorage>,
      'a sql-family model carries SqlModelStorage in storage'
    >(model);
    const storageField = sqlModel.storage?.fields?.[fieldName];
    if (!storageField) return undefined;

    const storage = blindCast<
      SqlStorage | undefined,
      'contract.storage is SqlStorage for sql family'
    >(contract.storage);
    if (!storage) return undefined;

    const storageNamespaceId = sqlModel.storage.namespaceId;
    if (!storageNamespaceId) return undefined;

    const table = entityAt<StorageTable>(storage, {
      namespaceId: storageNamespaceId,
      entityKind: 'table',
      entityName: sqlModel.storage.table,
    });
    const column = table?.columns[storageField.column];
    if (!column?.valueSet) return undefined;

    const valueSet = entityAt<StorageValueSet>(storage, {
      namespaceId: column.valueSet.namespaceId,
      entityKind: column.valueSet.entityKind,
      entityName: column.valueSet.entityName,
    });
    if (!valueSet) return undefined;

    return { encodedValues: valueSet.values, codecId: column.codecId };
  },

  getStorageTypeExports(contract: Contract, codecLookup?: CodecLookup): string | undefined {
    const storage = blindCast<
      SqlStorage | undefined,
      'contract.storage is SqlStorage for sql family'
    >(contract.storage);
    if (!storage?.namespaces) return undefined;
    return [
      `type ColumnTypeOverrides = ${generateColumnTypeOverridesMap(storage, codecLookup)};`,
      `export type StorageColumnTypes = ${columnTypesExpression('output')};`,
      `export type StorageColumnInputTypes = ${columnTypesExpression('input')};`,
    ].join('\n');
  },

  getFamilyImports(resolveImportSpecifier: ImportSpecifierResolver): string[] {
    return [
      'import type {',
      '  ColumnTypesFromStorage,',
      '  ContractWithTypeMaps,',
      '  RelationKeys,',
      '  TypeMaps as TypeMapsType,',
      `} from '${resolveImportSpecifier('@internal/sql-contract/types')}';`,
    ];
  },

  getFamilyTypeAliases(options?: GenerateContractTypesOptions): string {
    const queryOperationTypeImports = options?.queryOperationTypeImports ?? [];
    const queryOperationAliases = queryOperationTypeImports
      .filter((imp) => imp.named === 'QueryOperationTypes')
      .map((imp) => `${imp.alias}<CodecTypes>`);
    const queryOperationTypes =
      queryOperationAliases.length > 0
        ? queryOperationAliases.join(' & ')
        : 'Record<string, never>';

    return [
      'export type LaneCodecTypes = CodecTypes;',
      `export type QueryOperationTypes = ${queryOperationTypes};`,
      `export type AggregateTypes = ${generateAggregateTypes(options)};`,
      // A literal default is stored in `contract.json`, so it is typed by the
      // codec's JSON channel rather than its application type — the two diverge
      // wherever a codec's canonical JSON differs from the value it hands the
      // application. The emitted literal is kept whenever that channel admits
      // it, so a default stays as precise as the file it came from.
      'type DefaultLiteralValue<CodecId extends string, Encoded> =',
      '  CodecId extends keyof CodecTypes',
      '    ? Encoded extends CodecTypes[CodecId]["json"]',
      '      ? Encoded',
      '      : CodecTypes[CodecId]["json"]',
      '    : Encoded;',
    ].join('\n');
  },

  getTypeMapsExpression(): string {
    return 'TypeMapsType<CodecTypes, QueryOperationTypes, FieldOutputTypes, FieldInputTypes, StorageColumnTypes, StorageColumnInputTypes, AggregateTypes>';
  },

  getContractWrapper(contractBaseName: string, typeMapsName: string): string {
    return [
      `export type Contract = ContractWithTypeMaps<${contractBaseName}, ${typeMapsName}>;`,
      '',
      "export type Namespaces = Contract['storage']['namespaces'];",
    ].join('\n');
  },
} as const;

function columnTypesExpression(side: 'output' | 'input'): string {
  return `ColumnTypesFromStorage<ContractBase['storage'], CodecTypes, ParameterizedOutputTypeFunctions, ColumnTypeOverrides, ${serializeValue(side)}>`;
}

/** `ColumnTypeOverrides`: per namespace, table and column, the type of each column its codec does not give. */
function generateColumnTypeOverridesMap(
  storage: SqlStorage,
  codecLookup: CodecLookup | undefined,
): string {
  const entries = Object.entries(storage.namespaces ?? {}).flatMap(([nsId, ns]) => {
    const tables = blindCast<
      Readonly<Record<string, StorageTable>>,
      'same pattern as generateTablesMapType below'
    >(ns.entries.table ?? {});
    return Object.entries(tables).flatMap(([tableName, table]) =>
      Object.entries(table.columns).map(
        ([columnName, column]) =>
          [
            [nsId, tableName, columnName],
            columnTypeOverride(storage, column, codecLookup),
          ] as const,
      ),
    );
  });
  return renderTypeOverridesMap(entries);
}

function columnTypeOverride(
  storage: SqlStorage,
  column: StorageColumn,
  codecLookup: CodecLookup | undefined,
): TypeOverride | undefined {
  if (column.valueSet) {
    const valueSet = entityAt<StorageValueSet>(storage, {
      namespaceId: column.valueSet.namespaceId,
      entityKind: column.valueSet.entityKind,
      entityName: column.valueSet.entityName,
    });
    const override = valueSet
      ? renderValueSetOverride(valueSet.values, column.codecId, codecLookup)
      : undefined;
    if (override !== undefined) return override;
  }
  return renderCodecTypeOverride(
    column.codecId,
    nonEmptyTypeParams(column.typeParams),
    codecLookup,
  );
}

function generateDocumentScopedStorageTypesType(types: SqlStorage['types']): string | undefined {
  if (!types || Object.keys(types).length === 0) {
    return undefined;
  }

  const typeEntries: string[] = [];
  for (const [typeName, typeInstance] of Object.entries(types)) {
    const codecInstanceShape = typeInstance as Partial<StorageTypeInstance>;
    if (
      typeof codecInstanceShape.codecId !== 'string' ||
      typeof codecInstanceShape.dataType !== 'string'
    ) {
      throw sqlEmitterError(
        'CONTRACT.TYPE_UNKNOWN',
        `Unknown storage type kind for "${typeName}" in document-scoped storage.types; expected a codec-instance triple.`,
        {
          why: 'A storage.types entry is not a codec-instance triple, so its column type cannot be emitted.',
          fix: 'Regenerate the contract from its authoring source; storage.types entries must carry codecId and dataType.',
          meta: { type: typeName },
        },
      );
    }
    const codecId = serializeValue(codecInstanceShape.codecId);
    const dataType = serializeValue(codecInstanceShape.dataType);
    const typeParamsStr = serializeTypeParamsLiteral(codecInstanceShape.typeParams);
    typeEntries.push(
      `readonly ${serializeObjectKey(typeName)}: { readonly kind: "codec-instance"; readonly codecId: ${codecId}; readonly dataType: ${dataType}; readonly typeParams: ${typeParamsStr} }`,
    );
  }

  return `{ ${typeEntries.join('; ')} }`;
}

/**
 * Literalizes the `valueSet` entries slot — a core SQL entity kind (alongside
 * `table`), not a pack-contributed one, so naming it here isn't a
 * family→target layering leak. This is the only non-`table` entries slot with
 * a type-level consumer (`db.nativeEnums`, `packages/3-targets/postgres/9-facade`):
 * pack-contributed slots (`role`, `policy`, `native_enum`, …) have none and
 * are not emitted.
 */
function generateValueSetBlockType(valueSets: Readonly<Record<string, StorageValueSet>>): string {
  const entries = Object.entries(valueSets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, valueSet]) => `readonly ${serializeObjectKey(name)}: ${serializeValue(valueSet)}`);
  return `{ ${entries.join('; ')} }`;
}

function namespaceSerializedKind(ns: Namespace): string {
  const kind = ns.kind;
  if (kind === 'schema') {
    const id = ns.id;
    const lit = id === UNBOUND_NAMESPACE_ID ? 'postgres-unbound-schema' : 'postgres-schema';
    return `readonly kind: "${lit}"`;
  }
  if (typeof kind === 'string') {
    return `readonly kind: ${serializeValue(kind)}`;
  }
  throw sqlEmitterError(
    'CONTRACT.NAMESPACE_INVALID',
    `Namespace '${ns.id}' has no string kind — all namespaces must be target concretions with a defined kind property.`,
    {
      why: 'The namespace is not a target concretion, so the emitter cannot serialize its kind.',
      fix: 'Regenerate the contract with a target pack that materializes every namespace as a target concretion.',
      meta: { namespace: ns.id },
    },
  );
}

function generateTableLiteralType(table: StorageTable): string {
  const columns: string[] = [];
  for (const [colName, col] of Object.entries(table.columns)) {
    const nullable = col.nullable ? 'true' : 'false';
    const dataType = serializeValue(col.dataType);
    const codecId = serializeValue(col.codecId);
    const defaultSpec = col.default
      ? col.default.kind === 'literal'
        ? `; readonly default: { readonly kind: "literal"; readonly value: DefaultLiteralValue<${codecId}, ${serializeValue(
            col.default.value,
          )}> }`
        : `; readonly default: { readonly kind: "function"; readonly expression: ${serializeValue(
            col.default.expression,
          )} }`
      : '';
    const typeParamsSpec =
      col.typeParams && Object.keys(col.typeParams).length > 0
        ? `; readonly typeParams: ${serializeTypeParamsLiteral(col.typeParams)}`
        : '';
    const manySpec =
      col.many === false
        ? '; readonly many: false'
        : `; readonly many: { readonly elementNullable: ${col.many.elementNullable} }`;
    columns.push(
      `readonly ${serializeObjectKey(colName)}: { readonly dataType: ${dataType}; readonly codecId: ${codecId}; readonly nullable: ${nullable}${defaultSpec}${typeParamsSpec}${manySpec} }`,
    );
  }

  const tableParts: string[] = [`columns: { ${columns.join('; ')} }`];

  if (table.primaryKey) {
    const pkCols = table.primaryKey.columns.map((c) => serializeValue(c)).join(', ');
    const pkParts = [`readonly columns: readonly [${pkCols}]`];
    if (table.primaryKey.name) {
      pkParts.push(`readonly name: ${serializeValue(table.primaryKey.name)}`);
    }
    tableParts.push(`primaryKey: { ${pkParts.join('; ')} }`);
  }

  const uniques = table.uniques
    .map((u) => {
      const cols = u.columns.map((c: string) => serializeValue(c)).join(', ');
      const parts = [`readonly columns: readonly [${cols}]`];
      if (u.name) {
        parts.push(`readonly name: ${serializeValue(u.name)}`);
      }
      return `{ ${parts.join('; ')} }`;
    })
    .join(', ');
  tableParts.push(`uniques: readonly [${uniques}]`);

  const indexes = table.indexes
    .map((i) => {
      const parts = [`readonly name: ${serializeValue(i.name)}`];
      if (i.prefix !== undefined) {
        parts.push(`readonly prefix: ${serializeValue(i.prefix)}`);
      }
      if (i.columns !== undefined) {
        parts.push(
          `readonly columns: readonly [${i.columns.map((c: string) => serializeValue(c)).join(', ')}]`,
        );
      }
      if (i.expression !== undefined) {
        parts.push(`readonly expression: ${serializeValue(i.expression)}`);
      }
      if (i.where !== undefined) {
        parts.push(`readonly where: ${serializeValue(i.where)}`);
      }
      parts.push(`readonly unique: ${i.unique}`);
      if (i.type !== undefined) {
        parts.push(`readonly type: ${serializeValue(i.type)}`);
      }
      if (i.options !== undefined) {
        parts.push(`readonly options: ${serializeValue(i.options)}`);
      }
      return `{ ${parts.join('; ')} }`;
    })
    .join(', ');
  tableParts.push(`indexes: readonly [${indexes}]`);

  const fks = table.foreignKeys
    .map((fk) => {
      const srcCols = fk.source.columns.map((c: string) => serializeValue(c)).join(', ');
      const tgtCols = fk.target.columns.map((c: string) => serializeValue(c)).join(', ');
      const srcRef = `{ readonly namespaceId: ${serializeNamespaceId(String(fk.source.namespaceId))}; readonly tableName: ${serializeValue(fk.source.tableName)}; readonly columns: readonly [${srcCols}] }`;
      const tgtRef = `{ readonly namespaceId: ${serializeNamespaceId(String(fk.target.namespaceId))}; readonly tableName: ${serializeValue(fk.target.tableName)}; readonly columns: readonly [${tgtCols}] }`;
      const parts = [`readonly source: ${srcRef}`, `readonly target: ${tgtRef}`];
      if (fk.name) {
        parts.push(`readonly name: ${serializeValue(fk.name)}`);
      }
      return `{ ${parts.join('; ')} }`;
    })
    .join(', ');
  tableParts.push(`foreignKeys: readonly [${fks}]`);

  return `{ ${tableParts.join('; ')} }`;
}

function generateTablesMapType(tables: Readonly<Record<string, StorageTable>>): string {
  const tableEntries: string[] = [];
  for (const [tableName, table] of Object.entries(tables).sort(([a], [b]) => a.localeCompare(b))) {
    tableEntries.push(
      `readonly ${serializeObjectKey(tableName)}: ${generateTableLiteralType(table)}`,
    );
  }
  if (tableEntries.length === 0) {
    // Empty namespaces must emit `{}` (whose `keyof` is `never`), not
    // `Record<string, never>` (whose `keyof` is `string`). The latter
    // collapses `Db<C>` to a string-indexed shape and erases literal
    // table-name inference at every consumer site that walks all
    // namespaces (e.g. `db.sql.<tableName>`).
    return '{}';
  }
  return `{ ${tableEntries.join('; ')} }`;
}

function generateStorageNamespacesType(namespaces: SqlStorage['namespaces']): string {
  const entries = Object.entries(namespaces ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return 'Record<string, never>';
  }
  const parts: string[] = [];
  for (const [name, ns] of entries) {
    const kindSuffix = `; ${namespaceSerializedKind(ns)}`;
    const tablesType = generateTablesMapType(
      (ns.entries.table ?? {}) as Readonly<Record<string, StorageTable>>,
    );
    const entriesParts = [`readonly table: ${tablesType}`];
    const valueSetEntries = ns.entries.valueSet;
    if (valueSetEntries !== undefined && Object.keys(valueSetEntries).length > 0) {
      entriesParts.push(`readonly valueSet: ${generateValueSetBlockType(valueSetEntries)}`);
    }
    const valueObjectEntries = ns.entries.valueObject;
    if (valueObjectEntries !== undefined && Object.keys(valueObjectEntries).length > 0) {
      entriesParts.push(
        `readonly valueObject: ${generateValueObjectsDescriptorType(valueObjectEntries)}`,
      );
    }
    const entriesType = `{ ${entriesParts.join('; ')} }`;
    parts.push(
      `readonly ${serializeObjectKey(name)}: { readonly id: ${serializeValue(ns.id)}${kindSuffix}; readonly entries: ${entriesType} }`,
    );
  }
  return `{ ${parts.join('; ')} }`;
}
