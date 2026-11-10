import type { MongoQueryExecutor } from '@internal/mongo-orm';
import type { MongoRuntime } from '@internal/mongo-runtime';
import { describe, expectTypeOf, test } from 'vitest';
import { defineContract, field, model, type } from '../src/exports/contract-builder';
import mongo from '../src/runtime/mongo';
import mongoStatic from '../src/static/mongo-static';

const Account = model('Account', {
  collection: 'accounts',
  fields: {
    _id: field.scalar(type.ObjectId()),
    email: field.scalar(type.String()),
  },
});

const contract = defineContract({ models: { Account } });
const db = mongo({ contract });

describe('db.prepare declarations', () => {
  test('reject unknown codec ids', () => {
    // @ts-expect-error -- 'mongo/missing@1' is not one of the contract's codecs
    void db.prepare({ email: 'mongo/missing@1' }, () => db.query.from('accounts').build());
    // @ts-expect-error -- the object form is checked too
    void db.prepare({ email: { codecId: 'mongo/missing@1' } }, () =>
      db.query.from('accounts').build(),
    );
  });

  test('type run params from each codec input, plus null when nullable', async () => {
    const statement = await db.prepare(
      { email: 'mongo/string@1', nickname: { codecId: 'mongo/string@1', nullable: true } },
      (p) =>
        db.query
          .from('accounts')
          .match((f) => f.email.eq(p.email))
          .match((f) => f.email.ne(p.nickname))
          .build(),
    );
    expectTypeOf(statement.query).parameter(1).toEqualTypeOf<{
      readonly email: string;
      readonly nickname: string | null;
    }>();
  });
});

describe('the handle db.prepare returns', () => {
  test('has execute for updates and deletes', async () => {
    const update = await db.prepare({ email: 'mongo/string@1' }, (p) =>
      db.query
        .from('accounts')
        .match((f) => f.email.eq(p.email))
        .updateMany((f) => [f.email.set(p.email)]),
    );
    expectTypeOf(update).toHaveProperty('execute');

    const remove = await db.prepare({ email: 'mongo/string@1' }, (p) =>
      db.query
        .from('accounts')
        .match((f) => f.email.eq(p.email))
        .deleteMany(),
    );
    expectTypeOf(remove).toHaveProperty('execute');
  });

  test('has no execute for reads and inserts', async () => {
    const read = await db.prepare({ email: 'mongo/string@1' }, (p) =>
      db.query
        .from('accounts')
        .match((f) => f.email.eq(p.email))
        .build(),
    );
    expectTypeOf(read).not.toHaveProperty('execute');

    const insert = await db.prepare({ email: 'mongo/string@1' }, (p) =>
      db.query.from('accounts').insertOne({ email: p.email }),
    );
    expectTypeOf(insert).not.toHaveProperty('execute');
  });

  test('refuses a limit whose codec does not take a number', () => {
    void db.prepare({ take: 'mongo/int32@1' }, (p) =>
      db.query.from('accounts').limit(p.take).build(),
    );
    void db.prepare({ take: 'mongo/string@1' }, (p) =>
      // @ts-expect-error -- the string codec's input is not a number
      db.query.from('accounts').limit(p.take).build(),
    );
  });
});

describe('targets', () => {
  test('a MongoRuntime is a target and the client is not', () => {
    expectTypeOf<MongoRuntime>().toExtend<MongoQueryExecutor>();
    expectTypeOf(db).not.toExtend<MongoQueryExecutor>();
  });

  test('mongoStatic() has no prepare', () => {
    expectTypeOf(mongoStatic({ contract })).not.toHaveProperty('prepare');
  });
});
