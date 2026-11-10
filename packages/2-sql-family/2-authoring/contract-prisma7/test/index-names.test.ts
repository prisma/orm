import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { describe, expect, it } from 'vitest';
import { defaultIndexName, prisma7ConstraintName } from '../src/indexes';

const { identifierMaxBytes } = prisma7PostgresBinding;

/**
 * Prisma 7.10.0 cuts a generated constraint name so the whole name fits in
 * PostgreSQL's 63-byte identifier limit: the `{table}_{columns}` part is cut
 * to 63 bytes minus the suffix, on a character boundary, and the suffix is
 * kept whole. Every cut name below appears in
 * `fixtures/long-names/migration.sql`, which Prisma 7.10.0 generated.
 */
describe('defaultIndexName', () => {
  const table = 'AVeryLongModelNameThatKeepsGoingAndGoingForever';

  it('keeps a short name whole', () => {
    expect(defaultIndexName('User', ['email'], true, identifierMaxBytes)).toBe('User_email_key');
    expect(defaultIndexName('Post', ['title', 'category'], false, identifierMaxBytes)).toBe(
      'Post_title_category_idx',
    );
  });

  it('cuts the table and column part so the name is 63 bytes with the suffix', () => {
    expect(
      defaultIndexName(
        table,
        ['anotherVeryLongColumnNameThatIsAlsoQuiteLengthy'],
        true,
        identifierMaxBytes,
      ),
    ).toBe('AVeryLongModelNameThatKeepsGoingAndGoingForever_anotherVery_key');
    expect(
      defaultIndexName(
        table,
        ['aVeryLongColumnNameThatAlsoKeepsGoingAndGoing'],
        false,
        identifierMaxBytes,
      ),
    ).toBe('AVeryLongModelNameThatKeepsGoingAndGoingForever_aVeryLongCo_idx');
    expect(
      defaultIndexName(
        table,
        ['short', 'aVeryLongColumnNameThatAlsoKeepsGoingAndGoing'],
        true,
        identifierMaxBytes,
      ),
    ).toBe('AVeryLongModelNameThatKeepsGoingAndGoingForever_short_aVery_key');
    expect(
      defaultIndexName(
        'Exactly63CharactersLongNameAbcdefghijklmnopqrstuvwxyz0123',
        ['col'],
        false,
        identifierMaxBytes,
      ),
    ).toBe('Exactly63CharactersLongNameAbcdefghijklmnopqrstuvwxyz0123_c_idx');
  });

  it('counts bytes, not characters, and never cuts inside a multi-byte character', () => {
    expect(
      defaultIndexName(
        'Örebrö_Ünïcödé_ModelNameWithMultiByteCharactersInIt',
        ['ünïcödé_cölümn_näme_thät_ïs_älsö_vëry_löng'],
        false,
        identifierMaxBytes,
      ),
    ).toBe('Örebrö_Ünïcödé_ModelNameWithMultiByteCharactersInIt__idx');
  });
});

describe('prisma7ConstraintName', () => {
  const junction =
    '_AVeryLongModelNameThatKeepsGoingAndGoingForeverXToAnotherVeryLongModelNameThatAlsoKeepsGoingAndGoing';

  it('cuts an implicit junction table name to 63 bytes', () => {
    expect(prisma7ConstraintName(junction, '', identifierMaxBytes)).toBe(
      '_AVeryLongModelNameThatKeepsGoingAndGoingForeverXToAnotherVeryL',
    );
  });

  it('cuts the junction B index name around its suffix', () => {
    expect(prisma7ConstraintName(junction, '_B_index', identifierMaxBytes)).toBe(
      '_AVeryLongModelNameThatKeepsGoingAndGoingForeverXToAnot_B_index',
    );
  });
});
