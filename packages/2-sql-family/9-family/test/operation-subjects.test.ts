import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  fieldEventStorage,
  subjectsOfCalls,
  unknownCallNames,
} from '../src/core/migrations/operation-subjects';
import { NO_RENAMED_ORIGINS } from '../src/core/migrations/statement-planning';
import {
  app,
  byHand,
  column,
  losing,
  origin,
  renamesBetween,
  table,
  unchanged,
} from './operation-subjects-fixtures';
import { contractOf } from './statement-fixtures';

describe('subjectsOfCalls', () => {
  it('names the model of a dropped table and the field of a dropped column', () => {
    expect(
      subjectsOfCalls([unchanged, losing(table('legacy')), losing(column('user', 'full_name'))], {
        fromContract: origin,
        contract: contractOf({ User: { table: 'user', fields: { id: 'id' } } }),
        renames: renamesBetween(
          origin,
          contractOf({ User: { table: 'user', fields: { id: 'id' } } }),
        ),
        byHand,
        removedVariants: [],
        origins: NO_RENAMED_ORIGINS,
      }),
    ).toEqual({
      dataLoss: [
        {
          operationIndex: 1,
          subject: { kind: 'model', namespaceId: app, model: 'Legacy' },
          loss: 'drop',
          label: 'Drop',
        },
        {
          operationIndex: 2,
          subject: { kind: 'field', namespaceId: app, model: 'User', field: 'name' },
          loss: 'drop',
          label: 'Drop',
        },
      ],
      accessChanges: [],
      temporaryValues: [],
    });
  });

  it('names the enum value a removal is about', () => {
    const enumValue = { namespaceId: app, enum: 'Status', member: 'ARCHIVED' };
    expect(
      subjectsOfCalls(
        [
          {
            ...unchanged,
            label: 'Remove value',
            dataLoss: [
              {
                ...column('user', 'full_name'),
                enumValue,
                loss: 'drop',
              },
            ],
          },
        ],
        {
          fromContract: origin,
          contract: origin,
          renames: renamesBetween(origin, origin),
          byHand,
          removedVariants: [],
          origins: NO_RENAMED_ORIGINS,
        },
      ).dataLoss,
    ).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'enumValue', ...enumValue },
        loss: 'drop',
        label: 'Remove value',
      },
    ]);
  });

  it('names the value object field a key removal is about', () => {
    const valueObjectField = { namespaceId: app, valueObject: 'GeoPoint', field: 'lng' };
    expect(
      subjectsOfCalls(
        [
          {
            ...unchanged,
            label: 'Remove key',
            dataLoss: [{ ...column('user', 'full_name'), valueObjectField, loss: 'drop' }],
          },
        ],
        {
          fromContract: origin,
          contract: origin,
          renames: renamesBetween(origin, origin),
          byHand,
          removedVariants: [],
          origins: NO_RENAMED_ORIGINS,
        },
      ).dataLoss,
    ).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'valueObjectField', ...valueObjectField },
        loss: 'drop',
        label: 'Remove key',
      },
    ]);
  });

  it('names the value object field a temporary value fills', () => {
    const valueObjectField = { namespaceId: app, valueObject: 'GeoPoint', field: 'country' };
    expect(
      subjectsOfCalls(
        [
          unchanged,
          {
            ...unchanged,
            label: 'Fill key',
            temporaryValues: [
              { table: 'user', column: 'full_name', value: '""', valueObjectField },
            ],
          },
        ],
        {
          fromContract: origin,
          contract: origin,
          renames: renamesBetween(origin, origin),
          byHand,
          removedVariants: [],
          origins: NO_RENAMED_ORIGINS,
        },
      ).temporaryValues,
    ).toEqual([
      {
        operationIndex: 1,
        subject: { kind: 'valueObjectField', ...valueObjectField },
        value: '""',
      },
    ]);
  });

  it('counts every operation of a call with companions before the next call', () => {
    expect(
      subjectsOfCalls(
        [
          {
            operationCount: 3,
            label: 'Rename',
            dataLoss: [],
            accessChanges: [],
            temporaryValues: [],
          },
          losing(table('legacy')),
        ],
        {
          fromContract: origin,
          contract: origin,
          renames: renamesBetween(origin, origin),
          byHand,
          removedVariants: [],
          origins: NO_RENAMED_ORIGINS,
        },
      ).dataLoss,
    ).toEqual([
      {
        operationIndex: 3,
        subject: { kind: 'model', namespaceId: app, model: 'Legacy' },
        loss: 'drop',
        label: 'Drop',
      },
    ]);
  });

  it('finds a table and a column renamed earlier in the plan under their origin names', () => {
    const destination = contractOf({
      Account: { table: 'account', fields: { id: 'id', displayName: 'display_name' } },
    });
    const from = contractOf({
      User: { table: 'user', fields: { id: 'id', name: 'full_name' } },
    });
    expect(
      subjectsOfCalls([losing(column('account', 'display_name'))], {
        fromContract: from,
        contract: destination,
        renames: renamesBetween(from, destination),
        byHand,
        removedVariants: [],
        origins: {
          originTable: (current) =>
            current.table === 'account' ? { namespaceId: app, table: 'user' } : current,
          originColumn: (origin, column) =>
            origin.table === 'user' && column === 'display_name' ? 'full_name' : column,
        },
      }).dataLoss,
    ).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'field', namespaceId: app, model: 'User', field: 'name' },
        loss: 'drop',
        label: 'Drop',
      },
    ]);
  });

  it('keeps how each operation loses data, and the label of the call that loses it', () => {
    expect(
      subjectsOfCalls(
        [
          {
            operationCount: 1,
            label: 'Alter type',
            dataLoss: [{ ...column('user', 'full_name'), loss: 'typeChange' }],
            accessChanges: [],
            temporaryValues: [],
          },
        ],
        {
          fromContract: origin,
          contract: origin,
          renames: renamesBetween(origin, origin),
          byHand,
          removedVariants: [],
          origins: NO_RENAMED_ORIGINS,
        },
      ).dataLoss,
    ).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'field', namespaceId: app, model: 'User', field: 'name' },
        loss: 'typeChange',
        label: 'Alter type',
      },
    ]);
  });

  it('reads no rename into a convert statement', () => {
    const destination = contractOf({
      User: { table: 'user', fields: { id: 'id', name: 'display_name' } },
    });
    expect(
      subjectsOfCalls([losing(column('user', 'full_name'))], {
        fromContract: origin,
        contract: destination,
        renames: renamesBetween(origin, destination),
        byHand,
        removedVariants: [],
        origins: NO_RENAMED_ORIGINS,
      }).dataLoss.map(({ subject }) => subject),
    ).toEqual([{ kind: 'field', namespaceId: app, model: 'User', field: 'name' }]);
  });

  it('names storage the origin contract does not declare by its storage name', () => {
    expect(
      subjectsOfCalls(
        [losing(table('audit_log', 'public.audit_log'), column('user', 'nickname'))],
        {
          fromContract: origin,
          contract: origin,
          renames: renamesBetween(origin, origin),
          byHand,
          removedVariants: [],
          origins: NO_RENAMED_ORIGINS,
        },
      ).dataLoss,
    ).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'storage', name: 'public.audit_log' },
        loss: 'drop',
        label: 'Drop',
      },
      {
        operationIndex: 0,
        subject: { kind: 'storage', name: 'user.nickname' },
        loss: 'drop',
        label: 'Drop',
      },
    ]);
  });

  it('names every subject by its storage name when the plan has no origin contract', () => {
    expect(
      subjectsOfCalls([losing(table('legacy'), column('user', 'full_name'))], {
        fromContract: null,
        contract: origin,
        renames: undefined,
        byHand,
        removedVariants: [],
        origins: NO_RENAMED_ORIGINS,
      }).dataLoss,
    ).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'storage', name: 'legacy' },
        loss: 'drop',
        label: 'Drop',
      },
      {
        operationIndex: 0,
        subject: { kind: 'storage', name: 'user.full_name' },
        loss: 'drop',
        label: 'Drop',
      },
    ]);
  });

  it('names a subject with no table, such as a type, by its storage name', () => {
    expect(
      subjectsOfCalls([losing({ storageName: 'public.mood', table: undefined })], {
        fromContract: origin,
        contract: origin,
        renames: renamesBetween(origin, origin),
        byHand,
        removedVariants: [],
        origins: NO_RENAMED_ORIGINS,
      }).dataLoss,
    ).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'storage', name: 'public.mood' },
        loss: 'drop',
        label: 'Drop',
      },
    ]);
  });

  it('lists access changes with the model of their table', () => {
    expect(
      subjectsOfCalls(
        [
          unchanged,
          {
            operationCount: 1,
            label: 'Drop policy',
            dataLoss: [],
            accessChanges: [{ ...table('user'), widens: false }],
            temporaryValues: [],
          },
        ],
        {
          fromContract: origin,
          contract: origin,
          renames: renamesBetween(origin, origin),
          byHand,
          removedVariants: [],
          origins: NO_RENAMED_ORIGINS,
        },
      ),
    ).toEqual({
      dataLoss: [],
      accessChanges: [
        {
          operationIndex: 1,
          subject: { kind: 'model', namespaceId: app, model: 'User' },
          widens: false,
        },
      ],
      temporaryValues: [],
    });
  });
});

describe('unknownCallNames', () => {
  it('numbers the calls that share a factory name, and leaves a unique one alone', () => {
    const calls = [
      { factoryName: 'dropSearchConfig' },
      { factoryName: 'rebuildThing' },
      { factoryName: 'dropSearchConfig' },
    ];
    expect([...unknownCallNames(calls).values()]).toEqual([
      'dropSearchConfig#1',
      'rebuildThing',
      'dropSearchConfig#2',
    ]);
  });
});

describe('fieldEventStorage', () => {
  it('names the field event column, qualified by its namespace outside the unbound one', () => {
    const subjects = subjectsOfCalls(
      [
        losing(
          fieldEventStorage({ namespaceId: 'app', tableName: 'user', columnName: 'full_name' }),
          fieldEventStorage({ namespaceId: 'app', tableName: 'user', columnName: 'nickname' }),
        ),
      ],
      {
        fromContract: origin,
        contract: origin,
        renames: renamesBetween(origin, origin),
        byHand,
        removedVariants: [],
        origins: NO_RENAMED_ORIGINS,
      },
    );
    expect(subjects.dataLoss.map(({ subject }) => subject)).toEqual([
      { kind: 'field', namespaceId: app, model: 'User', field: 'name' },
      { kind: 'storage', name: 'app.user.nickname' },
    ]);
    expect(
      fieldEventStorage({ namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columnName: 'bio' })
        .storageName,
    ).toBe('user.bio');
  });
});
