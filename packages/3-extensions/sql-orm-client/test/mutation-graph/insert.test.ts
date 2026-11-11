import { ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Insert } from '../../src/mutation-graph/insert';
import { columnsOf, insertInto, insertOwner, recordingRun } from './statements';

const userIdOf7 = { user_id: ParamRef.of(7, { name: 'user_id' }) };
const first = insertInto('users', [{ name: 'Ada' }, { name: 'Grace' }], ['id']);
const second = insertInto('users', [{ name: 'Edsger', email: 'e@d.nl' }], ['id']);

describe('Insert', () => {
  it('holds its statements as SQL AST and is frozen', () => {
    const insert = new Insert([first, second], insertOwner);

    expect(insert.asts).toEqual([first, second]);
    expect(Object.isFrozen(insert)).toBe(true);
    expect(Object.isFrozen(insert.asts)).toBe(true);
  });

  it('runs its statement as it is when the payload slot has no edge', async () => {
    const insert = new Insert([insertInto('posts', [{ title: 'Hello' }], ['id'])], insertOwner);
    const run = recordingRun([{ id: 1 }]);

    expect(await insert.execute({ payload: null, state: null, requires: null }, run)).toEqual([
      { id: 1 },
    ]);
    expect(run.queried).toEqual(insert.asts);
  });

  it('adds the record of each edge to its row', async () => {
    const insert = new Insert([insertInto('posts', [{ title: 'Hello' }], ['id'])], insertOwner);
    const run = recordingRun();
    const titleOfEdge = { views: ParamRef.of(3, { name: 'views' }) };

    await insert.execute(
      { payload: [[userIdOf7], [titleOfEdge]], state: null, requires: null },
      run,
    );

    expect(run.queried).toHaveLength(1);
    expect(run.queried[0]).toMatchObject({
      kind: 'insert',
      rows: [
        {
          title: { value: 'Hello' },
          user_id: { value: 7 },
          views: { value: 3 },
        },
      ],
    });
  });

  it('returns no rows and runs nothing when an edge has no source row', async () => {
    const insert = new Insert([insertInto('posts', [{ title: 'Hello' }], ['id'])], insertOwner);
    const run = recordingRun([{ id: 1 }]);

    expect(
      await insert.execute({ payload: [[userIdOf7], []], state: null, requires: null }, run),
    ).toEqual([]);
    expect(run.queried).toEqual([]);
    expect(run.executed).toEqual([]);
  });

  it('refuses two edges that give one column of a junction different values, before running', () => {
    const insert = new Insert([insertInto('posts', [{ title: 'Hello' }])], insertOwner, {
      relation: 'tags',
      junction: 'post_tags',
    });
    const run = recordingRun();
    const userIdOf8 = { user_id: ParamRef.of(8, { name: 'user_id' }) };

    expect(() =>
      insert.execute({ payload: [[userIdOf7], [userIdOf8]], state: null, requires: null }, run),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.RELATION_MUTATION_INVALID',
        message:
          'Cannot write junction "post_tags": conflicting values for junction column "user_id"',
        meta: { relation: 'tags', junction: 'post_tags', column: 'user_id' },
      }),
    );
    expect(run).toMatchObject({ queried: [], executed: [] });
  });

  it('accepts two edges that give one column of a junction the same value', async () => {
    const insert = new Insert([insertInto('posts', [{ title: 'Hello' }])], insertOwner, {
      relation: 'tags',
      junction: 'post_tags',
    });
    const run = recordingRun([], 1);

    expect(
      await insert.execute(
        { payload: [[userIdOf7], [userIdOf7]], state: null, requires: null },
        run,
      ),
    ).toEqual({ affectedRows: 1 });
  });

  it('returns no rows and runs nothing when a node it requires produced no row', async () => {
    const insert = new Insert([insertInto('posts', [{ title: 'Hello' }], ['id'])], insertOwner);
    const run = recordingRun([{ id: 1 }]);

    expect(await insert.execute({ payload: null, state: null, requires: [[]] }, run)).toEqual([]);
    expect(run).toMatchObject({ queried: [], executed: [] });
  });

  it('gives the affected row count when its statement returns no column', async () => {
    const insert = new Insert([insertInto('posts', [{ title: 'a' }, { title: 'b' }])], insertOwner);
    const run = recordingRun([], 2);

    expect(await insert.execute({ payload: null, state: null, requires: null }, run)).toEqual({
      affectedRows: 2,
    });
    expect(run.executed).toEqual(insert.asts);
  });

  it('gives a node that also returns the columns it is asked for, once each', () => {
    const insert = new Insert([insertInto('users', [{ name: 'Ada' }], ['id'])], insertOwner);

    const widened = insert.withReturning(columnsOf('users', ['email', 'id']));

    expect(widened).toBeInstanceOf(Insert);
    expect(widened.returns.map((column) => column.alias)).toEqual(['id', 'email']);
  });

  describe('of several statements', () => {
    it('runs them in order and gives their rows one statement after another', async () => {
      const run = recordingRun([{ id: 1 }]);

      const rows = await new Insert([first, second], insertOwner).execute(
        { payload: null, state: null, requires: null },
        run,
      );

      expect(rows).toEqual([{ id: 1 }, { id: 1 }]);
      expect(run.queried).toEqual([first, second]);
    });

    it('gives the sum of the affected row counts when they return no column', async () => {
      const run = recordingRun([], 2);
      const counted = new Insert(
        [
          insertInto('users', [{ name: 'Ada' }]),
          insertInto('users', [{ name: 'Grace', email: 'g@h.io' }]),
        ],
        insertOwner,
      );

      expect(await counted.execute({ payload: null, state: null, requires: null }, run)).toEqual({
        affectedRows: 4,
      });
      expect(run).toMatchObject({ executed: counted.asts, queried: [] });
    });

    it('adds the record of each edge to every row of every statement', async () => {
      const run = recordingRun();

      await new Insert([first, second], insertOwner).execute(
        { payload: [[userIdOf7]], state: null, requires: null },
        run,
      );

      expect(run.queried).toMatchObject([
        {
          rows: [
            { name: { value: 'Ada' }, user_id: { value: 7 } },
            { name: { value: 'Grace' }, user_id: { value: 7 } },
          ],
        },
        { rows: [{ name: { value: 'Edsger' }, user_id: { value: 7 } }] },
      ]);
    });

    it('gives a node whose every statement also returns the columns it is asked for, with its junction', () => {
      const junction = { relation: 'tags', junction: 'post_tags' };
      const widened = new Insert([first, second], insertOwner, junction).withReturning(
        columnsOf('users', ['email']),
      );

      expect(widened.junction).toBe(junction);
      expect(
        widened.asts.map((ast) => (ast.returning ?? []).map((column) => column.alias)),
      ).toEqual([
        ['id', 'email'],
        ['id', 'email'],
      ]);
    });
  });
});
