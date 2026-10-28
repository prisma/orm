import { crossRef } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
import {
  createBuiltinLikeControlMutationDefaults,
  documentScopedTypes,
  interpretSqlContract,
  postgresNativeScalarTypeDescriptors,
  postgresScalarAuthoringTypes,
  postgresTarget,
  testEnumEntityContributions,
} from './fixtures';

const baseInput = {
  ...fixtureInterpreterTypes,
  target: postgresTarget,
  scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
  authoringContributions: {
    entityTypes: testEnumEntityContributions,
    type: postgresScalarAuthoringTypes,
  },
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
} as const;

describe('interpretPslDocumentToSqlContract types', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

  it('expands each named type into the columns typed by it, with its params inline', () => {
    const result = interpretSqlContract(
      `types {
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
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(documentScopedTypes(result.value)).toBeUndefined();
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              Event: {
                columns: {
                  id: { codecId: 'pg/uuid@1', dataType: 'pg/uuid', nullable: false },
                  slug: {
                    codecId: 'sql/varchar@1',
                    dataType: 'pg/varchar',
                    nullable: false,
                    typeParams: { length: 191 },
                  },
                  rating: {
                    codecId: 'pg/int2@1',
                    dataType: 'pg/int2',
                    nullable: false,
                  },
                  happenedAt: {
                    codecId: 'pg/time-temporal@1',
                    dataType: 'pg/time',
                    nullable: false,
                    typeParams: { precision: 3 },
                  },
                  publishDay: {
                    codecId: 'pg/date-temporal@1',
                    dataType: 'pg/date',
                    nullable: false,
                  },
                  payload: {
                    codecId: 'pg/json@1',
                    dataType: 'pg/json',
                    nullable: false,
                  },
                  amount: {
                    codecId: 'pg/numeric@1',
                    dataType: 'pg/numeric',
                    nullable: false,
                    typeParams: { precision: 10, scale: 2 },
                  },
                },
                primaryKey: { columns: ['id'] },
              },
            },
          },
        },
      },
    });
    expect(result.value.roots).toEqual({ Event: crossRef('Event', 'public') });
  });

  it('reads named types declared across several types blocks', () => {
    const result = interpretSqlContract(
      `types {
  Id = Uuid
}

model Event {
  id Id @id
  slug Slug
}

types {
  Slug = VarChar(191)
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect({
      types: documentScopedTypes(result.value),
      columns: result.value.storage,
    }).toMatchObject({
      types: undefined,
      columns: {
        namespaces: {
          public: {
            entries: {
              table: {
                Event: {
                  columns: {
                    id: { codecId: 'pg/uuid@1', dataType: 'pg/uuid', nullable: false },
                    slug: {
                      codecId: 'sql/varchar@1',
                      dataType: 'pg/varchar',
                      nullable: false,
                      typeParams: { length: 191 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('reports a named type repeated in another types block', () => {
    const result = interpretSqlContract(
      `types {
  Slug = VarChar(191)
}

types {
  Slug = VarChar(10)
}

model Event {
  id Int @id
  slug Slug
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "Slug"',
        span: expect.objectContaining({ start: expect.objectContaining({ line: 6, column: 3 }) }),
      }),
    ]);
  });

  it('expands additional Postgres native type named types into their columns', () => {
    const result = interpretSqlContract(
      `types {
  Code = Char(12)
  Score = Real
  CreatedAt = TimestampTemporal(3)
  PublishedAt = TimestamptzTemporal(6)
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
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(documentScopedTypes(result.value)).toBeUndefined();
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              Event: {
                columns: {
                  id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
                  code: {
                    codecId: 'sql/char@1',
                    dataType: 'pg/char',
                    nullable: false,
                    typeParams: { length: 12 },
                  },
                  score: {
                    codecId: 'pg/float4@1',
                    dataType: 'pg/float4',
                    nullable: false,
                  },
                  createdAt: {
                    codecId: 'pg/timestamp-temporal@1',
                    dataType: 'pg/timestamp',
                    nullable: false,
                    typeParams: { precision: 3 },
                  },
                  publishedAt: {
                    codecId: 'pg/timestamptz-temporal@1',
                    dataType: 'pg/timestamptz',
                    nullable: false,
                    typeParams: { precision: 6 },
                  },
                  reminderAt: {
                    codecId: 'pg/timetz@1',
                    dataType: 'pg/timetz',
                    nullable: false,
                    typeParams: { precision: 2 },
                  },
                  ip: {
                    codecId: 'pg/inet@1',
                    dataType: 'pg/inet',
                    nullable: false,
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(result.value.roots).toEqual({ Event: crossRef('Event', 'public') });
  });
});
