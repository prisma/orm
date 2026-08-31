import type { Contract } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import sqlFamilyPack from '@internal/family-sql/pack';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { buildBoundContract, enumType, member } from '@internal/sql-contract-ts/contract-builder';
import {
  AggregateExpr,
  ColumnRef,
  DerivedTableSource,
  EqColJoinOn,
  IdentifierRef,
  JoinAst,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { timeouts } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../../src/core/adapter';
import type { PostgresContract } from '../../src/core/types';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
} from './fixtures/runner-fixtures';

const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' };

// Declaration order: low → high → medium. Lexical order would be high, low, medium.
const Priority = enumType(
  'Priority',
  pgText,
  member('Low', 'low'),
  member('High', 'high'),
  member('Medium', 'medium'),
);

function makeTaskContract(): PostgresContract {
  return buildBoundContract(
    sqlFamilyPack,
    postgresPack,
    { enums: { Priority }, createNamespace: postgresCreateNamespace },
    ({ field: f, model: m }) => ({
      models: {
        Task: m('Task', {
          fields: {
            id: f.text().id(),
            priority: f.namedType(Priority).optional(),
          },
        }),
      },
    }),
  ) as Contract<SqlStorage> as PostgresContract;
}

// `Task.priority` is enum-backed; `Note.priority` is plain text. A bare `ORDER BY priority`
// across a Task⋈Note join is ambiguous, so it must NOT be rewritten to `array_position`.
function makeTaskNoteContract(): PostgresContract {
  return buildBoundContract(
    sqlFamilyPack,
    postgresPack,
    { enums: { Priority }, createNamespace: postgresCreateNamespace },
    ({ field: f, model: m }) => ({
      models: {
        Task: m('Task', {
          fields: {
            id: f.text().id(),
            priority: f.namedType(Priority).optional(),
          },
        }),
        Note: m('Note', {
          fields: {
            id: f.text().id(),
            priority: f.text().optional(),
          },
        }),
      },
    }),
  ) as Contract<SqlStorage> as PostgresContract;
}

async function migrate(driver: PostgresControlDriver, contract: PostgresContract): Promise<void> {
  const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
  const runner = postgresTargetDescriptor.createRunner(familyInstance);
  const result = planner.plan({
    contract,
    schema: emptySchema,
    policy: INIT_ADDITIVE_POLICY,
    fromContract: null,
    frameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') {
    throw new Error(`Planner failed: ${JSON.stringify(result, null, 2)}`);
  }
  const executeResult = await runner.execute({
    driver,
    perSpaceOptions: [
      {
        space: result.plan.spaceId ?? APP_SPACE_ID,
        plan: result.plan,
        migrationEdges: synthEdges(result.plan),
        driver,
        destinationContract: contract,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents,
      },
    ],
  });
  if (!executeResult.ok) {
    throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
  }
}

describe('ORDER BY on an enum column — declaration order, PGlite', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, timeouts.spinUpPpgDev);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, timeouts.spinUpPpgDev);

  it('renders array_position over the value-set and sorts by declaration order', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = makeTaskContract();
    await migrate(driver!, contract);

    // Insert rows out of declaration order.
    await driver!.query(`INSERT INTO "Task" (id, priority) VALUES
      ('a', 'high'), ('b', 'low'), ('c', 'medium'), ('d', 'low')`);

    const ast = SelectAst.from(TableSource.named('Task', undefined, 'public'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
        ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
      ])
      .withOrderBy([
        OrderByItem.asc(ColumnRef.of('Task', 'priority')),
        OrderByItem.asc(ColumnRef.of('Task', 'id')),
      ]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    expect(lowered.sql).toContain(
      `array_position(ARRAY['low', 'high', 'medium']::text[], "Task"."priority")`,
    );

    const rows = await driver!.query<{ id: string; priority: string }>(lowered.sql);
    expect(rows.rows.map((r) => r.priority)).toEqual(['low', 'low', 'high', 'medium']);
    expect(rows.rows.map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('intercepts an unqualified identifier-ref order column (sql-builder .orderBy form)', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = makeTaskContract();
    await migrate(driver!, contract);

    await driver!.query(`INSERT INTO "Task" (id, priority) VALUES
      ('a', 'high'), ('b', 'low'), ('c', 'medium'), ('d', 'low')`);

    const ast = SelectAst.from(TableSource.named('Task', undefined, 'public'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
        ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
      ])
      .withOrderBy([
        OrderByItem.asc(IdentifierRef.of('priority')),
        OrderByItem.asc(IdentifierRef.of('id')),
      ]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    expect(lowered.sql).toContain(
      `array_position(ARRAY['low', 'high', 'medium']::text[], "priority")`,
    );

    const rows = await driver!.query<{ id: string; priority: string }>(lowered.sql);
    expect(rows.rows.map((r) => r.priority)).toEqual(['low', 'low', 'high', 'medium']);
    expect(rows.rows.map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('leaves an ambiguous unqualified order column unrewritten across a join', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = makeTaskNoteContract();

    // Task ⋈ Note where both have a `priority` column (only Task's is enum-backed).
    const ast = SelectAst.from(TableSource.named('Task', undefined, 'public'))
      .withJoins([
        JoinAst.inner(
          TableSource.named('Note', undefined, 'public'),
          EqColJoinOn.of(ColumnRef.of('Task', 'id'), ColumnRef.of('Note', 'id')),
        ),
      ])
      .withProjection([ProjectionItem.of('id', ColumnRef.of('Task', 'id'))])
      .withOrderBy([OrderByItem.asc(IdentifierRef.of('priority'))]);

    const lowered = createPostgresAdapter().lower(ast, { contract });

    // Bare `priority` is ambiguous across the join → falls through to the plain column.
    expect(lowered.sql).not.toContain('array_position');
    expect(lowered.sql).toContain('"priority"');
  });

  it('sorts NULLs last (ASC) alongside declaration-ordered non-null values', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = makeTaskContract();
    await migrate(driver!, contract);

    await driver!.query(`INSERT INTO "Task" (id, priority) VALUES
      ('a', 'high'), ('b', NULL), ('c', 'low')`);

    const ast = SelectAst.from(TableSource.named('Task', undefined, 'public'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
        ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
      ])
      .withOrderBy([OrderByItem.asc(ColumnRef.of('Task', 'priority'))]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    const rows = await driver!.query<{ id: string; priority: string | null }>(lowered.sql);

    // array_position returns NULL for the NULL row; ASC sorts NULLs last by default.
    expect(rows.rows.map((r) => r.priority)).toEqual(['low', 'high', null]);
    expect(rows.rows.map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('distinctOn on a value-set column renders array_position, matching orderBy', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = makeTaskContract();

    // distinctOn('priority') emits IdentifierRef (string-arg path).
    // orderBy uses the same IdentifierRef shape but goes through renderOrderByExpr.
    // Both must render identically so Postgres accepts: DISTINCT ON (X) ... ORDER BY X.
    const ast = SelectAst.from(TableSource.named('Task', undefined, 'public'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('Task', 'id'))])
      .withDistinctOn([IdentifierRef.of('priority')])
      .withOrderBy([
        OrderByItem.asc(IdentifierRef.of('priority')),
        OrderByItem.asc(IdentifierRef.of('id')),
      ]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    const arrayPositionExpr = `array_position(ARRAY['low', 'high', 'medium']::text[], "priority")`;

    // DISTINCT ON and ORDER BY must emit the same expression.
    expect(lowered.sql).toContain(`DISTINCT ON (${arrayPositionExpr})`);
    expect(lowered.sql).toContain(`ORDER BY ${arrayPositionExpr}`);
  });

  it('distinctOn on a value-set column executes without error', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = makeTaskContract();
    await migrate(driver!, contract);

    await driver!.query(`INSERT INTO "Task" (id, priority) VALUES
      ('a', 'high'), ('b', 'low'), ('c', 'high')`);

    const ast = SelectAst.from(TableSource.named('Task', undefined, 'public'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
        ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
      ])
      .withDistinctOn([IdentifierRef.of('priority')])
      .withOrderBy([
        OrderByItem.asc(IdentifierRef.of('priority')),
        OrderByItem.asc(IdentifierRef.of('id')),
      ]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    const rows = await driver!.query<{ id: string; priority: string }>(lowered.sql);
    // One row per distinct priority, in declaration order (low < high < medium).
    expect(rows.rows.map((r) => r.priority)).toEqual(['low', 'high']);
  });

  it('distinctOn on a plain scalar column still renders as a bare identifier', () => {
    const contract = makeTaskContract();

    const ast = SelectAst.from(TableSource.named('Task', undefined, 'public'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('Task', 'id'))])
      .withDistinctOn([IdentifierRef.of('id')])
      .withOrderBy([OrderByItem.asc(IdentifierRef.of('id'))]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    expect(lowered.sql).toContain('DISTINCT ON ("id")');
    expect(lowered.sql).not.toContain('array_position');
  });
});

// `collectTableSources` (sql-renderer.ts) only recognises `table-source` FROM
// entries, so the enum hook resolves nothing once the FROM is a derived
// table — even though the ORM aliases that derived table back to the base
// table name specifically so outer references keep resolving. This is not
// specific to a grouped aggregate: any derived-table wrap loses declaration
// order the same way, wherever it comes from — `distinct()`'s ROW_NUMBER
// dedup wrap on the plain-select path (case 1/1b), a grouped aggregate's
// pre-group scoping wrap (case 2), or DISTINCT ON sharing renderOrderByExpr
// with ORDER BY (case 3). Case 0 is the unwrapped control: it already works
// and must keep working once the wrap-aware fix lands.
describe('ORDER BY on an enum column behind a derived table', () => {
  const contract = makeTaskContract();

  it('case 0 (control): unwrapped ORDER BY on the enum column uses array_position', () => {
    const ast = SelectAst.from(TableSource.named('Task', undefined, 'public'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
        ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
      ])
      .withOrderBy([OrderByItem.asc(ColumnRef.of('Task', 'priority'))]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    expect(lowered.sql).toContain(
      `array_position(ARRAY['low', 'high', 'medium']::text[], "Task"."priority")`,
    );
  });

  it('case 1: derived-table wrap, column-ref ORDER BY on the enum column', () => {
    const inner = SelectAst.from(TableSource.named('Task', undefined, 'public')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
      ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
    ]);
    const ast = SelectAst.from(DerivedTableSource.as('Task', inner))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
        ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
      ])
      .withOrderBy([OrderByItem.asc(ColumnRef.of('Task', 'priority'))]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    expect(lowered.sql).toContain(
      `array_position(ARRAY['low', 'high', 'medium']::text[], "Task"."priority")`,
    );
  });

  it('case 1b: derived-table wrap, identifier-ref ORDER BY on the enum column', () => {
    const inner = SelectAst.from(TableSource.named('Task', undefined, 'public')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
      ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
    ]);
    const ast = SelectAst.from(DerivedTableSource.as('Task', inner))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
        ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
      ])
      .withOrderBy([OrderByItem.asc(IdentifierRef.of('priority'))]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    expect(lowered.sql).toContain(
      `array_position(ARRAY['low', 'high', 'medium']::text[], "priority")`,
    );
  });

  it('case 2: derived-table wrap + GROUP BY + post-group ORDER BY on the group key', () => {
    const inner = SelectAst.from(TableSource.named('Task', undefined, 'public')).withProjection([
      ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
    ]);
    const ast = SelectAst.from(DerivedTableSource.as('Task', inner))
      .withProjection([
        ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
        ProjectionItem.of('total', AggregateExpr.count()),
      ])
      .withGroupBy([ColumnRef.of('Task', 'priority')])
      .withOrderBy([OrderByItem.asc(ColumnRef.of('Task', 'priority'))])
      .withLimit(1);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    expect(lowered.sql).toContain(
      `array_position(ARRAY['low', 'high', 'medium']::text[], "Task"."priority")`,
    );
  });

  it('case 3: derived-table wrap, DISTINCT ON the enum column', () => {
    const inner = SelectAst.from(TableSource.named('Task', undefined, 'public')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
      ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
    ]);
    const ast = SelectAst.from(DerivedTableSource.as('Task', inner))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('Task', 'id'))])
      .withDistinctOn([IdentifierRef.of('priority')])
      .withOrderBy([OrderByItem.asc(IdentifierRef.of('priority'))]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    const arrayPositionExpr = `array_position(ARRAY['low', 'high', 'medium']::text[], "priority")`;
    expect(lowered.sql).toContain(`DISTINCT ON (${arrayPositionExpr})`);
    expect(lowered.sql).toContain(`ORDER BY ${arrayPositionExpr}`);
  });

  // A projected expression that isn't a plain column reference (an alias
  // over a function call, say) has no storage column to look up — falling
  // back to a bare sort here is the status quo, not a new gap, and a wrong
  // enum order would be worse than the bug this file exists to close.
  it('falls back to plain column rendering when the derived table cannot resolve a storage column', () => {
    const inner = SelectAst.from(TableSource.named('Task', undefined, 'public')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
      ProjectionItem.of('priority_label', IdentifierRef.of('priority')),
    ]);
    const ast = SelectAst.from(DerivedTableSource.as('Task', inner))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('Task', 'id'))])
      .withOrderBy([OrderByItem.asc(ColumnRef.of('Task', 'priority_label'))]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    expect(lowered.sql).not.toContain('array_position');
    expect(lowered.sql).toContain('ORDER BY "Task"."priority_label" ASC');
  });
});
