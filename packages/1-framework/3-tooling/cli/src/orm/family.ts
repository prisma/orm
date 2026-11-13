import { ormConfigSection } from '@internal/config-loader';
import { DOCS_BASE } from '@internal/utils/structured-error';
import type { AnyCommand, RedirectSpec } from '@prisma/cli-engine';
import { defineCommandFamily } from '@prisma/cli-engine';
import { contractEmitCommand } from './contract/emit';
import { contractInferCommand } from './contract/infer';
import { contractPrintCommand } from './contract/print';
import { dbInitCommand } from './db/init';
import { dbSchemaCommand } from './db/schema';
import { dbSignCommand } from './db/sign';
import { dbUpdateCommand } from './db/update';
import { dbVerifyCommand } from './db/verify';
import { formatCommand } from './format';
import { initCommand } from './init';
import { lspCommand } from './lsp';
import { migrateCommand } from './migrate';
import { migrationCheckCommand } from './migration/check';
import { migrationGraphCommand } from './migration/graph';
import { migrationListCommand } from './migration/list';
import { migrationLogCommand } from './migration/log';
import { migrationNewCommand } from './migration/new';
import { migrationPlanCommand } from './migration/plan';
import { migrationShowCommand } from './migration/show';
import { migrationStatusCommand } from './migration/status';
import { refDeleteCommand } from './ref/delete';
import { refListCommand } from './ref/list';
import { refSetCommand } from './ref/set';

/**
 * The engine derives each diagnostic's docs link from this base plus the
 * dotted code.
 */
const DOCS_BASE_URL = `${DOCS_BASE}/`;

const commands: Readonly<Record<string, AnyCommand>> = {
  'contract print': contractPrintCommand,
  'contract emit': contractEmitCommand,
  'contract format': formatCommand,
  'contract infer': contractInferCommand,
  'db init': dbInitCommand,
  'db migrate': migrateCommand,
  'db schema': dbSchemaCommand,
  'db sign': dbSignCommand,
  'db update': dbUpdateCommand,
  'db verify': dbVerifyCommand,
  lsp: lspCommand,
  'migration check': migrationCheckCommand,
  'migration graph': migrationGraphCommand,
  'migration list': migrationListCommand,
  'migration log': migrationLogCommand,
  'migration new': migrationNewCommand,
  'migration plan': migrationPlanCommand,
  'migration ref delete': refDeleteCommand,
  'migration ref list': refListCommand,
  'migration ref set': refSetCommand,
  'migration show': migrationShowCommand,
  'migration status': migrationStatusCommand,
  'orm init': initCommand,
};

const CLI_DOCS_URL = 'https://www.prisma.io/docs/cli';

function v7Command(
  from: string,
  entry: Omit<RedirectSpec, 'from' | 'flag' | 'code' | 'summary'>,
): RedirectSpec {
  return {
    from,
    code: 'CLI.V7_COMMAND',
    summary: `\`{bin} ${from}\` is a Prisma 7 command and is not available in Prisma 8`,
    ...entry,
  };
}

/**
 * The invocations the ORM retired, and the Prisma 7 commands, so an old command line gets the replacement or a link to the docs rather than a spelling suggestion. Replacements name the binary as `{bin}`; the engine substitutes the shell's own name.
 *
 * The four flag redirects name `migration status`, which the engine requires to be a mounted command.
 */
const redirects: readonly RedirectSpec[] = [
  {
    from: 'migration apply',
    replacement: '{bin} db migrate --to <contract>',
    reason: 'Applying a migration is a move to a target contract, not a verb of its own.',
  },
  {
    from: 'migration status',
    flag: 'graph',
    replacement: '{bin} migration graph',
    reason: 'Topology is its own command rather than a mode of the status report.',
  },
  {
    from: 'migration status',
    flag: 'all',
    replacement: '{bin} migration log --db <url>',
    reason: 'Execution history is read from the database ledger, which is what migration log does.',
  },
  {
    from: 'migration status',
    flag: 'limit',
    replacement: '{bin} migration log --db <url>',
    reason: 'Execution history is read from the database ledger, which is what migration log does.',
  },
  {
    from: 'migration status',
    flag: 'ref',
    replacement: '{bin} migration status --to <contract>',
    reason: 'One flag names the target contract, whether it is a ref, a hash or a migration.',
  },
  v7Command('migrate dev', {
    replacement: '{bin} contract emit',
    reason:
      "Prisma 8 emits the contract, plans the migration and applies it in separate steps: run `contract emit`, then `migration plan --name <name>` (for `--create-only`, stop here), then `db migrate --advance-ref db`; while Prisma 7 still owns this project's migrations, run `migrate dev` with Prisma 7's CLI instead.",
    help: 'contract emit',
  }),
  v7Command('migrate deploy', {
    replacement: '{bin} db migrate',
    reason:
      "`db migrate` applies the planned migrations; while Prisma 7 still owns this project's migrations, run `migrate deploy` with Prisma 7's CLI instead.",
    help: 'db migrate',
  }),
  v7Command('migrate status', {
    replacement: '{bin} migration status',
    reason:
      "`migration status` reports which planned migrations the database has applied; while Prisma 7 still owns this project's migrations, run `migrate status` with Prisma 7's CLI instead.",
    help: 'migration status',
  }),
  v7Command('migrate diff', {
    replacement: '{bin} db update --dry-run',
    reason:
      '`db update --dry-run` prints the changes between the contract and a live database without applying them; to write the changes between two contracts as a migration package use `migration plan`, and to report drift use `db verify`.',
    help: 'db update',
  }),
  v7Command('migrate reset', {
    replacement: '{bin} db update',
    reason:
      "Prisma 8 has no reset: `db update` moves the database to the contract without a reset and asks before losing data, on a database whose migration history does not need to be kept; a database that changes only through migrations is moved with `db migrate`; while Prisma 7 still owns this project's migrations, run `migrate reset` with Prisma 7's CLI instead.",
    help: 'db update',
  }),
  v7Command('migrate resolve', {
    replacement: '{bin} db sign <migration>',
    reason:
      "`db sign <migration>` checks that the database already has that migration's schema and moves the database marker to that migration's contract, so `db migrate` continues after it; `migration status` does not list the migration as applied. Use it where you would run `migrate resolve --applied` after applying a migration's changes by hand. While Prisma 7 still owns this project's migrations, run `migrate resolve` with Prisma 7's CLI instead.",
    help: 'db sign',
  }),
  v7Command('generate', {
    replacement: '{bin} contract emit',
    help: 'contract emit',
    reason:
      'Prisma 8 has no client generation step. `contract emit` reads your schema and writes contract.json and contract.d.ts, the contract files the ORM reads to know your data model and its types.',
  }),
  v7Command('validate', {
    docsUrl: CLI_DOCS_URL,
    reason:
      'Prisma 8 has no separate validate command. `contract emit` reports an invalid schema when it runs, and writes the contract files when the schema is valid.',
  }),
  v7Command('format', {
    replacement: '{bin} contract format',
    help: 'contract format',
    reason:
      '`contract format` formats the PSL schema files your prisma.config.ts names as the contract source, in place. It leaves a schema written in TypeScript untouched.',
  }),
  v7Command('studio', {
    docsUrl: CLI_DOCS_URL,
    reason: 'Prisma 8 has no Studio command for browsing and editing your data in a browser.',
  }),
  v7Command('db pull', {
    replacement: '{bin} contract infer',
    help: 'contract infer',
    reason:
      '`contract infer` reads the live database, named with `--db <url>`, and writes its schema as a PSL contract file. Run `contract emit` afterwards to write the contract files the ORM reads.',
  }),
  v7Command('db push', {
    replacement: '{bin} db update',
    help: 'db update',
    reason:
      '`db update` changes the database to match the contract directly, without migration files, and asks before any change that would lose data. On a new database, `db init` creates what the contract declares and never removes or changes anything already there.',
  }),
  v7Command('db seed', {
    docsUrl: CLI_DOCS_URL,
    reason: 'Prisma 8 has no seed command. Run your seed script directly, for example with node.',
  }),
  v7Command('db execute', {
    docsUrl: CLI_DOCS_URL,
    reason: 'Prisma 8 has no command that runs a script file of statements against the database.',
  }),
];

/**
 * The unit the ORM contributes to a CLI: its config section, its commands by
 * name, where its diagnostics are documented, and the invocations it retired.
 * The shell owns the command tree, so nothing here says where a command mounts.
 */
export const ormCommandFamily = defineCommandFamily({
  configSection: ormConfigSection,
  commands,
  docsBaseUrl: DOCS_BASE_URL,
  redirects,
});
