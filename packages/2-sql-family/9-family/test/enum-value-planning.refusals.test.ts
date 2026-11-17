import { asNamespaceId, type JsonValue } from '@internal/contract/types';
import type { ResolvedEnumValueRenameStatement } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { planEnumValueRewrites } from '../src/core/migrations/enum-value-planning';
import {
  BIGINT_CODEC_ID,
  bigintCodecs,
  codecRef,
  contractWith,
  noCodecs,
  refusal,
  rename,
  rewrites,
  tablesOf,
  taskColumn,
} from './enum-value-fixtures';

type Members = Readonly<Record<string, JsonValue>>;

function plan(
  from: Members,
  to: Members,
  statements: readonly ResolvedEnumValueRenameStatement[] = [],
) {
  return planEnumValueRewrites({
    statements,
    fromContract: contractWith({ members: from, columns: [taskColumn] }),
    contract: contractWith({ members: to, columns: [taskColumn] }),
    tables: tablesOf(['app.task.status']),
    codecs: noCodecs,
  });
}

/** The rewrite of the `status` column of `task` that changes `from` to `to` for enum value `member`. */
function rewrite(
  member: string,
  from: JsonValue,
  to: JsonValue | undefined,
  statement?: ResolvedEnumValueRenameStatement,
) {
  return {
    enumValue: { namespaceId: asNamespaceId('app'), enum: 'Status', member },
    namespaceId: 'app',
    table: 'task',
    column: 'status',
    codecRef,
    many: false,
    member: undefined,
    from,
    to,
    statement,
  };
}

const CYCLE_WHY =
  'The plan rewrites a changed stored value in every row that holds it, one value after another, and no order of the rewrites moves values in a cycle.';

function handWritten(rewritten: string): string {
  return `run prisma migration new, and in the operations of the migration.ts it writes, rewrite ${rewritten} yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.`;
}

describe('planEnumValueRewrites refuses members that keep their names and move stored values in a cycle', () => {
  it('and gives a route through a value no member stores, in two plans', () => {
    expect(
      refusal(plan({ ACTIVE: 'active', OLD: 'old' }, { ACTIVE: 'old', OLD: 'active' })),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot change the stored values of enum "Status": enum values "Status.ACTIVE" and "Status.OLD" move stored values in a cycle, "active" to "old" and "old" to "active", and a rewrite of one would overwrite the other before it is read',
      why: `${CYCLE_WHY} Make the change in two plans: first give "Status.ACTIVE" a stored value no member stores, such as "prisma_swap", and give "Status.OLD" the stored value "active", and plan and apply that; then give "Status.ACTIVE" the stored value "old", and plan again. With migration plan, you can instead write this change as a hand-written migration: ${handWritten('the values in each column the enum types through a value no member stores, "active" to "prisma_swap", then "old" to "active", then "prisma_swap" to "old", each with this.replaceStoredValue({ table, column, from, to })')}`,
    });
  });

  it('plans both plans of the route', () => {
    const between = { ACTIVE: 'prisma_swap', OLD: 'active' };
    expect(rewrites(plan({ ACTIVE: 'active', OLD: 'old' }, between))).toEqual([
      rewrite('ACTIVE', 'active', 'prisma_swap'),
      rewrite('OLD', 'old', 'active'),
    ]);
    expect(rewrites(plan(between, { ACTIVE: 'old', OLD: 'active' }))).toEqual([
      rewrite('ACTIVE', 'prisma_swap', 'old'),
    ]);
  });

  it('moves a cycle of integer stored values through the next integer no member stores', () => {
    expect(
      refusal(plan({ LOW: 1, MID: 2, HIGH: 3, TOP: 7 }, { LOW: 2, MID: 3, HIGH: 1, TOP: 7 })),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot change the stored values of enum "Status": enum values "Status.LOW", "Status.MID" and "Status.HIGH" move stored values in a cycle, 1 to 2, 2 to 3 and 3 to 1, and a rewrite of one would overwrite the other before it is read',
      why: `${CYCLE_WHY} Make the change in two plans: first give "Status.LOW" a stored value no member stores, such as 8, and give "Status.MID" the stored value 3 and "Status.HIGH" the stored value 1, and plan and apply that; then give "Status.LOW" the stored value 2, and plan again. With migration plan, you can instead write this change as a hand-written migration: ${handWritten('the values in each column the enum types through a value no member stores, 1 to 8, then 3 to 1, then 2 to 3, then 8 to 2, each with this.replaceStoredValue({ table, column, from, to })')}`,
    });
  });

  it('moves a cycle of non-integer stored values through a whole number no member stores', () => {
    expect(refusal(plan({ LOW: 1.5, HIGH: 2.5 }, { LOW: 2.5, HIGH: 1.5 }))).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot change the stored values of enum "Status": enum values "Status.LOW" and "Status.HIGH" move stored values in a cycle, 1.5 to 2.5 and 2.5 to 1.5, and a rewrite of one would overwrite the other before it is read',
      why: `${CYCLE_WHY} Make the change in two plans: first give "Status.LOW" a stored value no member stores, such as 3, and give "Status.HIGH" the stored value 1.5, and plan and apply that; then give "Status.LOW" the stored value 2.5, and plan again. With migration plan, you can instead write this change as a hand-written migration: ${handWritten('the values in each column the enum types through a value no member stores, 1.5 to 3, then 2.5 to 1.5, then 3 to 2.5, each with this.replaceStoredValue({ table, column, from, to })')}`,
    });
  });
});

describe('planEnumValueRewrites refuses rename statements that move stored values in a cycle', () => {
  it('gives the route in two plans, and lets a plan without the statements be written by hand', () => {
    const statements = [rename('ACTIVE', 'X'), rename('OLD', 'Y')];
    expect(
      refusal(plan({ ACTIVE: 'active', OLD: 'old' }, { X: 'old', Y: 'active' }, statements)),
    ).toEqual({
      kind: 'statementRefused',
      summary:
        'Cannot rename enum value "Status.ACTIVE" to "Status.X": the renames move stored values in a cycle, "active" to "old" and "old" to "active", and a rewrite of one would overwrite the other before it is read',
      why: `${CYCLE_WHY} Make the change in two plans: first give "Status.X" a stored value no member stores, such as "prisma_swap", and give "Status.Y" the stored value "active", and plan and apply that with the same statements; then give "Status.X" the stored value "old", and plan again without them. With migration plan, you can instead leave out the renames in the cycle, and in the migration.ts a plan without them writes, rewrite the values in each column the enum types through a value no member stores, "active" to "prisma_swap", then "old" to "active", then "prisma_swap" to "old", each with this.replaceStoredValue({ table, column, from, to }).`,
      refusedStatement: rename('ACTIVE', 'X'),
      leaveOut: statements,
    });
    expect(rewrites(plan({ ACTIVE: 'active', OLD: 'old' }, { X: 'old', Y: 'active' }))).toEqual([]);
  });

  it('plans both plans of the route', () => {
    const statements = [rename('ACTIVE', 'X'), rename('OLD', 'Y')];
    const between = { X: 'prisma_swap', Y: 'active' };
    expect(rewrites(plan({ ACTIVE: 'active', OLD: 'old' }, between, statements))).toEqual([
      rewrite('ACTIVE', 'active', 'prisma_swap', statements[0]),
      rewrite('OLD', 'old', 'active', statements[1]),
    ]);
    expect(rewrites(plan(between, { X: 'old', Y: 'active' }))).toEqual([
      rewrite('X', 'prisma_swap', 'old'),
    ]);
  });

  it('gives no route that leaves out the statement when a member that keeps its name is in the cycle', () => {
    const statement = rename('OLD', 'LEGACY');
    expect(
      refusal(
        plan({ ACTIVE: 'active', OLD: 'old' }, { ACTIVE: 'old', LEGACY: 'active' }, [statement]),
      ),
    ).toEqual({
      kind: 'statementRefused',
      summary:
        'Cannot rename enum value "Status.OLD" to "Status.LEGACY": the renames move stored values in a cycle, "active" to "old" and "old" to "active", and a rewrite of one would overwrite the other before it is read',
      why: `${CYCLE_WHY} Make the change in two plans: first give "Status.ACTIVE" a stored value no member stores, such as "prisma_swap", and give "Status.LEGACY" the stored value "active", and plan and apply that with the same statements; then give "Status.ACTIVE" the stored value "old", and plan again without them. With migration plan, you can instead write this change as a hand-written migration: ${handWritten('the values in each column the enum types through a value no member stores, "active" to "prisma_swap", then "old" to "active", then "prisma_swap" to "old", each with this.replaceStoredValue({ table, column, from, to })')}`,
      refusedStatement: statement,
    });
  });

  it('plans both plans of the route when a member that keeps its name is in the cycle', () => {
    const statement = rename('OLD', 'LEGACY');
    const between = { ACTIVE: 'prisma_swap', LEGACY: 'active' };
    expect(rewrites(plan({ ACTIVE: 'active', OLD: 'old' }, between, [statement]))).toEqual([
      rewrite('ACTIVE', 'active', 'prisma_swap'),
      rewrite('OLD', 'old', 'active', statement),
    ]);
    expect(rewrites(plan(between, { ACTIVE: 'old', LEGACY: 'active' }))).toEqual([
      rewrite('ACTIVE', 'prisma_swap', 'old'),
    ]);
  });
});

describe('planEnumValueRewrites refuses a change that merges the data of two members', () => {
  it('when a member that keeps its name takes the stored value of a member the destination removes', () => {
    expect(refusal(plan({ ARCHIVED: 'archived', DONE: 'done' }, { ARCHIVED: 'done' }))).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot change the stored value of enum value "Status.ARCHIVED" from "archived" to "done": the origin enum stores "done" as enum value "Status.DONE"',
      why: `A changed stored value is rewritten in every row that holds it, so the rows of "Status.ARCHIVED" would hold "done" as the rows of "Status.DONE" do, and their data would merge. To make the change without merging their data, make it in two plans: first remove enum value "Status.DONE", and plan and apply that, which asks about its rows; then give "Status.ARCHIVED" the stored value "done", and plan again. To merge their data on purpose with migration plan, write this change as a hand-written migration instead: ${handWritten('"archived" to "done" in each column the enum types, with this.replaceStoredValue({ table, column, from, to })')}`,
    });
  });

  it('plans both plans of the route that keeps their data apart', () => {
    const between = { ARCHIVED: 'archived' };
    expect(rewrites(plan({ ARCHIVED: 'archived', DONE: 'done' }, between))).toEqual([
      rewrite('DONE', 'done', undefined),
    ]);
    expect(rewrites(plan(between, { ARCHIVED: 'done' }))).toEqual([
      rewrite('ARCHIVED', 'archived', 'done'),
    ]);
  });

  it('when a rename statement takes a stored value another member of the origin enum holds', () => {
    const statement = rename('ARCHIVED', 'CLOSED');
    expect(
      refusal(plan({ ARCHIVED: 'archived', DONE: 'done' }, { CLOSED: 'done' }, [statement])),
    ).toEqual({
      kind: 'statementRefused',
      summary:
        'Cannot rename enum value "Status.ARCHIVED" to "Status.CLOSED": the origin enum already stores "done", as enum value "Status.DONE"',
      why: 'A rename changes "archived" to "done" in every row that holds it, which merges its data with the data of "Status.DONE". Leave out this statement. To merge them on purpose, plan the change with migration plan and write this.replaceStoredValue(...) in the migration.ts it writes.',
      refusedStatement: statement,
    });
  });

  it('writes integer stored values without quotes', () => {
    const statement = rename('ARCHIVED', 'CLOSED');
    expect(
      refusal(
        planEnumValueRewrites({
          statements: [statement],
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
    ).toEqual({
      kind: 'statementRefused',
      summary:
        'Cannot rename enum value "Status.ARCHIVED" to "Status.CLOSED": the origin enum already stores 4, as enum value "Status.DONE"',
      why: 'A rename changes 3 to 4 in every row that holds it, which merges its data with the data of "Status.DONE". Leave out this statement. To merge them on purpose, plan the change with migration plan and write this.replaceStoredValue(...) in the migration.ts it writes.',
      refusedStatement: statement,
    });
  });
});

describe('planEnumValueRewrites refuses a rename statement', () => {
  it('whose old stored value the destination enum still has', () => {
    const statement = rename('ARCHIVED', 'RETIRED');
    expect(
      refusal(
        plan({ ARCHIVED: 'archived' }, { RETIRED: 'retired', HIDDEN: 'archived' }, [statement]),
      ),
    ).toEqual({
      kind: 'statementRefused',
      summary:
        'Cannot rename enum value "Status.ARCHIVED" to "Status.RETIRED": the destination enum still stores "archived", as enum value "Status.HIDDEN"',
      why: 'A rename changes the stored value in every row that holds it, so the rows that hold "archived" for "Status.HIDDEN" would change too. Leave out this statement.',
      refusedStatement: statement,
    });
  });
});
