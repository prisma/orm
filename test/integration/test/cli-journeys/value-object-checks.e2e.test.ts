/**
 * Value objects and discriminators are storage entities, and Postgres enforces them with derived checks.
 *
 * `User.address` holds an `Address` value object in a `jsonb` column. On a managed table the build derives a check on the column, `user_address_shape_<hash>`, which accepts the documents the ORM writes and refuses any other shape. `Task` is a base model whose variants are stored in their own tables; its discriminator column `type` gets a check on the variants' values, `task_type_check_<hash>`.
 *
 * Every journey runs twice: once through `migration plan` and `migrate`, once through `db update`. Each ends with `db verify --schema-only` clean and a further plan empty.
 *
 * - V1: the first migration creates the value object check. A row the ORM writes is accepted; a row with a key `Address` does not declare is refused, naming the check.
 * - V2: adding a member, and then making a member nullable, each drop the old check and add the new one, on a table whose rows fit the new shape.
 * - V3: adding a required member to a table that holds a row without it fails at apply, names the check, the table and the column, gives the query that finds the rows and the route that keeps them, and changes nothing. Following that route applies the change and keeps the row.
 * - V4: adding a variant replaces the discriminator check, and the new variant's value is accepted.
 * - V5: changing a value object that only an external table's column holds changes the storage hash and needs no operation: `migration plan` writes a migration with no operations, and `migrate` moves the marker.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineError,
  getMigrationDirs,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  readEmittedContractStorageHash,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
  setupJourney,
  sql,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import { createRowThroughOrm } from '../utils/journey-workspace-helpers';

type Via = 'migrate' | 'db update';
const VIAS: readonly Via[] = ['migrate', 'db update'];

function userContract(addressMembers: string): string {
  return `// use prisma-8

type Address {
${addressMembers}}

model User {
  id      Int      @id
  address Address?
  @@map("user")
}
`;
}

const ADDRESS = userContract('  street String\n  city   String\n');
const ADDRESS_WITH_ZIP = userContract('  street String\n  city   String\n  zip    String?\n');
const ADDRESS_WITH_OPTIONAL_CITY = userContract(
  '  street String\n  city   String?\n  zip    String?\n',
);
const ADDRESS_WITH_COUNTRY = userContract('  street  String\n  city    String\n  country String\n');

function taskContract(variants: readonly string[]): string {
  const models = variants.map(
    (name) => `
model ${name} {
  note String?
  @@base(Task, "${name.toLowerCase()}")
  @@map("${name.toLowerCase()}")
}
`,
  );
  return `// use prisma-8

model Task {
  id    Int    @id
  title String
  type  String
  @@discriminator(type)
  @@map("task")
}
${models.join('')}`;
}

const ONE_VARIANT = taskContract(['Bug']);
const TWO_VARIANTS = taskContract(['Bug', 'Feature']);

const AUTH_PROFILES_SQL = 'CREATE TABLE public.auth_profiles (id integer PRIMARY KEY, home jsonb)';

function externalContract(homeMembers: string): string {
  return `// use prisma-8

type Home {
${homeMembers}}

model User {
  id Int @id
  @@map("user")
}

model AuthProfile {
  id   Int   @id
  home Home?
  @@map("auth_profiles")
  @@control(external)
}
`;
}

const HOME = externalContract('  city String\n');
const HOME_WITH_ZIP = externalContract('  city String\n  zip  String?\n');

interface PlannedOperation {
  readonly id: string;
  readonly label: string;
}

async function emit(ctx: JourneyContext, psl: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

function journey(db: { readonly connectionString: string }, createTempDir: () => string) {
  return setupJourney({
    connectionString: db.connectionString,
    createTempDir,
    contractMode: 'psl',
  });
}

/** Plans from the latest migration, or from an empty database before the first one. */
function fromLatest(ctx: JourneyContext): readonly string[] {
  return getMigrationDirs(ctx).length === 0 ? [] : ['--from', latestMigrationDirName(ctx)];
}

/** Applies the emitted contract through `via` and returns the labels of the operations it planned. */
async function apply(ctx: JourneyContext, via: Via, label: string): Promise<readonly string[]> {
  if (via === 'migrate') {
    const plan = await planMigrationAndSelfEmit(ctx, [
      ...fromLatest(ctx),
      '--name',
      label.replace(/\W/g, '-'),
      '--json',
    ]);
    expect(plan.exitCode, `${label}: plan: ${plan.stderr}`).toBe(0);
    const migrate = await runMigrate(ctx);
    expect(migrate.exitCode, `${label}: migrate: ${migrate.stderr}`).toBe(0);
    return plannedLabels(ctx);
  }
  const update = await runDbUpdate(ctx, ['--json']);
  expect(update.exitCode, `${label}: db update: ${JSON.stringify(engineError(update))}`).toBe(0);
  return parseJsonOutput<{ plan: { operations: readonly PlannedOperation[] } }>(
    update,
  ).plan.operations.map((operation) => operation.label);
}

function plannedLabels(ctx: JourneyContext): readonly string[] {
  const ops = JSON.parse(
    readFileSync(
      join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx), 'ops.json'),
      'utf-8',
    ),
  ) as readonly PlannedOperation[];
  return ops.map((operation) => operation.label);
}

async function expectSettled(ctx: JourneyContext, via: Via, label: string): Promise<void> {
  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
  if (via === 'migrate') {
    const count = getMigrationDirs(ctx).length;
    const fresh = await runMigrationPlan(ctx, [...fromLatest(ctx), '--json']);
    expect(fresh.exitCode, `${label}: plan with no change: ${fresh.stderr}`).toBe(0);
    expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, `${label}: plan is empty`).toBe(true);
    expect(getMigrationDirs(ctx), `${label}: nothing written`).toHaveLength(count);
    return;
  }
  const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
  expect(dryRun.exitCode, `${label}: db update --dry-run: ${dryRun.stderr}`).toBe(0);
  expect(
    parseJsonOutput<{ plan: { operations: readonly PlannedOperation[] } }>(dryRun).plan.operations,
    `${label}: nothing left to plan`,
  ).toEqual([]);
}

const GIVE_EVERY_ADDRESS_A_COUNTRY = `rawSql({
        id: 'data.user.address.country',
        label: 'Give every address a country',
        operationClass: 'data',
        target: { id: 'postgres' },
        precheck: [],
        execute: [
          {
            description: 'give every address a country',
            sql: \`UPDATE "public"."user" SET address = address || '{"country": "NO"}' WHERE address IS NOT NULL\`,
          },
        ],
        postcheck: [],
      }),
      `;

/** Keeps the rows as the failure's advice says: in the failed migration.ts, or for `db update` in the database by hand. */
async function followTheAdvice(
  ctx: JourneyContext,
  via: Via,
  oldCheck: string | undefined,
  connectionString: string,
): Promise<void> {
  if (via === 'db update') {
    await sql(connectionString, `ALTER TABLE "public"."user" DROP CONSTRAINT "${oldCheck}"`);
    await sql(
      connectionString,
      `UPDATE "public"."user" SET address = address || '{"country": "NO"}' WHERE address IS NOT NULL`,
    );
    const update = await runDbUpdate(ctx, ['--json']);
    expect(update.exitCode, `V3.06: db update: ${JSON.stringify(engineError(update))}`).toBe(0);
    return;
  }
  const dir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
  const path = join(dir, 'migration.ts');
  const written = readFileSync(path, 'utf-8');
  const filled = written
    .replace(/import \{ ([^}]*) \} from '([^']+\/migration)';/, "import { $1, rawSql } from '$2';")
    .replace('this.addCheckConstraint(', `${GIVE_EVERY_ADDRESS_A_COUNTRY}this.addCheckConstraint(`);
  expect(filled, 'V3.06: the update sits before the new check').toContain('rawSql({');
  expect(filled, 'V3.06: rawSql is imported').toContain('rawSql }');
  writeFileSync(path, filled);
  const emitted = await selfEmitMigration(ctx, ['--dir', dir, '--config', ctx.configPath]);
  expect(emitted.exitCode, `V3.06: run migration.ts: ${emitted.stdout}${emitted.stderr}`).toBe(0);
  const migrate = await runMigrate(ctx, ['--json']);
  expect(migrate.exitCode, `V3.06: migrate: ${JSON.stringify(engineError(migrate))}`).toBe(0);
}

async function checkNames(connectionString: string, table: string): Promise<readonly string[]> {
  const { rows } = await sql(
    connectionString,
    `SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'c' ORDER BY conname`,
    [`public."${table}"`],
  );
  return rows.map((row) => String(row['conname']));
}

async function markerHash(connectionString: string): Promise<unknown> {
  const { rows } = await sql(
    connectionString,
    "SELECT core_hash FROM prisma_contract.marker WHERE space = 'app'",
  );
  return rows[0]?.['core_hash'];
}

async function insertError(connectionString: string, query: string): Promise<string> {
  try {
    await sql(connectionString, query);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'the insert was accepted';
}

/** Writes a user through the ORM of the emitted contract. */
function createUserThroughOrm(
  ctx: JourneyContext,
  connectionString: string,
  row: Record<string, unknown>,
): Promise<unknown> {
  return createRowThroughOrm({
    contractJson: JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8')),
    connectionString,
    model: 'User',
    row,
  });
}

withTempDir(({ createTempDir }) => {
  describe.each(VIAS)('V1 (%s): a value object column gets a check', (via) => {
    const db = useDevDatabase();

    it(
      'creates the check, accepts a row the ORM writes and refuses a row with an extra key',
      async () => {
        const ctx = journey(db, createTempDir);
        await emit(ctx, ADDRESS, 'V1.01');
        const labels = await apply(ctx, via, 'V1.02');
        expect(labels.join('\n'), 'V1.02: the table is created').toContain('Create table "user"');
        if (via === 'migrate') {
          expect(
            readFileSync(
              join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx), 'ops.json'),
              'utf-8',
            ),
            'V1.02: the migration writes the check',
          ).toMatch(/CONSTRAINT \\"user_address_shape_[0-9a-f]{8}\\" CHECK/);
        }
        expect(await checkNames(db.connectionString, 'user'), 'V1.02: the check').toEqual([
          expect.stringMatching(/^user_address_shape_[0-9a-f]{8}$/),
        ]);

        expect(
          await createUserThroughOrm(ctx, db.connectionString, {
            id: 1,
            address: { street: 'Main St', city: 'Oslo' },
          }),
          'V1.03: the ORM writes an address',
        ).toMatchObject({ id: 1, address: { street: 'Main St', city: 'Oslo' } });
        await sql(db.connectionString, `INSERT INTO "user" (id, address) VALUES (2, NULL)`);

        const [check] = await checkNames(db.connectionString, 'user');
        expect(
          await insertError(
            db.connectionString,
            `INSERT INTO "user" (id, address) VALUES (3, '{"street": "Main St", "city": "Oslo", "floor": 2}')`,
          ),
          'V1.04: an extra key is refused',
        ).toContain(`violates check constraint "${check}"`);
        expect(
          await insertError(
            db.connectionString,
            `INSERT INTO "user" (id, address) VALUES (3, '{"street": "Main St"}')`,
          ),
          'V1.05: a missing member is refused',
        ).toContain(`violates check constraint "${check}"`);

        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, `V1.06: db verify: ${verify.stderr}`).toBe(0);
        await expectSettled(ctx, via, 'V1.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(VIAS)('V2 (%s): changing a value object replaces its check', (via) => {
    const db = useDevDatabase();

    it(
      'drops the old check and adds the new one when a member is added, then when one becomes nullable',
      async () => {
        const ctx = journey(db, createTempDir);
        await emit(ctx, ADDRESS, 'V2.01');
        await apply(ctx, via, 'V2.02');
        await sql(
          db.connectionString,
          `INSERT INTO "user" (id, address) VALUES (1, '{"street": "Main St", "city": "Oslo"}')`,
        );
        const [first] = await checkNames(db.connectionString, 'user');

        await emit(ctx, ADDRESS_WITH_ZIP, 'V2.03');
        expect(await apply(ctx, via, 'V2.04'), 'V2.04: a member added').toEqual([
          `Drop check constraint "${first}" on "user"`,
          expect.stringMatching(
            /^Add check constraint "user_address_shape_[0-9a-f]{8}" on "user"$/,
          ),
        ]);
        const [second] = await checkNames(db.connectionString, 'user');
        expect(second, 'V2.04: a new check').not.toBe(first);
        await sql(
          db.connectionString,
          `INSERT INTO "user" (id, address) VALUES (2, '{"street": "Elm St", "city": "Bergen", "zip": "5003"}')`,
        );
        await expectSettled(ctx, via, 'V2.05');

        await emit(ctx, ADDRESS_WITH_OPTIONAL_CITY, 'V2.06');
        expect(await apply(ctx, via, 'V2.07'), 'V2.07: a member made nullable').toEqual([
          `Drop check constraint "${second}" on "user"`,
          expect.stringMatching(
            /^Add check constraint "user_address_shape_[0-9a-f]{8}" on "user"$/,
          ),
        ]);
        await sql(
          db.connectionString,
          `INSERT INTO "user" (id, address) VALUES (3, '{"street": "Elm St", "city": null}')`,
        );
        expect(
          (await sql(db.connectionString, 'SELECT id FROM "user" ORDER BY id')).rows,
          'V2.07: the rows are kept',
        ).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
        await expectSettled(ctx, via, 'V2.08');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(VIAS)('V3 (%s): a row that does not fit the new check', (via) => {
    const db = useDevDatabase();

    it(
      'fails the apply, names the check and changes nothing',
      async () => {
        const ctx = journey(db, createTempDir);
        await emit(ctx, ADDRESS, 'V3.01');
        await apply(ctx, via, 'V3.02');
        await sql(
          db.connectionString,
          `INSERT INTO "user" (id, address) VALUES (1, '{"street": "Main St", "city": "Oslo"}')`,
        );
        const before = await checkNames(db.connectionString, 'user');
        const marker = await markerHash(db.connectionString);

        await emit(ctx, ADDRESS_WITH_COUNTRY, 'V3.03');
        let failed: Parameters<typeof engineError>[0];
        if (via === 'migrate') {
          const plan = await planMigrationAndSelfEmit(ctx, [
            ...fromLatest(ctx),
            '--name',
            'country',
          ]);
          expect(plan.exitCode, `V3.04: plan: ${plan.stderr}`).toBe(0);
          failed = await runMigrate(ctx, ['--json']);
        } else {
          failed = await runDbUpdate(ctx, ['--json']);
        }
        expect(failed.exitCode, 'V3.04: the apply fails').not.toBe(0);
        const [oldCheck] = before;
        const error = engineError(failed);
        expect(
          error,
          'V3.04: the failure names the check, the table, the column and the route',
        ).toMatchObject({
          code: 'MIGRATION.EXECUTION_FAILED',
          summary: expect.stringMatching(
            /^Rows of table "user" fail check "user_address_shape_[0-9a-f]{8}" on column "address", so the check cannot be added\.$/,
          ),
          why: expect.stringContaining('Find them with `SELECT * FROM "public"."user" WHERE NOT ('),
          nextActions: [
            {
              label:
                via === 'migrate'
                  ? expect.stringMatching(
                      new RegExp(
                        `^To keep the data, add an operation that updates those rows to fit check "user_address_shape_[0-9a-f]{8}" to \`.+/migration\\.ts\`, after the operation that drops check "${oldCheck}" and before the operation that adds check`,
                      ),
                    )
                  : expect.stringMatching(
                      new RegExp(
                        `cannot keep this data, and no migration ends at the contract the database is at, so .+ cannot plan from it\\. Drop check "${oldCheck}" in the database yourself`,
                      ),
                    ),
            },
          ],
        });
        expect(JSON.stringify(error), 'V3.04: no advice that does not fit').not.toMatch(
          /drift|<contract>/,
        );

        expect(await checkNames(db.connectionString, 'user'), 'V3.05: the old check stays').toEqual(
          before,
        );
        expect(await markerHash(db.connectionString), 'V3.05: the marker stays').toBe(marker);
        expect(
          (await sql(db.connectionString, 'SELECT id, address FROM "user"')).rows,
          'V3.05: the row stays',
        ).toEqual([{ id: 1, address: { street: 'Main St', city: 'Oslo' } }]);

        await followTheAdvice(ctx, via, oldCheck, db.connectionString);
        expect(
          (await sql(db.connectionString, 'SELECT id, address FROM "user"')).rows,
          'V3.06: the row is kept and fits',
        ).toEqual([{ id: 1, address: { street: 'Main St', city: 'Oslo', country: 'NO' } }]);
        const verify = await runDbVerify(ctx, ['--strict']);
        expect(verify.exitCode, `V3.07: db verify --strict: ${verify.stderr}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(VIAS)('V4 (%s): adding a variant', (via) => {
    const db = useDevDatabase();

    it(
      "replaces the discriminator check, and the new variant's value is accepted",
      async () => {
        const ctx = journey(db, createTempDir);
        await emit(ctx, ONE_VARIANT, 'V4.01');
        await apply(ctx, via, 'V4.02');
        const [first] = await checkNames(db.connectionString, 'task');
        expect(first, 'V4.02: the discriminator check').toMatch(/^task_type_check_[0-9a-f]{8}$/);
        await sql(
          db.connectionString,
          `INSERT INTO "task" (id, title, type) VALUES (1, 'a', 'bug')`,
        );
        expect(
          await insertError(
            db.connectionString,
            `INSERT INTO "task" (id, title, type) VALUES (2, 'b', 'feature')`,
          ),
          'V4.03: a value no variant names is refused',
        ).toContain(`violates check constraint "${first}"`);

        await emit(ctx, TWO_VARIANTS, 'V4.04');
        const labels = await apply(ctx, via, 'V4.05');
        expect(
          labels.filter((label) => label.includes('check constraint')),
          'V4.05: the check is replaced',
        ).toEqual([
          `Drop check constraint "${first}" on "task"`,
          expect.stringMatching(/^Add check constraint "task_type_check_[0-9a-f]{8}" on "task"$/),
        ]);
        await sql(
          db.connectionString,
          `INSERT INTO "task" (id, title, type) VALUES (2, 'b', 'feature')`,
        );
        expect(
          (await sql(db.connectionString, 'SELECT id, type FROM "task" ORDER BY id')).rows,
          'V4.06: both variants are stored',
        ).toEqual([
          { id: 1, type: 'bug' },
          { id: 2, type: 'feature' },
        ]);
        await expectSettled(ctx, via, 'V4.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(VIAS)('V5 (%s): a value object only an external table holds', (via) => {
    const db = useDevDatabase({ onReady: (cs) => sql(cs, AUTH_PROFILES_SQL) });

    it(
      'changes the storage hash with no operation, and the apply moves the marker',
      async () => {
        const ctx = journey(db, createTempDir);
        await emit(ctx, HOME, 'V5.01');
        await apply(ctx, via, 'V5.02');
        expect(await checkNames(db.connectionString, 'auth_profiles'), 'V5.02: no check').toEqual(
          [],
        );
        const before = readEmittedContractStorageHash({ ...ctx, outputDir: ctx.testDir });

        await emit(ctx, HOME_WITH_ZIP, 'V5.03');
        const after = readEmittedContractStorageHash({ ...ctx, outputDir: ctx.testDir });
        expect(after, 'V5.03: the storage hash changes').not.toBe(before);
        if (via === 'migrate') {
          const plan = await runMigrationPlan(ctx, [...fromLatest(ctx), '--name', 'zip', '--json']);
          expect(plan.exitCode, `V5.04: plan: ${plan.stderr}`).toBe(0);
          expect(
            parseJsonOutput<{ operations: readonly unknown[]; summary: string }>(plan),
            'V5.04: no operations',
          ).toMatchObject({
            operations: [],
            summary: expect.stringContaining('What changed: value object "public.Home".'),
          });
          const migrate = await runMigrate(ctx);
          expect(migrate.exitCode, `V5.05: migrate: ${migrate.stderr}`).toBe(0);
        } else {
          expect(await apply(ctx, via, 'V5.04'), 'V5.04: no operations').toEqual([]);
        }
        expect(await markerHash(db.connectionString), 'V5.05: the marker').toBe(after);
        await expectSettled(ctx, via, 'V5.06');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
