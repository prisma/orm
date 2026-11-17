import {
  asNamespaceId,
  type Contract,
  type JsonValue,
  profileHash,
  type StorageHashBase,
} from '@internal/contract/types';
import type {
  ResolvedEnumValueRenameStatement,
  ResolvedNamespaceRenameStatement,
} from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import {
  encodeStoredValue,
  planEnumValueRewrites,
} from '../src/core/migrations/enum-value-planning';
import type { SchemaTables } from '../src/core/migrations/schema-tables';
import {
  FOLDING_CODEC_ID,
  TEXT_CODEC_ID,
  testCodecLookup,
  textCodec,
} from './enum-entity-fixtures';

interface EnumColumn {
  readonly model: string;
  readonly table: string;
  readonly field?: string;
  readonly column?: string;
  readonly nullable?: boolean;
  readonly many?: boolean;
}

function contractWith(options: {
  readonly members: Readonly<Record<string, JsonValue>>;
  readonly columns: readonly EnumColumn[];
  readonly namespace?: string;
  readonly codecId?: string;
}): Contract<SqlStorage> {
  const namespaceId = options.namespace ?? 'app';
  const valueSet = {
    plane: 'domain' as const,
    namespaceId,
    entityKind: 'enum' as const,
    entityName: 'Status',
  };
  const tables = [...new Set(options.columns.map(({ table }) => table))];
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [namespaceId]: createTestSqlNamespace({
          id: namespaceId,
          entries: {
            table: Object.fromEntries(
              tables.map((table) => [
                table,
                new StorageTable({
                  columns: Object.fromEntries(
                    options.columns
                      .filter((column) => column.table === table)
                      .map((column) => [
                        column.column ?? 'status',
                        {
                          dataType: 'test/text',
                          codecId: 'test/text@1',
                          nullable: column.nullable ?? true,
                          ...(column.many === true ? { many: { elementNullable: false } } : {}),
                        },
                      ]),
                  ),
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                }),
              ]),
            ),
          },
        }),
      },
    }),
    domain: {
      namespaces: {
        [namespaceId]: {
          enum: {
            Status: {
              codecId: options.codecId ?? 'test/text@1',
              members: Object.entries(options.members).map(([name, value]) => ({ name, value })),
            },
          },
          models: Object.fromEntries(
            options.columns.map((column) => [
              column.model,
              {
                fields: {
                  [column.field ?? 'status']: {
                    nullable: column.nullable ?? true,
                    type: { kind: 'scalar', codecId: 'test/text@1' },
                    valueSet,
                    ...(column.many === true ? { many: { elementNullable: false } } : {}),
                  },
                },
                relations: {},
                storage: {
                  table: column.table,
                  namespaceId,
                  fields: { [column.field ?? 'status']: { column: column.column ?? 'status' } },
                },
              },
            ]),
          ),
        },
      },
    },
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function tablesOf(qualifiedColumns: readonly string[]): SchemaTables {
  const has = (key: string) => qualifiedColumns.includes(key);
  return {
    hasTable: (namespaceId, table) =>
      qualifiedColumns.some((key) => key.startsWith(`${namespaceId}.${table}.`)),
    hasColumn: (namespaceId, table, column) => has(`${namespaceId}.${table}.${column}`),
    tablesNamed: () => [],
    columnsNamed: () => [],
    namespacesWithTable: () => [],
    hasNamespace: () => true,
  };
}

function rename(from: string, to: string, namespace = 'app'): ResolvedEnumValueRenameStatement {
  return {
    kind: 'rename',
    entity: 'enumValue',
    from: { namespaceId: asNamespaceId(namespace), enum: 'Status', member: from },
    to: { namespaceId: asNamespaceId(namespace), enum: 'Status', member: to },
  };
}

const noCodecs = { descriptorFor: () => undefined };
const BIGINT_CODEC_ID = 'test/bigint@1';
const bigintCodecs = {
  descriptorFor: (id: string) => {
    const descriptor = testCodecLookup.descriptorFor(TEXT_CODEC_ID);
    if (descriptor === undefined || id !== BIGINT_CODEC_ID) return undefined;
    return {
      ...descriptor,
      codecId: id,
      factory: () => () => ({
        ...textCodec,
        fromDataTypeValue: (value: { readonly value: JsonValue }) => BigInt(String(value.value)),
      }),
    };
  },
};

const ARCHIVED = { namespaceId: asNamespaceId('app'), enum: 'Status', member: 'ARCHIVED' };
const codecRef = { codecId: 'test/text@1' };
const taskColumn = { model: 'Task', table: 'task' };

function rewrites(result: ReturnType<typeof planEnumValueRewrites>) {
  if (!result.ok) throw new Error(`expected rewrites, got: ${result.failure.summary}`);
  return result.value;
}

function refusal(result: ReturnType<typeof planEnumValueRewrites>) {
  if (result.ok) throw new Error('expected a refusal');
  return result.failure;
}

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

  it('refuses members that keep their names and move stored values in a cycle, and says how to write the rewrites by hand', () => {
    const refused = refusal(
      planEnumValueRewrites({
        statements: [],
        fromContract: contractWith({
          members: { ACTIVE: 'active', OLD: 'old' },
          columns: [taskColumn],
        }),
        contract: contractWith({
          members: { ACTIVE: 'old', OLD: 'active' },
          columns: [taskColumn],
        }),
        tables: tablesOf(['app.task.status']),
        codecs: noCodecs,
      }),
    );
    expect(refused).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot change the stored values of enum "Status": enum values "Status.ACTIVE" and "Status.OLD" move stored values in a cycle, "active" to "old" and "old" to "active", and a rewrite of one would overwrite the other before it is read',
      why: 'The plan rewrites a changed stored value in every row that holds it, one value after another, and no order of the rewrites moves values in a cycle. Write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the values in each column the enum types through a value no member stores, "active" to "prisma_swap", then "old" to "active", then "prisma_swap" to "old", each with this.replaceStoredValue({ table, column, from, to }) yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
    });
  });

  it('moves a cycle of integer stored values through the next integer no member stores, in the advice', () => {
    const refused = refusal(
      planEnumValueRewrites({
        statements: [],
        fromContract: contractWith({
          members: { LOW: 1, MID: 2, HIGH: 3, TOP: 7 },
          columns: [taskColumn],
        }),
        contract: contractWith({
          members: { LOW: 2, MID: 3, HIGH: 1, TOP: 7 },
          columns: [taskColumn],
        }),
        tables: tablesOf(['app.task.status']),
        codecs: noCodecs,
      }),
    );
    expect(refused).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot change the stored values of enum "Status": enum values "Status.LOW", "Status.MID" and "Status.HIGH" move stored values in a cycle, 1 to 2, 2 to 3 and 3 to 1, and a rewrite of one would overwrite the other before it is read',
      why: 'The plan rewrites a changed stored value in every row that holds it, one value after another, and no order of the rewrites moves values in a cycle. Write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the values in each column the enum types through a value no member stores, 1 to 8, then 3 to 1, then 2 to 3, then 8 to 2, each with this.replaceStoredValue({ table, column, from, to }) yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
    });
  });

  it('moves a cycle of non-integer stored values through a whole number no member stores, in the advice', () => {
    const refused = refusal(
      planEnumValueRewrites({
        statements: [],
        fromContract: contractWith({ members: { LOW: 1.5, HIGH: 2.5 }, columns: [taskColumn] }),
        contract: contractWith({ members: { LOW: 2.5, HIGH: 1.5 }, columns: [taskColumn] }),
        tables: tablesOf(['app.task.status']),
        codecs: noCodecs,
      }),
    );
    expect(refused.why).toContain('1.5 to 3, then 2.5 to 1.5, then 3 to 2.5,');
  });

  it('refuses a member that keeps its name and takes the stored value of a member the destination removes', () => {
    expect(
      refusal(
        planEnumValueRewrites({
          statements: [],
          fromContract: contractWith({
            members: { ARCHIVED: 'archived', DONE: 'done' },
            columns: [taskColumn],
          }),
          contract: contractWith({ members: { ARCHIVED: 'done' }, columns: [taskColumn] }),
          tables: tablesOf(['app.task.status']),
          codecs: noCodecs,
        }),
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot change the stored value of enum value "Status.ARCHIVED" from "archived" to "done": the origin enum stores "done" as enum value "Status.DONE"',
      why: 'A changed stored value is rewritten in every row that holds it, so the rows of "Status.ARCHIVED" would hold "done" as the rows of "Status.DONE" do, and their data would merge. To keep their data apart, give "Status.ARCHIVED" a stored value no member of the origin enum stores, and plan again. To merge their data on purpose, write this change as a hand-written migration: run prisma migration new, and in the operations of the migration.ts it writes, rewrite "archived" to "done" in each column the enum types, with this.replaceStoredValue({ table, column, from, to }) yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
    });
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

  it('refuses renames that move stored values in a cycle, and says how to write them by hand', () => {
    expect(
      refusal(
        planEnumValueRewrites({
          statements: [rename('ACTIVE', 'X'), rename('OLD', 'Y')],
          fromContract: contractWith({
            members: { ACTIVE: 'active', OLD: 'old' },
            columns: [taskColumn],
          }),
          contract: contractWith({ members: { X: 'old', Y: 'active' }, columns: [taskColumn] }),
          tables: tablesOf(['app.task.status']),
          codecs: noCodecs,
        }),
      ),
    ).toMatchObject({
      kind: 'statementRefused',
      summary:
        'Cannot rename enum value "Status.ACTIVE" to "Status.X": the renames move stored values in a cycle, "active" to "old" and "old" to "active", and a rewrite of one would overwrite the other before it is read',
      why: 'Leave out the renames in the cycle, and write the rewrites by hand in the migration.ts a plan without them writes: rewrite the first value to a value no member stores, then each other value, then that value to its new value, with this.replaceStoredValue({ table, column, from, to }) for each.',
      leaveOut: [rename('ACTIVE', 'X'), rename('OLD', 'Y')],
    });
  });

  it('writes integer stored values without quotes in a refusal', () => {
    expect(
      refusal(
        planEnumValueRewrites({
          statements: [rename('ARCHIVED', 'CLOSED')],
          fromContract: contractWith({
            members: { ARCHIVED: '3', DONE: '4' },
            columns: [taskColumn],
            codecId: BIGINT_CODEC_ID,
          }),
          contract: contractWith({
            members: { CLOSED: '4' },
            columns: [taskColumn],
            codecId: BIGINT_CODEC_ID,
          }),
          tables: tablesOf(['app.task.status']),
          codecs: bigintCodecs,
        }),
      ),
    ).toMatchObject({
      summary:
        'Cannot rename enum value "Status.ARCHIVED" to "Status.CLOSED": the origin enum already stores 4, as enum value "Status.DONE"',
    });
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

  it('refuses a rename into a stored value another member of the origin enum holds, which would merge their data', () => {
    expect(
      refusal(
        planEnumValueRewrites({
          statements: [rename('ARCHIVED', 'CLOSED')],
          fromContract: contractWith({
            members: { ARCHIVED: 'archived', DONE: 'done' },
            columns: [taskColumn],
          }),
          contract: contractWith({ members: { CLOSED: 'done' }, columns: [taskColumn] }),
          tables: tablesOf(['app.task.status']),
          codecs: noCodecs,
        }),
      ),
    ).toMatchObject({
      kind: 'statementRefused',
      summary:
        'Cannot rename enum value "Status.ARCHIVED" to "Status.CLOSED": the origin enum already stores "done", as enum value "Status.DONE"',
      why: 'A rename changes "archived" to "done" in every row that holds it, which merges its data with the data of "Status.DONE". Leave out this statement. To merge them on purpose, plan the change with migration plan and write this.replaceStoredValue(...) in the migration.ts it writes.',
    });
  });

  it('refuses a rename whose old stored value the destination enum still has', () => {
    expect(
      refusal(
        planEnumValueRewrites({
          statements: [rename('ARCHIVED', 'RETIRED')],
          fromContract: contractWith({ members: { ARCHIVED: 'archived' }, columns: [taskColumn] }),
          contract: contractWith({
            members: { RETIRED: 'retired', HIDDEN: 'archived' },
            columns: [taskColumn],
          }),
          tables: tablesOf(['app.task.status']),
          codecs: noCodecs,
        }),
      ),
    ).toMatchObject({
      kind: 'statementRefused',
      summary:
        'Cannot rename enum value "Status.ARCHIVED" to "Status.RETIRED": the destination enum still stores "archived", as enum value "Status.HIDDEN"',
      why: 'A rename changes the stored value in every row that holds it, so the rows that hold "archived" for "Status.HIDDEN" would change too. Leave out this statement.',
    });
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
