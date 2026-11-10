import { InsertAst, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createCollectionTables } from '../../src/collection-tables';
import { Graph } from '../../src/mutation-graph/graph';
import { Insert } from '../../src/mutation-graph/insert';
import { InsertChunked } from '../../src/mutation-graph/insert-chunked';
import { PayloadData } from '../../src/mutation-graph/payload-data';
import { projectTableColumns } from '../../src/mutation-statements';
import { getTestContext } from '../helpers';
import { generatedContext } from './generated-keys-contract';
import {
  columnMappings,
  contextWithoutReturning,
  findUsers,
  insertInto,
  insertOwner,
  newGraph,
  newGraphWithoutReturning,
  recordingRun,
} from './statements';

const counters = createCollectionTables(generatedContext.contract, 'public', 'Counter').root;
const createCounter = { operation: 'create', modelName: 'Counter' };
const createCounters = { operation: 'createAll', modelName: 'Counter' };
const idToUserId = columnMappings('users', 'posts', [['id', 'user_id']]);
const noInputs = { payload: null, state: null, requires: null };

function insertCounters(rows: readonly Record<string, unknown>[], returning: readonly string[]) {
  const { contract } = generatedContext;
  return InsertAst.into(counters.tableSource(contract))
    .withRows(
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([column, value]) => [
            column,
            ParamRef.of(value, { name: column }),
          ]),
        ),
      ),
    )
    .withReturning(projectTableColumns(contract, counters, returning));
}

function runWithoutReturning(affectedRows: number, insertId?: string) {
  return recordingRun([], affectedRows, insertId, contextWithoutReturning);
}

describe('Insert on a contract without returning', () => {
  it('runs without RETURNING and gives the columns read from it from the values of its rows', async () => {
    const insert = new Insert(
      insertInto(
        'users',
        [
          { id: 1, name: 'Ada' },
          { id: 2, name: 'Grace' },
        ],
        ['id', 'name'],
      ),
      insertOwner,
    );
    const run = runWithoutReturning(2);

    expect(await insert.execute(noInputs, run)).toEqual([
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Grace' },
    ]);
    expect(run.executed.map((ast) => (ast.kind === 'insert' ? ast.returning : 'other'))).toEqual([
      undefined,
    ]);
  });

  it('gives the values the PayloadData edges give', async () => {
    const insert = new Insert(
      insertInto('posts', [{ id: 10, title: 'Hello' }], ['id', 'user_id']),
      insertOwner,
    );

    expect(
      await insert.execute(
        {
          payload: [[{ user_id: ParamRef.of(7, { name: 'user_id' }) }]],
          state: null,
          requires: null,
        },
        runWithoutReturning(1),
      ),
    ).toEqual([{ id: 10, user_id: 7 }]);
  });

  it('gives the key the database generated for a one-row insert, decoded from its insert id', async () => {
    const insert = new Insert(insertCounters([{ label: 'a' }], ['id', 'label']), createCounter);

    expect(await insert.execute(noInputs, recordingRun([], 1, '42', generatedContext))).toEqual([
      { id: 42, label: 'a' },
    ]);
  });

  it('fails with ORM.MUTATION_ROW_MISSING when the insert reports no insert id', async () => {
    const insert = new Insert(insertCounters([{ label: 'a' }], ['id']), createCounter);

    await expect(
      insert.execute(noInputs, recordingRun([], 1, undefined, generatedContext)),
    ).rejects.toMatchObject({
      code: 'ORM.MUTATION_ROW_MISSING',
      message:
        'create() for model "Counter" cannot find the row it inserted: the insert\'s result carried no insert id for key column "id". A middleware may have answered the statement in place of the database without one.',
      meta: { operation: 'create', model: 'Counter', phase: 'insert-id', column: 'id' },
    });
  });

  it('gives the affected row count when nothing reads from it', async () => {
    const insert = new Insert(insertInto('users', [{ id: 1 }, { id: 2 }]), insertOwner);

    expect(await insert.execute(noInputs, runWithoutReturning(2))).toEqual({ affectedRows: 2 });
  });
});

describe('InsertChunked on a contract without returning', () => {
  it('gives the columns read from it from the rows of every statement, in their order', async () => {
    const chunked = new InsertChunked(
      [
        insertInto('users', [{ id: 1 }, { id: 2 }], ['id']),
        insertInto('users', [{ id: 3, email: 'e@d.nl' }], ['id']),
      ],
      insertOwner,
    );

    expect(await chunked.execute(noInputs, runWithoutReturning(3))).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
  });

  it('gives the sum of the affected row counts when nothing reads from it', async () => {
    const chunked = new InsertChunked(
      [insertInto('users', [{ id: 1 }]), insertInto('users', [{ id: 2, email: 'e@d.nl' }])],
      insertOwner,
    );

    expect(await chunked.execute(noInputs, runWithoutReturning(1))).toEqual({ affectedRows: 2 });
  });
});

describe('the check of an insert', () => {
  it('refuses an insert of several rows that is read from and whose key the database generates', () => {
    const graph = new Graph(generatedContext.contract);
    const insert = new Insert(
      insertCounters([{ label: 'a' }, { label: 'b' }], ['id']),
      createCounters,
    );
    const id = graph.add(insert);

    expect(() => insert.check(graph, id, generatedContext)).toThrow(
      expect.objectContaining({
        code: 'ORM.CAPABILITY_MISSING',
        message:
          'createAll() on model "Counter" cannot return the rows it inserts: their key column "id" is generated, and without capability "returning" the database reports a generated value only for a one-row insert. Use createAndCount(), or create() for each row.',
        meta: { capability: 'returning', action: 'createAll()' },
      }),
    );
  });

  it('refuses an insert read from for a column its rows give no value and the database does not number', () => {
    const graph = newGraphWithoutReturning();
    const insert = new Insert(insertInto('posts', [{ title: 'Hello' }], ['id']), insertOwner);
    const id = graph.add(insert);

    expect(() => insert.check(graph, id, contextWithoutReturning)).toThrow(
      expect.objectContaining({
        code: 'ORM.CAPABILITY_MISSING',
        meta: { capability: 'returning', action: 'create()' },
      }),
    );
  });

  it('takes a column a PayloadData edge gives as given', () => {
    const graph = newGraphWithoutReturning();
    const find = graph.add(findUsers());
    const insert = new Insert(
      insertInto('posts', [{ id: 10, title: 'Hello' }], ['id', 'user_id']),
      insertOwner,
    );
    const id = graph.add(insert, { payload: [new PayloadData(find, idToUserId)] });

    expect(() => insert.check(graph, id, contextWithoutReturning)).not.toThrow();
  });

  it('accepts an insert that nothing reads from, whatever its rows', () => {
    const graph = new Graph(generatedContext.contract);
    const insert = new Insert(insertCounters([{ label: 'a' }, { label: 'b' }], []), createCounters);
    const id = graph.add(insert);

    expect(() => insert.check(graph, id, generatedContext)).not.toThrow();
  });

  it('accepts any insert on a contract with returning', () => {
    const graph = newGraph();
    const insert = new Insert(insertInto('posts', [{ title: 'Hello' }], ['id']), insertOwner);
    const id = graph.add(insert);

    expect(() => insert.check(graph, id, getTestContext())).not.toThrow();
  });

  it('refuses an InsertChunked of several rows read from for a generated key', () => {
    const graph = new Graph(generatedContext.contract);
    const chunked = new InsertChunked(
      [
        insertCounters([{ label: 'a' }], ['id']),
        insertCounters([{ label: 'b', slug: 'b' }], ['id']),
      ],
      createCounters,
    );
    const id = graph.add(chunked);

    expect(() => chunked.check(graph, id, generatedContext)).toThrow(
      expect.objectContaining({ code: 'ORM.CAPABILITY_MISSING' }),
    );
  });
});
