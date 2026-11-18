import { describe, expect, it } from 'vitest';
import { interpretSchemaText, interpretSchemaTextResult, serializedTable } from './support';

const now = (id: string, params?: Record<string, unknown>) =>
  params === undefined ? { kind: 'generator', id } : { kind: 'generator', id, params };
const ref = (field: string) => ({ namespace: 'public', entry: 'Post', field });
const databaseNow = { kind: 'function', expression: 'now()' };

describe('@default(now()) on Postgres', () => {
  it('lowers to the database default now() and the now generator on create, resolved by codec', () => {
    const contract = interpretSchemaText(`datasource db {
  provider = "postgresql"
}

model Post {
  id         Int       @id
  createdAt  DateTime  @default(now())
  optionalAt DateTime? @default(now())
  zonedAt    DateTime  @default(now()) @db.Timestamptz(6)
  day        DateTime  @default(now()) @db.Date
  clock      DateTime  @default(now()) @db.Time(0)
}
`);
    const { columns } = serializedTable(contract, 'Post');
    expect(
      Object.fromEntries(
        ['createdAt', 'optionalAt', 'zonedAt', 'day', 'clock'].map((name) => [
          name,
          columns[name]?.['default'],
        ]),
      ),
    ).toEqual({
      createdAt: databaseNow,
      optionalAt: databaseNow,
      zonedAt: databaseNow,
      day: databaseNow,
      clock: databaseNow,
    });
    expect(contract.execution?.mutations.defaults).toEqual([
      { ref: ref('clock'), onCreate: now('timeStringNow', { precision: 0 }) },
      { ref: ref('createdAt'), onCreate: now('timestampNow', { precision: 3 }) },
      { ref: ref('day'), onCreate: now('dateStringNow') },
      { ref: ref('optionalAt'), onCreate: now('timestampNow', { precision: 3 }) },
      { ref: ref('zonedAt'), onCreate: now('timestampNow', { precision: 6 }) },
    ]);
  });

  it('keeps the database default and writes now on create and on update with @updatedAt', () => {
    const contract = interpretSchemaText(`datasource db {
  provider = "postgresql"
}

model Post {
  id        Int      @id
  updatedAt DateTime @default(now()) @updatedAt
}
`);
    expect(serializedTable(contract, 'Post').columns['updatedAt']?.['default']).toEqual(
      databaseNow,
    );
    expect(contract.execution?.mutations.defaults).toEqual([
      {
        ref: ref('updatedAt'),
        onCreate: now('timestampNow', { precision: 3 }),
        onUpdate: now('timestampNow', { precision: 3 }),
      },
    ]);
  });

  it('is refused on a field that is not a DateTime, as Prisma 7 refuses it', () => {
    const result = interpretSchemaTextResult(`datasource db {
  provider = "postgresql"
}

model Post {
  id    Int    @id
  title String @default(now())
  stamp DateTime @default(now()) @db.Text
}
`);
    expect(result.ok ? [] : result.failure.diagnostics.map(({ message }) => message)).toEqual([
      'Field "Post.title": @default(now()) needs a DateTime field, but the field has type "String". Prisma 7 refuses this schema too. Remove @default(now()), or change the field\'s type to DateTime.',
      'Field "Post.stamp": @default(now()) needs a date or time column, but "@db.Text" makes it a column that is not a date or time. Prisma 7 refuses this schema too: "Native type Text is not compatible with declared field type DateTime". Remove @default(now()), or use a date or time native type such as @db.Timestamp.',
    ]);
  });
});
