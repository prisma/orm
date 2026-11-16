import { describe, expect, it } from 'vitest';
import {
  type OrderedRewrite,
  overlapRefusal,
  type RewriteFacts,
} from '../src/core/migrations/mongo-rewrite-overlaps';
import {
  CastFieldCall,
  DataTransformCall,
  RenameFieldCall,
  ReplaceStoredValueCall,
} from '../src/core/migrations/op-factory-call';
import { contract } from './mongo-statement-fixtures';

const tasks = contract('tasks', { Task: { collection: 'tasks', fields: ['_id'] } }, { tasks: {} });
const contracts = { fromContract: tasks, contract: tasks };

function rewrite(facts: RewriteFacts): OrderedRewrite {
  return { ...facts, statements: [], twoMigrationsAdvice: undefined };
}

const renameZ = rewrite({
  kind: 'renameField',
  call: new RenameFieldCall('tasks', 'z', 'w', { type: 'bug' }),
  discriminatorFilter: { kind: 'variant', field: 'type', value: 'bug' },
});
const replaceType = rewrite({
  kind: 'replaceStoredValue',
  call: new ReplaceStoredValueCall({
    collection: 'tasks',
    field: 'type',
    from: 'issue',
    to: { $literal: 'bug' },
    filter: { w: 1 },
  }),
  writtenValue: 'bug',
  discriminatorFilter: { kind: 'variant', field: 'w', value: 1 },
});

const filterRefusal = (earlier: OrderedRewrite, later: OrderedRewrite) => ({
  kind: 'unsupportedOperation',
  summary: `Cannot plan the migration: the filter of one of its operations reads what another changes (${earlier.call.label}; ${later.call.label})`,
  why: `An operation selects its documents by its filter when it runs, so it must run after the operations that write what its filter reads and before those that empty it, and these operations need both. Make the change in two migrations: first only "${later.call.label}" and apply that; then the rest.`,
});

describe('overlapRefusal', () => {
  it('refuses an operation that runs before the operation that writes the value its filter reads', () => {
    const renameOnBug = rewrite({
      kind: 'renameField',
      call: new RenameFieldCall('tasks', 'a', 'b', { type: 'bug' }),
      discriminatorFilter: { kind: 'variant', field: 'type', value: 'bug' },
    });
    const writesBug = rewrite({
      kind: 'replaceStoredValue',
      call: new ReplaceStoredValueCall({
        collection: 'tasks',
        field: 'type',
        from: 'issue',
        to: { $literal: 'bug' },
      }),
      writtenValue: 'bug',
      discriminatorFilter: undefined,
    });
    expect({
      writerFirst: overlapRefusal([writesBug, renameOnBug], contracts),
      readerFirst: overlapRefusal([renameOnBug, writesBug], contracts),
    }).toEqual({ writerFirst: undefined, readerFirst: filterRefusal(renameOnBug, writesBug) });
  });

  it('refuses operations whose filters each need the other to run first', () => {
    expect({
      zFirst: overlapRefusal([renameZ, replaceType], contracts),
      typeFirst: overlapRefusal([replaceType, renameZ], contracts),
    }).toEqual({
      zFirst: filterRefusal(renameZ, replaceType),
      typeFirst: filterRefusal(replaceType, renameZ),
    });
  });

  it('counts a cast and a data transform as writing their field', () => {
    const cast = rewrite({
      kind: 'castField',
      call: new CastFieldCall({ collection: 'tasks', field: 'a', from: ['int'], to: 'string' }),
      discriminatorFilter: undefined,
    });
    const transform = rewrite({
      kind: 'dataTransform',
      call: new DataTransformCall('Task.b', 'tasks', {}),
      transformedField: 'b',
      discriminatorFilter: undefined,
    });
    const renames = ['a', 'b'].map((from) =>
      rewrite({
        kind: 'renameField',
        call: new RenameFieldCall('tasks', from, `${from}2`),
        discriminatorFilter: undefined,
      }),
    );
    expect(
      [cast, transform].map((writer) => overlapRefusal([...renames, writer], contracts)?.summary),
    ).toEqual([
      `Cannot plan the migration: the migration writes a field that another of its operations reads (Rename field a to a2 in collection tasks; ${cast.call.label})`,
      `Cannot plan the migration: the migration writes a field that another of its operations reads (Rename field b to b2 in collection tasks; ${transform.call.label})`,
    ]);
  });
});
