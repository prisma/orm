/**
 * The Postgres planner rewrites an enum value that changes inside the JSON of value objects: a
 * renamed value is replaced and a removed one is taken out of lists or set to JSON null, in single
 * objects, lists of them and nested value objects, between the drop of the old shape check and the
 * creation of the new one, which then accepts every row.
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
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  buildSqlContractFromDefinition,
  enumType,
  member,
} from '@internal/sql-contract-ts/contract-builder';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  testTimeout,
} from './fixtures/runner-fixtures';

const codecLookup = createPostgresBuiltinCodecLookup();
const dataTypeLookup = createDataTypeLookup(postgresDataTypes);

const FULL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const text = { codecId: 'pg/text@1' } as const;
const jsonb = { codecId: 'pg/jsonb@1' } as const;

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
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
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

const publicId = asNamespaceId('public');

function renameValue(from: string, to: string): ResolvedMigrationStatement {
  return {
    kind: 'rename',
    entity: 'enumValue',
    from: { namespaceId: publicId, enum: 'Status', member: from },
    to: { namespaceId: publicId, enum: 'Status', member: to },
  };
}

const OPEN_DONE = { OPEN: 'open', DONE: 'done' };

describe('Postgres planner, enum values inside value objects', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    await database?.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    await driver?.close();
  }, testTimeout);

  const planner = () => postgresTargetDescriptor.createPlanner(controlAdapter);

  async function plan(
    from: Contract<SqlStorage> | null,
    to: Contract<SqlStorage>,
    statements: readonly ResolvedMigrationStatement[] = [],
  ) {
    const schema =
      from === null ? emptySchema : await familyInstance.introspect({ driver, contract: from });
    return planner().plan({
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
    const executed = await postgresTargetDescriptor.createRunner(familyInstance).execute({
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

  async function start(contract: Contract<SqlStorage>, status = 'open'): Promise<void> {
    await apply(await plan(null, contract), contract);
    await driver.query(
      `insert into "ticket" (id, meta, visits) values
        ('1', '{"status": "${status}", "previous": "done", "tags": ["done", "open", "done"]}', '[{"meta": {"status": "${status}", "previous": null, "tags": ["done"]}}]'),
        ('2', null, '[]')`,
    );
  }

  async function tickets(): Promise<unknown[]> {
    return (await driver.query('select id, meta, visits from "ticket" order by id')).rows;
  }

  async function operationKinds(
    result: Awaited<ReturnType<typeof plan>>,
  ): Promise<readonly string[]> {
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const operations = await Promise.all(result.plan.operations);
    return operations.map((operation) => operation.id.split('.')[0] ?? '');
  }

  it('replaces a renamed value in single objects, lists and nested objects, between the check drop and creation', {
    timeout: testTimeout,
  }, async () => {
    const from = ticketContract(OPEN_DONE);
    const to = ticketContract({ OPEN: 'open', CLOSED: 'closed' });
    await start(from);
    const statement = renameValue('DONE', 'CLOSED');

    const result = await plan(from, to, [statement]);

    expect(await operationKinds(result)).toEqual([
      'dropCheckConstraint',
      'dropCheckConstraint',
      ...Array.from({ length: 6 }, () => 'replaceStoredValue'),
      'checkConstraint',
      'checkConstraint',
    ]);
    expect(result.kind === 'success' && result.appliedStatements).toEqual([
      { statement, operationIndexes: [2, 3, 4, 5, 6, 7] },
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

  it('removes a value from list members and sets an optional member to JSON null, then the new check accepts every row', {
    timeout: testTimeout,
  }, async () => {
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
          namespaceId: 'public',
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

  it('fails at apply while a required member holds the removed value, with the row count and path', {
    timeout: testTimeout,
  }, async () => {
    const from = ticketContract(OPEN_DONE);
    const to = ticketContract({ OPEN: 'open' });
    await start(from, 'done');

    const failed = await apply(await plan(from, to), to).then(
      () => '',
      (error: Error) => error.message,
    );

    expect(failed).toContain(
      '[MIGRATION.PRECHECK_FAILED] Rows hold values that the migration removes where no null is allowed, so the values cannot be removed:\n- 1 row of "ticket" holds "done" at path "$.status" in column "meta"\n- 1 row of "ticket" holds "done" at path "$[*].meta.status" in column "visits"',
    );
    expect(failed).toContain('"member": "DONE"');
    expect(failed).toContain(
      '"replaceWith": "this.replaceStoredValue({ schema: \\"public\\", table: \\"ticket\\", column: \\"meta\\", path: \\"$.status\\", from: \\"done\\", to: \\"<stored value>\\" })"',
    );
    expect((await tickets())[0]).toMatchObject({ meta: { status: 'done' } });
  });

  it('renames a value object field before it replaces the enum value inside it, at the new path', {
    timeout: testTimeout,
  }, async () => {
    const from = ticketContract(OPEN_DONE, 'state');
    const to = ticketContract({ OPEN: 'open', CLOSED: 'closed' });
    await apply(await plan(null, from), from);
    await driver.query(
      `insert into "ticket" (id, meta, visits) values ('1', '{"state": "done", "previous": null, "tags": []}', '[]')`,
    );

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
