import type { Contract } from '@internal/contract/types';
import { crossRef } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  modelsOf,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

const baseInput = {
  dataTypeLookup: fixtureDataTypeSupport.lookup,
  target: postgresTarget,
  scalarColumnDescriptors: postgresScalarTypeDescriptors,
  controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
} as const;

function interpretSchema(schema: string) {
  const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
  return interpretPslDocumentToSqlContract({ ...baseInput, ...document });
}

function relationsOf(contract: Contract) {
  return modelsOf(contract) as Record<string, { relations?: Record<string, unknown> }>;
}

describe('interpretPslDocumentToSqlContract many-to-many junctions', () => {
  it('lowers bare list fields through an explicit junction to N:M relations on both sides', () => {
    const result = interpretSchema(`model Post {
  id Int @id
  tags Tag[]
}

model Tag {
  id Int @id
  posts Post[]
}

model PostTag {
  postId Int
  tagId Int
  post Post @relation(fields: [postId], references: [id])
  tag Tag @relation(fields: [tagId], references: [id])

  @@id([postId, tagId])
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = relationsOf(result.value);
    expect(models['Post']?.relations).toEqual({
      tags: {
        to: crossRef('Tag', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['postId'] },
        through: {
          table: 'PostTag',
          namespaceId: 'public',
          parentColumns: ['postId'],
          childColumns: ['tagId'],
          targetColumns: ['id'],
        },
      },
    });
    expect(models['Tag']?.relations).toEqual({
      posts: {
        to: crossRef('Post', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['tagId'] },
        through: {
          table: 'PostTag',
          namespaceId: 'public',
          parentColumns: ['tagId'],
          childColumns: ['postId'],
          targetColumns: ['id'],
        },
      },
    });
    expect(models['PostTag']?.relations).toEqual({
      post: {
        to: crossRef('Post', 'public'),
        cardinality: 'N:1',
        nullable: false,
        on: { localFields: ['postId'], targetFields: ['id'] },
      },
      tag: {
        to: crossRef('Tag', 'public'),
        cardinality: 'N:1',
        nullable: false,
        on: { localFields: ['tagId'], targetFields: ['id'] },
      },
    });

    const envelope = JSON.parse(JSON.stringify(result.value)) as unknown;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(envelope)).not.toThrow();
  });

  it('carries the junction model namespace into through.namespaceId for a non-default-namespace junction', () => {
    const result = interpretSchema(`namespace auth {
  model User {
    id Int @id
    tags Tag[]
  }

  model Tag {
    id Int @id
    users User[]
  }

  model UserTag {
    userId Int
    tagId Int
    user User @relation(fields: [userId], references: [id])
    tag Tag @relation(fields: [tagId], references: [id])

    @@id([userId, tagId])
  }
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = relationsOf(result.value);
    expect(models['User']?.relations).toEqual({
      tags: {
        to: crossRef('Tag', 'auth'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['userId'] },
        through: {
          table: 'UserTag',
          namespaceId: 'auth',
          parentColumns: ['userId'],
          childColumns: ['tagId'],
          targetColumns: ['id'],
        },
      },
    });

    const envelope = JSON.parse(JSON.stringify(result.value)) as unknown;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(envelope)).not.toThrow();
  });

  it('recognizes a junction with extra non-foreign-key data columns', () => {
    const result = interpretSchema(`model User {
  id Int @id
  tags Tag[]
}

model Tag {
  id Int @id
  users User[]
}

model UserTag {
  userId Int
  tagId Int
  createdAt DateTime
  note String
  user User @relation(fields: [userId], references: [id])
  tag Tag @relation(fields: [tagId], references: [id])

  @@id([userId, tagId])
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = relationsOf(result.value);
    expect(models['User']?.relations).toEqual({
      tags: {
        to: crossRef('Tag', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['userId'] },
        through: {
          table: 'UserTag',
          namespaceId: 'public',
          parentColumns: ['userId'],
          childColumns: ['tagId'],
          targetColumns: ['id'],
        },
      },
    });
  });

  it('populates composite-key through columns from multi-column junction foreign keys', () => {
    const result = interpretSchema(`model Project {
  tenantId Int
  id Int
  labels Label[]

  @@id([tenantId, id])
}

model Label {
  id Int @id
  projects Project[]
}

model ProjectLabel {
  projectTenantId Int
  projectId Int
  labelId Int
  project Project @relation(fields: [projectTenantId, projectId], references: [tenantId, id])
  label Label @relation(fields: [labelId], references: [id])

  @@id([projectTenantId, projectId, labelId])
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = relationsOf(result.value);
    expect(models['Project']?.relations).toEqual({
      labels: {
        to: crossRef('Label', 'public'),
        cardinality: 'N:M',
        on: {
          localFields: ['tenantId', 'id'],
          targetFields: ['projectTenantId', 'projectId'],
        },
        through: {
          table: 'ProjectLabel',
          namespaceId: 'public',
          parentColumns: ['projectTenantId', 'projectId'],
          childColumns: ['labelId'],
          targetColumns: ['id'],
        },
      },
    });
    expect(models['Label']?.relations).toEqual({
      projects: {
        to: crossRef('Project', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['labelId'] },
        through: {
          table: 'ProjectLabel',
          namespaceId: 'public',
          parentColumns: ['labelId'],
          childColumns: ['projectTenantId', 'projectId'],
          targetColumns: ['tenantId', 'id'],
        },
      },
    });
  });

  it('reorders through child columns to the target id order when FK references are swapped', () => {
    const result = interpretSchema(`model Project {
  tenantId Int
  id Int
  labels Label[]

  @@id([tenantId, id])
}

model Label {
  id Int @id
  projects Project[]
}

model ProjectLabel {
  projectId Int
  projectTenantId Int
  labelId Int
  project Project @relation(fields: [projectId, projectTenantId], references: [id, tenantId])
  label Label @relation(fields: [labelId], references: [id])

  @@id([projectTenantId, projectId, labelId])
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = relationsOf(result.value);
    expect(models['Label']?.relations).toEqual({
      projects: {
        to: crossRef('Project', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['labelId'] },
        through: {
          table: 'ProjectLabel',
          namespaceId: 'public',
          parentColumns: ['labelId'],
          childColumns: ['projectTenantId', 'projectId'],
          targetColumns: ['tenantId', 'id'],
        },
      },
    });
    expect(models['Project']?.relations).toEqual({
      labels: {
        to: crossRef('Label', 'public'),
        cardinality: 'N:M',
        on: {
          localFields: ['id', 'tenantId'],
          targetFields: ['projectId', 'projectTenantId'],
        },
        through: {
          table: 'ProjectLabel',
          namespaceId: 'public',
          parentColumns: ['projectId', 'projectTenantId'],
          childColumns: ['labelId'],
          targetColumns: ['id'],
        },
      },
    });

    const envelope = JSON.parse(JSON.stringify(result.value)) as unknown;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(envelope)).not.toThrow();
  });

  it('emits a junction-specific diagnostic when the junction child FK references a non-id unique', () => {
    const result = interpretSchema(`model Post {
  id Int @id
  tags Tag[]
}

model Tag {
  id Int @id
  slug String @unique
}

model PostTag {
  postId Int
  tagSlug String
  post Post @relation(fields: [postId], references: [id])
  tag Tag @relation(fields: [tagSlug], references: [slug])

  @@id([postId, tagSlug])
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_JUNCTION_TARGET_FK_NOT_ID',
          message: expect.stringContaining('Post.tags'),
        }),
      ]),
    );
    const diagnostic = result.failure.diagnostics.find(
      (d) => d.code === 'PSL_JUNCTION_TARGET_FK_NOT_ID',
    );
    expect(diagnostic?.message).toContain('PostTag');
    expect(diagnostic?.message).toContain('@id');
  });

  it('resolves self-referential junction lists disambiguated by relation name', () => {
    const result = interpretSchema(`model User {
  id Int @id
  following User[] @relation("follower")
  followers User[] @relation("followee")
}

model Follow {
  followerId Int
  followeeId Int
  follower User @relation("follower", fields: [followerId], references: [id])
  followee User @relation("followee", fields: [followeeId], references: [id])

  @@id([followerId, followeeId])
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = relationsOf(result.value);
    expect(models['User']?.relations).toEqual({
      following: {
        to: crossRef('User', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['followerId'] },
        through: {
          table: 'Follow',
          namespaceId: 'public',
          parentColumns: ['followerId'],
          childColumns: ['followeeId'],
          targetColumns: ['id'],
        },
      },
      followers: {
        to: crossRef('User', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['followeeId'] },
        through: {
          table: 'Follow',
          namespaceId: 'public',
          parentColumns: ['followeeId'],
          childColumns: ['followerId'],
          targetColumns: ['id'],
        },
      },
    });
  });

  it('returns diagnostics for self-referential junction lists without a relation name', () => {
    const result = interpretSchema(`model User {
  id Int @id
  follows User[]
}

model Follow {
  followerId Int
  followeeId Int
  follower User @relation("follower", fields: [followerId], references: [id])
  followee User @relation("followee", fields: [followeeId], references: [id])

  @@id([followerId, followeeId])
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_AMBIGUOUS_BACKRELATION',
          message: expect.stringContaining('User.follows'),
        }),
      ]),
    );
  });

  it('lowers two distinct named many-to-many relations between the same pair through separate junctions', () => {
    const result = interpretSchema(`model User {
  id Int @id
  ownedTags Tag[] @relation("owned")
  watchedTags Tag[] @relation("watched")
}

model Tag {
  id Int @id
  owners User[] @relation("owned")
  watchers User[] @relation("watched")
}

model TagOwnership {
  userId Int
  tagId Int
  user User @relation("owned", fields: [userId], references: [id])
  tag Tag @relation("owned", fields: [tagId], references: [id])

  @@id([userId, tagId])
}

model TagWatch {
  userId Int
  tagId Int
  user User @relation("watched", fields: [userId], references: [id])
  tag Tag @relation("watched", fields: [tagId], references: [id])

  @@id([userId, tagId])
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = relationsOf(result.value);
    expect(models['User']?.relations).toEqual({
      ownedTags: {
        to: crossRef('Tag', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['userId'] },
        through: {
          table: 'TagOwnership',
          namespaceId: 'public',
          parentColumns: ['userId'],
          childColumns: ['tagId'],
          targetColumns: ['id'],
        },
      },
      watchedTags: {
        to: crossRef('Tag', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['userId'] },
        through: {
          table: 'TagWatch',
          namespaceId: 'public',
          parentColumns: ['userId'],
          childColumns: ['tagId'],
          targetColumns: ['id'],
        },
      },
    });
    expect(models['Tag']?.relations).toEqual({
      owners: {
        to: crossRef('User', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['tagId'] },
        through: {
          table: 'TagOwnership',
          namespaceId: 'public',
          parentColumns: ['tagId'],
          childColumns: ['userId'],
          targetColumns: ['id'],
        },
      },
      watchers: {
        to: crossRef('User', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['tagId'] },
        through: {
          table: 'TagWatch',
          namespaceId: 'public',
          parentColumns: ['tagId'],
          childColumns: ['userId'],
          targetColumns: ['id'],
        },
      },
    });

    const envelope = JSON.parse(JSON.stringify(result.value)) as unknown;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(envelope)).not.toThrow();
  });

  it('returns diagnostics for two unnamed many-to-many relations between the same pair', () => {
    const result = interpretSchema(`model User {
  id Int @id
  ownedTags Tag[]
  watchedTags Tag[]
}

model Tag {
  id Int @id
  owners User[]
  watchers User[]
}

model TagOwnership {
  userId Int
  tagId Int
  user User @relation(fields: [userId], references: [id])
  tag Tag @relation(fields: [tagId], references: [id])

  @@id([userId, tagId])
}

model TagWatch {
  userId Int
  tagId Int
  user User @relation(fields: [userId], references: [id])
  tag Tag @relation(fields: [tagId], references: [id])

  @@id([userId, tagId])
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_AMBIGUOUS_BACKRELATION',
          message: expect.stringContaining('User.ownedTags'),
        }),
      ]),
    );
  });

  it('keeps the orphaned diagnostic for bare lists without any junction model', () => {
    const result = interpretSchema(`model Post {
  id Int @id
  tags Tag[]
}

model Tag {
  id Int @id
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_ORPHANED_BACKRELATION',
          message: expect.stringContaining('Post.tags'),
        }),
      ]),
    );
  });

  it('emits a junction-specific diagnostic when the join model id does not cover its foreign keys', () => {
    const result = interpretSchema(`model Post {
  id Int @id
  tags Tag[]
}

model Tag {
  id Int @id
}

model PostTag {
  id Int @id
  postId Int
  tagId Int
  post Post @relation(fields: [postId], references: [id])
  tag Tag @relation(fields: [tagId], references: [id])
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_JUNCTION_ID_NOT_FK_COVERING',
          message: expect.stringContaining('Post.tags'),
        }),
      ]),
    );
    const diagnostic = result.failure.diagnostics.find(
      (d) => d.code === 'PSL_JUNCTION_ID_NOT_FK_COVERING',
    );
    expect(diagnostic?.message).toContain('PostTag');
    expect(diagnostic?.message).toContain('@@id');
  });

  it('keeps explicit junction modelling without bare lists on the 1:N/N:1 output', () => {
    const result = interpretSchema(`model Post {
  id Int @id
  links PostTag[]
}

model Tag {
  id Int @id
  links PostTag[]
}

model PostTag {
  postId Int
  tagId Int
  post Post @relation(fields: [postId], references: [id])
  tag Tag @relation(fields: [tagId], references: [id])

  @@id([postId, tagId])
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = relationsOf(result.value);
    expect(models['Post']?.relations).toEqual({
      links: {
        to: crossRef('PostTag', 'public'),
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['postId'] },
      },
    });
    expect(models['Tag']?.relations).toEqual({
      links: {
        to: crossRef('PostTag', 'public'),
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['tagId'] },
      },
    });
    expect(models['PostTag']?.relations).toEqual({
      post: {
        to: crossRef('Post', 'public'),
        cardinality: 'N:1',
        nullable: false,
        on: { localFields: ['postId'], targetFields: ['id'] },
      },
      tag: {
        to: crossRef('Tag', 'public'),
        cardinality: 'N:1',
        nullable: false,
        on: { localFields: ['tagId'], targetFields: ['id'] },
      },
    });
  });

  it('prefers a direct FK-side match over junction recognition for the same list field', () => {
    const result = interpretSchema(`model Post {
  id Int @id
  tags Tag[]
}

model Tag {
  id Int @id
  postId Int
  post Post @relation(fields: [postId], references: [id])
}

model PostTag {
  postId Int
  tagId Int
  post Post @relation(fields: [postId], references: [id])
  tag Tag @relation(fields: [tagId], references: [id])

  @@id([postId, tagId])
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = relationsOf(result.value);
    expect(models['Post']?.relations).toEqual({
      tags: {
        to: crossRef('Tag', 'public'),
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['postId'] },
      },
    });
  });
});
