import { DatabaseSync } from 'node:sqlite';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import type { Contract } from '@internal/contract/types';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import sqlite from '@internal/target-sqlite/control';
import { describe, expect, it } from 'vitest';
import { sqliteContractFromPsl, sqliteFrameworkComponents, sqliteStack } from './sqlite-authoring';

/** One in-memory database with the control driver's `query` shape. */
function memoryDatabase() {
  const db = new DatabaseSync(':memory:');
  return {
    familyId: 'sql' as const,
    targetId: 'sqlite' as const,
    async query<Row = Record<string, unknown>>(text: string, params?: readonly unknown[]) {
      const rows = db.prepare(text).all(...((params ?? []) as Array<string | number | null>));
      return { rows: rows as Row[] };
    },
    async close() {
      db.close();
    },
  };
}

type MemoryDatabase = ReturnType<typeof memoryDatabase>;

const familyInstance = sql.create(sqliteStack);
const planner = sqlite.createPlanner(sqliteAdapter.create(sqliteStack));

/** Plans the move from `from` to `to` against the live database and runs each step it plans. */
async function migrate(
  database: MemoryDatabase,
  from: Contract<SqlStorage> | null,
  to: Contract<SqlStorage>,
): Promise<void> {
  const result = planner.plan({
    contract: to,
    schema: await familyInstance.introspect({ driver: database }),
    policy: INIT_ADDITIVE_POLICY,
    fromContract: from,
    frameworkComponents: sqliteFrameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result));
  for (const operation of await Promise.all(result.plan.operations)) {
    for (const step of operation.execute) {
      await database.query(step.sql, step.params);
    }
  }
}

async function verify(database: MemoryDatabase, contract: Contract<SqlStorage>) {
  const schema = await familyInstance.introspect({ driver: database, contract });
  return familyInstance.verifySchema({
    contract,
    schema,
    strict: true,
    frameworkComponents: sqliteFrameworkComponents,
  });
}

const created = `model Event {
  id    Int      @id
  label String
  at    DateTime @default("2024-01-01T01:00:00+01:00")

  @@map("event")
}`;

const altered = `model Event {
  id    Int      @id
  label String
  at    DateTime @default("2024-01-01T01:00:00+01:00")
  later DateTime @default("2024-06-30T12:34:56.5Z")

  @@map("event")
}`;

describe('a SQLite datetime default', () => {
  it('is the text the application writes for the same instant, in a table created with the default and for a default a migration adds', async () => {
    const database = memoryDatabase();
    const first = await sqliteContractFromPsl(created);
    const second = await sqliteContractFromPsl(altered);
    await migrate(database, null, first);
    await migrate(database, first, second);

    const codec = sqliteStack.codecLookup.get('sqlite/datetime@1');
    if (codec === undefined) throw new Error('the stack has no sqlite/datetime@1 codec');
    await database.query("INSERT INTO event (id, label) VALUES (1, 'default')");
    await database.query('INSERT INTO event (id, label, at, later) VALUES (2, ?, ?, ?)', [
      'application',
      await codec.encode(new Date('2024-01-01T00:00:00Z'), {}),
      await codec.encode(new Date('2024-06-30T12:34:56.5Z'), {}),
    ]);
    await database.query('INSERT INTO event (id, label, at, later) VALUES (3, ?, ?, ?)', [
      'half a second later',
      await codec.encode(new Date('2024-01-01T00:00:00.5Z'), {}),
      await codec.encode(new Date('2024-06-30T12:34:57Z'), {}),
    ]);

    const { rows } = await database.query(
      `SELECT a.label AS label,
              a.at = b.at AS sameAt,
              a.later = b.later AS sameLater,
              a.at < c.at AS atBefore,
              a.later < c.later AS laterBefore
       FROM event a, event b, event c
       WHERE a.id = 1 AND b.id = 2 AND c.id = 3`,
    );
    expect(rows).toEqual([
      { label: 'default', sameAt: 1, sameLater: 1, atBefore: 1, laterBefore: 1 },
    ]);
    await database.close();
  });

  it('verifies against the contract through the canonical form of sqlite/datetime', async () => {
    const database = memoryDatabase();
    const contract = await sqliteContractFromPsl(created);
    await migrate(database, null, contract);

    const { rows } = await database.query<{ dflt_value: string }>(
      "SELECT dflt_value FROM pragma_table_info('event') WHERE name = 'at'",
    );
    const result = await verify(database, contract);
    expect({ databaseDefault: rows[0]?.dflt_value, issues: result.schema.issues }).toEqual({
      databaseDefault: "'2024-01-01T00:00:00.000Z'",
      issues: [],
    });
    await database.close();
  });

  it('verifies a millisecond default, and plans nothing more', async () => {
    const database = memoryDatabase();
    const contract = await sqliteContractFromPsl(`model Event {
  id Int      @id
  at DateTime @default("2024-01-01T00:00:00.123Z")

  @@map("event")
}`);
    await migrate(database, null, contract);

    const { rows } = await database.query<{ dflt_value: string }>(
      "SELECT dflt_value FROM pragma_table_info('event') WHERE name = 'at'",
    );
    const result = await verify(database, contract);
    const replan = planner.plan({
      contract,
      schema: await familyInstance.introspect({ driver: database }),
      policy: INIT_ADDITIVE_POLICY,
      fromContract: contract,
      frameworkComponents: sqliteFrameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    expect({
      databaseDefault: rows[0]?.dflt_value,
      issues: result.schema.issues,
      replanned: replan.kind === 'success' ? replan.plan.operations.length : replan,
    }).toEqual({
      databaseDefault: "'2024-01-01T00:00:00.123Z'",
      issues: [],
      replanned: 0,
    });
    await database.close();
  });
});
