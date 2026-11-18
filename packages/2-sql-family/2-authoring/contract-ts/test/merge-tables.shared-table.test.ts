import { asNamespaceId } from '@internal/contract/types';
import type { ForeignKeyAuthoringInput } from '@internal/sql-contract/foreign-key-materialization';
import { describe, expect, it } from 'vitest';
import { mergeTables } from '../src/merge-tables';
import type { TableDescription } from '../src/storage-description';
import { baseTable, column, foreignKey, ownTable, table } from './merge-tables-support';
import { columnIndex } from './table-node-helpers';

describe('mergeTables on a table single-table variants share', () => {
  it("adds a variant's partial indexes and foreign keys to the base table", () => {
    const task = table('task', [column('Task', 'id'), column('Task', 'ownerId')]);
    const constraints = {
      indexes: [
        { ...columnIndex(['ownerId']), where: "kind = 'bug'" },
        { ...columnIndex(['ownerId']), where: "kind = 'bug'", unique: true },
      ],
      foreignKeys: [foreignKey('ownerId', 'user')],
    } satisfies Partial<TableDescription>;

    expect(
      mergeTables(
        [ownTable(task), baseTable('Bug', 'task', [column('Bug', 'ownerId')], constraints)],
        [],
      ),
    ).toEqual([{ ...task, ...constraints }]);
  });

  it("accepts a plain index on the columns of the variant's own foreign key", () => {
    const task = table('task', [column('Task', 'id'), column('Task', 'ownerId')]);
    const constraints = {
      indexes: [columnIndex(['ownerId'])],
      foreignKeys: [foreignKey('ownerId', 'user')],
    } satisfies Partial<TableDescription>;

    expect(
      mergeTables(
        [ownTable(task), baseTable('Bug', 'task', [column('Bug', 'ownerId')], constraints)],
        [],
      ),
    ).toEqual([{ ...task, ...constraints }]);
  });

  it('merges the same foreign key declared by two variants', () => {
    const task = table('task', [column('Task', 'id'), column('Task', 'ownerId')]);
    const constraints = { foreignKeys: [foreignKey('ownerId', 'user')] };

    expect(
      mergeTables(
        [
          ownTable(task),
          baseTable('Bug', 'task', [column('Bug', 'ownerId')], constraints),
          baseTable('Feature', 'task', [column('Feature', 'ownerId')], constraints),
        ],
        [],
      ),
    ).toEqual([{ ...task, ...constraints }]);
  });

  const ownerTable = table('task', [column('Task', 'id'), column('Task', 'ownerId')]);
  const variantOwning = (
    modelName: string,
    target: string,
    extra: Partial<TableDescription> = {},
  ) =>
    baseTable(modelName, 'task', [column(modelName, 'ownerId')], {
      foreignKeys: [foreignKey('ownerId', target)],
      ...extra,
    });

  it('refuses two variants with foreign keys on one column to different targets', () => {
    expect(() =>
      mergeTables(
        [ownTable(ownerTable), variantOwning('Bug', 'team'), variantOwning('Feature', 'user')],
        [],
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.FOREIGN_KEY_CONFLICT_ON_STI_VARIANT',
        message:
          'Models "Feature" and "Bug" share table "task" (single-table inheritance) and declare different foreign keys on (ownerId). Every row would have to satisfy both; give each variant its own column.',
        meta: {
          modelName: 'Feature',
          otherModelName: 'Bug',
          namespaceId: 'public',
          tableName: 'task',
          columns: ['ownerId'],
        },
      }),
    );
  });

  it('refuses a variant foreign key that differs from the base model one on the same column', () => {
    expect(() =>
      mergeTables(
        [
          ownTable({ ...ownerTable, foreignKeys: [foreignKey('ownerId', 'team')] }),
          variantOwning('Feature', 'user'),
        ],
        [],
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.FOREIGN_KEY_CONFLICT_ON_STI_VARIANT',
        message:
          'Model "Feature" shares table "task" with its base model "Model" (single-table inheritance) and declares a foreign key on (ownerId) that differs from the one "Model" declares there. Every row would have to satisfy both; keep only one of the two.',
      }),
    );
  });

  it("refuses a unique constraint over the variant's own foreign key columns", () => {
    expect(() =>
      mergeTables(
        [
          ownTable(ownerTable),
          variantOwning('Bug', 'user', { uniques: [{ columns: ['ownerId'] }] }),
        ],
        [],
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.UNSCOPED_INDEX_ON_STI_VARIANT',
        meta: expect.objectContaining({ modelName: 'Bug', unscoped: [['ownerId']] }),
      }),
    );
  });

  it.each([
    {
      case: 'an index type other than the derived one',
      variant: variantOwning('Bug', 'user', {
        indexes: [{ ...columnIndex(['ownerId']), type: 'hash', options: {} }],
      }),
    },
    {
      case: 'a foreign key that derives no index',
      variant: baseTable('Bug', 'task', [column('Bug', 'ownerId')], {
        foreignKeys: [{ ...foreignKey('ownerId', 'user'), index: false }],
        indexes: [columnIndex(['ownerId'])],
      }),
    },
  ])("refuses a plain index on the variant's foreign key columns with $case", ({ variant }) => {
    expect(() => mergeTables([ownTable(ownerTable), variant], [])).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.UNSCOPED_INDEX_ON_STI_VARIANT',
        meta: expect.objectContaining({ unscoped: [['ownerId']] }),
      }),
    );
  });

  it('accepts the backing index of a foreign key without a constraint, which still derives it', () => {
    const constraints = {
      foreignKeys: [{ ...foreignKey('ownerId', 'user'), constraint: false }],
      indexes: [columnIndex(['ownerId'])],
    };

    expect(
      mergeTables(
        [ownTable(ownerTable), baseTable('Bug', 'task', [column('Bug', 'ownerId')], constraints)],
        [],
      ),
    ).toEqual([{ ...ownerTable, ...constraints }]);
  });

  it('refuses a variant foreign key on a column a sibling variant maps without it', () => {
    expect(() =>
      mergeTables(
        [
          ownTable(ownerTable),
          variantOwning('Bug', 'user'),
          baseTable('Feature', 'task', [column('Feature', 'ownerId')]),
        ],
        [],
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.FOREIGN_KEY_CONFLICT_ON_STI_VARIANT',
        message:
          'Model "Bug" declares a foreign key on (ownerId) of table "task", but model "Feature" also maps column "ownerId" without it (single-table inheritance). Every "Feature" row would have to satisfy it; give "Bug" a column of its own.',
        meta: expect.objectContaining({ modelName: 'Bug', columns: ['ownerId'] }),
      }),
    );
  });

  it('refuses a variant unique on a foreign key column a sibling also maps', () => {
    expect(() =>
      mergeTables(
        [
          ownTable(ownerTable),
          variantOwning('Bug', 'user', { uniques: [{ columns: ['ownerId'] }] }),
          variantOwning('Feature', 'user'),
        ],
        [],
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.UNSCOPED_INDEX_ON_STI_VARIANT',
        meta: expect.objectContaining({ modelName: 'Bug', unscoped: [['ownerId']] }),
      }),
    );
  });

  const pairTable = table('task', [
    column('Task', 'id'),
    column('Task', 'tenantId'),
    column('Task', 'ownerId'),
  ]);
  const pairForeignKey = (
    columns: readonly string[],
    targetTable: string,
    targetColumns: readonly string[],
  ) => ({
    source: { namespaceId: asNamespaceId('public'), tableName: 'task', columns },
    target: {
      namespaceId: asNamespaceId('public'),
      tableName: targetTable,
      columns: targetColumns,
    },
    constraint: true,
    index: true,
  });
  const pairVariant = (modelName: string, foreignKeyInput: ForeignKeyAuthoringInput) =>
    baseTable(modelName, 'task', [column(modelName, 'tenantId'), column(modelName, 'ownerId')], {
      foreignKeys: [foreignKeyInput],
    });

  it('refuses foreign keys over the same columns listed in another order to different targets', () => {
    expect(() =>
      mergeTables(
        [
          ownTable(pairTable),
          pairVariant('Bug', pairForeignKey(['tenantId', 'ownerId'], 'team', ['tenantId', 'id'])),
          pairVariant(
            'Feature',
            pairForeignKey(['ownerId', 'tenantId'], 'user', ['id', 'tenantId']),
          ),
        ],
        [],
      ),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.FOREIGN_KEY_CONFLICT_ON_STI_VARIANT' }));
  });

  it('keeps one foreign key, in the order first written, for the same column pairs in another order', () => {
    const first = pairForeignKey(['tenantId', 'ownerId'], 'user', ['tenantId', 'id']);

    expect(
      mergeTables(
        [
          ownTable(pairTable),
          pairVariant('Bug', first),
          pairVariant(
            'Feature',
            pairForeignKey(['ownerId', 'tenantId'], 'user', ['id', 'tenantId']),
          ),
        ],
        [],
      ),
    ).toEqual([{ ...pairTable, foreignKeys: [first] }]);
  });

  it('ignores a variant foreign key that creates neither a constraint nor an index', () => {
    const base = { ...ownerTable, foreignKeys: [foreignKey('ownerId', 'team')] };
    const noOp = { ...foreignKey('ownerId', 'user'), constraint: false, index: false };

    expect(
      mergeTables(
        [
          ownTable(base),
          baseTable('Bug', 'task', [column('Bug', 'ownerId')], { foreignKeys: [noOp] }),
        ],
        [],
      ),
    ).toEqual([{ ...base, foreignKeys: [foreignKey('ownerId', 'team'), noOp] }]);
  });

  it('refuses a variant backing index the base table already has under another name', () => {
    const baseIndex = { ...columnIndex(['ownerId']), map: 'task_owner' };

    expect(() =>
      mergeTables(
        [
          ownTable({ ...ownerTable, indexes: [baseIndex] }),
          variantOwning('Bug', 'user', { indexes: [namedBackingIndex('bug_owner')] }),
        ],
        [],
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.UNSCOPED_INDEX_ON_STI_VARIANT',
        meta: expect.objectContaining({ modelName: 'Bug', unscoped: [['ownerId']] }),
      }),
    );
  });

  it('keeps one variant backing index the base table already has under the same name', () => {
    const base = { ...ownerTable, indexes: [namedBackingIndex('task_owner')] };

    expect(
      mergeTables(
        [
          ownTable(base),
          variantOwning('Bug', 'user', { indexes: [namedBackingIndex('task_owner')] }),
        ],
        [],
      ),
    ).toEqual([{ ...base, foreignKeys: [foreignKey('ownerId', 'user')] }]);
  });

  it('keeps a variant backing index beside a unique index of the base on the same columns', () => {
    const baseIndex = { ...columnIndex(['ownerId']), map: 'task_owner_key', unique: true };
    const base = { ...ownerTable, indexes: [baseIndex] };
    const indexes = [namedBackingIndex('bug_owner')];

    expect(mergeTables([ownTable(base), variantOwning('Bug', 'user', { indexes })], [])).toEqual([
      { ...base, indexes: [baseIndex, ...indexes], foreignKeys: [foreignKey('ownerId', 'user')] },
    ]);
  });

  it('keeps one partial index when two variants write it with and without an explicit unique: false', () => {
    const partial = { ...columnIndex(['ownerId']), where: 'owner_id > 0', name: 'task_owner_live' };
    const task = table('task', [column('Task', 'id'), column('Task', 'ownerId')]);

    expect(
      mergeTables(
        [
          ownTable(task),
          baseTable('Bug', 'task', [column('Bug', 'ownerId')], { indexes: [partial] }),
          baseTable('Feature', 'task', [column('Feature', 'ownerId')], {
            indexes: [{ ...partial, unique: false }],
          }),
        ],
        [],
      ),
    ).toEqual([{ ...task, indexes: [partial] }]);
  });

  it('adds nothing to a table no model owns, though it still checks the variant columns', () => {
    const standalone = table('task', [column('Task', 'id')]);
    const variant = baseTable('Bug', 'task', [], {
      indexes: [{ ...columnIndex(['id']), where: 'id > 0' }],
    });

    expect(mergeTables([variant], [standalone])).toEqual([standalone]);
    expect(() =>
      mergeTables([baseTable('Bug', 'task', [column('Bug', 'severity')])], [standalone]),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.VARIANT_COLUMN_NOT_ON_BASE_TABLE' }));
  });

  const namedBackingIndex = (map: string) => ({ ...columnIndex(['ownerId']), map });

  it('keeps one index when two variants write the same backing index', () => {
    const indexes = [namedBackingIndex('task_owner')];

    expect(
      mergeTables(
        [
          ownTable(ownerTable),
          variantOwning('Bug', 'user', { indexes }),
          variantOwning('Feature', 'user', { indexes }),
        ],
        [],
      ),
    ).toEqual([{ ...ownerTable, indexes, foreignKeys: [foreignKey('ownerId', 'user')] }]);
  });

  it('refuses a second variant that names the same backing index differently', () => {
    expect(() =>
      mergeTables(
        [
          ownTable(ownerTable),
          variantOwning('Bug', 'user', { indexes: [namedBackingIndex('task_owner')] }),
          variantOwning('Feature', 'user', { indexes: [namedBackingIndex('task_owner_id')] }),
        ],
        [],
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.UNSCOPED_INDEX_ON_STI_VARIANT',
        meta: expect.objectContaining({ modelName: 'Feature', unscoped: [['ownerId']] }),
      }),
    );
  });

  it('refuses every unique and every index without a condition on a variant', () => {
    const task = table('task', [
      column('Task', 'id'),
      column('Task', 'email'),
      column('Task', 'code'),
      column('Task', 'ownerId'),
    ]);

    expect(() =>
      mergeTables(
        [
          ownTable(task),
          baseTable(
            'Bug',
            'task',
            [column('Bug', 'email'), column('Bug', 'code'), column('Bug', 'ownerId')],
            {
              foreignKeys: [foreignKey('ownerId', 'user')],
              uniques: [{ columns: ['email'] }, { columns: ['ownerId', 'email'] }],
              indexes: [
                columnIndex(['code']),
                { ...columnIndex(['code']), unique: true },
                { ...columnIndex(['email']), where: "kind = 'bug'" },
              ],
            },
          ),
        ],
        [],
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.UNSCOPED_INDEX_ON_STI_VARIANT',
        meta: {
          modelName: 'Bug',
          namespaceId: 'public',
          tableName: 'task',
          unscoped: [['email'], ['ownerId', 'email'], ['code'], ['code']],
        },
      }),
    );
  });

  it('refuses a variant foreign key on a column with a stored default', () => {
    const defaulted = {
      ...column('Bug', 'ownerId'),
      default: { kind: 'literal', value: 1 },
    } as const;

    expect(() =>
      mergeTables(
        [
          ownTable(ownerTable),
          baseTable('Bug', 'task', [defaulted], { foreignKeys: [foreignKey('ownerId', 'user')] }),
        ],
        [],
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.FOREIGN_KEY_CONFLICT_ON_STI_VARIANT',
        message:
          'Model "Bug" declares a foreign key on (ownerId) of table "task", but column "ownerId" has a default, which the rows of every model sharing the table get too (single-table inheritance). Remove the default.',
      }),
    );
  });

  it('accepts the index a variant foreign key names as its backing index', () => {
    const named = { ...foreignKey('ownerId', 'user'), index: 'bug_owner' };
    const indexes = [namedBackingIndex('bug_owner')];

    expect(
      mergeTables(
        [
          ownTable(ownerTable),
          baseTable('Bug', 'task', [column('Bug', 'ownerId')], {
            foreignKeys: [named],
            indexes,
          }),
        ],
        [],
      ),
    ).toEqual([{ ...ownerTable, indexes, foreignKeys: [named] }]);
  });
});
