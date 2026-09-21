import type {
  Contract,
  ContractModel,
  ContractModelBase,
  JsonValue,
} from '@internal/contract/types';
import {
  renderValueSetType,
  serializeNamespaceId,
  serializeObjectKey,
  serializeValue,
} from '@internal/emitter/domain-type-generation';
import { isSafeTypeExpression } from '@internal/emitter/type-expression-safety';
import type { CodecLookup } from '@internal/framework-components/codec';
import type { AggregateDescriptor } from '@internal/framework-components/components';
import { settleAggregateOverloads } from '@internal/framework-components/components';
import type {
  GenerateContractTypesOptions,
  ImportSpecifierResolver,
  ValidationContext,
} from '@internal/framework-components/emission';
import { entityAt, type Namespace, UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type {
  SqlModelStorage,
  SqlStorage,
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
  StorageValueSet,
} from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { sqlEmitterError, sqlEmitterValidationError } from './errors';

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

  validateTypes(contract: Contract, _ctx: ValidationContext): void {
    const storage = contract.storage as unknown as SqlStorage | undefined;
    if (!storage?.namespaces) {
      return;
    }

    const typeIdRegex = /^([^/]+)\/([^@]+)@(\d+)$/;

    for (const ns of Object.values(storage.namespaces)) {
      for (const [tableName, table] of Object.entries(ns.entries.table ?? {})) {
        for (const [colName, colUnknown] of Object.entries(table.columns)) {
          const col = colUnknown as { codecId?: string };
          const codecId = col.codecId;
          if (!codecId) {
            throw sqlEmitterValidationError(
              `Column "${colName}" in table "${tableName}" is missing codecId`,
              { table: tableName, column: colName },
            );
          }

          const match = codecId.match(typeIdRegex);
          if (!match?.[1]) {
            throw sqlEmitterValidationError(
              `Column "${colName}" in table "${tableName}" has invalid codec ID format "${codecId}". Expected format: ns/name@version`,
              { table: tableName, column: colName, codecId },
            );
          }
        }
      }
    }
  },

  validateStructure(contract: Contract): void {
    if (contract.targetFamily !== 'sql') {
      throw sqlEmitterValidationError(
        `Expected targetFamily "sql", got "${contract.targetFamily}"`,
        { targetFamily: contract.targetFamily },
      );
    }

    const storage = contract.storage as unknown as SqlStorage | undefined;
    if (!storage?.namespaces) {
      throw sqlEmitterValidationError('SQL contract must have storage.namespaces', {});
    }

    const tableNamesSeenAcrossNamespaces = new Map<string, string>();
    for (const [nsId, ns] of Object.entries(storage.namespaces)) {
      for (const tableName of Object.keys(ns.entries.table ?? {})) {
        const existingNs = tableNamesSeenAcrossNamespaces.get(tableName);
        if (existingNs !== undefined && existingNs !== nsId) {
          throw sqlEmitterError(
            'CONTRACT.NAME_DUPLICATE',
            `Duplicate table name "${tableName}" in namespaces "${existingNs}" and "${nsId}"`,
            {
              why: 'Two SQL namespaces declare a table with the same name, which is ambiguous for emission.',
              fix: 'Rename one of the tables so every table name is unique across namespaces.',
              meta: { table: tableName, namespaces: [existingNs, nsId] },
            },
          );
        }
        tableNamesSeenAcrossNamespaces.set(tableName, nsId);
      }
    }

    const tableNames = new Set<string>();
    for (const ns of Object.values(storage.namespaces)) {
      for (const t of Object.keys(ns.entries.table ?? {})) {
        tableNames.add(t);
      }
    }

    for (const [namespaceId, domainNs] of Object.entries(contract.domain.namespaces)) {
      const models = domainNs.models as Record<string, ContractModel<SqlModelStorage>>;
      for (const [modelName, model] of Object.entries(models)) {
        const qualifiedName = `${namespaceId}:${modelName}`;
        if (!model.storage?.table) {
          throw sqlEmitterValidationError(`Model "${qualifiedName}" is missing storage.table`, {
            model: qualifiedName,
          });
        }
        if (!model.storage.namespaceId) {
          throw sqlEmitterValidationError(
            `Model "${qualifiedName}" is missing storage.namespaceId`,
            { model: qualifiedName },
          );
        }
        if (model.storage.namespaceId !== namespaceId) {
          throw sqlEmitterValidationError(
            `Model "${qualifiedName}" storage.namespaceId "${model.storage.namespaceId}" does not match domain namespace "${namespaceId}"`,
            {
              model: qualifiedName,
              storageNamespaceId: model.storage.namespaceId,
              domainNamespaceId: namespaceId,
            },
          );
        }

        const tableName = model.storage.table;
        const table = entityAt<StorageTable>(storage, {
          namespaceId,
          entityKind: 'table',
          entityName: tableName,
        });
        if (!table) {
          throw sqlEmitterValidationError(
            `Model "${qualifiedName}" references non-existent table "${namespaceId}.${tableName}"`,
            { model: qualifiedName, table: `${namespaceId}.${tableName}` },
          );
        }
        const columnNames = new Set(Object.keys(table.columns));
        const storageFields = model.storage.fields;
        if (!storageFields || Object.keys(storageFields).length === 0) {
          throw sqlEmitterValidationError(`Model "${qualifiedName}" is missing storage.fields`, {
            model: qualifiedName,
          });
        }

        for (const [fieldName, field] of Object.entries(storageFields)) {
          if (!field.column) {
            throw sqlEmitterValidationError(
              `Model "${qualifiedName}" field "${fieldName}" is missing column property`,
              { model: qualifiedName, field: fieldName },
            );
          }

          if (!columnNames.has(field.column)) {
            throw sqlEmitterValidationError(
              `Model "${qualifiedName}" field "${fieldName}" references non-existent column "${field.column}" in table "${tableName}"`,
              { model: qualifiedName, field: fieldName, column: field.column, table: tableName },
            );
          }
        }

        if (!model.relations || typeof model.relations !== 'object') {
          throw sqlEmitterValidationError(
            `Model "${qualifiedName}" is missing required field "relations" (must be an object)`,
            { model: qualifiedName },
          );
        }
      }
    }

    for (const ns of Object.values(storage.namespaces)) {
      for (const [tableName, table] of Object.entries(ns.entries.table ?? {})) {
        const columnNames = new Set(Object.keys(table.columns));

        if (!Array.isArray(table.uniques)) {
          throw sqlEmitterValidationError(
            `Table "${tableName}" is missing required field "uniques" (must be an array)`,
            { table: tableName },
          );
        }
        if (!Array.isArray(table.indexes)) {
          throw sqlEmitterValidationError(
            `Table "${tableName}" is missing required field "indexes" (must be an array)`,
            { table: tableName },
          );
        }
        if (!Array.isArray(table.foreignKeys)) {
          throw sqlEmitterValidationError(
            `Table "${tableName}" is missing required field "foreignKeys" (must be an array)`,
            { table: tableName },
          );
        }

        if (table.primaryKey) {
          for (const colName of table.primaryKey.columns) {
            if (!columnNames.has(colName)) {
              throw sqlEmitterValidationError(
                `Table "${tableName}" primaryKey references non-existent column "${colName}"`,
                { table: tableName, column: colName },
              );
            }
          }
        }

        for (const unique of table.uniques) {
          for (const colName of unique.columns) {
            if (!columnNames.has(colName)) {
              throw sqlEmitterValidationError(
                `Table "${tableName}" unique constraint references non-existent column "${colName}"`,
                { table: tableName, column: colName },
              );
            }
          }
        }

        for (const index of table.indexes) {
          for (const colName of index.columns) {
            if (!columnNames.has(colName)) {
              throw sqlEmitterValidationError(
                `Table "${tableName}" index references non-existent column "${colName}"`,
                { table: tableName, column: colName },
              );
            }
          }
        }

        for (const fk of table.foreignKeys) {
          for (const colName of fk.source.columns) {
            if (!columnNames.has(colName)) {
              throw sqlEmitterValidationError(
                `Table "${tableName}" foreignKey references non-existent column "${colName}"`,
                { table: tableName, column: colName },
              );
            }
          }

          const referencedTable = entityAt<StorageTable>(storage, {
            namespaceId: fk.target.namespaceId,
            entityKind: 'table',
            entityName: fk.target.tableName,
          });
          if (!referencedTable) {
            throw sqlEmitterValidationError(
              `Table "${tableName}" foreignKey references non-existent table "${fk.target.tableName}" in namespace "${fk.target.namespaceId}"`,
              {
                table: tableName,
                targetTable: fk.target.tableName,
                targetNamespace: fk.target.namespaceId,
              },
            );
          }

          const referencedColumnNames = new Set(Object.keys(referencedTable.columns));
          for (const colName of fk.target.columns) {
            if (!referencedColumnNames.has(colName)) {
              throw sqlEmitterValidationError(
                `Table "${tableName}" foreignKey references non-existent column "${colName}" in table "${fk.target.tableName}"`,
                { table: tableName, column: colName, targetTable: fk.target.tableName },
              );
            }
          }

          if (fk.source.columns.length !== fk.target.columns.length) {
            throw sqlEmitterValidationError(
              `Table "${tableName}" foreignKey column count (${fk.source.columns.length}) does not match referenced column count (${fk.target.columns.length})`,
              {
                table: tableName,
                sourceColumnCount: fk.source.columns.length,
                targetColumnCount: fk.target.columns.length,
              },
            );
          }
        }
      }
    }
  },

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

  resolveFieldTypeParams(
    _modelName: string,
    fieldName: string,
    model: ContractModelBase,
    contract: Contract,
  ): Record<string, unknown> | undefined {
    const sqlModel = model as ContractModel<SqlModelStorage>;
    const storageField = sqlModel.storage?.fields?.[fieldName];
    if (!storageField) return undefined;

    const storage = contract.storage as unknown as SqlStorage | undefined;
    if (!storage) return undefined;

    const tableName = sqlModel.storage.table;
    const storageNamespaceId = sqlModel.storage.namespaceId;
    if (!storageNamespaceId) return undefined;

    const table = entityAt<StorageTable>(storage, {
      namespaceId: storageNamespaceId,
      entityKind: 'table',
      entityName: tableName,
    });
    if (!table) return undefined;

    const column = table.columns[storageField.column];
    if (!column) return undefined;

    if (column.typeRef) {
      const typeInstance = storage.types?.[column.typeRef];
      if (typeInstance === undefined) return undefined;
      const codecShape = typeInstance as Partial<StorageTypeInstance>;
      return codecShape.typeParams;
    }
    return column.typeParams;
  },

  resolveFieldValueSet(
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
    const outputMap = generateStorageColumnTypesMap(storage, 'output', codecLookup);
    const inputMap = generateStorageColumnTypesMap(storage, 'input', codecLookup);
    return [
      `export type StorageColumnTypes = ${outputMap};`,
      `export type StorageColumnInputTypes = ${inputMap};`,
    ].join('\n');
  },

  getFamilyImports(resolveImportSpecifier: ImportSpecifierResolver): string[] {
    return [
      'import type {',
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

type ColumnTypeSide = 'output' | 'input';

function columnTypeParams(
  storage: SqlStorage,
  column: StorageColumn,
): Record<string, unknown> | undefined {
  if (column.typeRef) {
    const typeInstance = storage.types?.[column.typeRef];
    if (typeInstance === undefined) return undefined;
    return blindCast<
      Partial<StorageTypeInstance>,
      'storage.types entries are codec-instance triples carrying optional typeParams'
    >(typeInstance).typeParams;
  }
  return column.typeParams;
}

function renderRefinedCodecType(
  column: StorageColumn,
  side: ColumnTypeSide,
  params: Record<string, unknown> | undefined,
  codecLookup: CodecLookup | undefined,
): string {
  if (codecLookup && params && Object.keys(params).length > 0) {
    const rendered =
      side === 'output'
        ? codecLookup.renderOutputTypeFor(column.codecId, params)
        : codecLookup.renderInputTypeFor?.(column.codecId, params);
    if (rendered && isSafeTypeExpression(rendered)) {
      return rendered;
    }
  }
  return `CodecTypes[${serializeValue(column.codecId)}][${serializeValue(side)}]`;
}

function computeColumnType(
  storage: SqlStorage,
  column: StorageColumn,
  side: ColumnTypeSide,
  codecLookup: CodecLookup | undefined,
): string {
  let base: string | undefined;
  if (column.valueSet) {
    const valueSet = entityAt<StorageValueSet>(storage, {
      namespaceId: column.valueSet.namespaceId,
      entityKind: column.valueSet.entityKind,
      entityName: column.valueSet.entityName,
    });
    base = valueSet
      ? renderValueSetType(valueSet.values, column.codecId, side, codecLookup)
      : undefined;
  }
  if (base === undefined) {
    base = renderRefinedCodecType(column, side, columnTypeParams(storage, column), codecLookup);
  }
  if (column.many === true) base = `ReadonlyArray<${base}>`;
  return column.nullable ? `${base} | null` : base;
}

function generateStorageColumnTypesMap(
  storage: SqlStorage,
  side: ColumnTypeSide,
  codecLookup: CodecLookup | undefined,
): string {
  const namespaceEntries = Object.entries(storage.namespaces ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (namespaceEntries.length === 0) return 'Record<string, never>';

  const nsParts: string[] = [];
  for (const [nsId, ns] of namespaceEntries) {
    const tables = blindCast<
      Readonly<Record<string, StorageTable>>,
      'same pattern as generateTablesMapType below'
    >(ns.entries.table ?? {});
    const tableEntries = Object.entries(tables).sort(([a], [b]) => a.localeCompare(b));
    const tableParts: string[] = [];

    for (const [tableName, table] of tableEntries) {
      const colEntries = Object.entries(table.columns).sort(([a], [b]) => a.localeCompare(b));
      const colParts: string[] = [];

      for (const [colName, col] of colEntries) {
        const colType = computeColumnType(storage, col, side, codecLookup);
        colParts.push(`readonly ${serializeObjectKey(colName)}: ${colType}`);
      }

      const colMap = colParts.length > 0 ? `{ ${colParts.join('; ')} }` : '{}';
      tableParts.push(`readonly ${serializeObjectKey(tableName)}: ${colMap}`);
    }

    const tableMap = tableParts.length > 0 ? `{ ${tableParts.join('; ')} }` : '{}';
    nsParts.push(`readonly ${serializeObjectKey(nsId)}: ${tableMap}`);
  }

  return `{ ${nsParts.join('; ')} }`;
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
      typeof codecInstanceShape.nativeType !== 'string'
    ) {
      throw sqlEmitterError(
        'CONTRACT.TYPE_UNKNOWN',
        `Unknown storage type kind for "${typeName}" in document-scoped storage.types; expected a codec-instance triple.`,
        {
          why: 'A storage.types entry is not a codec-instance triple, so its column type cannot be emitted.',
          fix: 'Regenerate the contract from its authoring source; storage.types entries must carry codecId and nativeType.',
          meta: { type: typeName },
        },
      );
    }
    const codecId = serializeValue(codecInstanceShape.codecId);
    const nativeType = serializeValue(codecInstanceShape.nativeType);
    const typeParamsStr = serializeTypeParamsLiteral(codecInstanceShape.typeParams);
    typeEntries.push(
      `readonly ${serializeObjectKey(typeName)}: { readonly kind: "codec-instance"; readonly codecId: ${codecId}; readonly nativeType: ${nativeType}; readonly typeParams: ${typeParamsStr} }`,
    );
  }

  return `{ ${typeEntries.join('; ')} }`;
}

/**
 * Literalizes the `valueSet` entries slot — a core SQL entity kind (alongside
 * `table`), not a pack-contributed one, so naming it here isn't a
 * family→target layering leak. This is the only non-`table` entries slot with
 * a type-level consumer (`db.nativeEnums`, `packages/3-extensions/postgres`):
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
    const nativeType = serializeValue(col.nativeType);
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
    const typeRefSpec = col.typeRef ? `; readonly typeRef: ${serializeValue(col.typeRef)}` : '';
    columns.push(
      `readonly ${serializeObjectKey(colName)}: { readonly nativeType: ${nativeType}; readonly codecId: ${codecId}; readonly nullable: ${nullable}${defaultSpec}${typeParamsSpec}${typeRefSpec} }`,
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
    const entriesType = `{ ${entriesParts.join('; ')} }`;
    parts.push(
      `readonly ${serializeObjectKey(name)}: { readonly id: ${serializeValue(ns.id)}${kindSuffix}; readonly entries: ${entriesType} }`,
    );
  }
  return `{ ${parts.join('; ')} }`;
}
