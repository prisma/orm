import { Collection } from '@internal/sql-orm-client';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/mn-polymorphism/generated/contract';
import contractJson from './fixtures/mn-polymorphism/generated/contract.json' with { type: 'json' };
import { type IncludeStrategy, includeStrategies, postgresAdapterFor } from './helpers';
import {
  expectPerRelationStatements,
  timeouts,
  withPushedContractRuntime,
} from './integration-helpers';

const contract = new PostgresContractSerializer().deserializeContract<Contract>(contractJson);

function contextOf(strategy: IncludeStrategy): ExecutionContext<Contract> {
  return createExecutionContext({
    contract,
    stack: createSqlExecutionStack({
      target: postgresTarget,
      adapter: postgresAdapterFor(strategy),
    }),
  });
}

describe.each(includeStrategies)(
  'a many-to-many include whose target has a multi-table-inheritance variant (%s)',
  (strategy) => {
    it(
      'reads the variant columns of the included rows from the variant table',
      async () => {
        await withPushedContractRuntime(contract, async (runtime) => {
          await runtime.query(`insert into mnp_tags (id, name) values (1, 'ui')`);
          await runtime.query(
            `insert into mnp_tasks (id, title, type) values (10, 'Login', 'feature'), (11, 'Logo', 'feature')`,
          );
          await runtime.query('insert into mnp_features (id, priority) values (10, 3), (11, 5)');
          await runtime.query(
            'insert into mnp_task_tags (task_id, tag_id) values (10, 1), (11, 1)',
          );
          const tags = new Collection({ runtime, context: contextOf(strategy) }, 'Tag', {
            namespaceId: 'public',
          });

          runtime.resetExecutions();
          const rows = await tags
            .include('tasks', (tasks) => tasks.orderBy((task) => task.id.asc()))
            .all();
          expectPerRelationStatements(runtime, strategy, 2);

          expect(rows).toEqual([
            {
              id: 1,
              name: 'ui',
              tasks: [
                { id: 10, title: 'Login', type: 'feature', priority: 3 },
                { id: 11, title: 'Logo', type: 'feature', priority: 5 },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  },
);
