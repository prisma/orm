import { ContractValidationError } from '@internal/contract/contract-validation-error';
import {
  type Contract,
  type ContractField,
  type ContractModel,
  CrossReferenceSchema,
} from '@internal/contract/types';
import { validateContractDomain } from '@internal/contract/validate-domain';
import {
  type AnyEntityKindDescriptor,
  isPlainRecord,
  type Namespace,
} from '@internal/framework-components/ir';
import { computeCheckContentHash, computeIndexContentHash } from '@internal/sql-schema-ir/naming';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { type Type, type } from 'arktype';
import { contractError } from './contract-errors';
import { composeSqlEntityKinds } from './entity-kinds';
import { resolveSqlToOneRelationStorage } from './relation-storage';

export {
  CheckConstraintSchema,
  ColumnDefaultFunctionSchema,
  ColumnDefaultLiteralSchema,
  ColumnDefaultSchema,
  ForeignKeyReferenceSchema,
  ForeignKeySchema,
  ForeignKeySourceSchema,
  IndexSchema,
  ReferentialActionSchema,
  StorageTableSchema,
  StorageValueSetSchema,
} from './ir/storage-entry-schemas';

import type {
  CheckConstraint,
  Index,
  SqlModelStorage,
  SqlStorage,
  StorageColumn,
  StorageTable,
  StorageTypeInstanceInput,
} from './types';

const generatorKindSchema = type("'generator'");
const ControlPolicySchema = type("'managed' | 'tolerated' | 'external' | 'observed'");
const generatorIdSchema = type('string').narrow((value, ctx) => {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) ? true : ctx.mustBe('a flat generator id');
});

const ExecutionMutationDefaultValueSchema = type({
  '+': 'reject',
  kind: generatorKindSchema,
  id: generatorIdSchema,
  'params?': 'Record<string, unknown>',
});

const ExecutionMutationDefaultSchema = type({
  '+': 'reject',
  ref: {
    '+': 'reject',
    namespace: 'string',
    table: 'string',
    column: 'string',
  },
  'onCreate?': ExecutionMutationDefaultValueSchema,
  'onUpdate?': ExecutionMutationDefaultValueSchema,
});

const ExecutionSchema = type({
  '+': 'reject',
  executionHash: 'string',
  mutations: {
    '+': 'reject',
    defaults: ExecutionMutationDefaultSchema.array().readonly(),
  },
});

const DomainEnumRefSchema = type({
  plane: "'domain'",
  namespaceId: 'string',
  entityKind: "'enum'",
  entityName: 'string',
  'spaceId?': 'string',
});

/**
 * Codec-triple entry persisted under `storage.types[name]`. Carries an
 * enumerable literal `kind: 'codec-instance'` discriminator so the
 * polymorphic slot dispatch can distinguish codec triples from
 * class-instance kinds (e.g. `'postgres-enum'`) sharing the slot.
 */
const StorageTypeInstanceSchema = type
  .declare<StorageTypeInstanceInput & { kind: 'codec-instance' }>()
  .type({
    kind: "'codec-instance'",
    codecId: 'string',
    nativeType: 'string',
    'typeParams?': 'Record<string, unknown>',
  });

/** Document-scoped `storage.types`: codec triples only. */
const DocumentScopedStorageTypeSchema = StorageTypeInstanceSchema;

/**
 * Domain enum entry under `domain.namespaces[id].enum[name]`.
 * Carries the codec id and an ordered `members` array of `{name, value}` pairs.
 */
export const ContractEnumSchema = type({
  '+': 'reject',
  codecId: 'string',
  members: type({
    name: 'string',
    value: 'string | number | boolean | null | unknown[] | Record<string, unknown>',
  })
    .array()
    .readonly(),
});

/**
 * Derives a schema map from a descriptor map: maps each kind's key to its
 * `schema` field. Used by validation functions to validate entries.
 */
function schemaViewOf(
  kinds: ReadonlyMap<string, AnyEntityKindDescriptor>,
): ReadonlyMap<string, Type<unknown>> {
  return new Map([...kinds].map(([k, d]) => [k, d.schema]));
}

const DEFAULT_SQL_KINDS = composeSqlEntityKinds();

/**
 * Builds the per-namespace entry schema for `storage.namespaces[id]`.
 *
 * Validation is descriptor-driven: the `kinds` map carries both the schema
 * (used here for structural validation) and the construct function (used at
 * hydration time). An unregistered key fails validation naming the kind and
 * the namespace id, so validation fails closed.
 */
export function createNamespaceEntrySchema(
  kinds: ReadonlyMap<string, AnyEntityKindDescriptor>,
): Type<unknown> {
  const schemas = schemaViewOf(kinds);
  const knownKinds = new Set(kinds.keys());
  return type({
    '+': 'reject',
    id: 'string',
    'kind?': 'string',
    entries: 'object',
  }).narrow((ns, ctx) => {
    if (!isPlainRecord(ns.entries)) {
      return ctx.mustBe('an entries object');
    }
    for (const [key, innerMap] of Object.entries(ns.entries)) {
      if (!knownKinds.has(key)) {
        return ctx.reject({
          expected: `entries key "${key}" in namespace "${ns.id}" is not a registered entity kind`,
        });
      }
      if (!isPlainRecord(innerMap)) {
        return ctx.reject({
          expected: `entries["${key}"] in namespace "${ns.id}" must be an object`,
        });
      }
      const entrySchema = blindCast<
        Type<unknown>,
        'knownKinds.has(key) guarantees schemas.get(key) is defined'
      >(schemas.get(key));
      for (const [, value] of Object.entries(innerMap)) {
        const parsed = entrySchema(value);
        if (parsed instanceof type.errors) {
          return ctx.reject({ expected: parsed.summary });
        }
      }
    }
    return true;
  }) as Type<unknown>;
}

/**
 * Builds the storage schema. Pack contributions reach the per-namespace
 * entry shape through {@link createNamespaceEntrySchema}; the
 * document-scoped `storage.types` field (codec triples only) and the
 * storage hash stay family-shared.
 */
export function createSqlStorageSchema(
  kinds: ReadonlyMap<string, AnyEntityKindDescriptor>,
): Type<unknown> {
  const namespaceEntry = createNamespaceEntrySchema(kinds);
  return type({
    '+': 'reject',
    storageHash: 'string',
    'types?': type({ '[string]': DocumentScopedStorageTypeSchema }),
    // `__unbound__` is NOT required here: cross-namespace contracts can
    // declare only named namespaces (see cross-namespace FK fixtures). The
    // unbound slot is injected when absent by `ensureUnboundNamespaceSlot`
    // in `build-contract.ts`, not enforced here structurally.
    'namespaces?': type({ '[string]': namespaceEntry }),
  }) as Type<unknown>;
}

const StorageSchema = createSqlStorageSchema(DEFAULT_SQL_KINDS);

type NamespacedStorageWalk = {
  readonly namespaces: Readonly<
    Record<
      string,
      Namespace & { readonly entries: Readonly<Record<string, Readonly<Record<string, unknown>>>> }
    >
  >;
};

/**
 * Any entries entity that declares both a `tableName` and a physical `name`
 * (e.g. a target's RLS policy entities) shares one physical-name space per
 * table: two such entries of one kind on the same table would collide as
 * DDL (`CREATE POLICY "<name>" ON <table>` fails on the second), while the
 * same name on different tables is legal. Structural — no entry-kind
 * vocabulary; `table` entries are keyed by name already and are excluded.
 */
function validateTableScopedEntryNames(storage: SqlStorage, errors: string[]): void {
  for (const [namespaceId, ns] of Object.entries(storage.namespaces)) {
    if (!isPlainRecord(ns.entries)) continue;
    for (const [entriesKind, slot] of Object.entries(ns.entries)) {
      if (entriesKind === 'table' || !isPlainRecord(slot)) continue;
      const seen = new Map<string, number>();
      for (const entity of Object.values(slot)) {
        // Entities are IR class instances here (and plain records on the
        // deserialize path) — read structurally, not via a plain-record guard.
        if (typeof entity !== 'object' || entity === null) continue;
        const record = blindCast<
          Record<string, unknown>,
          'structural read of an entries entity (class instance or plain record); only string-typed name/tableName are consumed'
        >(entity);
        const name = record['name'];
        const tableName = record['tableName'];
        if (typeof name !== 'string' || typeof tableName !== 'string') continue;
        const key = `${tableName} ${name}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        if (seen.get(key) === 2) {
          errors.push(
            `Namespace "${namespaceId}" table "${tableName}": ${entriesKind} "${name}" is declared multiple times`,
          );
        }
      }
    }
  }
}

function eachStorageTable(storage: NamespacedStorageWalk) {
  return Object.entries(storage.namespaces).flatMap(([namespaceId, ns]) =>
    Object.entries(ns.entries['table'] ?? {}).map(([tableName, table]) => ({
      namespaceId,
      tableName,
      table,
    })),
  );
}

function findDuplicateValue(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return undefined;
}

/** A column may appear at most once in one index's element tuple. */
function rejectRepeatedIndexColumns(
  indexes: readonly Index[],
  coordinate: string,
  errors: string[],
): void {
  for (const index of indexes) {
    const duplicateColumn = findDuplicateValue(index.columns ?? []);
    if (duplicateColumn !== undefined) {
      errors.push(`${coordinate}: index contains duplicate column "${duplicateColumn}"`);
    }
  }
}

/**
 * Two wire-named indexes with the same content are one index written twice —
 * the content hash is their identity, so neither spelling can survive. An
 * exact-named index is identified by its name instead, so content twins under
 * two names are legal and a repeated name is rejected by the named-object
 * check.
 */
function rejectDuplicateWireNamedIndexContent(
  indexes: readonly Index[],
  coordinate: string,
  errors: string[],
): void {
  const seenContent = new Set<string>();
  for (const index of indexes) {
    if (index.prefix === undefined) continue;
    const content = computeIndexContentHash(index);
    if (seenContent.has(content)) {
      errors.push(
        `${coordinate}: duplicate index definition on columns [${(index.columns ?? []).join(', ')}]`,
      );
      continue;
    }
    seenContent.add(content);
  }
}

/**
 * Two wire-named checks with the same predicate are one check written twice —
 * the content hash is their identity, so neither spelling can survive, and
 * whitespace variants of one predicate collapse onto the same hash. An
 * exact-named check is identified by its name instead, so content twins under
 * two names are legal (the legacy shape a database adopts from) and a repeated
 * name is rejected by the named-object check.
 */
function rejectDuplicateWireNamedCheckContent(
  checks: readonly CheckConstraint[],
  coordinate: string,
  errors: string[],
): void {
  const seenContent = new Set<string>();
  for (const check of checks) {
    if (check.prefix === undefined) continue;
    const content = computeCheckContentHash(check.expression);
    if (seenContent.has(content)) {
      errors.push(
        `${coordinate}: duplicate check constraint definition (expression "${check.expression}")`,
      );
      continue;
    }
    seenContent.add(content);
  }
}

function isContractFieldType(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  const kind = value['kind'];
  if (kind === 'scalar') {
    if (typeof value['codecId'] !== 'string') return false;
    const typeParams = value['typeParams'];
    if (typeParams !== undefined && !isPlainRecord(typeParams)) return false;
    return true;
  }
  if (kind === 'valueObject') {
    return typeof value['name'] === 'string';
  }
  if (kind === 'union') {
    const members = value['members'];
    if (!Array.isArray(members)) return false;
    return members.every((m) => isContractFieldType(m));
  }
  return false;
}

const ContractFieldTypeSchema = type('unknown').narrow((value, ctx) =>
  isContractFieldType(value) ? true : ctx.mustBe('scalar, valueObject, or union field type'),
);

const ModelFieldSchema = type({
  '+': 'reject',
  nullable: 'boolean',
  type: ContractFieldTypeSchema,
  'many?': 'true',
  'dict?': 'true',
  'valueSet?': DomainEnumRefSchema,
});

const ModelStorageFieldSchema = type({
  column: 'string',
  'codecId?': 'string',
  'nullable?': 'boolean',
});

const ModelStorageSchema = type({
  table: 'string',
  namespaceId: 'string',
  fields: type({ '[string]': ModelStorageFieldSchema }),
});

const ContractRelationThroughSchema = type({
  '+': 'reject',
  table: 'string',
  namespaceId: 'string',
  parentColumns: type.string.array().readonly(),
  childColumns: type.string.array().readonly(),
  targetColumns: type.string.array().readonly(),
});

const ContractRelationOnSchema = type({
  '+': 'reject',
  localFields: type.string.array().readonly(),
  targetFields: type.string.array().readonly(),
});

const ContractManyToManyRelationSchema = type({
  '+': 'reject',
  to: CrossReferenceSchema,
  cardinality: "'N:M'",
  on: ContractRelationOnSchema,
  through: ContractRelationThroughSchema,
});

const ContractToOneRelationSchema = type({
  '+': 'reject',
  to: CrossReferenceSchema,
  cardinality: "'1:1' | 'N:1'",
  'nullable?': 'boolean',
  on: ContractRelationOnSchema,
});

const ContractToManyRelationSchema = type({
  '+': 'reject',
  to: CrossReferenceSchema,
  cardinality: "'1:N'",
  on: ContractRelationOnSchema,
});

const ContractReferenceRelationSchema = ContractManyToManyRelationSchema.or(
  ContractToOneRelationSchema,
).or(ContractToManyRelationSchema);

const ContractEmbedRelationSchema = type({
  '+': 'reject',
  to: CrossReferenceSchema,
  cardinality: "'1:1' | '1:N'",
});

const ContractRelationSchema = ContractReferenceRelationSchema.or(ContractEmbedRelationSchema);

const ModelSchema = type({
  storage: ModelStorageSchema,
  'fields?': type({ '[string]': ModelFieldSchema }),
  'relations?': type({ '[string]': ContractRelationSchema }),
  'discriminator?': 'unknown',
  'variants?': 'unknown',
  'base?': CrossReferenceSchema,
  'owner?': 'string',
});

const ContractMetaSchema = type({
  '[string]': 'unknown',
});

/**
 * Builds the full SQL contract schema. The storage subtree threads
 * pack contributions through {@link createSqlStorageSchema}; the rest
 * of the contract envelope is family-shared.
 */
export function createSqlContractSchema(
  kinds: ReadonlyMap<string, AnyEntityKindDescriptor>,
): Type<unknown> {
  const storage = createSqlStorageSchema(kinds);
  return type({
    '+': 'reject',
    target: 'string',
    targetFamily: "'sql'",
    'coreHash?': 'string',
    profileHash: 'string',
    'capabilities?': 'Record<string, Record<string, boolean>>',
    'extensions?': 'Record<string, unknown>',
    'meta?': ContractMetaSchema,
    'defaultControlPolicy?': ControlPolicySchema,
    'roots?': type({ '[string]': CrossReferenceSchema }),
    domain: type({
      namespaces: type({
        '[string]': type({
          models: type({ '[string]': ModelSchema }),
          'valueObjects?': 'Record<string, unknown>',
          'enum?': type({ '[string]': ContractEnumSchema }),
        }),
      }),
    }),
    storage,
    'execution?': ExecutionSchema,
  }) as Type<unknown>;
}

const SqlContractSchema = createSqlContractSchema(DEFAULT_SQL_KINDS);

/**
 * Validates the structural shape of SqlStorage using Arktype. Pure
 * structural check: namespace IR is never materialized here (that needs
 * a target concretion via the serializer hydration path), so this throws
 * on invalid input and constructs nothing.
 *
 * @param value - The storage value to validate
 * @throws Error if the storage structure is invalid
 */
export function validateStorage(value: unknown): void {
  const result = StorageSchema(value);
  if (result instanceof type.errors) {
    const errors = result.map((p: { message: string }) => p.message);
    throw contractError(
      'CONTRACT.VALIDATION_FAILED',
      `Storage validation failed: ${errors.join('; ')}`,
      {
        meta: { errors },
      },
    );
  }
}

export function validateModel(value: unknown): unknown {
  const result = ModelSchema(value);
  if (result instanceof type.errors) {
    const errors = result.map((p: { message: string }) => p.message);
    throw contractError(
      'CONTRACT.VALIDATION_FAILED',
      `Model validation failed: ${errors.join('; ')}`,
      {
        meta: { errors },
      },
    );
  }
  return result;
}

/**
 * Structural arktype validation of an SQL contract envelope. Internal
 * helper for {@link validateSqlContractFully} — exposed only inside
 * this module, since the family seam-of-record is the
 * `SqlContractSerializerBase.deserializeContract` SPI.
 */
function validateSqlContractStructure<T extends Contract<SqlStorage>>(
  value: unknown,
  contractSchema: Type<unknown>,
): T {
  if (typeof value !== 'object' || value === null) {
    throw new ContractValidationError(
      'Contract structural validation failed: value must be an object',
      'structural',
    );
  }

  const rawValue = value as { targetFamily?: string };
  if (rawValue.targetFamily !== undefined && rawValue.targetFamily !== 'sql') {
    throw new ContractValidationError(
      `Unsupported target family: ${rawValue.targetFamily}`,
      'structural',
    );
  }

  const contractResult = contractSchema(value);

  if (contractResult instanceof type.errors) {
    const messages = contractResult.map((p: { message: string }) => p.message).join('; ');
    throw new ContractValidationError(
      `Contract structural validation failed: ${messages}`,
      'structural',
    );
  }

  // Arktype's inferred output type differs from T due to exactOptionalPropertyTypes
  // and branded hash types — the runtime value is structurally compatible after validation
  return contractResult as unknown as T;
}

/**
 * Validates semantic constraints on SqlStorage that cannot be expressed in Arktype schemas.
 *
 * Returns an array of human-readable error strings. Empty array = valid.
 *
 * Currently checks:
 * - duplicate named primary key / unique / index / foreign key objects within a table
 * - duplicate unique, index, or foreign key declarations within a table
 * - duplicate columns within primary key / unique / index definitions
 * - nullable columns in primary key definitions
 * - `setNull` referential action on a non-nullable FK column (would fail at runtime)
 * - `setDefault` referential action on a non-nullable FK column without a DEFAULT (would fail at runtime)
 */
export function validateStorageSemantics(storage: SqlStorage): string[] {
  const errors: string[] = [];

  validateTableScopedEntryNames(storage, errors);

  for (const { namespaceId, tableName, table: rawTable } of eachStorageTable(storage)) {
    const table = rawTable as StorageTable;
    const namedObjects = new Map<string, string[]>();
    const registerNamedObject = (kind: string, name: string | undefined) => {
      if (!name) return;
      namedObjects.set(name, [...(namedObjects.get(name) ?? []), kind]);
    };

    registerNamedObject('primary key', table.primaryKey?.name);
    for (const unique of table.uniques) {
      registerNamedObject('unique constraint', unique.name);
    }
    for (const index of table.indexes) {
      registerNamedObject('index', index.name);
    }
    for (const fk of table.foreignKeys) {
      registerNamedObject('foreign key', fk.name);
    }
    for (const check of table.checks ?? []) {
      registerNamedObject('check constraint', check.name);
    }

    for (const [name, kinds] of namedObjects) {
      if (kinds.length > 1) {
        errors.push(
          `Namespace "${namespaceId}" table "${tableName}": named object "${name}" is declared multiple times (${kinds.join(', ')})`,
        );
      }
    }

    if (table.primaryKey) {
      const duplicateColumn = findDuplicateValue(table.primaryKey.columns);
      if (duplicateColumn !== undefined) {
        errors.push(
          `Namespace "${namespaceId}" table "${tableName}": primary key contains duplicate column "${duplicateColumn}"`,
        );
      }

      for (const columnName of table.primaryKey.columns) {
        const column = table.columns[columnName];
        if (column?.nullable === true) {
          errors.push(
            `Namespace "${namespaceId}" table "${tableName}": primary key column "${columnName}" is nullable; primary key columns must be NOT NULL`,
          );
        }
      }
    }

    const seenUniqueDefinitions = new Set<string>();
    for (const unique of table.uniques) {
      const duplicateColumn = findDuplicateValue(unique.columns);
      if (duplicateColumn !== undefined) {
        errors.push(
          `Namespace "${namespaceId}" table "${tableName}": unique constraint contains duplicate column "${duplicateColumn}"`,
        );
      }

      const signature = JSON.stringify({ columns: unique.columns });
      if (seenUniqueDefinitions.has(signature)) {
        errors.push(
          `Namespace "${namespaceId}" table "${tableName}": duplicate unique constraint definition on columns [${unique.columns.join(', ')}]`,
        );
        continue;
      }
      seenUniqueDefinitions.add(signature);
    }

    const tableCoordinate = `Namespace "${namespaceId}" table "${tableName}"`;
    rejectRepeatedIndexColumns(table.indexes, tableCoordinate, errors);
    rejectDuplicateWireNamedIndexContent(table.indexes, tableCoordinate, errors);

    const seenForeignKeyDefinitions = new Set<string>();
    for (const fk of table.foreignKeys) {
      const signature = JSON.stringify({
        source: fk.source,
        target: fk.target,
        onDelete: fk.onDelete ?? null,
        onUpdate: fk.onUpdate ?? null,
      });
      if (seenForeignKeyDefinitions.has(signature)) {
        errors.push(
          `Namespace "${namespaceId}" table "${tableName}": duplicate foreign key definition on columns [${fk.source.columns.join(', ')}]`,
        );
        continue;
      }
      seenForeignKeyDefinitions.add(signature);
    }

    for (const fk of table.foreignKeys) {
      for (const colName of fk.source.columns) {
        const column = table.columns[colName];
        if (!column) continue;

        if (fk.onDelete === 'setNull' && !column.nullable) {
          errors.push(
            `Namespace "${namespaceId}" table "${tableName}": onDelete setNull on foreign key column "${colName}" which is NOT NULL`,
          );
        }
        if (fk.onUpdate === 'setNull' && !column.nullable) {
          errors.push(
            `Namespace "${namespaceId}" table "${tableName}": onUpdate setNull on foreign key column "${colName}" which is NOT NULL`,
          );
        }
        if (fk.onDelete === 'setDefault' && !column.nullable && column.default === undefined) {
          errors.push(
            `Namespace "${namespaceId}" table "${tableName}": onDelete setDefault on foreign key column "${colName}" which is NOT NULL and has no DEFAULT`,
          );
        }
        if (fk.onUpdate === 'setDefault' && !column.nullable && column.default === undefined) {
          errors.push(
            `Namespace "${namespaceId}" table "${tableName}": onUpdate setDefault on foreign key column "${colName}" which is NOT NULL and has no DEFAULT`,
          );
        }
      }
    }

    rejectDuplicateWireNamedCheckContent(table.checks ?? [], tableCoordinate, errors);
  }

  return errors;
}

/**
 * SQL storage logical-consistency checks: every model.storage.table
 * resolves to a real table, every model.storage.fields[*].column
 * resolves to a real column, and value-object fields land on JSON-native
 * columns. Throws `ContractValidationError` on the first mismatch.
 */
export function validateModelStorageReferences(contract: Contract<SqlStorage>): void {
  for (const [namespaceId, namespace] of Object.entries(contract.domain.namespaces)) {
    const models = namespace.models as Record<string, ContractModel<SqlModelStorage>>;
    for (const [modelName, model] of Object.entries(models)) {
      const qualifiedName = `${namespaceId}:${modelName}`;
      const storageNamespaceId = model.storage.namespaceId;
      if (storageNamespaceId !== namespaceId) {
        throw new ContractValidationError(
          `Model "${qualifiedName}" storage.namespaceId "${storageNamespaceId}" does not match domain namespace "${namespaceId}"`,
          'storage',
        );
      }

      const storageTable = model.storage.table;
      const storageNs = contract.storage.namespaces[storageNamespaceId];
      const rawTable = storageNs?.entries.table?.[storageTable];
      if (rawTable === undefined) {
        throw new ContractValidationError(
          `Model "${qualifiedName}" references non-existent table "${storageNamespaceId}.${storageTable}"`,
          'storage',
        );
      }

      const table = rawTable as StorageTable;

      const columnNames = new Set(Object.keys(table.columns));
      for (const [fieldName, field] of Object.entries(model.storage.fields)) {
        if (!columnNames.has(field.column)) {
          throw new ContractValidationError(
            `Model "${qualifiedName}" field "${fieldName}" references non-existent column "${field.column}" in table "${storageTable}"`,
            'storage',
          );
        }
      }

      const JSON_NATIVE_TYPES = new Set(['json', 'jsonb']);
      for (const [fieldName, domainField] of Object.entries(model.fields ?? {})) {
        const f = domainField as ContractField;
        if (f.type?.kind !== 'valueObject') continue;
        const storageField = model.storage.fields[fieldName];
        if (!storageField) continue;
        const column = table.columns[storageField.column];
        if (!column) continue;
        if (!JSON_NATIVE_TYPES.has(column.nativeType)) {
          throw new ContractValidationError(
            `Model "${qualifiedName}" field "${fieldName}" is a value object but storage column "${storageField.column}" has nativeType "${column.nativeType}" (expected json or jsonb)`,
            'storage',
          );
        }
      }
    }
  }
}

/**
 * Cross-table consistency checks for SQL storage: primary key, unique,
 * index, and foreign key column references resolve to real columns;
 * NOT NULL columns don't carry a literal `null` default; FK column
 * counts match their referenced columns. Throws on the first mismatch.
 */
export function validateSqlStorageConsistency(contract: Contract<SqlStorage>): void {
  for (const { namespaceId, tableName, table: rawTable } of eachStorageTable(contract.storage)) {
    const table = rawTable as StorageTable;
    const columnNames = new Set(Object.keys(table.columns));

    if (table.primaryKey) {
      for (const colName of table.primaryKey.columns) {
        if (!columnNames.has(colName)) {
          throw new ContractValidationError(
            `Namespace "${namespaceId}" table "${tableName}" primaryKey references non-existent column "${colName}"`,
            'storage',
          );
        }
      }
    }

    for (const unique of table.uniques) {
      for (const colName of unique.columns) {
        if (!columnNames.has(colName)) {
          throw new ContractValidationError(
            `Namespace "${namespaceId}" table "${tableName}" unique constraint references non-existent column "${colName}"`,
            'storage',
          );
        }
      }
    }

    for (const index of table.indexes) {
      for (const colName of index.columns ?? []) {
        if (!columnNames.has(colName)) {
          throw new ContractValidationError(
            `Namespace "${namespaceId}" table "${tableName}" index references non-existent column "${colName}"`,
            'storage',
          );
        }
      }
    }

    for (const [colName, column] of Object.entries(table.columns)) {
      if (!column.nullable && column.default?.kind === 'literal' && column.default.value === null) {
        throw new ContractValidationError(
          `Namespace "${namespaceId}" table "${tableName}" column "${colName}" is NOT NULL but has a literal null default`,
          'storage',
        );
      }
    }

    for (const fk of table.foreignKeys) {
      if (fk.source.namespaceId !== namespaceId || fk.source.tableName !== tableName) {
        throw new ContractValidationError(
          `Namespace "${namespaceId}" table "${tableName}" contains foreignKey with mismatched source coordinates (${fk.source.namespaceId}.${fk.source.tableName})`,
          'storage',
        );
      }

      for (const colName of fk.source.columns) {
        if (!columnNames.has(colName)) {
          throw new ContractValidationError(
            `Namespace "${namespaceId}" table "${tableName}" foreignKey references non-existent column "${colName}"`,
            'storage',
          );
        }
      }

      if (fk.target.spaceId === undefined) {
        const targetNamespace = contract.storage.namespaces[fk.target.namespaceId];
        const referencedRaw = targetNamespace?.entries.table?.[fk.target.tableName];
        if (referencedRaw === undefined) {
          throw new ContractValidationError(
            `Namespace "${namespaceId}" table "${tableName}" foreignKey references non-existent table "${fk.target.namespaceId}.${fk.target.tableName}"`,
            'storage',
          );
        }
        const referencedTable = referencedRaw as StorageTable;
        const referencedColumnNames = new Set(Object.keys(referencedTable.columns));
        for (const colName of fk.target.columns) {
          if (!referencedColumnNames.has(colName)) {
            throw new ContractValidationError(
              `Namespace "${namespaceId}" table "${tableName}" foreignKey references non-existent column "${colName}" in table "${fk.target.tableName}"`,
              'storage',
            );
          }
        }
      }

      if (fk.source.columns.length !== fk.target.columns.length) {
        throw new ContractValidationError(
          `Namespace "${namespaceId}" table "${tableName}" foreignKey column count (${fk.source.columns.length}) does not match referenced column count (${fk.target.columns.length})`,
          'storage',
        );
      }
    }
  }
}

export interface ValidateSqlContractFullyOptions {
  /**
   * Precomputed structural schema to validate against. Built once at
   * serializer construction time when the family `ContractSerializer`
   * has folded pack-contributed `validatorSchema` fragments into the
   * per-namespace entry shape; absent for the family-default validator
   * path (no pack contributions). Falls back to the cached default
   * `SqlContractSchema` when omitted.
   */
  readonly contractSchema?: Type<unknown>;
}

/**
 * Full SQL contract validation: structural (arktype) +
 * framework-shared domain + SQL storage logical-consistency + SQL
 * storage semantic + model ↔ storage reference checks. Throws
 * `ContractValidationError` on the first failure. Returns the
 * validated flat-data shape; IR class hydration happens in the SPI
 * base on top of this helper.
 */
export function validateSqlContractFully<T extends Contract<SqlStorage>>(
  value: unknown,
  options?: ValidateSqlContractFullyOptions,
): T {
  const stripped =
    typeof value === 'object' && value !== null
      ? (() => {
          const { schemaVersion: _, _generated: _g, ...rest } = value as Record<string, unknown>;
          return rest;
        })()
      : value;
  const schema = options?.contractSchema ?? SqlContractSchema;
  const validated = validateSqlContractStructure<T>(stripped, schema);
  validateContractDomain({
    roots: validated.roots,
    domain: validated.domain,
  });
  validateSqlStorageConsistency(validated);
  const semanticErrors = validateStorageSemantics(validated.storage);
  if (semanticErrors.length > 0) {
    throw new ContractValidationError(
      `Contract semantic validation failed: ${semanticErrors.join('; ')}`,
      'storage',
    );
  }
  validateModelStorageReferences(validated);
  validateRelationThroughConsistency(validated);
  validateToOneRelationNullabilityAgainstStorage(validated);
  return validated;
}

/**
 * A same-space to-one relation that states `nullable` must agree with its local FK columns:
 * nullable exactly when one of them is nullable (a column that cannot be resolved counts as
 * nullable). A relation without the flag is left to hydration, which derives it the same way.
 */
function validateToOneRelationNullabilityAgainstStorage(contract: Contract<SqlStorage>): void {
  for (const [namespaceId, namespace] of Object.entries(contract.domain.namespaces)) {
    for (const [modelName, model] of Object.entries(namespace.models)) {
      const storage = blindCast<SqlModelStorage, 'SQL contract model storage'>(model.storage);
      for (const [relationName, relation] of Object.entries(model.relations)) {
        const isSameSpaceToOne =
          'on' in relation &&
          (relation.cardinality === '1:1' || relation.cardinality === 'N:1') &&
          relation.to.space === undefined;
        if (!isSameSpaceToOne || relation.nullable === undefined) continue;
        const location = `Relation "${relationName}" on model "${namespaceId}:${modelName}"`;
        const { ownsForeignKey, columns } = resolveSqlToOneRelationStorage(
          contract,
          storage,
          relation,
        );
        if (!ownsForeignKey) {
          if (relation.nullable) continue;
          throw new ContractValidationError(
            `${location} is required but does not own the foreign key, so nothing in storage guarantees the related row exists`,
            'storage',
          );
        }
        const anyNullable = columns.some((column) => column.nullable);
        if (relation.nullable === anyNullable) continue;
        const columnList = columns
          .filter((column) => column.nullable !== relation.nullable)
          .map((column) => `"${column.name}"`)
          .join(', ');
        throw new ContractValidationError(
          relation.nullable
            ? `${location} is nullable but every local FK column is NOT NULL (columns ${columnList})`
            : `${location} is required but a local FK column is nullable (columns ${columnList})`,
          'storage',
        );
      }
    }
  }
}

/** Storage column lookup for through-consistency validation. */
function lookupStorageColumn(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  columnName: string,
): StorageColumn | undefined {
  const rawTable = contract.storage.namespaces[namespaceId]?.entries.table?.[tableName];
  if (rawTable === undefined) {
    return undefined;
  }
  const table = blindCast<StorageTable, 'structurally validated storage table'>(rawTable);
  return table.columns[columnName];
}

/**
 * Two storage columns share a type when their `nativeType` and `typeParams`
 * match. The contract is canonicalized, so `typeParams` key order is stable and
 * a JSON comparison is exact. `codecId` and `nullable` are intentionally not
 * compared: they do not change the database-level type that governs a join.
 */
function sameStorageType(a: StorageColumn, b: StorageColumn): boolean {
  return (
    a.nativeType === b.nativeType &&
    JSON.stringify(a.typeParams ?? null) === JSON.stringify(b.typeParams ?? null)
  );
}

function describeColumnType(column: StorageColumn): string {
  return column.typeParams === undefined
    ? column.nativeType
    : `${column.nativeType} ${JSON.stringify(column.typeParams)}`;
}

/**
 * Validates one side of an N:M join: the junction columns and the model
 * columns they pair against positionally must be equal in number, exist in
 * their tables, and share the same storage type (`nativeType` + `typeParams`).
 * The junction's storage foreign keys already guarantee this for user-declared
 * FK constraints, but `through` is a logical descriptor never tied to them by
 * the rest of validation — and the TS builder accepts explicit join columns
 * without requiring a junction FK at all — so this checks the columns directly
 * against storage, one path regardless of how the junction was authored.
 *
 * Joined columns must be the *same* storage type, not merely compatible:
 * relying on implicit conversion (e.g. `text`↔`character`) is unsafe on writes
 * — `character(n)` space-padding makes such coercions non-associative — and no
 * ADR sanctions heterogeneous junction columns. Equality is the conservative
 * default; it can be relaxed deliberately if a real use case ever appears.
 */
function validateThroughJoinSide(input: {
  readonly contract: Contract<SqlStorage>;
  readonly qualifiedName: string;
  readonly modelColumns: readonly string[];
  readonly modelColumnsLabel: string;
  /**
   * The model side of the join, when resolvable. Absent for a cross-space
   * target whose storage lives in another contract: the length and
   * junction-column-existence checks still run, but the target-column
   * existence and type checks are skipped because the target table is not
   * available here. `fieldToColumn` is present when `modelColumns` are domain
   * field names (the `on.*Fields` arrays), absent when they are already storage
   * column names (the `through.*Columns` arrays).
   */
  readonly model?: {
    readonly namespaceId: string;
    readonly table: string;
    readonly fieldToColumn?: Readonly<Record<string, { readonly column: string }>>;
  };
  readonly junctionColumns: readonly string[];
  readonly junctionColumnsLabel: string;
  readonly junctionNamespaceId: string;
  readonly junctionTable: string;
}): void {
  const fail = (detail: string): ContractValidationError =>
    new ContractValidationError(
      `Many-to-many relation "${input.qualifiedName}" ${detail}`,
      'storage',
    );
  if (input.junctionColumns.length !== input.modelColumns.length) {
    throw fail(
      `pairs ${input.junctionColumnsLabel} (${input.junctionColumns.length}) with ${input.modelColumnsLabel} (${input.modelColumns.length}) of differing length; they join positionally and must match.`,
    );
  }
  for (const [index, junctionColumnName] of input.junctionColumns.entries()) {
    const modelColumnRef = input.modelColumns[index];
    if (modelColumnRef === undefined) {
      continue;
    }
    const junctionColumn = lookupStorageColumn(
      input.contract,
      input.junctionNamespaceId,
      input.junctionTable,
      junctionColumnName,
    );
    if (junctionColumn === undefined) {
      throw fail(
        `${input.junctionColumnsLabel} references column "${junctionColumnName}" absent from junction table "${input.junctionNamespaceId}.${input.junctionTable}".`,
      );
    }
    // Cross-space target: its storage lives in another contract, so the target
    // column's existence and type cannot be checked here. Length and
    // junction-column existence have already been validated above.
    const model = input.model;
    if (model === undefined) {
      continue;
    }
    let modelColumnName = modelColumnRef;
    if (model.fieldToColumn !== undefined) {
      const mapped = model.fieldToColumn[modelColumnRef];
      if (mapped === undefined) {
        throw fail(
          `${input.modelColumnsLabel} references field "${modelColumnRef}" absent from model on table "${model.namespaceId}.${model.table}".`,
        );
      }
      modelColumnName = mapped.column;
    }
    const modelColumn = lookupStorageColumn(
      input.contract,
      model.namespaceId,
      model.table,
      modelColumnName,
    );
    if (modelColumn === undefined) {
      throw fail(
        `${input.modelColumnsLabel} references column "${modelColumnName}" absent from table "${model.namespaceId}.${model.table}".`,
      );
    }
    if (!sameStorageType(junctionColumn, modelColumn)) {
      throw fail(
        `joins "${input.junctionTable}.${junctionColumnName}" (${describeColumnType(junctionColumn)}) with "${model.table}.${modelColumnName}" (${describeColumnType(modelColumn)}) of differing storage type; junction columns must match the type of the column they reference.`,
      );
    }
  }
}

/**
 * Validates that every N:M relation's `through` descriptor is consistent with
 * the storage columns it joins: both join sides match in column count,
 * reference columns that exist in their tables, and pair columns of the same
 * storage type. Without this, a `through` that disagrees with storage surfaces
 * as a silently wrong JOIN at query time rather than a validation error here.
 */
function validateRelationThroughConsistency(contract: Contract<SqlStorage>): void {
  for (const [namespaceId, namespace] of Object.entries(contract.domain.namespaces)) {
    for (const [modelName, model] of Object.entries(namespace.models)) {
      for (const [relationName, relation] of Object.entries(model.relations)) {
        if (relation.cardinality !== 'N:M') continue;
        const qualifiedName = `${namespaceId}.${modelName}.${relationName}`;
        const { on, through } = relation;
        const modelStorage = blindCast<SqlModelStorage, 'SQL contract model storage'>(
          model.storage,
        );
        // Parent side: the owning model's localFields (domain field names) join
        // the junction's parentColumns (storage columns).
        validateThroughJoinSide({
          contract,
          qualifiedName,
          modelColumns: on.localFields,
          modelColumnsLabel: 'on.localFields',
          model: {
            namespaceId,
            table: modelStorage.table,
            fieldToColumn: modelStorage.fields,
          },
          junctionColumns: through.parentColumns,
          junctionColumnsLabel: 'through.parentColumns',
          junctionNamespaceId: through.namespaceId,
          junctionTable: through.table,
        });
        // Child side: the junction's childColumns join the target model's
        // targetColumns. Length and junction-column existence are checked
        // regardless; a cross-space target lives in another contract, so its
        // column existence and type are checked only when it is resolvable here.
        const targetModel =
          relation.to.space === undefined
            ? contract.domain.namespaces[relation.to.namespace]?.models[relation.to.model]
            : undefined;
        const targetModelSide =
          targetModel === undefined
            ? undefined
            : {
                namespaceId: relation.to.namespace,
                table: blindCast<SqlModelStorage, 'SQL contract model storage'>(targetModel.storage)
                  .table,
              };
        validateThroughJoinSide({
          contract,
          qualifiedName,
          modelColumns: through.targetColumns,
          modelColumnsLabel: 'through.targetColumns',
          ...ifDefined('model', targetModelSide),
          junctionColumns: through.childColumns,
          junctionColumnsLabel: 'through.childColumns',
          junctionNamespaceId: through.namespaceId,
          junctionTable: through.table,
        });
      }
    }
  }
}
