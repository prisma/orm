import { crossRef } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  documentScopedTypes,
  postgresNativeScalarTypeDescriptors,
  postgresScalarAuthoringTypes,
  postgresTarget,
  symbolTableInputFromParseArgs,
  testEnumEntityContributions,
} from './fixtures';

const baseInput = {
  target: postgresTarget,
  scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
  authoringContributions: {
    entityTypes: testEnumEntityContributions,
    type: postgresScalarAuthoringTypes,
    field: {},
  },
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
} as const;

describe('interpretPslDocumentToSqlContract types', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

  it('lowers preserved native type named types into storage descriptors', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  Id = Uuid
  Slug = VarChar(191)
  Rating = SmallInt
  HappenedAt = Time(3)
  PublishDay = Date
  Payload = Json
  Amount = Numeric(10, 2)
}

model Event {
  id Id @id
  slug Slug
  rating Rating
  happenedAt HappenedAt
  publishDay PublishDay
  payload Payload
  amount Amount
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(documentScopedTypes(result.value)).toMatchObject({
      Id: { codecId: 'pg/uuid@1', nativeType: 'uuid' },
      Slug: {
        codecId: 'sql/varchar@1',
        nativeType: 'character varying',
        typeParams: { length: 191 },
      },
      Rating: { codecId: 'pg/int2@1', nativeType: 'int2' },
      HappenedAt: {
        codecId: 'pg/time-temporal@1',
        nativeType: 'time',
        typeParams: { precision: 3 },
      },
      PublishDay: { codecId: 'pg/date-temporal@1', nativeType: 'date' },
      Payload: { codecId: 'pg/json@1', nativeType: 'json' },
      Amount: {
        codecId: 'pg/numeric@1',
        nativeType: 'numeric',
        typeParams: { precision: 10, scale: 2 },
      },
    });
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              event: {
                columns: {
                  id: { codecId: 'pg/uuid@1', nativeType: 'uuid', nullable: false, typeRef: 'Id' },
                  slug: {
                    codecId: 'sql/varchar@1',
                    nativeType: 'character varying',
                    nullable: false,
                    typeRef: 'Slug',
                  },
                  rating: {
                    codecId: 'pg/int2@1',
                    nativeType: 'int2',
                    nullable: false,
                    typeRef: 'Rating',
                  },
                  happenedAt: {
                    codecId: 'pg/time-temporal@1',
                    nativeType: 'time',
                    nullable: false,
                    typeRef: 'HappenedAt',
                  },
                  publishDay: {
                    codecId: 'pg/date-temporal@1',
                    nativeType: 'date',
                    nullable: false,
                    typeRef: 'PublishDay',
                  },
                  payload: {
                    codecId: 'pg/json@1',
                    nativeType: 'json',
                    nullable: false,
                    typeRef: 'Payload',
                  },
                  amount: {
                    codecId: 'pg/numeric@1',
                    nativeType: 'numeric',
                    nullable: false,
                    typeRef: 'Amount',
                  },
                },
                primaryKey: { columns: ['id'] },
              },
            },
          },
        },
      },
    });
    expect(result.value.roots).toEqual({ event: crossRef('Event', 'public') });
  });

  it('lowers additional Postgres native type attributes on named types', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  Code = Char(12)
  Score = Real
  CreatedAt = Timestamp(3)
  PublishedAt = Timestamptz(6)
  ReminderAt = Timetz(2)
  Ip = Inet
}

model Event {
  id Int @id
  code Code
  score Score
  createdAt CreatedAt
  publishedAt PublishedAt
  reminderAt ReminderAt
  ip Ip
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(documentScopedTypes(result.value)).toMatchObject({
      Code: {
        codecId: 'sql/char@1',
        nativeType: 'character',
        typeParams: { length: 12 },
      },
      Score: {
        codecId: 'pg/float4@1',
        nativeType: 'float4',
      },
      CreatedAt: {
        codecId: 'pg/timestamp-temporal@1',
        nativeType: 'timestamp',
        typeParams: { precision: 3 },
      },
      PublishedAt: {
        codecId: 'pg/timestamptz-temporal@1',
        nativeType: 'timestamptz',
        typeParams: { precision: 6 },
      },
      ReminderAt: {
        codecId: 'pg/timetz@1',
        nativeType: 'timetz',
        typeParams: { precision: 2 },
      },
      Ip: {
        codecId: 'pg/inet@1',
        nativeType: 'inet',
      },
    });
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              event: {
                columns: {
                  id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                  code: {
                    codecId: 'sql/char@1',
                    nativeType: 'character',
                    nullable: false,
                    typeRef: 'Code',
                  },
                  score: {
                    codecId: 'pg/float4@1',
                    nativeType: 'float4',
                    nullable: false,
                    typeRef: 'Score',
                  },
                  createdAt: {
                    codecId: 'pg/timestamp-temporal@1',
                    nativeType: 'timestamp',
                    nullable: false,
                    typeRef: 'CreatedAt',
                  },
                  publishedAt: {
                    codecId: 'pg/timestamptz-temporal@1',
                    nativeType: 'timestamptz',
                    nullable: false,
                    typeRef: 'PublishedAt',
                  },
                  reminderAt: {
                    codecId: 'pg/timetz@1',
                    nativeType: 'timetz',
                    nullable: false,
                    typeRef: 'ReminderAt',
                  },
                  ip: {
                    codecId: 'pg/inet@1',
                    nativeType: 'inet',
                    nullable: false,
                    typeRef: 'Ip',
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(result.value.roots).toEqual({ event: crossRef('Event', 'public') });
  });
});
