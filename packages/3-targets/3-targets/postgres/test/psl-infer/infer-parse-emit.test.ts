import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import {
  computeIndexContentHash,
  formatWireName,
  parseNaming,
} from '@internal/sql-schema-ir/naming';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { assert, describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../../src/core/authoring';
import { type PostgresSchema, postgresCreateNamespace } from '../../src/core/postgres-schema';
import { postgresDataTypeSupport } from '../fixtures/postgres-data-type-support';
import { printPslFromFlat } from './fixtures';

const authoringTypes = {
  Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1', nativeType: 'int4' } },
  Uuid: { kind: 'typeConstructor', output: { codecId: 'pg/uuid@1', nativeType: 'uuid' } },
  Inet: { kind: 'typeConstructor', output: { codecId: 'pg/inet@1', nativeType: 'inet' } },
  Timestamptz: {
    kind: 'typeConstructor',
    output: { codecId: 'pg/timestamptz-temporal@1', nativeType: 'timestamptz' },
  },
  VarChar: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
    output: {
      codecId: 'pg/text@1',
      nativeType: 'varchar',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Numeric: {
    kind: 'typeConstructor',
    args: [
      { kind: 'number', name: 'precision', integer: true, minimum: 1, optional: true },
      {
        kind: 'number',
        name: 'scale',
        integer: true,
        minimum: -1000,
        maximum: 1000,
        optional: true,
      },
    ],
    output: {
      codecId: 'pg/numeric@1',
      nativeType: 'numeric',
      typeParams: {
        precision: { kind: 'arg', index: 0 },
        scale: { kind: 'arg', index: 1 },
      },
    },
  },
  Json: { kind: 'typeConstructor', output: { codecId: 'pg/json@1', nativeType: 'json' } },
  Jsonb: { kind: 'typeConstructor', output: { codecId: 'pg/jsonb@1', nativeType: 'jsonb' } },
} as const satisfies AuthoringTypeNamespace;

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      type: authoringTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
    },
  },
]);

const target = {
  kind: 'target' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
  authoring: { type: authoringTypes },
};

const codecLookup: CodecLookupWithDescriptors = {
  get: () => undefined,
  targetTypesFor: () => undefined,
  renderOutputTypeFor: () => undefined,
  descriptorFor: () => undefined,
};

function parseAndEmit(source: string) {
  const bound = bindPslSchema(source, {
    sourceId: 'infer-parse-emit.test.psl',
    context: {
      composedExtensions: [],
      composedExtensionContracts: new Map(),
      authoringContributions: {
        ...assembled,
        type: { ...authoringTypes, ...assembled.type },
        attributeSpecs: sqlAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup,
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      dataTypes: postgresDataTypeSupport,
      resolvedInputs: [],
      capabilities: {},
    },
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target,
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

describe('Postgres PSL inference round trip', () => {
  it('preserves unparameterized, parameterized, json, and jsonb storage', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        sample: {
          name: 'sample',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            uuid_value: { name: 'uuid_value', nativeType: 'uuid', nullable: false },
            ip_address: { name: 'ip_address', nativeType: 'inet', nullable: false },
            amount: { name: 'amount', nativeType: 'numeric(10,2)', nullable: false },
            bare_amount: { name: 'bare_amount', nativeType: 'numeric', nullable: false },
            json_value: { name: 'json_value', nativeType: 'json', nullable: false },
            jsonb_value: { name: 'jsonb_value', nativeType: 'jsonb', nullable: false },
            occurred_at: { name: 'occurred_at', nativeType: 'timestamptz', nullable: false },
            label: { name: 'label', nativeType: 'varchar(191)', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });

    const inferred = printPslFromFlat(schemaIR);
    expect(inferred).not.toContain('types {');
    expect(inferred).toMatch(/uuidValue\s+Uuid/);
    expect(inferred).toMatch(/ipAddress\s+Inet/);
    expect(inferred).toMatch(/amount\s+Numeric\(10, 2\)/);
    expect(inferred).toMatch(/bareAmount\s+Numeric/);
    expect(inferred).not.toContain('bareAmount Numeric()');
    expect(inferred).toMatch(/jsonValue\s+Json/);
    expect(inferred).toMatch(/jsonbValue\s+Jsonb/);
    expect(inferred).toMatch(/occurredAt\s+Timestamptz/);
    expect(inferred).toMatch(/label\s+VarChar\(191\)/);

    const emitted = parseAndEmit(inferred);
    if (!emitted.ok) {
      assert.fail(JSON.stringify(emitted.failure.diagnostics));
    }

    const storage = emitted.value.storage as SqlStorage;
    const namespace = storage.namespaces['public'] as PostgresSchema;
    expect({ entries: namespace.entries, types: storage.types }).toEqual({
      entries: {
        table: {
          sample: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false, many: false },
              uuid_value: {
                codecId: 'pg/uuid@1',
                nativeType: 'uuid',
                nullable: false,
                many: false,
              },
              ip_address: {
                codecId: 'pg/inet@1',
                nativeType: 'inet',
                nullable: false,
                many: false,
              },
              amount: {
                codecId: 'pg/numeric@1',
                nativeType: 'numeric',
                nullable: false,
                many: false,
                typeParams: { precision: 10, scale: 2 },
              },
              bare_amount: {
                codecId: 'pg/numeric@1',
                nativeType: 'numeric',
                nullable: false,
                many: false,
              },
              json_value: {
                codecId: 'pg/json@1',
                nativeType: 'json',
                nullable: false,
                many: false,
              },
              jsonb_value: {
                codecId: 'pg/jsonb@1',
                nativeType: 'jsonb',
                nullable: false,
                many: false,
              },
              occurred_at: {
                codecId: 'pg/timestamptz-temporal@1',
                nativeType: 'timestamptz',
                nullable: false,
                many: false,
              },
              label: {
                codecId: 'pg/text@1',
                nativeType: 'varchar',
                nullable: false,
                many: false,
                typeParams: { length: 191 },
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      types: undefined,
    });
  });

  it('leaves out an exact-named index whose where would not read back and keeps a wire-named one by name', () => {
    const where = '(owner_id > 0)\n';
    const wireName = formatWireName(
      'sample_owner_idx',
      computeIndexContentHash({ columns: ['owner_id'], where, unique: false }),
    );
    const partialIndex = (name: string) => ({
      naming: parseNaming(name, undefined),
      columns: ['owner_id'],
      where,
      unique: false,
      partial: true,
      type: undefined,
      options: undefined,
      annotations: undefined,
      dependsOn: undefined,
    });
    const schemaIR = new SqlSchemaIR({
      tables: {
        sample: {
          name: 'sample',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            owner_id: { name: 'owner_id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [partialIndex('sample_adopted'), partialIndex(wireName)],
        },
      },
    });

    const inferred = printPslFromFlat(schemaIR);
    expect(inferred).toContain(
      '// prisma: skipped index "sample_adopted": its SQL cannot be written as a sql literal that reads back unchanged. It is not in this schema, so migration plan will drop it. A sql literal written by hand holds different text, so migration plan then stops with a conflict for an index or check, or drops and recreates a policy. Either change the SQL in the database to the text of the literal, or add the object without map: or @@map so Prisma names it.',
    );

    const emitted = parseAndEmit(inferred);
    if (!emitted.ok) {
      assert.fail(JSON.stringify(emitted.failure.diagnostics));
    }
    const storage = emitted.value.storage as SqlStorage;
    const namespace = storage.namespaces['public'] as PostgresSchema;
    expect(namespace.entries.table?.['sample']?.indexes).toEqual([
      {
        columns: ['owner_id'],
        where: '(owner_id > 0)',
        prefix: 'sample_owner_idx',
        name: wireName,
        unique: false,
      },
    ]);
  });
});
