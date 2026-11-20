import { defineContract, field, model, rel, type } from '@internal/mongo/contract-builder';
import mongo from '@internal/mongo/runtime';
import { MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import { timeouts } from '@repo/test-utils';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const Team = model('Team', {
  collection: 'teams',
  fields: {
    _id: field.scalar(type.ObjectId()),
    name: field.scalar(type.String()),
  },
});

const Member = model('Member', {
  collection: 'members',
  fields: {
    _id: field.scalar(type.ObjectId()),
    name: field.scalar(type.String()),
    nickname: field.scalar(type.String()).optional(),
    tags: field.scalar(type.String()).many(),
    teamId: field.scalar(type.ObjectId()),
  },
  relations: { team: rel.belongsTo(Team, { from: 'teamId', to: Team.ref('_id') }) },
});

const contract = defineContract({ models: { Team, Member } });

const dbName = 'prepare_client_orm_reads';
const red = new ObjectId('65f000000000000000000001');
const blue = new ObjectId('65f000000000000000000002');
const ann = new ObjectId('65f0000000000000000000a1');

describe('db.prepare with ORM reads through mongo()', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [
        { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
      ],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    const db = client.db(dbName);
    await db.collection('teams').insertMany([
      { _id: red, name: 'Red' },
      { _id: blue, name: 'Blue' },
    ]);
    await db.collection('members').insertMany([
      { _id: ann, name: 'Ann', nickname: 'Annie', tags: ['admin'], teamId: red },
      { name: 'Bob', nickname: null, tags: ['staff'], teamId: red },
      { name: 'Cid', tags: ['staff', 'admin'], teamId: blue },
      { name: 'Dee', nickname: 'D', tags: ['staff'], teamId: blue },
    ]);
  }, timeouts.spinUpMongoMemoryServer);

  afterAll(async () => {
    await client?.close();
    await replSet?.stop();
  }, timeouts.spinUpMongoMemoryServer);

  function connectDb() {
    return mongo({ contract, mongoClient: client, dbName });
  }

  it('runs all() with a where placeholder and limit and offset placeholders, once per params', async () => {
    const db = connectDb();
    const page = await db.prepare(
      { tag: 'mongo/string@1', skip: 'mongo/int32@1', take: 'mongo/int32@1' },
      (p) =>
        db.orm.members
          .where({ tags: p.tag })
          .select('name')
          .orderBy({ name: 1 })
          .offset(p.skip)
          .limit(p.take)
          .prepared.all(),
    );
    const runtime = await db.runtime();

    const runs = {
      staff: await page.query(runtime, { tag: 'staff', skip: 0, take: 10 }).toArray(),
      secondStaff: await page.query(runtime, { tag: 'staff', skip: 1, take: 1 }).toArray(),
      admins: await page.query(runtime, { tag: 'admin', skip: 0, take: 10 }).toArray(),
    };

    expect(runs).toEqual({
      staff: [{ name: 'Bob' }, { name: 'Cid' }, { name: 'Dee' }],
      secondStaff: [{ name: 'Cid' }],
      admins: [{ name: 'Ann' }, { name: 'Cid' }],
    });
    await db.close();
  });

  it('runs first() as one row or null', async () => {
    const db = connectDb();
    const byName = await db.prepare({ name: 'mongo/string@1' }, (p) =>
      db.orm.members.where({ name: p.name }).select('name', 'tags').prepared.first(),
    );
    const runtime = await db.runtime();

    expect({
      found: await byName.query(runtime, { name: 'Cid' }),
      missing: await byName.query(runtime, { name: 'Zed' }),
    }).toEqual({ found: { name: 'Cid', tags: ['staff', 'admin'] }, missing: null });
    await db.close();
  });

  it('runs firstOrThrow() as one row, rejecting when nothing matches', async () => {
    const db = connectDb();
    const byName = await db.prepare({ name: 'mongo/string@1' }, (p) =>
      db.orm.members.where({ name: p.name }).select('name').prepared.firstOrThrow(),
    );
    const runtime = await db.runtime();

    expect(await byName.query(runtime, { name: 'Dee' })).toEqual({ name: 'Dee' });
    await expect(byName.query(runtime, { name: 'Zed' })).rejects.toMatchObject({
      code: 'RUNTIME.NO_ROWS',
    });
    await db.close();
  });

  it('matches null and missing values with a nullable placeholder given null', async () => {
    const db = connectDb();
    const byNickname = await db.prepare(
      { nickname: { codecId: 'mongo/string@1', nullable: true } },
      (p) =>
        db.orm.members
          .where({ nickname: p.nickname })
          .select('name')
          .orderBy({ name: 1 })
          .prepared.all(),
    );
    const runtime = await db.runtime();

    expect({
      none: await byNickname.query(runtime, { nickname: null }).toArray(),
      annie: await byNickname.query(runtime, { nickname: 'Annie' }).toArray(),
    }).toEqual({ none: [{ name: 'Bob' }, { name: 'Cid' }], annie: [{ name: 'Ann' }] });
    await db.close();
  });

  it('encodes each value with the declared codec', async () => {
    const db = connectDb();
    const byId = await db.prepare({ id: 'mongo/objectId@1' }, (p) =>
      db.orm.members.where({ _id: p.id }).select('name').prepared.first(),
    );
    const byTeam = await db.prepare({ teamId: 'mongo/objectId@1' }, (p) =>
      db.orm.members
        .where(MongoFieldFilter.eq('teamId', p.teamId))
        .select('name')
        .orderBy({ name: 1 })
        .prepared.all(),
    );
    const runtime = await db.runtime();

    expect({
      byId: await byId.query(runtime, { id: ann.toHexString() }),
      byTeam: await byTeam.query(runtime, { teamId: blue.toHexString() }).toArray(),
    }).toEqual({ byId: { name: 'Ann' }, byTeam: [{ name: 'Cid' }, { name: 'Dee' }] });
    await db.close();
  });

  it('runs a read with an include', async () => {
    const db = connectDb();
    const withTeam = await db.prepare({ name: 'mongo/string@1' }, (p) =>
      db.orm.members.where({ name: p.name }).include('team').prepared.firstOrThrow(),
    );
    const runtime = await db.runtime();

    expect(await withTeam.query(runtime, { name: 'Ann' })).toEqual({
      _id: ann.toHexString(),
      name: 'Ann',
      nickname: 'Annie',
      tags: ['admin'],
      teamId: red.toHexString(),
      team: { _id: red.toHexString(), name: 'Red' },
    });
    await db.close();
  });

  it('refuses a limit placeholder that first() replaces, as unused', async () => {
    const db = connectDb();

    await expect(
      db.prepare({ take: 'mongo/int32@1' }, (p) => db.orm.members.limit(p.take).prepared.first()),
    ).rejects.toMatchObject({
      code: 'RUNTIME.PREPARE_UNUSED_PARAM',
      details: { unused: ['take'] },
    });
    await db.close();
  });

  it('refuses a placeholder whose codec is not the field codec in a filter expression', async () => {
    const db = connectDb();

    await expect(
      db.prepare({ name: 'mongo/string@1' }, (p) =>
        db.orm.members.where(MongoFieldFilter.eq('teamId', p.name)).prepared.all(),
      ),
    ).rejects.toMatchObject({
      code: 'ORM.ARGUMENT_INVALID',
      meta: {
        name: 'name',
        field: 'teamId',
        codecId: 'mongo/string@1',
        fieldCodecId: 'mongo/objectId@1',
      },
    });
    await db.close();
  });

  it('refuses to prepare an ORM read on a closed client', async () => {
    const db = connectDb();
    await db.close();

    await expect(
      db.prepare({ name: 'mongo/string@1' }, (p) =>
        db.orm.members.where({ name: p.name }).prepared.all(),
      ),
    ).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED', message: 'Mongo client is closed' });
  });
});
