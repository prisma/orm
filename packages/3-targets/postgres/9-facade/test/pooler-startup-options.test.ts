import { prismaPostgresPoolerRefusesOptions } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

describe('the Prisma Postgres pooler stand-in reads startup options as PostgreSQL does', () => {
  it.each([
    ['no options', ''],
    ['DateStyle alone', '-c DateStyle=ISO'],
    ['every allowed setting', '-c DateStyle=ISO -c TimeZone=UTC -c extra_float_digits=3'],
    ['a value with a backslash-escaped space', '-c DateStyle=ISO,\\ MDY'],
    ['the -cname=value and --name=value forms', '-cDateStyle=ISO --TimeZone=UTC'],
    ['a name with dashes for underscores', '--extra-float-digits=3'],
    ['a name in another case', '-c datestyle=ISO'],
  ])('accepts %s', (_case, options) => {
    expect(prismaPostgresPoolerRefusesOptions(options)).toBe(false);
  });

  it.each([
    ['lc_monetary', '-c DateStyle=ISO -c lc_monetary=C'],
    ['a setting after an escaped space', '-c DateStyle=ISO,\\ MDY -c search_path=app'],
    ['a name with an escaped backslash', '-c Date\\\\Style=ISO'],
  ])('refuses %s', (_case, options) => {
    expect(prismaPostgresPoolerRefusesOptions(options)).toBe(true);
  });
});
