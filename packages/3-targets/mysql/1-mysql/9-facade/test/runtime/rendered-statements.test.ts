import { afterEach, describe, expect, it, vi } from 'vitest';
import mysql from '../../src/runtime/mysql';
import { contractFromJson } from '../../src/static/contract-from-json';
import type { Contract } from '../fixtures/generated/contract.d';
import contractJson from '../fixtures/generated/contract.json' with { type: 'json' };
import { countersContract, eventsContract, notesContract, ticksContract } from './live-contracts';
import { type Answer, recordStatements } from './recording-driver';

const contract = contractFromJson<Contract>(contractJson);
const url = 'mysql://root@localhost/app';

const userRow = (id: unknown) => ({ id: String(id), email: `user${id}@example.com`, role: 'USER' });
const postRow = { id: '1', title: 'Alpha', authorId: '1', posts: '[]' };

/** Answers a select from `User`, `Post` or `Tick` with the stored rows it asks for by key, or one row, so a write that reads its rows back goes on. */
const storedRows: Answer = (sql, params) => {
  if (!sql.startsWith('SELECT')) return [];
  if (/ FROM `User` WHERE `User`\.`id` IN /.test(sql)) return params.map(userRow);
  if (/ FROM `User`/.test(sql)) return [{ ...userRow(1), posts: '[]' }];
  if (/ FROM `Post`/.test(sql)) return [postRow];
  if (/ FROM `Tick`/.test(sql)) return params.map((at) => ({ at, label: 'tick' }));
  return [];
};

/** The statements `run` sends, rendered without a database, and how it ended: answered, or the code of the error it raised. */
async function sends(run: () => Promise<unknown>, answer?: Answer) {
  const statements = recordStatements(answer);
  const outcome = await run().then(
    () => 'answered',
    (error: unknown) => Object(error).code ?? String(error),
  );
  return { statements, outcome };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The SQL of every query in MySQL's live tests (`orm-reads`, `orm-includes`, `orm-writes` and `raw-lane`), rendered without a database, so a change to the SQL MySQL is sent shows here first.
 */
describe('the statements MySQL live tests send', () => {
  it('reads through the ORM and the SQL builder', async () => {
    const client = () => mysql({ contract, url, verifyMarker: false });
    const counters = () => mysql({ contract: countersContract, url, verifyMarker: false });
    expect({
      filtered: await sends(async () => {
        await using db = client();
        await db.orm.User.where({ role: 'ADMIN' })
          .select('id', 'email')
          .orderBy((u) => u.email.asc())
          .limit(2)
          .all();
      }),
      offsets: await sends(async () => {
        await using db = client();
        const ordered = db.orm.User.select('id', 'role').orderBy((u) => u.id.asc());
        await ordered.offset(2).all();
        await ordered.offset(1).limit(2).all();
      }),
      first: await sends(async () => {
        await using db = client();
        await db.orm.User.select('id', 'email').first({ id: 3 });
      }),
      bigintFilter: await sends(async () => {
        await using db = counters();
        await db.orm.Counter.where({ big: 9007199254740993n })
          .select('id', 'big')
          .orderBy((c) => c.id.asc())
          .all();
      }),
      bigintExpression: await sends(async () => {
        await using db = counters();
        await db.query(
          db.sql.Counter.select('id')
            .where((f, fns) =>
              fns.eq(fns.raw`${f.big} + 0`.returns('mysql/bigint@1'), 9007199254740993n),
            )
            .build(),
        );
      }),
      aggregate: await sends(async () => {
        await using db = client();
        await db.orm.Post.where((p) => p.id.gte(2)).aggregate((a) => ({
          count: a.count(),
          total: a.sum('authorId'),
          mean: a.avg('authorId'),
          first: a.min('title'),
          last: a.max('title'),
        }));
      }),
      enumExtremes: await sends(async () => {
        await using db = client();
        await db.orm.User.aggregate((a) => ({ least: a.min('role'), greatest: a.max('role') }));
        await db.orm.User.select('role')
          .orderBy((u) => u.role.asc())
          .first();
      }),
      groupBy: await sends(async () => {
        await using db = client();
        await db.orm.Post.groupBy('authorId').aggregate((a) => ({
          posts: a.count(),
          newest: a.max('id'),
        }));
      }),
      builder: await sends(async () => {
        await using db = client();
        await db.query(
          db.sql.User.select('id', 'email')
            .where((f, fns) => fns.eq(f.role, 'ADMIN'))
            .orderBy('id')
            .build(),
        );
      }),
      joinParams: await sends(async () => {
        await using db = client();
        await db.query(
          db.sql.User.innerJoin(db.sql.Post, (f, fns) =>
            fns.and(fns.eq(f.User.id, f.Post.authorId), fns.eq(f.User.role, 'ADMIN')),
          )
            .select('email', 'title')
            .where((f, fns) => fns.eq(f.Post.title, 'Beta'))
            .build(),
        );
      }),
      derivedJoinParams: await sends(async () => {
        await using db = client();
        const titled = db.sql.Post.select('authorId', 'title')
          .where((f, fns) => fns.eq(f.title, 'Delta'))
          .as('titled');
        await db.query(
          db.sql.User.innerJoin(titled, (f, fns) => fns.eq(f.User.id, f.titled.authorId))
            .select('email', 'title')
            .where((f, fns) => fns.eq(f.User.role, 'ADMIN'))
            .build(),
        );
      }),
      distinctInclude: await sends(async () => {
        await using db = client();
        await db.orm.User.where({ email: 'b@example.com' })
          .distinct('role')
          .select('role')
          .include('posts', (posts) => posts.where({ title: 'Beta' }).select('title'))
          .all();
      }),
      marker: await sends(async () => {
        await using db = mysql({ contract, url });
        await db.orm.User.select('id').first({ id: 1 });
      }),
    }).toMatchSnapshot();
  });

  it('reads includes through the ORM', async () => {
    const client = () => mysql({ contract, url, verifyMarker: false });
    expect({
      toOne: await sends(async () => {
        await using db = client();
        await db.orm.Post.select('id', 'title')
          .include('author', (author) => author.select('id', 'email'))
          .orderBy((p) => p.id.asc())
          .all();
      }),
      enumMember: await sends(async () => {
        await using db = client();
        await db.orm.Post.select('id')
          .include('author', (author) => author.select('role'))
          .where((p) => p.id.gte(4))
          .orderBy((p) => p.id.asc())
          .all();
      }),
      ordered: await sends(async () => {
        await using db = client();
        for (const dir of ['desc', 'asc'] as const) {
          await db.orm.User.select('id')
            .include('posts', (posts) =>
              posts
                .select('title')
                .orderBy((p) => (dir === 'asc' ? p.title.asc() : p.title.desc())),
            )
            .first({ id: 1 });
        }
      }),
      paged: await sends(async () => {
        await using db = client();
        await db.orm.User.select('id')
          .include('posts', (posts) =>
            posts
              .select('title')
              .orderBy((p) => p.title.asc())
              .offset(1)
              .limit(1),
          )
          .first({ id: 1 });
      }),
      twoLevels: await sends(async () => {
        await using db = client();
        await db.orm.User.select('id')
          .include('posts', (posts) =>
            posts
              .select('title')
              .orderBy((p) => p.id.desc())
              .include('author', (author) => author.select('email')),
          )
          .orderBy((u) => u.id.asc())
          .all();
      }),
      wholeRows: await sends(async () => {
        await using db = client();
        await db.orm.User.include('posts', (posts) => posts.orderBy((p) => p.title.desc())).first({
          id: 1,
        });
        await db.orm.Post.include('author')
          .orderBy((p) => p.id.asc())
          .all();
      }),
      awkwardText: await sends(async () => {
        await using db = mysql({ contract: notesContract, url, verifyMarker: false });
        await db.orm.Author.select('id')
          .include('notes', (notes) => notes.select('body', 'summary').orderBy((n) => n.id.asc()))
          .first({ id: 1 });
      }),
      threeLevels: await sends(async () => {
        await using db = client();
        await db.orm.User.select('id')
          .include('posts', (posts) =>
            posts
              .select('title')
              .orderBy((p) => p.id.asc())
              .include('author', (author) =>
                author
                  .select('email')
                  .include('posts', (again) => again.select('id').orderBy((p) => p.id.desc())),
              ),
          )
          .first({ id: 2 });
      }),
      reduced: await sends(async () => {
        await using db = client();
        await db.orm.User.include('posts', (p) => p.count()).first({ id: 1 });
        await db.orm.User.include('posts', (p) => p.sum('id')).first({ id: 1 });
        await db.orm.User.include('posts', (p) => p.avg('id')).first({ id: 1 });
        await db.orm.User.include('posts', (p) => p.min('title')).first({ id: 1 });
        await db.orm.User.include('posts', (p) => p.max('title')).first({ id: 1 });
      }),
      sumBigInt: await sends(async () => {
        await using db = mysql({ contract: eventsContract, url, verifyMarker: false });
        await db.orm.Account.select('id')
          .include('events', (events) => events.sumBigInt('id'))
          .first({ id: 1 });
        await db.orm.Account.select('id')
          .include('events', (events) => events.sum('id'))
          .first({ id: 1 });
      }),
      combined: await sends(async () => {
        await using db = client();
        await db.orm.User.select('id')
          .include('posts', (posts) =>
            posts.combine({
              rows: posts
                .select('title')
                .orderBy((p) => p.title.asc())
                .limit(2),
              count: posts.count(),
            }),
          )
          .where((u) => u.id.lte(3))
          .orderBy((u) => u.id.asc())
          .all();
      }),
      countTwoLevels: await sends(async () => {
        await using db = client();
        await db.orm.Post.select('id')
          .include('author', (author) =>
            author.select('email').include('posts', (again) => again.count()),
          )
          .where((p) => p.id.gte(3))
          .orderBy((p) => p.id.asc())
          .all();
      }),
      exactValues: await sends(async () => {
        await using db = mysql({ contract: eventsContract, url, verifyMarker: false });
        await db.orm.Account.select('id')
          .include('events', (events) => events.select('id', 'at').orderBy((e) => e.id.desc()))
          .first({ id: 1 });
      }),
    }).toMatchSnapshot();
  });

  it('writes through the ORM', async () => {
    const client = () => mysql({ contract, url, verifyMarker: false });
    const generatedRows = [
      { email: 'a@example.com', role: 'USER' },
      { email: 'b@example.com', role: 'ADMIN' },
    ] as const;
    expect({
      create: await sends(async () => {
        await using db = client();
        await db.orm.User.create({ email: 'a@example.com', role: 'USER' });
      }, storedRows),
      createWithId: await sends(async () => {
        await using db = client();
        await db.orm.User.create({ id: 0, email: 'zero@example.com', role: 'USER' });
      }, storedRows),
      createAllGenerated: await sends(async () => {
        await using db = client();
        await db.orm.User.createAll(generatedRows);
      }, storedRows),
      createAndCount: await sends(async () => {
        await using db = client();
        await db.orm.User.createAndCount(generatedRows);
      }, storedRows),
      createAllExplicit: await sends(async () => {
        await using db = client();
        await db.orm.User.createAll([
          { id: 10, email: 'c@example.com', role: 'USER' },
          { id: 11, email: 'd@example.com', role: 'USER' },
        ]);
        await db.orm.User.createAll([{ email: 'e@example.com', role: 'USER' }]);
      }, storedRows),
      createAllByDatetime: await sends(async () => {
        await using db = mysql({ contract: ticksContract, url, verifyMarker: false });
        await db.orm.Tick.createAll([
          { at: new Date('2024-01-02T03:04:05.678Z'), label: 'later' },
          { at: new Date('2024-01-02T03:04:05.123Z'), label: 'earlier' },
        ]);
      }, storedRows),
      createAllChunked: await sends(async () => {
        await using db = client();
        await db.orm.User.createAll(
          Array.from({ length: 1200 }, (_, index) => ({
            id: 1200 - index,
            email: `user${1200 - index}@example.com`,
            role: 'USER' as const,
          })),
        );
      }, storedRows).then(({ statements, outcome }) => ({
        statements: statements.map(({ sql, params }) => ({
          sql: sql.length > 200 ? `${sql.slice(0, 200)}…` : sql,
          sqlLength: sql.length,
          params: params.length,
        })),
        outcome,
      })),
      upsertByCase: await sends(async () => {
        await using db = client();
        await db.orm.User.upsert({
          create: { email: 'B@Example.com', role: 'USER' },
          update: { role: 'USER' },
          conflictOn: { email: 'B@Example.com' },
        });
      }, storedRows),
      createWithPosts: await sends(async () => {
        await using db = client();
        await db.orm.User.include('posts', (post) =>
          post.select('title').orderBy((p) => p.id.asc()),
        ).create({
          email: 'a@example.com',
          role: 'USER',
          posts: (posts) => posts.create([{ title: 'First' }, { title: 'Second' }]),
        });
      }, storedRows),
      createWithAuthor: await sends(async () => {
        await using db = client();
        await db.orm.Post.create({
          title: 'Third',
          author: (author) => author.create({ email: 'b@example.com', role: 'ADMIN' }),
        });
      }, storedRows),
      updateUpsertDelete: await sends(async () => {
        await using db = client();
        await db.orm.User.where({ id: 1 }).update({ role: 'ADMIN' });
        await db.orm.User.upsert({
          create: { email: 'a@example.com', role: 'USER' },
          update: { role: 'ADMIN' },
          conflictOn: { email: 'a@example.com' },
        });
        await db.orm.User.upsert({
          create: { email: 'b@example.com', role: 'USER' },
          update: {},
          conflictOn: { email: 'b@example.com' },
        });
        await db.orm.User.where({ role: 'USER' }).updateAndCount({ role: 'ADMIN' });
        await db.orm.User.where({ id: 1 }).delete();
        await db.orm.User.select('email', 'role').all();
      }, storedRows),
      updateAllDeleteAll: await sends(async () => {
        await using db = client();
        await db.orm.Post.where({ authorId: 1 })
          .select('id', 'title')
          .orderBy((post) => post.id.asc())
          .updateAll({ title: 'Edited' });
        await db.orm.Post.where({ title: 'Edited' })
          .select('id')
          .orderBy((post) => post.id.asc())
          .deleteAll();
        await db.orm.Post.where({ authorId: 2 }).deleteAndCount();
        await db.orm.Post.all();
      }, storedRows),
    }).toMatchSnapshot();
  });

  it('runs raw SQL', async () => {
    const client = () => mysql({ contract, url, verifyMarker: false });
    expect({
      integers: await sends(async () => {
        await using db = client();
        await db.query(
          db.raw
            .sql`SELECT ${10} < ${9} AS lt, GREATEST(${10}, ${9}) AS greatest, CAST(JSON_ARRAY(${5}) AS CHAR) AS arr, CAST(${9007199254740993n} AS SIGNED) + ${1n} AS sum`
            .returnsRow({
              lt: 'mysql/int@1',
              greatest: 'mysql/int@1',
              arr: 'mysql/text@1',
              sum: 'mysql/bigint@1',
            })
            .build(),
        );
        await db.query(
          db.raw.sql`SELECT id FROM Post WHERE title > ${9} ORDER BY id`
            .returnsRow({ id: 'mysql/int@1' })
            .build(),
        );
      }),
      limits: await sends(async () => {
        await using db = client();
        await db.query(
          db.raw.sql`SELECT id FROM Post ORDER BY id LIMIT ${2}`
            .returnsRow({ id: 'mysql/int@1' })
            .build(),
        );
        await db.query(
          db.raw.sql`SELECT id FROM Post ORDER BY id LIMIT ${2} OFFSET ${1}`
            .returnsRow({ id: 'mysql/int@1' })
            .build(),
        );
        await db.query(
          db.raw.sql`SELECT id FROM Post ORDER BY id LIMIT ${1}, ${2}`
            .returnsRow({ id: 'mysql/int@1' })
            .build(),
        );
      }),
      inTransaction: await sends(
        async () => {
          await using db = client();
          await db.transaction(async (tx) => {
            for await (const row of tx.query(
              tx.raw
                .sql`WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < ${500}) SELECT n, REPEAT('x', 4000) AS pad FROM s`
                .returnsRow({ n: 'mysql/int@1', pad: 'mysql/text@1' })
                .build(),
            )) {
              await tx.query(
                tx.raw.sql`SELECT ${row.n} AS m`.returnsRow({ m: 'mysql/int@1' }).build(),
              );
            }
          });
        },
        (sql) => (sql.startsWith('WITH') ? [{ n: '1', pad: 'x' }] : []),
      ),
      embeddedSelect: await sends(async () => {
        await using db = client();
        const copies = db.sql.Post.innerJoin(db.sql.User, (f, fns) =>
          fns.eq(f.User.id, f.Post.authorId),
        )
          .select((f, fns) => ({
            id: fns.raw`${f.Post.id} + ${10}`.returns('mysql/int@1'),
            title: f.Post.title,
            authorId: f.Post.authorId,
          }))
          .where((f, fns) => fns.eq(f.User.role, 'ADMIN'));
        await db.execute(
          db.raw
            .sql`INSERT INTO Post (id, title, authorId) SELECT c.id, CONCAT(${'Copy of '}, c.title), c.authorId FROM (${copies}) AS c WHERE c.id < ${14}`
            .affectedCount()
            .build(),
        );
        await db.query(
          db.sql.Post.select('id', 'title', 'authorId')
            .where((f, fns) => fns.gt(f.id, 10))
            .orderBy('id')
            .build(),
        );
      }),
    }).toMatchSnapshot();
  });
});
