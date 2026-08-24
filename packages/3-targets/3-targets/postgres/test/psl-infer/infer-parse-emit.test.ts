import {
  type AuthoringTypeNamespace,
  collectScalarTypeConstructors,
} from '@internal/framework-components/authoring';
import type { CodecLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { assert, describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../../src/core/authoring';
import { type PostgresSchema, postgresCreateNamespace } from '../../src/core/postgres-schema';
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
      { kind: 'number', name: 'scale', integer: true, minimum: 0, optional: true },
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

const codecLookup: CodecLookup = {
  get: () => undefined,
  targetTypesFor: () => undefined,
  renderOutputTypeFor: () => undefined,
  descriptorFor: () => undefined,
};

function parseAndEmit(source: string) {
  const { document, sourceFile } = parse(source);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    capabilities: {},
    target,
    scalarColumnDescriptors: collectScalarTypeConstructors(authoringTypes),
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    codecLookup,
  });
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
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
              uuid_value: { codecId: 'pg/uuid@1', nativeType: 'uuid', nullable: false },
              ip_address: { codecId: 'pg/inet@1', nativeType: 'inet', nullable: false },
              amount: {
                codecId: 'pg/numeric@1',
                nativeType: 'numeric',
                nullable: false,
                typeParams: { precision: 10, scale: 2 },
              },
              bare_amount: { codecId: 'pg/numeric@1', nativeType: 'numeric', nullable: false },
              json_value: { codecId: 'pg/json@1', nativeType: 'json', nullable: false },
              jsonb_value: { codecId: 'pg/jsonb@1', nativeType: 'jsonb', nullable: false },
              occurred_at: {
                codecId: 'pg/timestamptz-temporal@1',
                nativeType: 'timestamptz',
                nullable: false,
              },
              label: {
                codecId: 'pg/text@1',
                nativeType: 'varchar',
                nullable: false,
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
