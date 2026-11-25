import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  contract,
  type EnumSpec,
  type ModelSpec,
  NS,
  plan,
  planned,
  refusal,
  renameModel,
  schemaCollection,
} from './mongo-statement-fixtures';

const ADMIN = { collection: 'users', fields: ['_id', 'admin'] };
const INT = { codecId: 'mongo/int32@1' };
const SCHEMA = [schemaCollection('users'), schemaCollection('members')];

const convert = (model: string, field: string): ResolvedMigrationStatement => ({
  kind: 'convert',
  entity: 'field',
  field: { namespaceId: NS, model, field },
});
const backfill = (model: string, field: string): ResolvedMigrationStatement => ({
  kind: 'backfill',
  entity: 'field',
  field: { namespaceId: NS, model, field },
});

/** `User` leaves `users`, which it shares with `Admin`, and becomes `Member` in `members`, beside `Guest`. */
function moveScenario(
  user: Omit<ModelSpec, 'collection'>,
  guest: {
    readonly from: Omit<ModelSpec, 'collection'>;
    readonly to: Omit<ModelSpec, 'collection'>;
  },
  extra: {
    readonly from?: Record<string, ModelSpec>;
    readonly to?: Record<string, ModelSpec>;
  } = {},
  enums: {
    readonly from?: Record<string, EnumSpec>;
    readonly to?: Record<string, EnumSpec>;
  } = {},
) {
  const from = contract(
    'from',
    {
      Admin: ADMIN,
      User: { collection: 'users', ...user },
      Guest: { collection: 'members', ...guest.from },
      ...extra.from,
    },
    { users: {}, members: {} },
    {},
    enums.from,
  );
  const to = contract(
    'to',
    {
      Admin: ADMIN,
      Member: { collection: 'members', ...user },
      Guest: { collection: 'members', ...guest.to },
      ...extra.to,
    },
    { users: {}, members: {} },
    {},
    enums.to,
  );
  return { from, to };
}

const EARLIER =
  'Or make the change in an earlier migration, before model "Member" is added to collection "members".';

/**
 * The summaries of the refusals of the plan without `--rename User:Member`. Each names the earlier
 * migration that works, and the statement's own refusal gives no move, since its route reads that
 * plan.
 */
function leftOutSummaries(
  scenario: ReturnType<typeof moveScenario>,
  statements: readonly ResolvedMigrationStatement[] = [],
): readonly string[] {
  const leftOut = refusal(plan({ ...scenario, schema: SCHEMA, statements }));
  const [stated] = refusal(
    plan({
      ...scenario,
      schema: SCHEMA,
      statements: [renameModel('User', 'Member'), ...statements],
    }),
  );
  expect({
    earlier: leftOut.map(({ why }) => why?.endsWith(EARLIER)),
    route: {
      fallback: stated?.why?.endsWith(
        'Planned without it, the change is refused for another reason as well, which that refusal names.',
      ),
      moves: stated?.why?.includes('rawAggregate('),
    },
  }).toEqual({ earlier: leftOut.map(() => true), route: { fallback: true, moves: false } });
  return leftOut.map(({ summary }) => summary);
}

describe('MongoMigrationPlanner, rewrites in the target of a document move', () => {
  describe('a rewrite of another model that would reach the moved documents is refused in the plan the route describes', () => {
    it('a field rename', () => {
      const scenario = moveScenario(
        { fields: ['_id', 'name'] },
        {
          from: { fields: ['_id', 'guest', 'name'] },
          to: { fields: ['_id', 'guest', 'name'], storedAs: { name: 'fullName' } },
        },
      );
      expect(leftOutSummaries(scenario)).toEqual([
        'Cannot rename field "name" to "fullName" in collection "members": model "Member" stores field "name" in the same collection, "members"',
      ]);
    });

    it('a cast', () => {
      const scenario = moveScenario(
        { fields: ['_id', 'user', 'age'], types: { age: INT } },
        {
          from: { fields: ['_id', 'guest', 'age'] },
          to: { fields: ['_id', 'guest', 'age'], types: { age: INT } },
        },
      );
      expect(leftOutSummaries(scenario)).toEqual([
        'Cannot cast field "age" of model "Guest" in collection "members": model "Member" stores it in the same collection',
      ]);
    });

    it('a conversion', () => {
      const scenario = moveScenario(
        { fields: ['_id', 'user', 'n'] },
        {
          from: { fields: ['_id', 'guest', 'n'] },
          to: { fields: ['_id', 'guest', 'n'], types: { n: INT } },
        },
      );
      expect(leftOutSummaries(scenario, [convert('Guest', 'n')])).toEqual([
        'Cannot convert field "n" of model "Guest" in collection "members": model "Member" stores it in the same collection',
      ]);
    });

    it('a fill', () => {
      const scenario = moveScenario(
        { fields: ['_id', 'user'] },
        { from: { fields: ['_id', 'guest'] }, to: { fields: ['_id', 'guest', 'level'] } },
      );
      expect(leftOutSummaries(scenario)).toEqual([
        'Cannot fill field "level" of model "Guest" in collection "members": model "Member" is stored in the same collection',
      ]);
    });

    it('a backfill', () => {
      const scenario = moveScenario(
        { fields: ['_id', 'user'] },
        { from: { fields: ['_id', 'guest'] }, to: { fields: ['_id', 'guest', 'level'] } },
      );
      expect(leftOutSummaries(scenario, [backfill('Guest', 'level')])).toEqual([
        'Cannot backfill field "level" of model "Guest" in collection "members": model "Member" is stored in the same collection',
      ]);
    });

    it('a removal', () => {
      const scenario = moveScenario(
        { fields: ['_id', 'user', 'age'] },
        { from: { fields: ['_id', 'guest', 'age'] }, to: { fields: ['_id', 'guest'] } },
      );
      expect(leftOutSummaries(scenario)).toEqual([
        'Cannot remove field "age" of model "Guest" from collection "members": model "Member" stores it in the same collection',
      ]);
    });

    it('an enum value replacement', () => {
      const status = { codecId: 'mongo/string@1', valueSet: 'Status' };
      const scenario = moveScenario(
        { fields: ['_id', 'user', 'status'] },
        {
          from: { fields: ['_id', 'guest', 'status'], types: { status } },
          to: { fields: ['_id', 'guest', 'status'], types: { status } },
        },
        {},
        { from: { Status: { members: { A: 'a' } } }, to: { Status: { members: { A: 'x' } } } },
      );
      expect(leftOutSummaries(scenario)).toEqual([
        'Cannot replace enum value "Status.A" inside field "status" of model "Guest" in collection "members": model "Member" stores it in the same collection',
      ]);
    });

    it('a key rename inside an embedded model', () => {
      const line = (owner: string, sku: string): ModelSpec => ({
        owner,
        fields: ['sku'],
        types: { sku: { codecId: 'mongo/string@1' } },
        storedAs: { sku },
      });
      const scenario = moveScenario(
        { fields: ['_id', 'user'], embeds: { lines: { field: 'lines', model: 'Line' } } },
        {
          from: { fields: ['_id', 'guest'], embeds: { lines: { field: 'lines', model: 'GLine' } } },
          to: { fields: ['_id', 'guest'], embeds: { lines: { field: 'lines', model: 'GLine' } } },
        },
        {
          from: { Line: line('User', 'sku'), GLine: line('Guest', 'sku') },
          to: { Line: line('Member', 'sku'), GLine: line('Guest', 'code') },
        },
      );
      expect(leftOutSummaries(scenario)).toEqual([
        'Cannot rename field "GLine.sku" inside field "lines" of model "Guest" in collection "members": model "Member" stores it in the same collection',
      ]);
    });
  });

  it('moves the documents in the same plan when a rewrite in the target cannot reach them', () => {
    const scenario = moveScenario(
      { fields: ['_id', 'user'] },
      {
        from: { fields: ['_id', 'guest'] },
        to: { fields: ['_id', 'guest'], storedAs: { guest: 'visitor' } },
      },
    );
    const [conflict] = refusal(
      plan({ ...scenario, schema: SCHEMA, statements: [renameModel('User', 'Member')] }),
    );
    expect({
      leftOut: planned(plan({ ...scenario, schema: SCHEMA })).labels,
      why: conflict?.why,
    }).toEqual({
      leftOut: ['Rename field guest to visitor in collection members'],
      why: expect.stringContaining(
        'With migration plan, keep the documents by moving them in the migration that plan writes. Plan the change without --rename User:Member. At the start of the operations of the migration.ts it writes, before any other operation on collection "users", add a dataTransform.',
      ),
    });
  });

  it("plans the moving model's own rewrite in the target, after the move, so it reaches the moved documents", () => {
    const line = (owner: string, sku: string): ModelSpec => ({
      owner,
      fields: ['sku'],
      types: { sku: { codecId: 'mongo/string@1' } },
      storedAs: { sku },
    });
    const scenario = moveScenario(
      { fields: ['_id', 'user'], embeds: { lines: { field: 'lines', model: 'Line' } } },
      { from: { fields: ['_id', 'guest'] }, to: { fields: ['_id', 'guest'] } },
      { from: { Line: line('User', 'sku') }, to: { Line: line('Member', 'code') } },
    );
    expect(planned(plan({ ...scenario, schema: SCHEMA })).labels).toEqual([
      'Rename key "sku" to "code" at path "$[*]" in field lines of collection members',
    ]);
  });
});
