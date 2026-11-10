import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { describe, expect, it } from 'vitest';
import {
  prisma7ForeignKeyName,
  prisma7JunctionForeignKeyName,
  prisma7JunctionPrimaryKeyName,
  prisma7PrimaryKeyName,
} from '../src/constraint-names';

const { identifierMaxBytes } = prisma7PostgresBinding;

/**
 * Every name below appears in a `migration.sql` Prisma 7.10.0 generated:
 * `fixtures/constraint-names` for the primary keys and foreign keys, and
 * `fixtures/long-names` for the long junction table.
 */
describe('prisma7PrimaryKeyName', () => {
  it('uses the map name when one is given', () => {
    expect(prisma7PrimaryKeyName('Author', 'author_primary', identifierMaxBytes)).toBe(
      'author_primary',
    );
  });

  it('appends _pkey to a short table name', () => {
    expect(prisma7PrimaryKeyName('Post', undefined, identifierMaxBytes)).toBe('Post_pkey');
  });

  it.each([
    {
      bytes: 59,
      table: 'AnotherModelNameLongEnoughThatPrismaSevenCutsItsKeyNamesXyz',
      name: 'AnotherModelNameLongEnoughThatPrismaSevenCutsItsKeyNamesXy_pkey',
    },
    {
      bytes: 60,
      table: 'ThisModelNameIsLongEnoughThatPrismaSevenCutsItsKeyNamesAbcde',
      name: 'ThisModelNameIsLongEnoughThatPrismaSevenCutsItsKeyNamesAbc_pkey',
    },
    {
      bytes: 60,
      table: 'Ünïcödé_täble_nämé_thät_ïs_löng_ënöügh_tö_cüt',
      name: 'Ünïcödé_täble_nämé_thät_ïs_löng_ënöügh_tö_c_pkey',
    },
  ])('cuts the $bytes-byte table name $table so the name fits 63 bytes', ({ table, name }) => {
    expect(prisma7PrimaryKeyName(table, undefined, identifierMaxBytes)).toBe(name);
  });
});

describe('prisma7ForeignKeyName', () => {
  it('uses the map name when one is given', () => {
    expect(prisma7ForeignKeyName('Post', ['authorId'], 'post_written_by', identifierMaxBytes)).toBe(
      'post_written_by',
    );
  });

  it('joins the table and columns with _fkey', () => {
    expect(prisma7ForeignKeyName('Post', ['authorId'], undefined, identifierMaxBytes)).toBe(
      'Post_authorId_fkey',
    );
  });

  it('cuts the table and columns so the name fits 63 bytes, keeping _fkey', () => {
    expect(
      prisma7ForeignKeyName(
        'ThisModelNameIsLongEnoughThatPrismaSevenCutsItsKeyNamesAbcde',
        ['authorIdentifierWithAVeryLongColumnName'],
        undefined,
        identifierMaxBytes,
      ),
    ).toBe('ThisModelNameIsLongEnoughThatPrismaSevenCutsItsKeyNamesAbc_fkey');
  });
});

describe('implicit many-to-many junction constraints', () => {
  const longRelation =
    'AVeryLongModelNameThatKeepsGoingAndGoingForeverXToAnotherVeryLongModelNameThatAlsoKeepsGoingAndGoing';

  it('names a short junction _{relation}_AB_pkey, _A_fkey and _B_fkey', () => {
    expect(prisma7JunctionPrimaryKeyName('PostToTag', identifierMaxBytes)).toBe(
      '_PostToTag_AB_pkey',
    );
    expect(prisma7JunctionForeignKeyName('PostToTag', 'A', identifierMaxBytes)).toBe(
      '_PostToTag_A_fkey',
    );
    expect(prisma7JunctionForeignKeyName('PostToTag', 'B', identifierMaxBytes)).toBe(
      '_PostToTag_B_fkey',
    );
  });

  it('cuts a long relation name so each name fits 63 bytes, keeping the suffix', () => {
    expect(prisma7JunctionPrimaryKeyName(longRelation, identifierMaxBytes)).toBe(
      '_AVeryLongModelNameThatKeepsGoingAndGoingForeverXToAnot_AB_pkey',
    );
    expect(prisma7JunctionForeignKeyName(longRelation, 'A', identifierMaxBytes)).toBe(
      '_AVeryLongModelNameThatKeepsGoingAndGoingForeverXToAnoth_A_fkey',
    );
    expect(prisma7JunctionForeignKeyName(longRelation, 'B', identifierMaxBytes)).toBe(
      '_AVeryLongModelNameThatKeepsGoingAndGoingForeverXToAnoth_B_fkey',
    );
  });
});
