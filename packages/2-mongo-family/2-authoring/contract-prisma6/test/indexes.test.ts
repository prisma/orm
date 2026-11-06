import { describe, expect, it } from 'vitest';
import { prisma6IndexName, prisma6IndexNameProblem } from '../src/indexes';

describe('prisma6IndexName', () => {
  it('joins the collection and the stored fields, with _key for a unique index and _idx for others', () => {
    expect({
      unique: prisma6IndexName('User', ['email'], true),
      plain: prisma6IndexName('users', ['author_id', 'createdAt'], false),
    }).toEqual({ unique: 'User_email_key', plain: 'users_author_id_createdAt_idx' });
  });

  it('cuts the name before the suffix to 127 bytes, between characters, as Prisma 6 does', () => {
    const long = prisma6IndexName('c', ['f'.repeat(200)], false);
    const multiByte = prisma6IndexName('c', [`${'f'.repeat(119)}é`], true);
    expect({
      long: [long.length, long.endsWith('_idx'), long.startsWith(`c_${'f'.repeat(121)}_`)],
      exactlyFull: prisma6IndexName('c', ['f'.repeat(121)], false).length,
      multiByte,
    }).toEqual({
      long: [127, true, true],
      exactlyFull: 127,
      multiByte: `c_${'f'.repeat(119)}é_key`,
    });
  });

  it('cuts a multi-byte character that would cross the limit', () => {
    expect(prisma6IndexName('c', [`${'f'.repeat(120)}é`], true)).toBe(`c_${'f'.repeat(120)}_key`);
  });
});

describe('prisma6IndexNameProblem', () => {
  it('refuses an empty name and one longer than 127 bytes', () => {
    expect({
      empty: prisma6IndexNameProblem(''),
      atLimit: prisma6IndexNameProblem('n'.repeat(127)),
      overLimit: prisma6IndexNameProblem('é'.repeat(64)) !== undefined,
    }).toEqual({
      empty: 'The `map` argument cannot be an empty string.',
      atLimit: undefined,
      overLimit: true,
    });
  });
});
