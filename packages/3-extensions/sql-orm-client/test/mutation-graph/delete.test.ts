import { BinaryExpr, ColumnRef, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Delete } from '../../src/mutation-graph/delete';
import { deletePosts, recordingRun } from './statements';

const userIdIs = (value: number) =>
  BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ParamRef.of(value, { name: 'user_id' }));
const linkOf = (where: Delete) => new Delete(where.ast, { relation: 'posts', junction: 'posts' });

describe('Delete of a junction row', () => {
  it('refuses two edges that give one junction column different values, before running', () => {
    const run = recordingRun([], 1);

    expect(() =>
      linkOf(deletePosts()).execute(
        { filter: [[userIdIs(7)], [userIdIs(8)]], state: null, requires: null },
        run,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.RELATION_MUTATION_INVALID',
        message: 'Cannot write junction "posts": conflicting values for junction column "user_id"',
        meta: { relation: 'posts', junction: 'posts', column: 'user_id' },
      }),
    );
    expect(run).toMatchObject({ queried: [], executed: [] });
  });

  it('runs when the edges give one junction column the same value', async () => {
    const run = recordingRun([], 1);

    expect(
      await linkOf(deletePosts()).execute(
        { filter: [[userIdIs(7)], [userIdIs(7)]], state: null, requires: null },
        run,
      ),
    ).toBe(1);
  });
});
