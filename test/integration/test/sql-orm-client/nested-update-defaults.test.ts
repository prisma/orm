import {
  int4Column,
  textColumn,
  timestamptzJsDateColumn,
} from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { defineContract, field, gen, model, rel } from '@internal/postgres/contract-builder';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { timeouts, withPushedContractRuntime } from './integration-helpers';

const Author = model('Author', {
  fields: { id: field.column(int4Column).id(), name: field.column(textColumn) },
}).sql({ table: 'ud_authors' });

const Article = model('Article', {
  fields: {
    id: field.column(int4Column).id(),
    title: field.column(textColumn).optional(),
    authorId: field.column(int4Column).column('author_id').optional(),
    updatedAt: field.column(timestamptzJsDateColumn).column('updated_at').onUpdate(gen.now()),
  },
  relations: { author: rel.belongsTo(Author, { from: 'authorId', to: 'id' }).sql({ fk: {} }) },
}).sql({ table: 'ud_articles' });

const contract = defineContract({
  models: {
    Author: Author.relations({ articles: rel.hasMany(() => Article, { by: 'authorId' }) }).sql({
      table: 'ud_authors',
    }),
    Article,
  },
});
const context = createExecutionContext({
  contract,
  stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
});

const seeded = new Date('2020-01-01T00:00:00.000Z');

type Articles = Collection<typeof contract, 'Article'>;
type Authors = Collection<typeof contract, 'Author'>;

async function withArticles(
  fn: (articles: Articles, authors: Authors) => Promise<void>,
): Promise<void> {
  await withPushedContractRuntime(contract, async (runtime) => {
    await runtime.query(`insert into ud_authors (id, name) values (1, 'Ada'), (2, 'Grace')`);
    await runtime.query(
      `insert into ud_articles (id, author_id, updated_at) values (10, 1, '${seeded.toISOString()}')`,
    );
    await fn(
      new Collection({ runtime, context }, 'Article', { namespaceId: 'public' }),
      new Collection({ runtime, context }, 'Author', { namespaceId: 'public' }),
    );
  });
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

describe('integration/update() with a relation the parent holds the key for', () => {
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
    timeouts.spinUpPpgDev,
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
    timeouts.spinUpPpgDev,
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
    timeouts.spinUpPpgDev,
  );
  it(
    'advances the update default when the only change is a disconnect whose criteria match the linked row',
    async () => {
      await withArticles(async (articles) => {
        const updated = await articles
          .select('id', 'authorId', 'updatedAt')
          .where({ id: 10 })
          .update({ author: (author) => author.disconnect([{ id: 1 }]) });

        await expectAdvanced(articles, updated, null);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'keeps an update default the update sets itself when a disconnect whose criteria match unlinks the row',
    async () => {
      await withArticles(async (articles) => {
        const explicit = new Date('2021-06-01T00:00:00.000Z');
        const updated = await articles
          .select('id', 'authorId', 'updatedAt')
          .where({ id: 10 })
          .update({ updatedAt: explicit, author: (author) => author.disconnect([{ id: 1 }]) });

        expect(updated).toEqual({ id: 10, authorId: null, updatedAt: explicit });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'advances the update default of the child that where().update() changes on a relation the child holds the key for',
    async () => {
      await withArticles(async (articles, authors) => {
        await authors
          .where({ id: 1 })
          .update({ articles: (list) => list.where({ id: 10 }).update({ title: 'New' }) });
        const updated = await articles.select('id', 'title', 'updatedAt').where({ id: 10 }).first();

        expect(updated).toEqual({ id: 10, title: 'New', updatedAt: expect.any(Date) });
        expect(updated?.updatedAt.getTime()).toBeGreaterThan(seeded.getTime());
      });
    },
    timeouts.spinUpPpgDev,
  );
});
