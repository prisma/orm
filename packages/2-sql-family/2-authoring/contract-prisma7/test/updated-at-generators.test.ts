import { getAuthoringTypeConstructor } from '@internal/framework-components/authoring';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { describe, expect, it } from 'vitest';
import { interpretSchemaText, postgresSourceContext } from './support';

const PRISMA7_POSTGRES_DATE_TIME_NATIVE_TYPES = [
  'Timestamp',
  'Timestamptz',
  'Date',
  'Time',
  'Timetz',
] as const;

describe('@updatedAt on Postgres', () => {
  const { authoringContributions, generatorFunctions } = postgresSourceContext([]);
  const { typeMap } = prisma7PostgresBinding;
  const mappingOf = (table: typeof typeMap.scalars, name: string) => {
    const mapping = table[name];
    if (mapping === undefined) throw new Error(`the Prisma 7 type table has no ${name}`);
    return mapping;
  };
  const mappings = [
    ['DateTime', mappingOf(typeMap.scalars, 'DateTime')],
    ...PRISMA7_POSTGRES_DATE_TIME_NATIVE_TYPES.map(
      (nativeType) => [`@db.${nativeType}`, mappingOf(typeMap.nativeTypes, nativeType)] as const,
    ),
  ] as const;

  it.each(mappings)('resolves now() for the codec %s maps to', (_type, mapping) => {
    const codecId = getAuthoringTypeConstructor(authoringContributions, [mapping.constructorName])
      ?.output.codecId;
    expect(codecId).toBeDefined();
    expect(
      generatorFunctions?.resolve(
        { name: 'now', args: {} },
        { codecId: codecId ?? '', typeParams: undefined, length: undefined },
      ),
    ).toMatchObject({ ok: true, generator: { kind: 'generator' } });
  });

  it('lowers to now() on create and on update, with the precision of a time or timestamp column', () => {
    const contract = interpretSchemaText(`datasource db {
  provider = "postgresql"
}

model Clock {
  id        Int      @id
  updatedAt DateTime @updatedAt
  seenAt    DateTime @db.Time(0) @updatedAt
  stampedAt DateTime @db.Timestamp(0) @updatedAt
}
`);
    const now = (id: string, params?: Record<string, unknown>) =>
      params === undefined ? { kind: 'generator', id } : { kind: 'generator', id, params };
    const ref = (field: string) => ({ namespace: 'public', entry: 'Clock', field });
    expect(contract.execution?.mutations.defaults).toEqual([
      {
        ref: ref('seenAt'),
        onCreate: now('timeStringNow', { precision: 0 }),
        onUpdate: now('timeStringNow', { precision: 0 }),
      },
      {
        ref: ref('stampedAt'),
        onCreate: now('timestampNow', { precision: 0 }),
        onUpdate: now('timestampNow', { precision: 0 }),
      },
      {
        ref: ref('updatedAt'),
        onCreate: now('timestampNow', { precision: 3 }),
        onUpdate: now('timestampNow', { precision: 3 }),
      },
    ]);
  });
});
