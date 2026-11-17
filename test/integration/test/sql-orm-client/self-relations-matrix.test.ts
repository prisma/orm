import { and, Collection } from '@internal/sql-orm-client';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import type { Contract as SelfRelationsContract } from './fixtures/self-relations/generated/contract';
import selfRelationsContractJson from './fixtures/self-relations/generated/contract.json' with {
  type: 'json',
};
import { type IncludeStrategy, includeStrategies, postgresAdapterFor } from './helpers';
import { timeouts, withPushedContractRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

const selfRelationsContract =
  new PostgresContractSerializer().deserializeContract<SelfRelationsContract>(
    selfRelationsContractJson,
  );
function selfRelationsContext(strategy: IncludeStrategy): ExecutionContext<SelfRelationsContract> {
  return createExecutionContext({
    contract: selfRelationsContract,
    stack: createSqlExecutionStack({
      target: postgresTarget,
      adapter: postgresAdapterFor(strategy),
    }),
  });
}

function createPeopleCollection(runtime: PgIntegrationRuntime, strategy: IncludeStrategy) {
  return new Collection({ runtime, context: selfRelationsContext(strategy) }, 'Person', {
    namespaceId: 'public',
  });
}

async function seedSelfRelationGraph(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query(`
    insert into people (id, name, manager_id, partner_id) values
      (1, 'Ada', null, 2),
      (2, 'Bea', 1, null),
      (3, 'Cy', 1, 4),
      (4, 'Dex', 2, null),
      (5, 'Eve', null, null)
  `);
  await runtime.query(`
    insert into person_follows (follower_id, followee_id) values
      (1, 2),
      (1, 3),
      (2, 1),
      (3, 4)
  `);
  await runtime.query(`
    insert into person_connections (source_id, target_id, weight) values
      (1, 2, 5),
      (1, 3, 7),
      (2, 1, 11),
      (3, 4, 13)
  `);
}

async function withSelfRelationGraph(
  strategy: IncludeStrategy,
  fn: (
    runtime: PgIntegrationRuntime,
    people: ReturnType<typeof createPeopleCollection>,
  ) => Promise<void>,
): Promise<void> {
  await withPushedContractRuntime(selfRelationsContract, async (runtime) => {
    await seedSelfRelationGraph(runtime);
    await fn(runtime, createPeopleCollection(runtime, strategy));
  });
}

describe.each(includeStrategies)('integration/self-relation matrix (%s)', (strategy) => {
  it(
    'M:1 and 1:M predicates, joins, nesting, and aggregates work in both directions',
    async () => {
      await withSelfRelationGraph(strategy, async (_runtime, people) => {
        const descendants = await people
          .select('id', 'name')
          .where((person) =>
            person.reports.some((report) =>
              report.reports.some((nestedReport) => nestedReport.name.eq('Dex')),
            ),
          )
          .include('reports', (reports) =>
            reports
              .select('id', 'name')
              .distinct('name')
              .orderBy((report) => report.id.asc())
              .include('reports', (nested) =>
                nested
                  .select('id', 'name')
                  .distinct('name')
                  .orderBy((report) => report.id.asc()),
              ),
          )
          .all();

        expect(descendants).toEqual([
          {
            id: 1,
            name: 'Ada',
            reports: [
              { id: 2, name: 'Bea', reports: [{ id: 4, name: 'Dex' }] },
              { id: 3, name: 'Cy', reports: [] },
            ],
          },
        ]);

        const none = await people
          .select('id', 'name')
          .where((person) => person.reports.none((report) => report.name.eq('Cy')))
          .orderBy((person) => person.id.asc())
          .all();

        expect(none).toEqual([
          { id: 2, name: 'Bea' },
          { id: 3, name: 'Cy' },
          { id: 4, name: 'Dex' },
          { id: 5, name: 'Eve' },
        ]);

        const every = await people
          .select('id', 'name')
          .where((person) => person.reports.every((report) => report.name.neq('Dex')))
          .orderBy((person) => person.id.asc())
          .all();

        expect(every).toEqual([
          { id: 1, name: 'Ada' },
          { id: 3, name: 'Cy' },
          { id: 4, name: 'Dex' },
          { id: 5, name: 'Eve' },
        ]);

        const managers = await people
          .select('id', 'name')
          .where((person) =>
            person.manager.some((manager) =>
              manager.manager.some((nestedManager) => nestedManager.name.eq('Ada')),
            ),
          )
          .include('manager', (manager) =>
            manager
              .select('id', 'name')
              .include('manager', (nested) => nested.select('id', 'name')),
          )
          .all();

        expect(managers).toEqual([
          {
            id: 4,
            name: 'Dex',
            manager: { id: 2, name: 'Bea', manager: { id: 1, name: 'Ada' } },
          },
        ]);

        const stats = await people
          .where((person) => person.manager.some((manager) => manager.name.eq('Ada')))
          .aggregate((aggregate) => ({ count: aggregate.count() }));

        expect(stats).toEqual({ count: 2 });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '1:1 predicates and depth-2 joins work in both directions with filtered aggregation',
    async () => {
      await withSelfRelationGraph(strategy, async (_runtime, people) => {
        const owningDirection = await people
          .select('id', 'name')
          .where((person) =>
            person.partner.some((partner) =>
              and(
                partner.name.eq('Bea'),
                partner.partneredBy.some((owner) => owner.name.eq('Ada')),
              ),
            ),
          )
          .include('partner', (partner) =>
            partner
              .select('id', 'name')
              .include('partneredBy', (owner) => owner.select('id', 'name')),
          )
          .all();

        expect(owningDirection).toEqual([
          {
            id: 1,
            name: 'Ada',
            partner: { id: 2, name: 'Bea', partneredBy: { id: 1, name: 'Ada' } },
          },
        ]);

        const reverseDirection = await people
          .select('id', 'name')
          .where((person) =>
            person.partneredBy.some((owner) =>
              and(
                owner.name.eq('Ada'),
                owner.partner.some((partner) => partner.name.eq('Bea')),
              ),
            ),
          )
          .include('partneredBy', (owner) =>
            owner
              .select('id', 'name')
              .include('partner', (partner) => partner.select('id', 'name')),
          )
          .all();

        expect(reverseDirection).toEqual([
          {
            id: 2,
            name: 'Bea',
            partneredBy: { id: 1, name: 'Ada', partner: { id: 2, name: 'Bea' } },
          },
        ]);

        const stats = await people
          .where((person) => person.partner.some())
          .aggregate((aggregate) => ({ count: aggregate.count() }));

        expect(stats).toEqual({ count: 2 });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'implicit M:N predicates, joins, nesting, and counts work in both directions',
    async () => {
      await withSelfRelationGraph(strategy, async (runtime, people) => {
        runtime.resetExecutions();
        const rows = await people
          .select('id', 'name')
          .where((person) =>
            and(
              person.following.some((followed) =>
                followed.following.some((nested) => nested.name.eq('Dex')),
              ),
              person.followers.some((follower) => follower.name.eq('Bea')),
            ),
          )
          .include('following', (following) =>
            following.combine({
              rows: following
                .select('id', 'name')
                .orderBy((person) => person.id.asc())
                .include('followers', (followers) =>
                  followers.select('id', 'name').orderBy((person) => person.id.asc()),
                ),
              count: following.count(),
            }),
          )
          .include('followers', (followers) =>
            followers.combine({
              rows: followers.select('id', 'name').orderBy((person) => person.id.asc()),
              count: followers.count(),
            }),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Ada',
            following: {
              rows: [
                { id: 2, name: 'Bea', followers: [{ id: 1, name: 'Ada' }] },
                { id: 3, name: 'Cy', followers: [{ id: 1, name: 'Ada' }] },
              ],
              count: 2,
            },
            followers: { rows: [{ id: 2, name: 'Bea' }], count: 1 },
          },
        ]);
        expect(runtime.executions).toHaveLength(strategy === 'join' ? 1 : 6);
        expect(runtime.executions[0]?.sql).toContain('INNER JOIN "public"."person_follows"');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'explicit M:N junction predicates, joins, nesting, and aggregates work in both directions',
    async () => {
      await withSelfRelationGraph(strategy, async (_runtime, people) => {
        const rows = await people
          .select('id', 'name')
          .where((person) =>
            and(
              person.outgoingLinks.some((link) =>
                link.target.some((target) => target.name.eq('Bea')),
              ),
              person.incomingLinks.some((link) =>
                link.source.some((source) => source.name.eq('Bea')),
              ),
            ),
          )
          .include('outgoingLinks', (links) =>
            links.combine({
              rows: links
                .select('sourceId', 'targetId', 'weight')
                .orderBy((link) => link.targetId.asc())
                .include('target', (target) =>
                  target
                    .select('id', 'name')
                    .include('reports', (reports) =>
                      reports.select('id', 'name').orderBy((person) => person.id.asc()),
                    ),
                ),
              count: links.count(),
              totalWeight: links.sum('weight'),
            }),
          )
          .include('incomingLinks', (links) =>
            links.combine({
              rows: links
                .select('sourceId', 'targetId', 'weight')
                .include('source', (source) => source.select('id', 'name')),
              count: links.count(),
              totalWeight: links.sum('weight'),
            }),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Ada',
            outgoingLinks: {
              rows: [
                {
                  sourceId: 1,
                  targetId: 2,
                  weight: 5,
                  target: { id: 2, name: 'Bea', reports: [{ id: 4, name: 'Dex' }] },
                },
                {
                  sourceId: 1,
                  targetId: 3,
                  weight: 7,
                  target: { id: 3, name: 'Cy', reports: [] },
                },
              ],
              count: 2,
              totalWeight: 12,
            },
            incomingLinks: {
              rows: [
                {
                  sourceId: 2,
                  targetId: 1,
                  weight: 11,
                  source: { id: 2, name: 'Bea' },
                },
              ],
              count: 1,
              totalWeight: 11,
            },
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
