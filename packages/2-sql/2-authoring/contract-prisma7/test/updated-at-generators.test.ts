import { getAuthoringTypeConstructor } from '@internal/framework-components/authoring';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { describe, expect, it } from 'vitest';
import { postgresSourceContext } from './support';

const PRISMA7_POSTGRES_DATE_TIME_NATIVE_TYPES = [
  'Timestamp',
  'Timestamptz',
  'Date',
  'Time',
  'Timetz',
] as const;

describe('the Postgres binding for @updatedAt', () => {
  const { authoringContributions } = postgresSourceContext([]);
  const { typeMap } = prisma7PostgresBinding;
  const mappings = [
    ['DateTime', typeMap.scalars.DateTime],
    ...PRISMA7_POSTGRES_DATE_TIME_NATIVE_TYPES.map(
      (nativeType) => [`@db.${nativeType}`, typeMap.nativeTypes[nativeType]] as const,
    ),
  ] as const;

  it.each(mappings)('gives %s a "now" generator', (_type, mapping) => {
    const codecId = getAuthoringTypeConstructor(authoringContributions, [mapping.constructorName])
      ?.output.codecId;
    expect(codecId).toBeDefined();
    expect(prisma7PostgresBinding.updatedAtGenerator({ codecId: codecId ?? '' })).toMatchObject({
      kind: 'generator',
    });
  });

  it('gives a time column its precision as the generator param', () => {
    expect(
      prisma7PostgresBinding.updatedAtGenerator({
        codecId: 'pg/time-string@1',
        typeParams: { precision: 0 },
      }),
    ).toEqual({ kind: 'generator', id: 'timeStringNow', params: { precision: 0 } });
  });

  it('gives a timestamp column no generator params', () => {
    expect(
      prisma7PostgresBinding.updatedAtGenerator({
        codecId: 'pg/timestamp-string@1',
        typeParams: { precision: 0 },
      }),
    ).toEqual({ kind: 'generator', id: 'timestampStringNow' });
  });
});
