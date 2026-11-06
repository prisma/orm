import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { RawInsertOneCommand, RawUpdateManyCommand } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { fieldRewriteOf } from '../src/core/field-rewrite';

const meta = { target: 'mongo', storageHash: '', lane: 'mongo-raw' };

function dmlOperation(commands: readonly object[]): MigrationPlanOperation {
  const run = commands.map((command) => ({ collection: 'users', command, meta }));
  return { id: 'op', label: 'op', operationClass: 'destructive', run } as MigrationPlanOperation;
}

const bypass = { bypassDocumentValidation: true };

describe('fieldRewriteOf', () => {
  it('reads the collection and field of the planner rewrites', () => {
    const unset = new RawUpdateManyCommand('users', {}, { $unset: { nickname: '' } }, bypass);
    const rename = new RawUpdateManyCommand('users', {}, { $rename: { name: 'fullName' } }, bypass);
    expect([fieldRewriteOf(dmlOperation([unset])), fieldRewriteOf(dmlOperation([rename]))]).toEqual(
      [
        { collection: 'users', field: 'nickname', command: unset },
        { collection: 'users', field: 'name', command: rename },
      ],
    );
  });

  it('does not read a hand-written transform that does not skip validation, or that does more', () => {
    const unset = new RawUpdateManyCommand('users', {}, { $unset: { nickname: '' } });
    const set = new RawUpdateManyCommand('users', {}, { $set: { status: 'active' } }, bypass);
    const two = new RawUpdateManyCommand('users', {}, { $unset: { a: '', b: '' } }, bypass);
    const rewrite = new RawUpdateManyCommand('users', {}, { $unset: { nickname: '' } }, bypass);
    expect([
      fieldRewriteOf(dmlOperation([unset])),
      fieldRewriteOf(dmlOperation([set])),
      fieldRewriteOf(dmlOperation([two])),
      fieldRewriteOf(dmlOperation([rewrite, new RawInsertOneCommand('users', { a: 1 })])),
      fieldRewriteOf({ id: 'ddl', label: 'ddl', operationClass: 'additive' }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});
