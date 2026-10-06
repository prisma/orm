import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { createDataTypeLookup } from '@internal/framework-components/codec';
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
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { assert, describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../../src/core/authoring';
import { createPostgresBuiltinCodecLookup } from '../../src/core/codec-registry';
import { type PostgresSchema, postgresCreateNamespace } from '../../src/core/postgres-schema';
import { printPslFromFlat } from './fixtures';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

const authoringTypes = {
  Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1' } },
  Uuid: { kind: 'typeConstructor', output: { codecId: 'pg/uuid@1' } },
  Inet: { kind: 'typeConstructor', output: { codecId: 'pg/inet@1' } },
  TimestampString: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'precision', integer: true, optional: true }],
    output: {
      codecId: 'pg/timestamp-string@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  TimestamptzString: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'precision', integer: true, optional: true }],
    output: {
      codecId: 'pg/timestamptz-string@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  DateString: {
    kind: 'typeConstructor',
    output: { codecId: 'pg/date-string@1' },
  },
  TimeString: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'precision', integer: true, optional: true }],
    output: {
      codecId: 'pg/time-string@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  VarChar: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'length', integer: true, optional: true }],
    output: {
      codecId: 'sql/varchar@1',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Numeric: {
    kind: 'typeConstructor',
    args: [
      { kind: 'number', name: 'precision', integer: true, optional: true },
      { kind: 'number', name: 'scale', integer: true, optional: true },
    ],
    output: {
      codecId: 'pg/numeric@1',
      typeParams: {
        precision: { kind: 'arg', index: 0 },
        scale: { kind: 'arg', index: 1 },
      },
    },
  },
  Json: { kind: 'typeConstructor', output: { codecId: 'pg/json@1' } },
  Jsonb: { kind: 'typeConstructor', output: { codecId: 'pg/jsonb@1' } },
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

const codecLookup: CodecLookupWithDescriptors = createPostgresBuiltinCodecLookup();

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
      dataTypeLookup: postgresDataTypeLookup,
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
  it('preserves unparameterized, parameterized, json, jsonb, and date and time storage', () => {
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
            logged_at: { name: 'logged_at', nativeType: 'timestamp(3)', nullable: false },
            due_on: { name: 'due_on', nativeType: 'date', nullable: false },
            opens_at: { name: 'opens_at', nativeType: 'time', nullable: false },
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
    expect(inferred).toMatch(/occurredAt\s+TimestamptzString\s/);
    expect(inferred).toMatch(/loggedAt\s+TimestampString\(3\)/);
    expect(inferred).toMatch(/dueOn\s+DateString\s/);
    expect(inferred).toMatch(/opensAt\s+TimeString\s/);
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
                codecId: 'pg/timestamptz-string@1',
                nativeType: 'timestamptz',
                nullable: false,
                many: false,
              },
              logged_at: {
                codecId: 'pg/timestamp-string@1',
                nativeType: 'timestamp',
                nullable: false,
                many: false,
                typeParams: { precision: 3 },
              },
              due_on: {
                codecId: 'pg/date-string@1',
                nativeType: 'date',
                nullable: false,
                many: false,
              },
              opens_at: {
                codecId: 'pg/time-string@1',
                nativeType: 'time',
                nullable: false,
                many: false,
              },
              label: {
                codecId: 'sql/varchar@1',
                nativeType: 'character varying',
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
});
