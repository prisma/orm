import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { planFieldEventOperations } from '../src/core/migrations/field-event-planner';
import type { TableRename } from '../src/core/migrations/resolve-table-rename';
import type { CodecControlHooks } from '../src/core/migrations/types';
import { col, contract, recordingHook, table } from './field-event-fixtures';

const priorContract = contract({
  Profile: table({ id: col({ codecId: 'cs/string@1' }), email: col({ codecId: 'cs/string@1' }) }),
});
const newContract = contract({
  Member: table({
    id: col({ codecId: 'cs/string@1' }),
    email: col({ codecId: 'cs/string@1' }),
    nickname: col({ codecId: 'cs/string@1' }),
  }),
});

function eventsWith(tableRenames: readonly TableRename[]) {
  const cs = recordingHook([]);
  planFieldEventOperations({
    priorContract,
    newContract,
    codecHooks: new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]),
    tableRenames,
    columnRenames: [],
  });
  return cs.calls.map((call) => `${call.event} ${call.tableName}.${call.fieldName}`);
}

describe('planFieldEventOperations with renamed tables', () => {
  it('treats the columns of a renamed table as the same columns under the new name', () => {
    expect(
      eventsWith([{ namespaceId: UNBOUND_NAMESPACE_ID, from: 'Profile', to: 'Member' }]),
    ).toEqual(['added Member.nickname']);
  });

  it('still reports a table that is not renamed as dropped and created', () => {
    expect(eventsWith([])).toEqual([
      'added Member.email',
      'added Member.id',
      'added Member.nickname',
      'dropped Profile.email',
      'dropped Profile.id',
    ]);
  });

  it('keys a rename by namespace, so the same table name in another namespace is not renamed', () => {
    expect(eventsWith([{ namespaceId: 'other', from: 'Profile', to: 'Member' }])).toEqual([
      'added Member.email',
      'added Member.id',
      'added Member.nickname',
      'dropped Profile.email',
      'dropped Profile.id',
    ]);
  });
});
