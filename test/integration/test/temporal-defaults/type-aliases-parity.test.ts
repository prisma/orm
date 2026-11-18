import { describe, expect, it } from 'vitest';
import aliases from './_fixture-aliases/generated/contract.json' with { type: 'json' };

const dateTime = {
  codecId: 'pg/timestamptz-date@1',
  dataType: 'pg/timestamptz',
  nullable: false,
  typeParams: { precision: 3 },
};
const now = { kind: 'generator', id: 'timestampNow', params: { precision: 3 } };

describe('columns typed by the temporal type aliases', () => {
  it('store the type bare DateTime becomes, with now on create and on update', () => {
    const { columns } = aliases.storage.namespaces.public.entries.table.reading;
    expect({
      createdAt: columns.createdAt,
      updatedAt: columns.updatedAt,
      defaults: aliases.execution?.mutations.defaults,
    }).toEqual({
      createdAt: dateTime,
      updatedAt: dateTime,
      defaults: [
        { ref: { namespace: 'public', entry: 'reading', field: 'createdAt' }, onCreate: now },
        {
          ref: { namespace: 'public', entry: 'reading', field: 'updatedAt' },
          onCreate: now,
          onUpdate: now,
        },
      ],
    });
  });
});
