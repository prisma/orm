import { describe, expect, it } from 'vitest';
import { prisma7PostgresTypeMap } from '../src/core/prisma7-type-map';
import { postgresScalarAndNativeTypeConstructors } from '../src/core/type-constructors';

const TEMPORAL_CODEC_IDS = [
  'pg/date-temporal@1',
  'pg/timestamp-temporal@1',
  'pg/timestamp-instant@1',
  'pg/timestamptz-temporal@1',
  'pg/time-temporal@1',
];

const constructorNames = [
  ...Object.entries(postgresScalarAndNativeTypeConstructors)
    .filter(([, descriptor]) => 'inferred' in descriptor)
    .map(([name]) => ({ source: 'contract infer', name })),
  ...[
    ...Object.values(prisma7PostgresTypeMap.scalars),
    ...Object.values(prisma7PostgresTypeMap.nativeTypes),
  ].map(({ constructorPath }) => ({ source: 'prisma7Schema', name: constructorPath.join('.') })),
];

function codecIdOf(name: string): string | undefined {
  const descriptor = Object.hasOwn(postgresScalarAndNativeTypeConstructors, name)
    ? postgresScalarAndNativeTypeConstructors[
        name as keyof typeof postgresScalarAndNativeTypeConstructors
      ]
    : undefined;
  return descriptor?.kind === 'typeConstructor' ? descriptor.output.codecId : undefined;
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

describe('the constructors marked inferred', () => {
  it('name no codec that needs Temporal', () => {
    expect(
      Object.entries(postgresScalarAndNativeTypeConstructors)
        .flatMap(([name, descriptor]) =>
          descriptor.kind === 'typeConstructor' && 'inferred' in descriptor
            ? [{ name, codecId: descriptor.output.codecId }]
            : [],
        )
        .filter(({ codecId }) => TEMPORAL_CODEC_IDS.includes(codecId)),
    ).toEqual([]);
  });
});
