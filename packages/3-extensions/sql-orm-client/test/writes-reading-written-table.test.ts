import {
  createPostgresAdapter,
  postgresAdapterCapabilities,
} from '@internal/adapter-postgres/adapter';
import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import type { PostgresContract } from '../../../3-targets/postgres/2-adapter/src/core/types';
import { Collection } from '../src/collection';
import { and } from '../src/filters';
import { defineContract, field, model, rel } from './contract-builder';
import type { Contract as PolyContract } from './fixtures/polymorphism/generated/contract';
import polyContractJson from './fixtures/polymorphism/generated/contract.json' with {
  type: 'json',
};
import {
  buildTestContextFromContract,
  createMockRuntime,
  getTestContract,
  type MockRuntime,
} from './helpers';

const TeamBase = model('Team', {
  fields: { id: field.column(int4Column).id(), name: field.column(textColumn) },
});

const MemberBase = model('Member', {
  fields: {
    id: field.column(int4Column).id(),
    name: field.column(textColumn),
    invitedById: field.column(int4Column).column('invited_by_id').optional(),
    teamId: field.column(int4Column).column('team_id').optional(),
  },
});

const Member = MemberBase.relations({
  invitedBy: rel.belongsTo(MemberBase, { from: 'invitedById', to: 'id' }),
  invitees: rel.hasMany(() => MemberBase, { by: 'invitedById' }),
  team: rel.belongsTo(TeamBase, { from: 'teamId', to: 'id' }),
}).sql({ table: 'members' });

const Team = TeamBase.relations({
  members: rel.hasMany(() => Member, { by: 'teamId' }),
}).sql({ table: 'teams' });

const StepBase = model('Step', {
  fields: {
    flowId: field.column(int4Column).column('flow_id'),
    position: field.column(int4Column),
    label: field.column(textColumn),
    previousPosition: field.column(int4Column).column('previous_position').optional(),
  },
}).attributes(({ fields, constraints }) => ({
  id: constraints.id([fields.flowId, fields.position]),
}));

const Step = StepBase.relations({
  previous: rel.belongsTo(StepBase, {
    from: ['flowId', 'previousPosition'],
    to: ['flowId', 'position'],
  }),
  next: rel.hasMany(() => StepBase, { by: ['flowId', 'previousPosition'] }),
}).sql({ table: 'steps' });

const EntryBase = model('Entry', {
  fields: {
    code: field.column(textColumn).optional().unique(),
    label: field.column(textColumn),
    parentCode: field.column(textColumn).column('parent_code').optional(),
  },
});

const Entry = EntryBase.relations({
  parent: rel.belongsTo(EntryBase, { from: 'parentCode', to: 'code' }),
}).sql({ table: 'entries' });

const membersContract = defineContract({ models: { Team, Member, Step, Entry } });
const polyContract = new PostgresContractSerializer().deserializeContract<PolyContract>(
  polyContractJson,
);

type Capability = 'reported' | 'not reported';

type Returning = 'with RETURNING' | 'without RETURNING';

function adapterWith(capability: Capability, returning: Returning): typeof postgresAdapter {
  const returns = returning === 'with RETURNING';
  return {
    ...postgresAdapter,
    capabilities: {
      postgres: { ...postgresAdapterCapabilities.postgres, returning: returns },
      sql: {
        ...postgresAdapterCapabilities.sql,
        returning: returns,
        subqueryReadsWrittenTable: capability === 'reported',
      },
    },
  };
}

const lowering = createPostgresAdapter();

interface Statement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function writesOf(runtime: MockRuntime, contract: Contract<SqlStorage>): Statement[] {
  return runtime.executions.flatMap(({ plan }) => {
    if (!('ast' in plan) || (plan.ast.kind !== 'update' && plan.ast.kind !== 'delete')) {
      return [];
    }
    const lowered = lowering.lower(plan.ast, {
      contract: contract as unknown as PostgresContract,
      params: plan.params,
    });
    return [
      {
        sql: lowered.sql,
        params: lowered.params.map((param) => (param.kind === 'literal' ? param.value : param)),
      },
    ];
  });
}

function membersClient(capability: Capability, returning: Returning = 'with RETURNING') {
  const runtime = createMockRuntime();
  const context = buildTestContextFromContract(membersContract, {
    adapter: adapterWith(capability, returning),
  });
  const collection = <Name extends 'Team' | 'Member' | 'Step' | 'Entry'>(name: Name) =>
    new Collection({ runtime, context }, name, { namespaceId: 'public' });
  return { runtime, collection, writes: () => writesOf(runtime, context.contract) };
}

function polyClient(capability: Capability) {
  const runtime = createMockRuntime();
  const context = buildTestContextFromContract(polyContract, {
    adapter: adapterWith(capability, 'with RETURNING'),
  });
  const collection = <Name extends 'Task' | 'Project' | 'Person'>(name: Name) =>
    new Collection({ runtime, context }, name, { namespaceId: 'public' });
  return { runtime, collection, writes: () => writesOf(runtime, context.contract) };
}

type MembersClient = ReturnType<typeof membersClient>;
type PolyClient = ReturnType<typeof polyClient>;

const inviterNamedA = `EXISTS (SELECT "members_2"."id" AS "_exists" FROM "public"."members" AS "members_2" WHERE ("members_2"."id" = "members"."invited_by_id" AND "members_2"."name" = $2))`;

function keySetOf(table: string, where: string): string {
  return `"${table}"."id" IN (SELECT "matching_keys"."id" AS "id" FROM (SELECT "${table}"."id" AS "id" FROM "public"."${table}" WHERE ${where}) AS "matching_keys")`;
}

describe('a write whose filter reads the written table, on a database that runs it', () => {
  it('sends the filter as it is written, for a self-relation and for a variant stored in its own table', async () => {
    const members = membersClient('reported');
    const poly = polyClient('reported');

    await members
      .collection('Member')
      .where((member) => member.invitedBy.some((inviter) => inviter.name.eq('a')))
      .updateAndCount({ name: 'z' });
    await members
      .collection('Member')
      .where((member) => member.invitees.none())
      .deleteAndCount();
    await poly.collection('Task').variant('feature').updateAndCount({ title: 'z' });

    expect([...members.writes(), ...poly.writes()]).toEqual([
      {
        sql: `UPDATE "public"."members" SET "name" = $1 WHERE ${inviterNamedA}`,
        params: ['z', 'a'],
      },
      {
        sql: 'DELETE FROM "public"."members" WHERE NOT EXISTS (SELECT "members_2"."invited_by_id" AS "_exists" FROM "public"."members" AS "members_2" WHERE "members_2"."invited_by_id" = "members"."id")',
        params: [],
      },
      {
        sql: 'UPDATE "public"."tasks" SET "title" = $1 WHERE EXISTS (SELECT "tasks_2"."id" AS "id" FROM "public"."tasks" AS "tasks_2" INNER JOIN "public"."features" ON "tasks_2"."id" = "features"."id" WHERE ("tasks_2"."id" = "tasks"."id" AND "tasks"."type" = $2))',
        params: ['z', 'feature'],
      },
    ]);
  });
});

function unaffectedWrites(capability: Capability): Promise<Statement[]> {
  const members = membersClient(capability);
  members.runtime.setNextResults([[{ id: 1 }]]);
  return (async () => {
    await members.collection('Member').where({ name: 'a' }).updateAndCount({ name: 'z' });
    await members
      .collection('Member')
      .where((member) => member.team.some((team) => team.name.eq('core')))
      .deleteAndCount();
    await members
      .collection('Team')
      .where({ id: 1 })
      .update({
        members: (teamMembers) => teamMembers.where({ name: 'a' }).updateAll({ name: 'z' }),
      });
    return members.writes();
  })();
}

describe('a write whose filter does not read the written table, on a database that cannot run one that does', () => {
  it('sends the same statements as on a database that can: a filter with no subquery, a relation filter on another table, and a nested filtered write', async () => {
    const statements = await unaffectedWrites('not reported');

    expect(statements).toEqual(await unaffectedWrites('reported'));
    expect(statements).toEqual([
      {
        sql: 'UPDATE "public"."members" SET "name" = $1 WHERE "members"."name" = $2',
        params: ['z', 'a'],
      },
      {
        sql: 'DELETE FROM "public"."members" WHERE EXISTS (SELECT "teams"."id" AS "_exists" FROM "public"."teams" WHERE ("teams"."id" = "members"."team_id" AND "teams"."name" = $1))',
        params: ['core'],
      },
      {
        sql: 'UPDATE "public"."members" SET "name" = $1 WHERE ("members"."name" = $2 AND "members"."team_id" = $3)',
        params: ['z', 'a', 1],
      },
    ]);
  });
});

describe('a write whose filter reads the written table, on a database that cannot run it', () => {
  async function selfRelationWrites(
    write: (members: MembersClient) => Promise<unknown>,
  ): Promise<Statement[]> {
    const members = membersClient('not reported');
    await write(members);
    return members.writes();
  }

  it('updateAll filtered by some() writes the rows whose keys a derived table selects', async () => {
    expect(
      await selfRelationWrites(({ collection }) =>
        collection('Member')
          .where((member) => member.invitedBy.some((inviter) => inviter.name.eq('a')))
          .updateAndCount({ name: 'z' }),
      ),
    ).toEqual([
      {
        sql: `UPDATE "public"."members" SET "name" = $1 WHERE ${keySetOf('members', inviterNamedA)}`,
        params: ['z', 'a'],
      },
    ]);
  });

  it('deleteAll filtered by none() and by every() deletes the rows whose keys a derived table selects', async () => {
    expect(
      await selfRelationWrites(async ({ collection }) => {
        await collection('Member')
          .where((member) => member.invitees.none())
          .deleteAndCount();
        await collection('Member')
          .where((member) => member.invitees.every((invitee) => invitee.name.eq('a')))
          .deleteAndCount();
      }),
    ).toEqual([
      {
        sql: `DELETE FROM "public"."members" WHERE ${keySetOf('members', 'NOT EXISTS (SELECT "members_2"."invited_by_id" AS "_exists" FROM "public"."members" AS "members_2" WHERE "members_2"."invited_by_id" = "members"."id")')}`,
        params: [],
      },
      {
        sql: `DELETE FROM "public"."members" WHERE ${keySetOf('members', 'NOT EXISTS (SELECT "members_2"."invited_by_id" AS "_exists" FROM "public"."members" AS "members_2" WHERE ("members_2"."invited_by_id" = "members"."id" AND NOT ("members_2"."name" = $1)))')}`,
        params: ['a'],
      },
    ]);
  });

  it('repeats after the key set each top-level condition that does not read the written table, and binds a repeated parameter once', async () => {
    expect(
      await selfRelationWrites(({ collection }) =>
        collection('Member')
          .where({ name: 'b' })
          .where((member) => member.invitedBy.some((inviter) => inviter.name.eq('a')))
          .where((member) => member.team.some((team) => team.name.eq('core')))
          .updateAndCount({ name: 'z' }),
      ),
    ).toEqual([
      {
        sql: `UPDATE "public"."members" SET "name" = $1 WHERE (${keySetOf(
          'members',
          `("members"."name" = $2 AND EXISTS (SELECT "members_2"."id" AS "_exists" FROM "public"."members" AS "members_2" WHERE ("members_2"."id" = "members"."invited_by_id" AND "members_2"."name" = $3)) AND EXISTS (SELECT "teams"."id" AS "_exists" FROM "public"."teams" WHERE ("teams"."id" = "members"."team_id" AND "teams"."name" = $4)))`,
        )} AND "members"."name" = $2 AND EXISTS (SELECT "teams"."id" AS "_exists" FROM "public"."teams" WHERE ("teams"."id" = "members"."team_id" AND "teams"."name" = $4)))`,
        params: ['z', 'b', 'a', 'core'],
      },
    ]);
  });

  it('repeats nothing after the key set for one condition that is not a conjunction, at any depth of the subquery', async () => {
    expect(
      await selfRelationWrites(({ collection }) =>
        collection('Member')
          .where((member) =>
            and(
              member.name.eq('b'),
              member.team.some((team) => team.members.some((other) => other.name.eq('a'))),
            ).not(),
          )
          .deleteAndCount(),
      ),
    ).toEqual([
      {
        sql: `DELETE FROM "public"."members" WHERE ${keySetOf(
          'members',
          `NOT (("members"."name" = $1 AND EXISTS (SELECT "teams"."id" AS "_exists" FROM "public"."teams" WHERE ("teams"."id" = "members"."team_id" AND EXISTS (SELECT "members_2"."team_id" AS "_exists" FROM "public"."members" AS "members_2" WHERE ("members_2"."team_id" = "teams"."id" AND "members_2"."name" = $2))))))`,
        )}`,
        params: ['b', 'a'],
      },
    ]);
  });

  it('compares the columns of a composite primary key, in key order, with the key set', async () => {
    expect(
      await selfRelationWrites(({ collection }) =>
        collection('Step')
          .where((step) => step.next.none())
          .updateAndCount({ label: 'last' }),
      ),
    ).toEqual([
      {
        sql: 'UPDATE "public"."steps" SET "label" = $1 WHERE ("steps"."flow_id", "steps"."position") IN (SELECT "matching_keys"."flow_id" AS "flow_id", "matching_keys"."position" AS "position" FROM (SELECT "steps"."flow_id" AS "flow_id", "steps"."position" AS "position" FROM "public"."steps" WHERE NOT EXISTS (SELECT "steps_2"."flow_id" AS "_exists" FROM "public"."steps" AS "steps_2" WHERE ("steps_2"."flow_id" = "steps"."flow_id" AND "steps_2"."previous_position" = "steps"."position"))) AS "matching_keys")',
        params: ['last'],
      },
    ]);
  });

  it('puts the keys of the rows a write read first inside the key set, and repeats them after it', async () => {
    const members = membersClient('not reported', 'without RETURNING');
    members.runtime.setNextResults([[{ id: 1 }, { id: 2 }]]);

    await members
      .collection('Member')
      .where((member) => member.invitees.some())
      .select('id')
      .deleteAll();

    expect(members.writes()).toEqual([
      {
        sql: `DELETE FROM "public"."members" WHERE (${keySetOf('members', '(EXISTS (SELECT "members_2"."invited_by_id" AS "_exists" FROM "public"."members" AS "members_2" WHERE "members_2"."invited_by_id" = "members"."id") AND "members"."id" IN ($1, $2))')} AND "members"."id" IN ($1, $2))`,
        params: [1, 2],
      },
    ]);
  });

  it('a nested updateAll and deleteAll filtered by a self-relation select only keys of rows of the parent, and repeat the conditions of nested conjunctions', async () => {
    const updating = membersClient('not reported');
    const deleting = membersClient('not reported');
    const updatingNamed = membersClient('not reported');
    updatingNamed.runtime.setNextResults([[{ id: 3 }]]);
    updating.runtime.setNextResults([[{ id: 3 }]]);
    deleting.runtime.setNextResults([[{ id: 3 }]]);
    const withInvitees =
      'EXISTS (SELECT "members_2"."invited_by_id" AS "_exists" FROM "public"."members" AS "members_2" WHERE "members_2"."invited_by_id" = "members"."id")';

    await updating
      .collection('Member')
      .where({ id: 3 })
      .update({
        invitees: (invitees) =>
          invitees.where((member) => member.invitees.some()).updateAll({ name: 'z' }),
      });
    await deleting
      .collection('Member')
      .where({ id: 3 })
      .update({
        invitees: (invitees) => invitees.where((member) => member.invitees.some()).deleteAll(),
      });

    await updatingNamed
      .collection('Member')
      .where({ id: 3 })
      .update({
        invitees: (invitees) =>
          invitees
            .where({ name: 'b' })
            .where((member) => member.invitees.some())
            .updateAll({ name: 'z' }),
      });

    expect([...updating.writes(), ...deleting.writes(), ...updatingNamed.writes()]).toEqual([
      {
        sql: `UPDATE "public"."members" SET "name" = $1 WHERE (${keySetOf('members', `(${withInvitees} AND "members"."invited_by_id" = $2)`)} AND "members"."invited_by_id" = $2)`,
        params: ['z', 3],
      },
      {
        sql: `DELETE FROM "public"."members" WHERE (${keySetOf('members', `(${withInvitees} AND "members"."invited_by_id" = $1)`)} AND "members"."invited_by_id" = $1)`,
        params: [3],
      },
      {
        sql: `UPDATE "public"."members" SET "name" = $1 WHERE (${keySetOf('members', `(("members"."name" = $2 AND ${withInvitees}) AND "members"."invited_by_id" = $3)`)} AND "members"."name" = $2 AND "members"."invited_by_id" = $3)`,
        params: ['z', 'b', 3],
      },
    ]);
  });

  it('refuses a table with no primary key and no unique constraint whose columns are all NOT NULL, before any statement runs', async () => {
    const members = membersClient('not reported');

    await expect(
      members
        .collection('Entry')
        .where((entry) => entry.parent.some((parent) => parent.label.eq('a')))
        .deleteAndCount(),
    ).rejects.toMatchObject({
      code: 'ORM.CAPABILITY_MISSING',
      message:
        'Cannot write table "entries" by a filter with a subquery that reads "entries": the contract lacks capability "sql.subqueryReadsWrittenTable", so the rows to write are selected by key first, and the table has no primary key and no unique constraint whose columns are all NOT NULL.',
      meta: { capability: 'sql.subqueryReadsWrittenTable', table: 'entries' },
    });
    expect(members.runtime.executions).toEqual([]);
  });

  it('a nested updateAll on a many-to-many self-relation puts the junction condition inside the key set and repeats it after', async () => {
    const runtime = createMockRuntime();
    const context = buildTestContextFromContract(getTestContract(), {
      adapter: adapterWith('not reported', 'with RETURNING'),
    });
    runtime.setNextResults([[{ tenant_id: 1, id: 2 }]]);
    const linked =
      '("projects"."tenant_id", "projects"."id") IN (SELECT "project_links_2"."dst_tenant_id" AS "dst_tenant_id", "project_links_2"."dst_id" AS "dst_id" FROM "public"."project_links" AS "project_links_2" WHERE ("project_links_2"."src_tenant_id" = $2 AND "project_links_2"."src_id" = $3))';

    await new Collection({ runtime, context }, 'Project', { namespaceId: 'public' })
      .where({ tenantId: 1, id: 2 })
      .update({
        related: (related) =>
          related.where((project) => project.related.some()).updateAll({ name: 'z' }),
      });

    expect(writesOf(runtime, context.contract)).toEqual([
      {
        sql: `UPDATE "public"."projects" SET "name" = $1 WHERE (("projects"."tenant_id", "projects"."id") IN (SELECT "matching_keys"."tenant_id" AS "tenant_id", "matching_keys"."id" AS "id" FROM (SELECT "projects"."tenant_id" AS "tenant_id", "projects"."id" AS "id" FROM "public"."projects" WHERE (EXISTS (SELECT "projects_2"."tenant_id" AS "_exists" FROM "public"."projects" AS "projects_2" INNER JOIN "public"."project_links" ON ("project_links"."dst_tenant_id" = "projects_2"."tenant_id" AND "project_links"."dst_id" = "projects_2"."id") WHERE ("project_links"."src_tenant_id" = "projects"."tenant_id" AND "project_links"."src_id" = "projects"."id")) AND ${linked})) AS "matching_keys") AND ${linked})`,
        params: ['z', 1, 2],
      },
    ]);
  });

  describe('for a variant stored in its own table', () => {
    async function variantWrites(write: (poly: PolyClient) => Promise<unknown>) {
      const poly = polyClient('not reported');
      poly.runtime.setNextResults([[{ id: 1 }]]);
      await write(poly);
      return poly.writes();
    }

    it('updateAll and deleteAll write the rows whose keys a derived table selects, and repeat nothing after it', async () => {
      expect(
        await variantWrites(async ({ collection }) => {
          await collection('Task').variant('feature').updateAndCount({ title: 'z' });
          await collection('Task').variant('feature').where({ id: 4 }).deleteAndCount();
        }),
      ).toEqual([
        {
          sql: `UPDATE "public"."tasks" SET "title" = $1 WHERE ${keySetOf('tasks', 'EXISTS (SELECT "tasks_2"."id" AS "id" FROM "public"."tasks" AS "tasks_2" INNER JOIN "public"."features" ON "tasks_2"."id" = "features"."id" WHERE ("tasks_2"."id" = "tasks"."id" AND "tasks"."type" = $2))')}`,
          params: ['z', 'feature'],
        },
        {
          sql: `DELETE FROM "public"."tasks" WHERE ${keySetOf('tasks', 'EXISTS (SELECT "tasks_2"."id" AS "id" FROM "public"."tasks" AS "tasks_2" INNER JOIN "public"."features" ON "tasks_2"."id" = "features"."id" WHERE ("tasks_2"."id" = "tasks"."id" AND "tasks"."type" = $1 AND "tasks"."id" = $2))')}`,
          params: ['feature', 4],
        },
      ]);
    });

    it('connect and disconnect link and unlink the row whose key a derived table selects', async () => {
      const featureTwo =
        'EXISTS (SELECT "tasks_2"."id" AS "id" FROM "public"."tasks" AS "tasks_2" INNER JOIN "public"."features" ON "tasks_2"."id" = "features"."id" WHERE ("tasks_2"."id" = "tasks"."id" AND "tasks"."type" = $2 AND "tasks"."id" = $3))';
      expect(
        await variantWrites(({ collection }) =>
          collection('Project')
            .where({ id: 1 })
            .update({
              tasks: (tasks) => [
                tasks.variant('feature').connect({ id: 2 }),
                tasks.variant('feature').disconnect([{ id: 2 }]),
              ],
            }),
        ),
      ).toEqual([
        {
          sql: `UPDATE "public"."tasks" SET "project_id" = $1 WHERE ${keySetOf('tasks', featureTwo)}`,
          params: [1, 'feature', 2],
        },
        {
          sql: `UPDATE "public"."tasks" SET "project_id" = $1 WHERE (${keySetOf('tasks', `(${featureTwo} AND "tasks"."project_id" = $4)`)} AND "tasks"."project_id" = $4)`,
          params: [null, 'feature', 2, 1],
        },
      ]);
    });
  });
});
