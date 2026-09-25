import { buildSymbolTable, type FieldSymbol } from '@internal/psl-parser';
import { fkRelationPairKey } from '@internal/psl-parser/interpret';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { type MongoForeignKeyRelation, pairMongoBackRelations } from '../src/pair-back-relations';

const schema = `model User {
  id    ObjectId @id @map("_id")
  posts Post[]
  pinned Post[] @relation("pinned")
  profile Profile
}

model Post {
  id       ObjectId @id @map("_id")
  authorId ObjectId
}

model Profile {
  id     ObjectId @id @map("_id")
  userId ObjectId
}
`;

const { document, sources } = parse(schema, 'schema.prisma');
const { symbolTable } = buildSymbolTable({
  documents: [document],
  sources,
  pslBlockDescriptors: {},
});

function fieldOf(modelName: string, fieldName: string): FieldSymbol {
  const field = symbolTable.topLevel.models[modelName]?.fields[fieldName];
  if (field === undefined) throw new Error(`no field ${modelName}.${fieldName}`);
  return field;
}

const postsCandidate = {
  modelName: 'User',
  targetModelName: 'Post',
  cardinality: '1:N' as const,
  field: fieldOf('User', 'posts'),
  sources,
};

const authorFk: MongoForeignKeyRelation = {
  declaringModel: 'Post',
  targetModel: 'User',
  localFields: ['authorId'],
  targetFields: ['_id'],
};

describe('pairMongoBackRelations', () => {
  it('pairs a back-relation with its foreign key and reverses the fields', () => {
    expect(
      pairMongoBackRelations({
        foreignKeys: [authorFk],
        candidates: [postsCandidate],
        invalidFkPairings: [],
      }),
    ).toEqual({
      relations: [
        {
          modelName: 'User',
          fieldName: 'posts',
          relation: {
            to: { namespace: '__unbound__', model: 'Post' },
            cardinality: '1:N',
            on: { localFields: ['_id'], targetFields: ['authorId'] },
          },
        },
      ],
      diagnostics: [],
    });
  });

  it('reports a back-relation with no foreign key as orphaned', () => {
    const result = pairMongoBackRelations({
      foreignKeys: [],
      candidates: [postsCandidate],
      invalidFkPairings: [],
    });
    expect(result.relations).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'PSL_ORPHANED_BACKRELATION', filename: 'schema.prisma' }),
    ]);
  });

  it('stays silent for a back-relation whose foreign key was already reported', () => {
    expect(
      pairMongoBackRelations({
        foreignKeys: [],
        candidates: [postsCandidate],
        invalidFkPairings: [{ pairKey: fkRelationPairKey('Post', 'User') }],
      }),
    ).toEqual({ relations: [], diagnostics: [] });
  });

  it('reports an unnamed back-relation that matches two foreign keys as ambiguous', () => {
    const result = pairMongoBackRelations({
      foreignKeys: [authorFk, { ...authorFk, relationName: 'pinned' }],
      candidates: [postsCandidate],
      invalidFkPairings: [],
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'PSL_AMBIGUOUS_BACKRELATION' }),
    ]);
  });

  it('pairs a named back-relation only with the foreign key of the same name', () => {
    const result = pairMongoBackRelations({
      foreignKeys: [authorFk, { ...authorFk, relationName: 'pinned', localFields: ['pinnedById'] }],
      candidates: [{ ...postsCandidate, field: fieldOf('User', 'pinned'), relationName: 'pinned' }],
      invalidFkPairings: [],
    });
    expect(result.relations).toEqual([
      expect.objectContaining({
        fieldName: 'pinned',
        relation: expect.objectContaining({
          on: { localFields: ['_id'], targetFields: ['pinnedById'] },
        }),
      }),
    ]);
  });

  it('reports a required one-to-one back-relation and still records the relation', () => {
    const result = pairMongoBackRelations({
      foreignKeys: [
        {
          declaringModel: 'Profile',
          targetModel: 'User',
          localFields: ['userId'],
          targetFields: ['_id'],
        },
      ],
      candidates: [
        {
          modelName: 'User',
          targetModelName: 'Profile',
          cardinality: '1:1',
          field: fieldOf('User', 'profile'),
          sources,
        },
      ],
      invalidFkPairings: [],
    });
    expect(result).toEqual({
      relations: [
        {
          modelName: 'User',
          fieldName: 'profile',
          relation: {
            to: { namespace: '__unbound__', model: 'Profile' },
            cardinality: '1:1',
            nullable: true,
            on: { localFields: ['_id'], targetFields: ['userId'] },
          },
        },
      ],
      diagnostics: [expect.objectContaining({ code: 'PSL_REQUIRED_ONE_TO_ONE_BACKRELATION' })],
    });
  });
});
