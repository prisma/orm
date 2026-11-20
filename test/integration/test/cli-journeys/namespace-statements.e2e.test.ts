/**
 * Namespace statements on Postgres.
 *
 * Namespace `billing` holds `Invoice` (rows, a unique field, a secondary index, row-level security with a policy) and `Receipt`, whose foreign key references `Invoice`.
 *
 * `--rename billing:finance` renames the schema with `ALTER SCHEMA … RENAME TO`, and `--rename billing.Invoice:finance.Bill` in the same run renames the table inside it: N1 through `migration plan` and `migrate`, N2 through `db update`.
 *
 * A namespace the destination no longer declares is asked about one model at a time, and the refusal says that `--delete billing` answers them all. N3 answers with `--delete billing` through `db update`; N4 answers with one `--delete` per model through `migration plan`. N5 and N6 keep `Invoice` by moving it to `public` in the same run, through `db update` and `migration plan`.
 *
 * Every journey ends with `db verify --schema-only` clean and a further plan empty, and every `migration.ts` written is run again and reproduces its `ops.json` and `migration.json` byte for byte.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineError,
  parseJsonOutput,
  runDbUpdate,
  runMigrationPlan,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import {
  type AppliedStatementReport,
  emitContract,
  expectKeptInvoice,
  expectRenamedState,
  expectSettled,
  KEEP,
  type PlannedOperation,
  planReEmitAndMigrate,
  RENAME,
  schemas,
  startAt,
} from '../utils/namespace-statement-journeys';

const REMOVED_NAMESPACE_REFUSAL = {
  code: 'CLI.CONSENT_REQUIRED',
  severity: 'error',
  summary: 'This change would lose data: model "billing.Receipt", model "billing.Invoice".',
  why: [
    'This change would delete the data of model "billing.Receipt".',
    'The contract no longer has namespace "billing".',
    'The operation of the plan that does this: Drop table "Receipt".',
    '',
    'This change would delete the data of model "billing.Invoice".',
    'The operation of the plan that does this: Drop table "Invoice".',
  ].join('\n'),
  nextActions: [
    {
      kind: 'user-choice',
      label: 'If the data of everything in namespace "billing" can go: --delete billing',
    },
    {
      kind: 'user-choice',
      label: `If model "billing.Receipt" was renamed, add it to the contract under its new name and run \`prisma-test contract emit\`; then keep its data: --rename 'billing.Receipt:<new name>'`,
    },
    {
      kind: 'user-choice',
      label: 'If the data of model "billing.Receipt" can go: --delete billing.Receipt',
    },
    {
      kind: 'user-choice',
      label: `If model "billing.Invoice" was renamed, add it to the contract under its new name and run \`prisma-test contract emit\`; then keep its data: --rename 'billing.Invoice:<new name>'`,
    },
    {
      kind: 'user-choice',
      label: 'If the data of model "billing.Invoice" can go: --delete billing.Invoice',
    },
  ],
  meta: {
    unanswered: [
      { subject: 'billing.Receipt', verbs: ['rename', 'delete'] },
      { subject: 'billing.Invoice', verbs: ['rename', 'delete'] },
    ],
  },
  docsUrl: 'https://docs.prisma.io/docs/orm/v8/reference/error-reference/CLI.CONSENT_REQUIRED',
};

withTempDir(({ createTempDir }) => {
  describe('N1: rename a namespace and a model in it with migration plan', () => {
    const db = useDevDatabase();

    it(
      'renames the schema, then the table in it, and keeps every row and object',
      async () => {
        const { ctx, origin } = await startAt(db, createTempDir, 'migrate', 'N1');
        await emitContract(ctx, 'contract-namespace-statements-renamed', 'N1.03');

        const planned = await planReEmitAndMigrate(ctx, origin ?? '', RENAME, 'N1.04');
        expect(planned.operations.slice(0, 2).map(({ label }) => label)).toEqual([
          'Rename schema "billing" to "finance"',
          'Rename table "Invoice" to "Bill"',
        ]);
        expect(
          planned.operations.filter(({ operationClass }) => operationClass !== 'widening'),
          'N1.04: renames only',
        ).toEqual([]);
        expect(planned.appliedStatements.map(({ description }) => description)).toEqual([
          'rename namespace "billing" to "finance"',
          'rename model "billing.Invoice" to "finance.Bill"',
        ]);
        expect(planned.source).toContain("this.renameSchema({ schema: 'billing', to: 'finance' })");

        await expectRenamedState(db.connectionString, 'N1.05');
        await expectSettled(ctx, 'migrate', planned.dirName, 'N1.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('N2: rename a namespace and a model in it with db update', () => {
    const db = useDevDatabase();

    it(
      'renames the schema, then the table in it, without asking anything',
      async () => {
        const { ctx } = await startAt(db, createTempDir, 'db update', 'N2');
        await emitContract(ctx, 'contract-namespace-statements-renamed', 'N2.03');

        const update = await runDbUpdate(ctx, [...RENAME, '--no-interactive', '--json']);
        expect(update.exitCode, `N2.04: db update: ${JSON.stringify(engineError(update))}`).toBe(0);

        await expectRenamedState(db.connectionString, 'N2.05');
        await expectSettled(ctx, 'db update', undefined, 'N2.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('N3: delete a removed namespace with db update --delete billing', () => {
    const db = useDevDatabase();

    it(
      'is refused with the flags that answer, then drops the tables and the schema',
      async () => {
        const { ctx } = await startAt(db, createTempDir, 'db update', 'N3');
        await emitContract(ctx, 'contract-namespace-statements-removed', 'N3.03');

        const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(engineError(refused)?.code, 'N3.04: nobody to answer').toBe('CLI.CONSENT_REQUIRED');
        expect(engineError(refused), 'N3.04: the flags that answer').toEqual(
          REMOVED_NAMESPACE_REFUSAL,
        );
        expect(await schemas(db.connectionString), 'N3.04: nothing dropped').toEqual(['billing']);

        const update = await runDbUpdate(ctx, [
          '--delete',
          'billing',
          '--no-interactive',
          '--json',
        ]);
        expect(
          update.exitCode,
          `N3.05: db update --delete billing: ${JSON.stringify(engineError(update))}`,
        ).toBe(0);
        const updated = parseJsonOutput<{
          plan: { operations: readonly PlannedOperation[] };
          appliedStatements: readonly AppliedStatementReport[];
        }>(update);
        expect(updated.plan.operations.map(({ label }) => label).at(-1)).toBe(
          'Drop schema "billing"',
        );
        expect(updated.appliedStatements.map(({ description }) => description).sort()).toEqual([
          'delete model "billing.Invoice"',
          'delete model "billing.Receipt"',
        ]);
        expect(await schemas(db.connectionString), 'N3.06: the schema is gone').toEqual([]);
        await expectSettled(ctx, 'db update', undefined, 'N3.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('N4: delete a removed namespace with migration plan, one --delete per model', () => {
    const db = useDevDatabase();

    it(
      'is refused, then plans the drops and the schema drop with the per-model flags',
      async () => {
        const { ctx, origin } = await startAt(db, createTempDir, 'migrate', 'N4');
        await emitContract(ctx, 'contract-namespace-statements-removed', 'N4.03');

        const refused = await runMigrationPlan(ctx, ['--from', origin ?? '', '--json']);
        expect(engineError(refused)?.code, 'N4.04: nobody to answer').toBe('CLI.CONSENT_REQUIRED');
        expect(engineError(refused), 'N4.04: the flags that answer').toEqual(
          REMOVED_NAMESPACE_REFUSAL,
        );

        const planned = await planReEmitAndMigrate(
          ctx,
          origin ?? '',
          ['--delete', 'billing.Invoice', '--delete', 'billing.Receipt'],
          'N4.05',
        );
        expect(planned.operations.map(({ label }) => label).at(-1)).toBe('Drop schema "billing"');
        expect(planned.source).toContain("this.dropSchema({ schema: 'billing' })");
        expect(await schemas(db.connectionString), 'N4.06: the schema is gone').toEqual([]);
        await expectSettled(ctx, 'migrate', planned.dirName, 'N4.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('N5: keep one model of a removed namespace with db update', () => {
    const db = useDevDatabase();

    it(
      'moves Invoice to public and deletes the rest of billing',
      async () => {
        const { ctx } = await startAt(db, createTempDir, 'db update', 'N5');
        await emitContract(ctx, 'contract-namespace-statements-kept', 'N5.03');

        const update = await runDbUpdate(ctx, [...KEEP, '--no-interactive', '--json']);
        expect(update.exitCode, `N5.04: db update: ${JSON.stringify(engineError(update))}`).toBe(0);

        await expectKeptInvoice(db.connectionString, 'N5.05');
        await expectSettled(ctx, 'db update', undefined, 'N5.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('N6: keep one model of a removed namespace with migration plan', () => {
    const db = useDevDatabase();

    it(
      'moves Invoice to public and deletes the rest of billing',
      async () => {
        const { ctx, origin } = await startAt(db, createTempDir, 'migrate', 'N6');
        await emitContract(ctx, 'contract-namespace-statements-kept', 'N6.03');

        const planned = await planReEmitAndMigrate(ctx, origin ?? '', KEEP, 'N6.04');
        expect(planned.source).toContain(
          "this.setTableSchema({ schema: 'billing', table: 'Invoice', to: 'public' })",
        );

        await expectKeptInvoice(db.connectionString, 'N6.05');
        await expectSettled(ctx, 'migrate', planned.dirName, 'N6.06');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
