import { crossRef } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  modelsOf,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

const baseInput = {
  target: postgresTarget,
  scalarColumnDescriptors: postgresScalarTypeDescriptors,
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
} as const;

type RelationModels = Record<string, { relations?: Record<string, unknown> }>;

describe('interpretPslDocumentToSqlContract 1:1 back-relation FK uniqueness', () => {
  it('resolves a 1:1 back-relation whose FK is covered by a composite @@unique', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Users {
  tenantId Int
  id       Int
  profiles Profiles?
  @@id([tenantId, id])
}

model Profiles {
  id             Int @id
  userTenantId   Int
  userId         Int
  user Users @relation(fields: [userTenantId, userId], references: [tenantId, id])
  @@unique([userTenantId, userId])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = modelsOf(result.value) as RelationModels;
    expect(models['Users']?.relations).toEqual({
      profiles: {
        to: crossRef('Profiles', 'public'),
        cardinality: '1:1',
        nullable: true,
        on: {
          localFields: ['tenantId', 'id'],
          targetFields: ['userTenantId', 'userId'],
        },
      },
    });
  });

  it('resolves a 1:1 back-relation whose FK columns are declared in a different order than the @@unique', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Users {
  tenantId Int
  id       Int
  profiles Profiles?
  @@id([tenantId, id])
}

model Profiles {
  id             Int @id
  userId         Int
  userTenantId   Int
  user Users @relation(fields: [userId, userTenantId], references: [id, tenantId])
  @@unique([userTenantId, userId])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = modelsOf(result.value) as RelationModels;
    expect(models['Users']?.relations).toEqual({
      profiles: {
        to: crossRef('Profiles', 'public'),
        cardinality: '1:1',
        nullable: true,
        on: {
          localFields: ['id', 'tenantId'],
          targetFields: ['userId', 'userTenantId'],
        },
      },
    });
  });

  it('resolves a 1:1 back-relation whose FK is covered by the target model @id', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Users {
  id       Int @id
  profiles Profiles?
}

model Profiles {
  userId Int @id
  user Users @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = modelsOf(result.value) as RelationModels;
    expect(models['Users']?.relations).toEqual({
      profiles: {
        to: crossRef('Profiles', 'public'),
        cardinality: '1:1',
        nullable: true,
        on: {
          localFields: ['id'],
          targetFields: ['userId'],
        },
      },
    });
  });

  it('rejects a required 1:1 back-relation and tells the user to make it optional', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id      Int @id
  profile Profile
}

model Profile {
  id     Int @id
  userId Int @unique
  user   User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_REQUIRED_ONE_TO_ONE_BACKRELATION',
        message: expect.stringContaining(
          'Backrelation field "User.profile" is required, but "Profile" holds the relation fields',
        ),
        span: expect.objectContaining({ start: expect.objectContaining({ line: 3 }) }),
      }),
    ]);
  });

  it('rejects a singular back-relation whose matched FK is not unique', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Users {
  id       Int @id
  profiles Profiles?
}

model Profiles {
  id     Int @id
  userId Int
  user Users @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_NON_UNIQUE_BACKRELATION',
          message: expect.stringContaining('Users.profiles'),
        }),
      ]),
    );
  });

  it('rejects a singular back-relation whose FK is only a subset of a composite @@unique', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Users {
  id       Int @id
  profiles Profiles?
}

model Profiles {
  id     Int @id
  userId Int
  other  Int
  user Users @relation(fields: [userId], references: [id])
  @@unique([userId, other])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_NON_UNIQUE_BACKRELATION',
          message: expect.stringContaining('Users.profiles'),
        }),
      ]),
    );
  });
});
