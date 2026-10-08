import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { planFieldEventOperations } from '../src/core/migrations/field-event-planner';
import type { ColumnRename } from '../src/core/migrations/resolve-column-rename';
import type { TableRename } from '../src/core/migrations/resolve-table-rename';
import type { CodecControlHooks } from '../src/core/migrations/types';
import { col, contract, recordingHook, table } from './field-event-fixtures';

const string = col({ codecId: 'cs/string@1' });

function eventsWith(
  prior: ReturnType<typeof contract>,
  next: ReturnType<typeof contract>,
  tableRenames: readonly TableRename[],
  columnRenames: readonly ColumnRename[],
) {
  const cs = recordingHook([]);
  planFieldEventOperations({
    priorContract: prior,
    newContract: next,
    codecHooks: new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]),
    tableRenames,
    columnRenames,
  });
  return cs.calls.map((call) => `${call.event} ${call.tableName}.${call.fieldName}`);
}

describe('planFieldEventOperations with renamed columns', () => {
  const prior = contract({ User: table({ id: string, name: string }) });
  const next = contract({ User: table({ id: string, fullName: string }) });

  it('treats a renamed column as the same column under its new name', () => {
    expect(
      eventsWith(
        prior,
        next,
        [],
        [{ namespaceId: UNBOUND_NAMESPACE_ID, table: 'User', from: 'name', to: 'fullName' }],
      ),
    ).toEqual([]);
  });

  it('still reports a column that is not renamed as dropped and added', () => {
    expect(eventsWith(prior, next, [], [])).toEqual(['added User.fullName', 'dropped User.name']);
  });

  it('finds a renamed column under the new name of its renamed table', () => {
    const priorProfile = contract({ Profile: table({ id: string, name: string }) });
    expect(
      eventsWith(
        priorProfile,
        next,
        [{ namespaceId: UNBOUND_NAMESPACE_ID, from: 'Profile', to: 'User' }],
        [{ namespaceId: UNBOUND_NAMESPACE_ID, table: 'User', from: 'name', to: 'fullName' }],
      ),
    ).toEqual([]);
  });
});
