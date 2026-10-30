/**
 * The Postgres planner rewrites an enum value that changes inside the JSON of value objects: a
 * renamed value is replaced and a removed one is taken out of lists or set to JSON null, in single
 * objects, lists of them and nested value objects, after the rest of the plan.
 */
import type { Contract } from '@internal/contract/types';
import { asNamespaceId } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  buildSqlContractFromDefinition,
  enumType,
  member,
} from '@internal/sql-contract-ts/contract-builder';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { sqliteDataTypes } from '@internal/target-sqlite/data-types';
import sqlitePack from '@internal/target-sqlite/pack';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
} from './fixtures/runner-fixtures';

const codecLookup = createSqliteBuiltinCodecLookup();
const dataTypeLookup = createDataTypeLookup(sqliteDataTypes);

const FULL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const text = { codecId: 'sqlite/text@1' } as const;
const jsonb = { codecId: 'sqlite/json@1' } as const;

/**
 * `Ticket` holds a `Meta` in `meta` and a list of `Visit` in `visits`, each `Visit` holding a
 * `Meta`. `Meta` has a required `Status` member named `statusMember`, an optional one, `previous`,
 * and a list of them, `tags`.
 */
function ticketContract(
  values: Readonly<Record<string, string>>,
  statusMember = 'status',
): Contract<SqlStorage> {
  const [first, ...rest] = Object.entries(values);
  if (first === undefined) throw new Error('a status needs a member');
  const Status = enumType(
    'Status',
    text,
    member(first[0], first[1]),
    ...rest.map(([name, value]) => member(name, value)),
  );
  return buildSqlContractFromDefinition(
    {
      warnings: undefined,
      target: sqlitePack,
      createNamespace: sqliteCreateNamespace,
      enums: { Status },
      models: [
        {
          modelName: 'Ticket',
          tableName: 'ticket',
          fields: [
            { fieldName: 'id', columnName: 'id', descriptor: text, nullable: false },
            {
              fieldName: 'meta',
              columnName: 'meta',
              valueObjectName: 'Meta',
              descriptor: jsonb,
              nullable: true,
            },
            {
              fieldName: 'visits',
              columnName: 'visits',
              valueObjectName: 'Visit',
              descriptor: jsonb,
              nullable: true,
              many: true,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
      valueObjects: [
        {
          name: 'Meta',
          fields: [
            { fieldName: statusMember, descriptor: text, nullable: false, enumTypeHandle: Status },
            { fieldName: 'previous', descriptor: text, nullable: true, enumTypeHandle: Status },
            {
              fieldName: 'tags',
              descriptor: text,
              nullable: false,
              many: true,
              enumTypeHandle: Status,
            },
          ],
        },
        {
          name: 'Visit',
          fields: [{ fieldName: 'meta', valueObjectName: 'Meta', nullable: false }],
        },
      ],
    },
    codecLookup,
    dataTypeLookup,
  );
}

const publicId = asNamespaceId(UNBOUND_NAMESPACE_ID);

function renameValue(from: string, to: string): ResolvedMigrationStatement {
  return {
    kind: 'rename',
    entity: 'enumValue',
    from: { namespaceId: publicId, enum: 'Status', member: from },
    to: { namespaceId: publicId, enum: 'Status', member: to },
  };
}

const OPEN_DONE = { OPEN: 'open', DONE: 'done' };

describe('SQLite planner, enum values inside value objects', {
  timeout: timeouts.databaseOperation,
}, () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb?.cleanup();
  });

  async function plan(
    from: Contract<SqlStorage> | null,
    to: Contract<SqlStorage>,
    statements: readonly ResolvedMigrationStatement[] = [],
  ) {
    const schema =
      from === null
        ? emptySchema
        : await familyInstance.introspect({ driver: testDb.driver, contract: from });
    return sqliteTargetDescriptor.createPlanner(controlAdapter).plan({
      contract: to,
      schema,
      policy: from === null ? INIT_ADDITIVE_POLICY : FULL_POLICY,
      fromContract: from,
      origin: from === null ? null : planOriginOf(from),
      statements,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
  }

  async function apply(result: Awaited<ReturnType<typeof plan>>, contract: Contract<SqlStorage>) {
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const { driver } = testDb;
    const executed = await sqliteTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: result.plan,
          migrationEdges: synthEdges(result.plan),
          driver,
          destinationContract: contract,
          policy: FULL_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!executed.ok) throw new Error(formatRunnerFailure(executed.failure));
  }

  async function insert(rows: string): Promise<void> {
    await testDb.driver.query(`INSERT INTO "ticket" (id, meta, visits) VALUES ${rows}`);
  }

  async function start(contract: Contract<SqlStorage>, status = 'open'): Promise<void> {
    await apply(await plan(null, contract), contract);
    await insert(
      `('1', '{"status": "${status}", "previous": "done", "tags": ["done", "open", "done"]}', '[{"meta": {"status": "${status}", "previous": null, "tags": ["done"]}}]'),
        ('2', NULL, '[]')`,
    );
  }

  async function tickets(): Promise<unknown[]> {
    const { rows } = await testDb.driver.query<Record<string, string | null>>(
      'SELECT id, meta, visits FROM "ticket" ORDER BY id',
    );
    return rows.map(({ id, meta, visits }) => ({
      id,
      meta: meta === null || meta === undefined ? null : JSON.parse(meta),
      visits: visits === null || visits === undefined ? null : JSON.parse(visits),
    }));
  }

  async function operationKinds(
    result: Awaited<ReturnType<typeof plan>>,
  ): Promise<readonly string[]> {
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const operations = await Promise.all(result.plan.operations);
    return operations.map((operation) => operation.id.split('.')[0] ?? '');
  }

  it('replaces a renamed value in single objects, lists and nested objects, after the rest of the plan', async () => {
    const from = ticketContract(OPEN_DONE);
    const to = ticketContract({ OPEN: 'open', CLOSED: 'closed' });
    await start(from);
    const statement = renameValue('DONE', 'CLOSED');

    const result = await plan(from, to, [statement]);

    expect(await operationKinds(result)).toEqual(
      Array.from({ length: 6 }, () => 'replaceStoredValue'),
    );
    expect(result.kind === 'success' && result.appliedStatements).toEqual([
      { statement, operationIndexes: [0, 1, 2, 3, 4, 5] },
    ]);
    await apply(result, to);
    expect(await tickets()).toEqual([
      {
        id: '1',
        meta: { status: 'open', previous: 'closed', tags: ['closed', 'open', 'closed'] },
        visits: [{ meta: { status: 'open', previous: null, tags: ['closed'] } }],
      },
      { id: '2', meta: null, visits: [] },
    ]);
    expect(await operationKinds(await plan(to, to))).toEqual([]);
  });

  it('removes a value from list members and sets an optional member to JSON null, in every row', async () => {
    const from = ticketContract(OPEN_DONE);
    const to = ticketContract({ OPEN: 'open' });
    await start(from);

    const result = await plan(from, to);

    expect(
      result.kind === 'success' &&
        new Set(result.dataLoss.map(({ subject }) => JSON.stringify(subject))),
    ).toEqual(
      new Set([
        JSON.stringify({
          kind: 'enumValue',
          namespaceId: UNBOUND_NAMESPACE_ID,
          enum: 'Status',
          member: 'DONE',
        }),
      ]),
    );
    await apply(result, to);
    expect(await tickets()).toEqual([
      {
        id: '1',
        meta: { status: 'open', previous: null, tags: ['open'] },
        visits: [{ meta: { status: 'open', previous: null, tags: [] } }],
      },
      { id: '2', meta: null, visits: [] },
    ]);
  });

  it('fails at apply while a required member holds the removed value, with the row count and path', async () => {
    const from = ticketContract(OPEN_DONE);
    const to = ticketContract({ OPEN: 'open' });
    await start(from, 'done');

    const failed = await apply(await plan(from, to), to).then(
      () => '',
      (error: Error) => error.message,
    );

    expect(failed).toContain(
      '[MIGRATION.PRECHECK_FAILED] 1 row of "ticket" holds "done" at path "$.status" in column "meta", a member that takes no null, so the value cannot be removed.',
    );
    expect(failed).toContain('"member": "DONE"');
    expect(failed).toContain(
      '"replaceWith": "this.replaceStoredValue({ table: \\"ticket\\", column: \\"meta\\", path: \\"$.status\\", from: \\"done\\", to: \\"<stored value>\\" })"',
    );
    expect((await tickets())[0]).toMatchObject({ meta: { status: 'done' } });
  });

  it('renames a value object field before it replaces the enum value inside it, at the new path', async () => {
    const from = ticketContract(OPEN_DONE, 'state');
    const to = ticketContract({ OPEN: 'open', CLOSED: 'closed' });
    await apply(await plan(null, from), from);
    await insert(`('1', '{"state": "done", "previous": null, "tags": []}', '[]')`);

    await apply(
      await plan(from, to, [
        {
          kind: 'rename',
          entity: 'valueObjectField',
          from: { namespaceId: publicId, valueObject: 'Meta', field: 'state' },
          to: { namespaceId: publicId, valueObject: 'Meta', field: 'status' },
        },
        renameValue('DONE', 'CLOSED'),
      ]),
      to,
    );

    expect((await tickets())[0]).toEqual({
      id: '1',
      meta: { status: 'closed', previous: null, tags: [] },
      visits: [],
    });
  });
});
