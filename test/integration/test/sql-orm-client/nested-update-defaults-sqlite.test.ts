import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { datetimeColumn, integerColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import { soleDomainNamespaceId } from '@internal/contract/types';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import { defineContract, field, gen, model, rel } from '@internal/sqlite/contract-builder';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const Author = model('Author', {
  fields: { id: field.column(integerColumn).id(), name: field.column(textColumn) },
}).sql({ table: 'authors' });

const Article = model('Article', {
  fields: {
    id: field.column(integerColumn).id(),
    authorId: field.column(integerColumn).column('author_id').optional(),
    updatedAt: field.column(datetimeColumn).column('updated_at').onUpdate(gen.now()),
  },
  relations: { author: rel.belongsTo(Author, { from: 'authorId', to: 'id' }).sql({ fk: {} }) },
}).sql({ table: 'articles' });

const contract = defineContract({ models: { Author, Article } });

const seeded = new Date('2020-01-01T00:00:00.000Z');

type Articles = Collection<typeof contract, 'Article'>;

async function withArticles(fn: (articles: Articles) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'orm-nested-update-defaults-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(`
    create table authors (id integer primary key, name text not null);
    create table articles (id integer primary key, author_id integer, updated_at text not null);
    insert into authors values (1, 'Ada'), (2, 'Grace');
    insert into articles values (10, 1, '${seeded.toISOString()}');
  `);
  database.close();

  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
  });
  const context = createExecutionContext({ contract, stack });
  const { adapter, driver } = instantiateExecutionStack(stack);
  if (adapter === undefined || driver === undefined) {
    throw new InternalError('SQLite execution stack is missing its adapter or driver');
  }
  await driver.connect({ kind: 'path', path });
  const runtime = new SqliteRuntimeImpl({ context, adapter, driver, closeRefusal: undefined });
  try {
    await fn(
      new Collection({ runtime, context }, 'Article', {
        namespaceId: soleDomainNamespaceId(contract.domain),
      }),
    );
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function expectAdvanced(
  articles: Articles,
  updated: { readonly updatedAt: Date } | null,
  authorId: number | null,
): Promise<void> {
  expect(updated).toEqual({ id: 10, authorId, updatedAt: expect.any(Date) });
  expect(updated?.updatedAt.getTime()).toBeGreaterThan(seeded.getTime());
  expect(await articles.select('id', 'authorId', 'updatedAt').where({ id: 10 }).first()).toEqual(
    updated,
  );
}

describe('integration/update() with a relation the parent holds the key for on SQLite', () => {
  it(
    'advances the update default when the only change is a connect',
    async () => {
      await withArticles(async (articles) => {
        const updated = await articles
          .select('id', 'authorId', 'updatedAt')
          .where({ id: 10 })
          .update({ author: (author) => author.connect({ id: 2 }) });

        await expectAdvanced(articles, updated, 2);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'advances the update default when the only change is a create',
    async () => {
      await withArticles(async (articles) => {
        const updated = await articles
          .select('id', 'authorId', 'updatedAt')
          .where({ id: 10 })
          .update({ author: (author) => author.create({ id: 3, name: 'Edsger' }) });

        await expectAdvanced(articles, updated, 3);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'advances the update default when the only change is a disconnect',
    async () => {
      await withArticles(async (articles) => {
        const updated = await articles
          .select('id', 'authorId', 'updatedAt')
          .where({ id: 10 })
          .update({ author: (author) => author.disconnect() });

        await expectAdvanced(articles, updated, null);
      });
    },
    timeouts.databaseOperation,
  );
});
