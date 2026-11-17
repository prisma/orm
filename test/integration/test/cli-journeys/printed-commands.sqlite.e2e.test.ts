/**
 * The commands and paths the CLI prints work as printed from the directory the CLI ran in, when
 * `--config` names a config in another directory. The journey runs from the parent of the project
 * and follows, through to an applied migration: the `node` command `migration plan` prints for a
 * migration with slots, the advice of a failed conversion, of a backfill that missed a row, of a
 * field made required while rows hold NULL, and of the route that plans the failed migration again;
 * and the `node` command `migration new` prints. Advice after a run with `--db` repeats `--db <url>`,
 * so following it migrates that database, and the `migration plan` command `db update` prints for a
 * temporary value plans as printed.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { stripVTControlCharacters } from 'node:util';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { runOnEngine, withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import { sqlitePslConfigFixture, timeouts } from '../utils/journey-test-helpers';

const CONFIG = 'app/prisma.config.ts';
const BIN = 'prisma-test';

const psl = (fields: string) => `// use prisma-8

model User {
  id  Int @id
${fields}
}
`;

interface Project {
  readonly parent: string;
  readonly appDir: string;
  readonly dbPath: string;
}

function writeProject(parent: string): Project {
  const appDir = join(parent, 'app');
  mkdirSync(appDir, { recursive: true });
  const dbPath = join(appDir, 'journey.db');
  const config = readFileSync(sqlitePslConfigFixture, 'utf-8')
    .replace('{{DB_PATH}}', () => dbPath)
    .replace("migrations: { dir: 'migrations' }", "migrations: { dir: './db/migrations' }");
  writeFileSync(join(parent, CONFIG), config, 'utf-8');
  writeFileSync(join(appDir, 'contract.prisma'), psl('  age String'), 'utf-8');
  writeProjectManifest(appDir);
  return { parent, appDir, dbPath };
}

/**
 * Runs the CLI from the parent directory with `argv` exactly as given. The parent has no config of
 * its own, so a command that leaves out `--config` fails, as it would for a user.
 */
async function run(project: Project, argv: readonly string[]) {
  const result = await runOnEngine(
    { testDir: project.parent, configPath: join(project.parent, 'prisma.config.ts') },
    argv,
  );
  return { ...result, output: `${result.stdout}\n${result.stderr}` };
}

/** Runs the CLI from the parent directory, naming the config in `app/` as a user would type it. */
function cli(project: Project, argv: readonly string[]) {
  return run(project, [...argv, '--config', CONFIG]);
}

/** The words of a printed command, with its quotes removed as a shell removes them. */
function words(command: string): readonly string[] {
  return [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    ([, double, single, bare]) => double ?? single ?? bare ?? '',
  );
}

/** The advice of a failed command run with `--json`. */
function adviceOf(result: { readonly stdout: string }): string {
  const line = result.stdout.split('\n').find((text) => text.includes('"kind":"result"')) ?? '{}';
  const envelope = JSON.parse(line) as {
    readonly envelope?: {
      readonly error?: { readonly nextActions?: readonly { label: string }[] };
    };
  };
  return (envelope.envelope?.error?.nextActions ?? []).map(({ label }) => label).join('\n');
}

/** The commands and paths the text prints between backticks. */
function printed(text: string) {
  const spans = [...text.matchAll(/`([^`]+)`/g)].map(([, span]) => span ?? '');
  return {
    node: spans.filter((span) => span.startsWith('node ')).map(words),
    cli: spans.filter((span) => span.startsWith(`${BIN} `)).map((span) => words(span).slice(1)),
    paths: spans.filter((span) => !span.startsWith('node ') && !span.startsWith(`${BIN} `)),
  };
}

/** The first `node …` command a command's output prints, also inside its JSON output. */
function printedNode(output: string): readonly string[] {
  const match = /node (?:'[^']+'|\S+?migration\.ts)(?: --config (?:'[^']+'|[^\s`"']+))?/.exec(
    stripVTControlCharacters(output),
  );
  expect(match, `no node command in:\n${output}`).not.toBeNull();
  return words(match?.[0] ?? '');
}

function runNode(project: Project, command: readonly string[]) {
  expect(command[0], 'a node command').toBe('node');
  const [, ...args] = command;
  const result = spawnSync(process.execPath, args, { cwd: project.parent, encoding: 'utf-8' });
  return { exitCode: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function migrationDirs(project: Project): readonly string[] {
  const dir = join(project.appDir, 'db/migrations/app');
  return existsSync(dir) ? readdirSync(dir).filter((name) => name !== 'refs') : [];
}

/** Runs `step` and returns the migration directory it wrote. */
async function written(project: Project, step: () => Promise<unknown>): Promise<string> {
  const before = new Set(migrationDirs(project));
  await step();
  const [created] = migrationDirs(project).filter((name) => !before.has(name));
  expect(created, 'a new migration directory').toBeDefined();
  return created ?? '';
}

function columnType(dbPath: string, table: string, column: string): string | undefined {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db
      .prepare('SELECT type FROM pragma_table_info(?) WHERE name = ?')
      .get(table, column) as { readonly type: string } | undefined;
    return row?.type;
  } finally {
    db.close();
  }
}

function exec(dbPath: string, sql: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

async function emit(project: Project, fields: string) {
  writeFileSync(join(project.appDir, 'contract.prisma'), psl(fields), 'utf-8');
  const emitted = await cli(project, ['contract', 'emit']);
  expect(emitted.exitCode, `emit: ${emitted.output}`).toBe(0);
}

/** Plans from `from` and returns the new migration's directory name and the plan's output. */
async function plan(project: Project, from: string, name: string, flags: readonly string[] = []) {
  let output = '';
  const dir = await written(project, async () => {
    const planned = await cli(project, [
      'migration',
      'plan',
      '--name',
      name,
      '--from',
      from,
      ...flags,
    ]);
    expect(planned.exitCode, `plan ${name}: ${planned.output}`).toBe(0);
    output = planned.output;
  });
  return { dir, output };
}

/** Applies with `db migrate`, which fails, and returns what its advice prints. */
async function failingMigrate(project: Project) {
  const failed = await cli(project, ['db', 'migrate', '--json']);
  expect(failed.exitCode, 'the apply fails').not.toBe(0);
  return printed(adviceOf(failed));
}

/** Runs each printed `db migrate` command as printed, and expects it to apply. */
async function migrateAsPrinted(project: Project, commands: readonly (readonly string[])[]) {
  const migrate = commands.find(([command, sub]) => command === 'db' && sub === 'migrate');
  expect(migrate, 'the advice prints db migrate').toBeDefined();
  const applied = await run(project, migrate ?? []);
  expect(applied.exitCode, `db migrate as printed: ${applied.output}`).toBe(0);
}

function slotFilled(file: string, slot: RegExp, source: string): void {
  writeFileSync(file, readFileSync(file, 'utf-8').replace(slot, source));
}

withTempDir(({ createTempDir }) => {
  describe('commands printed for a config in another directory', () => {
    it(
      'run as printed from the directory the CLI ran in, through to applied migrations',
      async () => {
        const project = writeProject(createTempDir());
        await emit(project, '  age String');
        const initial = await written(project, async () => {
          const planned = await cli(project, ['migration', 'plan', '--name', 'initial']);
          expect(planned.exitCode, `plan: ${planned.output}`).toBe(0);
        });
        expect((await cli(project, ['db', 'migrate'])).exitCode, 'migrate').toBe(0);
        exec(project.dbPath, `INSERT INTO "User" (id, age) VALUES (1, 'ten'), (2, '7')`);

        // A conversion that leaves a value the new type cannot hold.
        await emit(project, '  age Int');
        const converted = await plan(project, initial, 'age-to-int', ['--convert', 'User.age']);
        const planNode = printedNode(converted.output);
        const conversionFile = join(project.parent, planNode[1] ?? '');
        const convertSlot = /placeholder\((['"])User\.age:convert\1\)/;
        const scaffold = readFileSync(conversionFile, 'utf-8');
        writeFileSync(conversionFile, scaffold.replace(convertSlot, `'trim("age")'`));
        expect(runNode(project, planNode).exitCode, 'migration plan prints node').toBe(0);
        const conversion = await failingMigrate(project);
        expect(conversion.paths.map((path) => existsSync(join(project.parent, path)))).toEqual(
          conversion.paths.map(() => true),
        );
        writeFileSync(
          join(project.parent, conversion.paths[0] ?? ''),
          scaffold.replace(
            convertSlot,
            `"CASE WHEN \\"age\\" = 'ten' THEN 10 ELSE CAST(\\"age\\" AS INTEGER) END"`,
          ),
        );
        const [conversionNode = []] = conversion.node;
        expect(runNode(project, conversionNode).exitCode, 'the advice prints node').toBe(0);
        await migrateAsPrinted(project, conversion.cli);

        // A backfill whose run misses a row.
        await emit(project, '  age  Int\n  name String');
        const backfilled = await plan(project, converted.dir, 'name', ['--backfill', 'User.name']);
        const backfillNode = printedNode(backfilled.output);
        const backfillFile = join(project.parent, backfillNode[1] ?? '');
        const runSlot = /\(\) => placeholder\((['"])User\.name:run\1\)/;
        const backfillScaffold = readFileSync(backfillFile, 'utf-8');
        writeFileSync(
          backfillFile,
          backfillScaffold.replace(
            runSlot,
            '() => `UPDATE "User" SET name = \'one\' WHERE id = 1`',
          ),
        );
        expect(runNode(project, backfillNode).exitCode, 'migration plan prints node').toBe(0);
        const missed = await failingMigrate(project);
        expect(missed.paths.map((path) => existsSync(join(project.parent, path)))).toEqual(
          missed.paths.map(() => true),
        );
        writeFileSync(
          join(project.parent, missed.paths[0] ?? ''),
          backfillScaffold.replace(
            runSlot,
            '() => `UPDATE "User" SET name = \'user \' || id WHERE name IS NULL`',
          ),
        );
        const [missedNode = []] = missed.node;
        expect(runNode(project, missedNode).exitCode, 'the advice prints node').toBe(0);
        await migrateAsPrinted(project, missed.cli);

        // Two optional fields, then each made required while rows hold NULL.
        await emit(project, '  age   Int\n  name  String\n  nick  String?\n  title String?');
        const optional = await plan(project, backfilled.dir, 'optional');
        expect((await cli(project, ['db', 'migrate'])).exitCode, 'migrate optional').toBe(0);

        await emit(project, '  age   Int\n  name  String\n  nick  String\n  title String?');
        const nick = await plan(project, optional.dir, 'nick');
        const nullRows = await failingMigrate(project);
        exec(project.dbPath, `UPDATE "User" SET nick = 'anon'`);
        await migrateAsPrinted(project, nullRows.cli);

        await emit(project, '  age   Int\n  name  String\n  nick  String\n  title String');
        await plan(project, nick.dir, 'title');
        const replan = await failingMigrate(project);
        const [failedDir = ''] = replan.paths;
        expect(existsSync(join(project.parent, failedDir)), failedDir).toBe(true);
        rmSync(join(project.parent, failedDir), { recursive: true });
        const planAgain = replan.cli.find(
          ([command, sub]) => command === 'migration' && sub === 'plan',
        );
        expect(planAgain, 'the advice prints migration plan').toBeDefined();
        let replanned = '';
        const replannedDir = await written(project, async () => {
          const planned = await run(project, planAgain ?? []);
          expect(planned.exitCode, `migration plan as printed: ${planned.output}`).toBe(0);
          replanned = planned.output;
        });
        const replanNode = printedNode(replanned);
        expect(replanNode[1]).toContain(replannedDir);
        slotFilled(
          join(project.parent, replanNode[1] ?? ''),
          /\(\) => placeholder\((['"])User\.title:run\1\)/,
          '() => `UPDATE "User" SET title = \'untitled\' WHERE title IS NULL`',
        );
        expect(runNode(project, replanNode).exitCode, 'the re-plan prints node').toBe(0);
        await migrateAsPrinted(project, replan.cli);

        // A migration written by hand.
        const scaffolded = await cli(project, [
          'migration',
          'new',
          '--name',
          'by-hand',
          '--from',
          JSON.parse(
            readFileSync(
              join(project.appDir, 'db/migrations/app', replannedDir, 'migration.json'),
              'utf-8',
            ),
          ).to,
        ]);
        expect(scaffolded.exitCode, `migration new: ${scaffolded.output}`).toBe(0);
        const newNode = printedNode(scaffolded.output);
        expect(runNode(project, newNode).exitCode, 'migration new prints node').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'with --db, apply to the database the failed command named, not the one in the config',
      async () => {
        const project = writeProject(createTempDir());
        const other = join(project.parent, 'other.db');
        await emit(project, '  age String');
        const initial = await written(project, async () => {
          const planned = await cli(project, ['migration', 'plan', '--name', 'initial']);
          expect(planned.exitCode, `plan: ${planned.output}`).toBe(0);
        });
        expect((await cli(project, ['db', 'migrate'])).exitCode, 'migrate the config').toBe(0);
        expect(
          (await cli(project, ['db', 'migrate', '--db', other])).exitCode,
          'migrate --db',
        ).toBe(0);
        exec(other, `INSERT INTO "User" (id, age) VALUES (1, 'ten')`);

        await emit(project, '  age Int');
        const converted = await plan(project, initial, 'age-to-int', ['--convert', 'User.age']);
        const planNode = printedNode(converted.output);
        const conversionFile = join(project.parent, planNode[1] ?? '');
        const convertSlot = /placeholder\((['"])User\.age:convert\1\)/;
        const scaffold = readFileSync(conversionFile, 'utf-8');
        writeFileSync(conversionFile, scaffold.replace(convertSlot, `'trim("age")'`));
        expect(runNode(project, planNode).exitCode, 'migration plan prints node').toBe(0);

        const failed = await cli(project, ['db', 'migrate', '--db', other, '--json']);
        expect(failed.exitCode, 'the apply fails on the other database').not.toBe(0);
        const advice = printed(adviceOf(failed));
        writeFileSync(
          conversionFile,
          scaffold.replace(
            convertSlot,
            `"CASE WHEN \\"age\\" = 'ten' THEN 10 ELSE CAST(\\"age\\" AS INTEGER) END"`,
          ),
        );
        const [adviceNode = []] = advice.node;
        expect(runNode(project, adviceNode).exitCode, 'the advice prints node').toBe(0);
        await migrateAsPrinted(
          project,
          advice.cli.map((command) => command.map((word) => (word === '<url>' ? other : word))),
        );

        expect({
          other: columnType(other, 'User', 'age'),
          config: columnType(project.dbPath, 'User', 'age'),
        }).toEqual({ other: 'INTEGER', config: 'TEXT' });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'the migration plan that db update suggests for a temporary value plans as printed',
      async () => {
        const project = writeProject(createTempDir());
        await emit(project, '  age String');
        await written(project, async () => {
          const planned = await cli(project, ['migration', 'plan', '--name', 'initial']);
          expect(planned.exitCode, `plan: ${planned.output}`).toBe(0);
        });
        expect((await cli(project, ['db', 'migrate'])).exitCode, 'migrate').toBe(0);
        exec(project.dbPath, `INSERT INTO "User" (id, age) VALUES (1, '7')`);

        await emit(project, '  age  String\n  name String');
        const dryRun = await cli(project, ['db', 'update', '--dry-run']);
        expect(dryRun.exitCode, `db update --dry-run: ${dryRun.output}`).toBe(0);
        const suggested = new RegExp(`${BIN} (migration plan .*?) instead\\.`).exec(
          stripVTControlCharacters(dryRun.output),
        );
        expect(suggested, `no migration plan in:\n${dryRun.output}`).not.toBeNull();

        await written(project, async () => {
          const planned = await run(project, words(suggested?.[1] ?? ''));
          expect(planned.exitCode, `migration plan as printed: ${planned.output}`).toBe(0);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
