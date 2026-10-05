import { describe, expect, it } from 'vitest';
import { prisma7PostgresTypeMap } from '../../../3-targets/postgres/src/core/prisma7-type-map';
import { INFERRED_PSL_TYPE_NAMES } from '../../../3-targets/postgres/src/core/psl-build/postgres-type-map';
import { postgresPslTypeConstructors } from '../src/core/control-mutation-defaults';

const TEMPORAL_CODEC_IDS = [
  'pg/date-temporal@1',
  'pg/timestamp-temporal@1',
  'pg/timestamptz-temporal@1',
  'pg/time-temporal@1',
];

const constructorNames = [
  ...[...INFERRED_PSL_TYPE_NAMES].map((name) => ({ source: 'contract infer', name })),
  ...[
    ...Object.values(prisma7PostgresTypeMap.scalars),
    ...Object.values(prisma7PostgresTypeMap.nativeTypes),
  ].map(({ constructorName }) => ({ source: 'prisma7Schema', name: constructorName })),
];

function codecIdOf(name: string): string | undefined {
  return Object.hasOwn(postgresPslTypeConstructors, name)
    ? postgresPslTypeConstructors[name as keyof typeof postgresPslTypeConstructors].output.codecId
    : undefined;
}

describe('the types contract infer and prisma7Schema write', () => {
  it('names a type constructor the adapter contributes for every entry', () => {
    expect(constructorNames.length).toBeGreaterThan(30);
    expect(constructorNames.filter(({ name }) => codecIdOf(name) === undefined)).toEqual([]);
  });

  it('binds no column to a codec that needs Temporal', () => {
    expect(
      constructorNames
        .map(({ source, name }) => ({ source, name, codecId: codecIdOf(name) }))
        .filter(({ codecId }) => codecId !== undefined && TEMPORAL_CODEC_IDS.includes(codecId)),
    ).toEqual([]);
  });
});
