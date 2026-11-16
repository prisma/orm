import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { MongoQueryExecutor } from '@internal/mongo-orm';
import type { UpdateResult } from '@internal/mongo-query-builder';
import type {
  MongoPreparedExecution,
  MongoPreparedStatement,
  MongoRuntime,
} from '@internal/mongo-runtime';
import { describe, expectTypeOf, test } from 'vitest';
import { defineContract, field, model, type } from '../src/exports/contract-builder';
import type {
  MongoClient,
  MongoPreparedRowQuery,
  MongoPrepareMember,
} from '../src/exports/runtime';
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

describe('the handle db.prepare returns for an ORM read', () => {
  type AccountRow = Awaited<ReturnType<typeof db.orm.accounts.firstOrThrow>>;

  test('returns the result the ad-hoc read returns', async () => {
    const all = await db.prepare({ email: 'mongo/string@1' }, (p) =>
      db.orm.accounts.where({ email: p.email }).prepared.all(),
    );
    const first = await db.prepare({ email: 'mongo/string@1' }, (p) =>
      db.orm.accounts.where({ email: p.email }).prepared.first(),
    );
    const firstOrThrow = await db.prepare({ email: 'mongo/string@1' }, (p) =>
      db.orm.accounts.where({ email: p.email }).prepared.firstOrThrow(),
    );
    const runtime = await db.runtime();

    expectTypeOf(all.query(runtime, { email: 'a' })).toEqualTypeOf<
      AsyncIterableResult<AccountRow>
    >();
    expectTypeOf(first.query(runtime, { email: 'a' })).toEqualTypeOf<Promise<AccountRow | null>>();
    expectTypeOf(firstOrThrow.query(runtime, { email: 'a' })).toEqualTypeOf<Promise<AccountRow>>();
  });

  test('types run params from the declaration', async () => {
    const page = await db.prepare({ email: 'mongo/string@1', take: 'mongo/int32@1' }, (p) =>
      db.orm.accounts.where({ email: p.email }).limit(p.take).prepared.all(),
    );
    expectTypeOf(page.query).parameter(1).toEqualTypeOf<{
      readonly email: string;
      readonly take: number;
    }>();
  });

  test('has no execute', async () => {
    const all = await db.prepare({ email: 'mongo/string@1' }, (p) =>
      db.orm.accounts.where({ email: p.email }).prepared.all(),
    );
    expectTypeOf(all).not.toHaveProperty('execute');
  });

  test('refuses an ad-hoc read, which would run inside the callback', () => {
    void db.prepare({ email: 'mongo/string@1' }, (p) =>
      // @ts-expect-error -- first() sends the query and returns a promise, not a prepared read
      db.orm.accounts.where({ email: p.email }).first(),
    );
    void db.prepare({ email: 'mongo/string@1' }, (p) =>
      // @ts-expect-error -- all() sends the query and returns a row stream, not a prepared read
      db.orm.accounts.where({ email: p.email }).all(),
    );
  });

  test('refuses a placeholder whose codec is not the field codec', () => {
    void db.prepare({ id: 'mongo/objectId@1' }, (p) =>
      // @ts-expect-error -- email is a string field
      db.orm.accounts.where({ email: p.id }).prepared.all(),
    );
  });
});

describe('MongoPrepareMember', () => {
  type Contract = typeof contract;

  test('a client has the prepare it describes', () => {
    expectTypeOf<MongoClient<Contract>>().toExtend<MongoPrepareMember<Contract>>();
  });

  test('types an ORM read, a plan and an update plan', async () => {
    type Params = { readonly email: string };
    type AccountRow = Awaited<ReturnType<typeof db.orm.accounts.firstOrThrow>>;
    type PlanRow = { readonly _id: string; readonly email: string };
    expectTypeOf<AccountRow>().toExtend<{ _id: string; email: string }>();
    expectTypeOf<{ _id: string; email: string }>().toExtend<AccountRow>();
    const member: MongoPrepareMember<Contract> = db;
    const runtime = await db.runtime();

    const first = await member.prepare({ email: 'mongo/string@1' }, (p) =>
      db.orm.accounts.where({ email: p.email }).prepared.first(),
    );
    const all = await member.prepare({ email: 'mongo/string@1' }, (p) =>
      db.orm.accounts.where({ email: p.email }).prepared.all(),
    );
    const plan = await member.prepare({ email: 'mongo/string@1' }, (p) =>
      db.query
        .from('accounts')
        .match((f) => f.email.eq(p.email))
        .build(),
    );
    const update = await member.prepare({ email: 'mongo/string@1' }, (p) =>
      db.query
        .from('accounts')
        .match((f) => f.email.eq(p.email))
        .updateMany((f) => [f.email.set(p.email)]),
    );

    expectTypeOf(first).toEqualTypeOf<MongoPreparedRowQuery<Params, Promise<AccountRow | null>>>();
    expectTypeOf(first.query(runtime, { email: 'a' })).toEqualTypeOf<Promise<AccountRow | null>>();
    expectTypeOf(all.query(runtime, { email: 'a' })).toEqualTypeOf<
      AsyncIterableResult<AccountRow>
    >();
    expectTypeOf(plan).toEqualTypeOf<MongoPreparedStatement<Params, PlanRow>>();
    expectTypeOf(update).toEqualTypeOf<MongoPreparedExecution<Params, UpdateResult>>();
    // @ts-expect-error -- 'mongo/missing@1' is not one of the contract's codecs
    void member.prepare({ email: 'mongo/missing@1' }, () => db.query.from('accounts').build());
  });

  test('the upgrade note replacements type-check', async () => {
    const clientPrepare: MongoPrepareMember<Contract> = db;
    const runtimePrepare: Pick<MongoRuntime, 'prepare'> = await db.runtime();
    // @ts-expect-error -- MongoRuntime['prepare'] is the method's function type, which a runtime is not
    const notARuntime: MongoRuntime['prepare'] = await db.runtime();
    void [clientPrepare, runtimePrepare, notARuntime];
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
