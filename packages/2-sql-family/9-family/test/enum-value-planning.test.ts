import { asNamespaceId } from '@internal/contract/types';
import type { ResolvedNamespaceRenameStatement } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  encodeStoredValue,
  planEnumValueRewrites,
} from '../src/core/migrations/enum-value-planning';
import {
  FOLDING_CODEC_ID,
  TEXT_CODEC_ID,
  testCodecLookup,
  textCodec,
} from './enum-entity-fixtures';
import {
  ARCHIVED,
  codecRef,
  contractWith,
  noCodecs,
  rename,
  rewrites,
  tablesOf,
  taskColumn,
} from './enum-value-fixtures';

describe('planEnumValueRewrites', () => {
  it('removes a stored value the destination enum no longer has from every column the enum types', () => {
    const columns = [
      taskColumn,
      { model: 'Note', table: 'note', column: 'tags', field: 'tags', many: true },
    ];
    expect(
      rewrites(
        planEnumValueRewrites({
          statements: [],
          fromContract: contractWith({
            members: { ACTIVE: 'active', ARCHIVED: 'archived' },
            columns,
          }),
          contract: contractWith({ members: { ACTIVE: 'active' }, columns }),
          tables: tablesOf(['app.task.status', 'app.note.tags']),
          codecs: noCodecs,
        }),
      ),
    ).toEqual([
      {
        enumValue: ARCHIVED,
        namespaceId: 'app',
        table: 'task',
        column: 'status',
        codecRef,
        many: false,
        from: 'archived',
        to: undefined,
        statement: undefined,
      },
      {
        enumValue: ARCHIVED,
        namespaceId: 'app',
        table: 'note',
        column: 'tags',
        codecRef,
        many: true,
        from: 'archived',
        to: undefined,
        statement: undefined,
      },
    ]);
  });

  it('plans nothing for a member renamed with its stored value kept, with or without a statement', () => {
    const fromContract = contractWith({ members: { ARCHIVED: 'archived' }, columns: [taskColumn] });
    const contract = contractWith({ members: { RETIRED: 'archived' }, columns: [taskColumn] });
    const tables = tablesOf(['app.task.status']);

    expect(
      rewrites(
        planEnumValueRewrites({ statements: [], fromContract, contract, tables, codecs: noCodecs }),
      ),
    ).toEqual([]);
    expect(
      rewrites(
        planEnumValueRewrites({
          statements: [rename('ARCHIVED', 'RETIRED')],
          fromContract,
          contract,
          tables,
          codecs: noCodecs,
        }),
      ),
    ).toEqual([]);
  });

  it('replaces the stored value when a rename statement changes it', () => {
    const statement = rename('ARCHIVED', 'RETIRED');
    expect(
      rewrites(
        planEnumValueRewrites({
          statements: [statement],
          fromContract: contractWith({ members: { ARCHIVED: 'archived' }, columns: [taskColumn] }),
          contract: contractWith({ members: { RETIRED: 'retired' }, columns: [taskColumn] }),
          tables: tablesOf(['app.task.status']),
          codecs: noCodecs,
        }),
      ),
    ).toEqual([
      {
        enumValue: ARCHIVED,
        namespaceId: 'app',
        table: 'task',
        column: 'status',
        codecRef,
        many: false,
        from: 'archived',
        to: 'retired',
        statement,
      },
    ]);
  });

  it('replaces the stored value of a member that keeps its name, in every column the enum types', () => {
    const columns = [
      taskColumn,
      { model: 'Note', table: 'note', column: 'tags', field: 'tags', many: true },
    ];
    expect(
      rewrites(
        planEnumValueRewrites({
          statements: [],
          fromContract: contractWith({ members: { ARCHIVED: 1 }, columns }),
          contract: contractWith({ members: { ARCHIVED: 2 }, columns }),
          tables: tablesOf(['app.task.status', 'app.note.tags']),
          codecs: noCodecs,
        }),
      ),
    ).toEqual([
      {
        enumValue: ARCHIVED,
        namespaceId: 'app',
        table: 'task',
        column: 'status',
        codecRef,
        many: false,
        member: undefined,
        from: 1,
        to: 2,
        statement: undefined,
      },
      {
        enumValue: ARCHIVED,
        namespaceId: 'app',
        table: 'note',
        column: 'tags',
        codecRef,
        many: true,
        member: undefined,
        from: 1,
        to: 2,
        statement: undefined,
      },
    ]);
  });

  it('orders the changes of a chain so none overwrites a value another still has to read', () => {
    const planned = rewrites(
      planEnumValueRewrites({
        statements: [],
        fromContract: contractWith({ members: { A: 'a', B: 'b' }, columns: [taskColumn] }),
        contract: contractWith({ members: { A: 'b', B: 'c' }, columns: [taskColumn] }),
        tables: tablesOf(['app.task.status']),
        codecs: noCodecs,
      }),
    );
    expect(
      planned.map(({ enumValue, from, to, statement }) => ({
        member: enumValue.member,
        from,
        to,
        statement,
      })),
    ).toEqual([
      { member: 'B', from: 'b', to: 'c', statement: undefined },
      { member: 'A', from: 'a', to: 'b', statement: undefined },
    ]);
  });

  it('replaces a value a member frees and a new member takes, and the new member starts with no rows', () => {
    expect(
      rewrites(
        planEnumValueRewrites({
          statements: [],
          fromContract: contractWith({ members: { A: 'a' }, columns: [taskColumn] }),
          contract: contractWith({ members: { A: 'b', C: 'a' }, columns: [taskColumn] }),
          tables: tablesOf(['app.task.status']),
          codecs: noCodecs,
        }),
      ).map(({ enumValue, from, to }) => ({ member: enumValue.member, from, to })),
    ).toEqual([{ member: 'A', from: 'a', to: 'b' }]);
  });

  it('accepts renames that shift stored values along, and rewrites the last value first', () => {
    const higher = rename('Higher', 'A');
    const max = rename('Max', 'B');
    const planned = rewrites(
      planEnumValueRewrites({
        statements: [higher, max],
        fromContract: contractWith({
          members: { Low: 0, Higher: 3, Max: 4 },
          columns: [taskColumn],
        }),
        contract: contractWith({ members: { Low: 0, A: 4, B: 5 }, columns: [taskColumn] }),
        tables: tablesOf(['app.task.status']),
        codecs: noCodecs,
      }),
    );
    expect(planned.map(({ from, to, statement }) => ({ from, to, statement }))).toEqual([
      { from: 4, to: 5, statement: max },
      { from: 3, to: 4, statement: higher },
    ]);
  });

  it('leaves out a column the working schema does not have yet, and a table the destination drops', () => {
    expect(
      rewrites(
        planEnumValueRewrites({
          statements: [],
          fromContract: contractWith({
            members: { ACTIVE: 'active', ARCHIVED: 'archived' },
            columns: [taskColumn, { model: 'Old', table: 'old' }],
          }),
          contract: contractWith({
            members: { ACTIVE: 'active' },
            columns: [taskColumn, { model: 'Note', table: 'note' }],
          }),
          tables: tablesOf(['app.task.status', 'app.old.status']),
          codecs: noCodecs,
        }),
      ),
    ).toMatchObject([{ table: 'task' }]);
  });

  it('finds the enum of a renamed namespace under its new name', () => {
    expect(
      rewrites(
        planEnumValueRewrites({
          statements: [
            {
              kind: 'rename',
              entity: 'namespace',
              from: asNamespaceId('app'),
              to: asNamespaceId('crm'),
            } satisfies ResolvedNamespaceRenameStatement,
          ],
          fromContract: contractWith({
            members: { ACTIVE: 'active', ARCHIVED: 'archived' },
            columns: [taskColumn],
          }),
          contract: contractWith({
            members: { ACTIVE: 'active' },
            columns: [taskColumn],
            namespace: 'crm',
          }),
          tables: tablesOf(['crm.task.status']),
          codecs: noCodecs,
        }),
      ),
    ).toMatchObject([{ enumValue: ARCHIVED, namespaceId: 'crm', table: 'task' }]);
  });

  it('plans nothing without an origin contract', () => {
    expect(
      rewrites(
        planEnumValueRewrites({
          statements: [],
          fromContract: null,
          contract: contractWith({ members: { ACTIVE: 'active' }, columns: [taskColumn] }),
          tables: tablesOf(['app.task.status']),
          codecs: noCodecs,
        }),
      ),
    ).toEqual([]);
  });

  it('removes a stored value from a required scalar column too: the operation checks the rows when it runs', () => {
    expect(
      rewrites(
        planEnumValueRewrites({
          statements: [],
          fromContract: contractWith({
            members: { ACTIVE: 'active', ARCHIVED: 'archived' },
            columns: [{ ...taskColumn, nullable: false }],
          }),
          contract: contractWith({
            members: { ACTIVE: 'active' },
            columns: [{ ...taskColumn, nullable: false }],
          }),
          tables: tablesOf(['app.task.status']),
          codecs: noCodecs,
        }),
      ),
    ).toMatchObject([
      { enumValue: ARCHIVED, table: 'task', column: 'status', from: 'archived', to: undefined },
    ]);
  });
});

function lookupWithWire(wire: unknown) {
  return {
    descriptorFor: (id: string) => {
      const descriptor = testCodecLookup.descriptorFor(TEXT_CODEC_ID);
      if (descriptor === undefined) return undefined;
      return {
        ...descriptor,
        codecId: id,
        factory: () => () => ({ ...textCodec, toWire: async () => wire }),
      };
    },
  };
}

describe('encodeStoredValue', () => {
  it('writes a value through the column codec, as the database stores it', async () => {
    expect(
      await encodeStoredValue('ARCHIVED', {
        codecRef: { codecId: FOLDING_CODEC_ID },
        codecs: testCodecLookup,
      }),
    ).toBe('archived');
  });

  it('uses the value as written with no codec, or one the stack does not have', async () => {
    expect(await encodeStoredValue(1, undefined)).toBe(1);
    expect(
      await encodeStoredValue('x', {
        codecRef: { codecId: 'test/none@1' },
        codecs: testCodecLookup,
      }),
    ).toBe('x');
  });

  it('writes a wire bigint as its digits, and refuses any other wire value', async () => {
    expect(
      await encodeStoredValue('7', {
        codecRef: { codecId: 'test/big@1' },
        codecs: lookupWithWire(7n),
      }),
    ).toBe('7');
    await expect(
      encodeStoredValue('x', { codecRef: { codecId: 'test/blob@1' }, codecs: lookupWithWire({}) }),
    ).rejects.toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message:
        'Codec test/blob@1 writes the stored value "x" as neither a string nor a number, which a migration cannot compare',
    });
  });
});
