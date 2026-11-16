import { describe, expect, it } from 'vitest';
import {
  inFilterOrder,
  type OrderedRewrite,
  overlapRefusal,
  type RewriteCall,
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

function rewrite(call: RewriteCall, facts: Partial<OrderedRewrite> = {}): OrderedRewrite {
  return {
    call,
    statements: [],
    twoMigrationsAdvice: undefined,
    writtenValue: undefined,
    transformedField: undefined,
    discriminatorFilter: undefined,
    ...facts,
  };
}

const renameZ = rewrite(new RenameFieldCall('tasks', 'z', 'w', { type: 'bug' }), {
  discriminatorFilter: { kind: 'variant', field: 'type', value: 'bug' },
});
const replaceType = rewrite(
  new ReplaceStoredValueCall({
    collection: 'tasks',
    field: 'type',
    from: 'issue',
    to: { $literal: 'bug' },
    filter: { w: 1 },
  }),
  { writtenValue: 'bug', discriminatorFilter: { kind: 'variant', field: 'w', value: 1 } },
);

describe('inFilterOrder', () => {
  it('runs an operation after the operation that writes the value its filter reads', () => {
    const renameOnBug = rewrite(new RenameFieldCall('tasks', 'a', 'b', { type: 'bug' }), {
      discriminatorFilter: { kind: 'variant', field: 'type', value: 'bug' },
    });
    const writesBug = rewrite(
      new ReplaceStoredValueCall({
        collection: 'tasks',
        field: 'type',
        from: 'issue',
        to: { $literal: 'bug' },
      }),
      { writtenValue: 'bug' },
    );
    expect(inFilterOrder([renameOnBug, writesBug])).toEqual([writesBug, renameOnBug]);
  });
});

describe('overlapRefusal', () => {
  it('refuses operations whose filters each need the other to run first', () => {
    expect(overlapRefusal(inFilterOrder([renameZ, replaceType]), contracts)).toEqual({
      kind: 'unsupportedOperation',
      summary: `Cannot plan the migration: the filter of one of its operations reads what another changes (${renameZ.call.label}; ${replaceType.call.label})`,
      why: `An operation selects its documents by its filter when it runs, so it must run after the operations that write what its filter reads and before those that empty it, and these operations need both. Make the change in two migrations: first only "${replaceType.call.label}" and apply that; then the rest.`,
    });
  });

  it('counts a cast and a data transform as writing their field', () => {
    const cast = rewrite(
      new CastFieldCall({ collection: 'tasks', field: 'a', from: ['int'], to: 'string' }),
    );
    const transform = rewrite(new DataTransformCall('Task.b', 'tasks', {}), {
      transformedField: 'b',
    });
    const renames = [
      rewrite(new RenameFieldCall('tasks', 'a', 'c')),
      rewrite(new RenameFieldCall('tasks', 'b', 'd')),
    ];
    expect(
      [cast, transform].map((writer) => overlapRefusal([...renames, writer], contracts)?.summary),
    ).toEqual([
      `Cannot plan the migration: the migration writes a field that another of its operations reads (Rename field a to c in collection tasks; ${cast.call.label})`,
      `Cannot plan the migration: the migration writes a field that another of its operations reads (Rename field b to d in collection tasks; ${transform.call.label})`,
    ]);
  });

  it('throws when the planner did not say what a data transform writes', () => {
    expect(() =>
      overlapRefusal([rewrite(new DataTransformCall('Task.b', 'tasks', {}))], contracts),
    ).toThrow('The planner did not say the field written of Data transform: Task.b');
  });
});
