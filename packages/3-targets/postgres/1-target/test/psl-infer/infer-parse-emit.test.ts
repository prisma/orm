import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { EMPTY_GENERATOR_FUNCTIONS } from '@internal/framework-components/components';
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
import { createPostgresBuiltinCodecLookup } from '../../src/core/codec-registry';
import { type PostgresSchema, postgresCreateNamespace } from '../../src/core/postgres-schema';
import { postgresScalarAndNativeTypeConstructors } from '../../src/core/type-constructors';
import { postgresDataTypeSupport } from '../fixtures/postgres-data-type-support';
import { printPslFromFlat } from './fixtures';

const authoringTypes: AuthoringTypeNamespace = postgresScalarAndNativeTypeConstructors;

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

const codecLookup: CodecLookupWithDescriptors = createPostgresBuiltinCodecLookup();

function parseAndEmit(source: string) {
  const bound = bindPslSchema(source, {
    sourceId: 'infer-parse-emit.test.psl',
    context: {
      composedExtensions: [],
      defaultNamespaceId: 'public',
      composedExtensionContracts: new Map(),
      authoringContributions: {
        ...assembled,
        type: { ...authoringTypes, ...assembled.type },
        attributeSpecs: sqlAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup,
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      generatorFunctions: EMPTY_GENERATOR_FUNCTIONS,
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
  it('preserves unparameterized, parameterized, json, jsonb, and date and time storage', async () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        sample: {
          name: 'sample',
          columns: {
            id: { name: 'id', typeText: 'int4', nullable: false },
            uuid_value: { name: 'uuid_value', typeText: 'uuid', nullable: false },
            ip_address: { name: 'ip_address', typeText: 'inet', nullable: false },
            amount: { name: 'amount', typeText: 'numeric(10,2)', nullable: false },
            bare_amount: { name: 'bare_amount', typeText: 'numeric', nullable: false },
            json_value: { name: 'json_value', typeText: 'json', nullable: false },
            jsonb_value: { name: 'jsonb_value', typeText: 'jsonb', nullable: false },
            occurred_at: { name: 'occurred_at', typeText: 'timestamptz', nullable: false },
            logged_at: { name: 'logged_at', typeText: 'timestamp(3)', nullable: false },
            due_on: { name: 'due_on', typeText: 'date', nullable: false },
            opens_at: { name: 'opens_at', typeText: 'time', nullable: false },
            label: { name: 'label', typeText: 'varchar(191)', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });

    const inferred = await printPslFromFlat(schemaIR);
    expect(inferred).not.toContain('types {');
    expect(inferred).toMatch(/uuidValue\s+Uuid/);
    expect(inferred).toMatch(/ipAddress\s+Inet/);
    expect(inferred).toMatch(/amount\s+Numeric\(10, 2\)/);
    expect(inferred).toMatch(/bareAmount\s+Numeric/);
    expect(inferred).not.toContain('bareAmount Numeric()');
    expect(inferred).toMatch(/jsonValue\s+Json/);
    expect(inferred).toMatch(/jsonbValue\s+Jsonb/);
    expect(inferred).toMatch(/occurredAt\s+DateTime\(precision: 6\)\s/);
    expect(inferred).toMatch(/loggedAt\s+DateTime\(storage: timestamp\)\s/);
    expect(inferred).toMatch(/dueOn\s+Date\s/);
    expect(inferred).toMatch(/opensAt\s+Time\s/);
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
              id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false, many: false },
              uuid_value: {
                codecId: 'pg/uuid@1',
                dataType: 'pg/uuid',
                nullable: false,
                many: false,
              },
              ip_address: {
                codecId: 'pg/inet@1',
                dataType: 'pg/inet',
                nullable: false,
                many: false,
              },
              amount: {
                codecId: 'pg/numeric@1',
                dataType: 'pg/numeric',
                nullable: false,
                many: false,
                typeParams: { precision: 10, scale: 2 },
              },
              bare_amount: {
                codecId: 'pg/numeric@1',
                dataType: 'pg/numeric',
                nullable: false,
                many: false,
              },
              json_value: {
                codecId: 'pg/json@1',
                dataType: 'pg/json',
                nullable: false,
                many: false,
              },
              jsonb_value: {
                codecId: 'pg/jsonb@1',
                dataType: 'pg/jsonb',
                nullable: false,
                many: false,
              },
              occurred_at: {
                codecId: 'pg/timestamptz-date@1',
                dataType: 'pg/timestamptz',
                nullable: false,
                many: false,
                typeParams: { precision: 6 },
              },
              logged_at: {
                codecId: 'pg/timestamp-date@1',
                dataType: 'pg/timestamp',
                nullable: false,
                many: false,
                typeParams: { precision: 3 },
              },
              due_on: {
                codecId: 'pg/date-string@1',
                dataType: 'pg/date',
                nullable: false,
                many: false,
              },
              opens_at: {
                codecId: 'pg/time-string@1',
                dataType: 'pg/time',
                nullable: false,
                many: false,
              },
              label: {
                codecId: 'sql/varchar@1',
                dataType: 'pg/varchar',
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

  it('leaves out an exact-named index whose where would not read back and keeps a wire-named one by name', async () => {
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
            id: { name: 'id', typeText: 'int4', nullable: false },
            owner_id: { name: 'owner_id', typeText: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [partialIndex('sample_adopted'), partialIndex(wireName)],
        },
      },
    });

    const inferred = await printPslFromFlat(schemaIR);
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
