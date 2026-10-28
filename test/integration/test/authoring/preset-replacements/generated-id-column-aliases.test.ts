import type { Contract } from '@internal/contract/types';
import { defineContract as definePostgresContract } from '@internal/postgres/contract-builder';
import { defineContract as defineSqliteContract } from '@internal/sqlite/contract-builder';
import { describe, expect, it } from 'vitest';
import {
  emitPostgres,
  emitSqlite,
  type Interpreted,
  interpretPostgres,
  interpretSqlite,
} from './preset-replacement-contracts';

const ALIASES = [
  ['UuidString', 36, 'uuid()'],
  ['Ulid', 26, 'ulid()'],
  ['Nanoid', 21, 'nanoid()'],
  ['Cuid2', 24, 'cuid(2)'],
  ['Ksuid', 27, 'ksuid()'],
] as const;

function schema(column: string, generator: string): string {
  return `model Author {
  id    ${column} @id @onCreate(${generator})
  posts Post[]
}

model Post {
  id       Int     @id
  authorId ${column}
  author   Author  @relation(fields: [authorId], references: [id])
}
`;
}

async function emitted(
  interpret: (schema: string) => Interpreted,
  emit: (contract: Contract) => Promise<string>,
  source: string,
): Promise<unknown> {
  const interpreted = interpret(source);
  if (!interpreted.ok) {
    throw new Error(`the schema did not interpret: ${JSON.stringify(interpreted.failure)}`);
  }
  return JSON.parse(await emit(interpreted.value));
}

describe('a generated id column alias on a key and the foreign key that copies it', () => {
  it.each(ALIASES)(
    'on postgres, %s emits the contract Char(%i) emits',
    async (alias, length, generator) => {
      expect(await emitted(interpretPostgres, emitPostgres, schema(alias, generator))).toEqual(
        await emitted(interpretPostgres, emitPostgres, schema(`Char(${length})`, generator)),
      );
    },
  );

  it.each(ALIASES)(
    'on postgres, sql.%s emits the contract Char(%i) emits',
    async (alias, length, generator) => {
      expect(
        await emitted(interpretPostgres, emitPostgres, schema(`sql.${alias}`, generator)),
      ).toEqual(
        await emitted(interpretPostgres, emitPostgres, schema(`Char(${length})`, generator)),
      );
    },
  );

  it.each(ALIASES)(
    'on sqlite, sql.%s emits the contract sql.Char(%i) emits',
    async (alias, length, generator) => {
      expect(await emitted(interpretSqlite, emitSqlite, schema(`sql.${alias}`, generator))).toEqual(
        await emitted(interpretSqlite, emitSqlite, schema(`sql.Char(${length})`, generator)),
      );
    },
  );
});

function diagnosticsOf(interpret: (schema: string) => Interpreted, field: string) {
  const interpreted = interpret(`model Token {\n  id    Int @id\n  value ${field}\n}\n`);
  return interpreted.ok
    ? []
    : interpreted.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

describe('a generator on a generated id column alias', () => {
  it.each([
    [
      'Ulid @onCreate(uuid())',
      'uuid() writes 36 characters, which does not fit a column of 26 characters.',
    ],
    [
      'sql.Ulid @onCreate(uuid())',
      'uuid() writes 36 characters, which does not fit a column of 26 characters.',
    ],
    [
      'Nanoid @onCreate(nanoid(30))',
      'nanoid(30) writes 30 characters, which does not fit a column of 21 characters.',
    ],
  ] as const)(
    'is refused on postgres when it writes more than the alias stores: %s',
    (field, message) => {
      expect(diagnosticsOf(interpretPostgres, field)).toEqual([
        { code: 'PSL_GENERATOR_NOT_APPLICABLE', message: `Field "Token.value": ${message}` },
      ]);
    },
  );
});

function postgresKeyAndForeignKey(written: 'alias' | 'char'): Contract {
  return definePostgresContract({}, ({ field, model, rel, gen, type }) => {
    const column = () => field.column(written === 'alias' ? type.Ulid() : type.Char(26));
    const Author = model('Author', { fields: { id: column().id().onCreate(gen.ulid()) } });
    const Post = model('Post', {
      fields: { id: field.column(type.Int()).id(), authorId: column() },
    });
    return {
      models: {
        Author: Author.relations({ posts: rel.hasMany(Post, { by: 'authorId' }) }),
        Post: Post.relations({ author: rel.belongsTo(Author, { from: 'authorId', to: 'id' }) }),
      },
    };
  });
}

function sqliteKeyAndForeignKey(written: 'alias' | 'char'): Contract {
  return defineSqliteContract({}, ({ field, model, rel, gen, type }) => {
    const column = () => field.column(written === 'alias' ? type.sql.Ulid() : type.sql.Char(26));
    const Author = model('Author', { fields: { id: column().id().onCreate(gen.ulid()) } });
    const Post = model('Post', {
      fields: { id: field.column(type.Int()).id(), authorId: column() },
    });
    return {
      models: {
        Author: Author.relations({ posts: rel.hasMany(Post, { by: 'authorId' }) }),
        Post: Post.relations({ author: rel.belongsTo(Author, { from: 'authorId', to: 'id' }) }),
      },
    };
  });
}

describe('a generated id column alias in TypeScript on a key and the foreign key that copies it', () => {
  it('on postgres, type.Ulid() emits the contract type.Char(26) emits', async () => {
    const alias = JSON.parse(await emitPostgres(postgresKeyAndForeignKey('alias')));
    expect(alias.storage.namespaces.public.entries.table.Post.columns.authorId).toMatchObject({
      codecId: 'sql/char@1',
      typeParams: { length: 26 },
    });
    expect(Object.keys(alias.domain.namespaces.public.models.Post.relations)).toEqual(['author']);
    expect(alias).toEqual(JSON.parse(await emitPostgres(postgresKeyAndForeignKey('char'))));
  });

  it('on sqlite, type.sql.Ulid() emits the contract type.sql.Char(26) emits', async () => {
    expect(JSON.parse(await emitSqlite(sqliteKeyAndForeignKey('alias')))).toEqual(
      JSON.parse(await emitSqlite(sqliteKeyAndForeignKey('char'))),
    );
  });
});
