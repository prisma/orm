/**
 * The rename lines `migration plan` and `db update` print for a removed variant, also when the same change renames or removes its base (with the variant in its base's table or in a table of its own), and for a rename to a name another field holds work when a careful reader follows them (SQLite).
 *
 * Each journey reads the line, changes the contract as it says, runs the command with the flags it gives, and checks the data.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { timeouts } from '../utils/journey-test-helpers';
import {
  COMMANDS,
  emit,
  expectSettled,
  planAndApply,
  refusal,
  rows,
  sqliteJourney,
  start,
} from '../utils/stored-name-journeys';

function tasks(variants: string, extra = ''): string {
  return `// use prisma-8

model Task {
  id   Int    @id
  type String
  @@discriminator(type)
  @@map("task")
}
${variants}
model Epic {
  scope String?
  @@base(Task, "epic")
}
${extra}`;
}

const BUG = `
model Bug {
  severity String?
  @@base(Task, "bug")
}
`;

const ISSUE = `
model Issue {
  id       Int     @id
  severity String?
  @@map("issue")
}
`;

const BUG_OWN_TABLE = `
model Bug {
  severity String?
  @@base(Task, "bug")
  @@map("bug")
}
`;

const DEFECT_OWN_MODEL = `
model Defect {
  id       Int     @id
  severity String?
  @@map("defect")
}
`;

const DEFECT = `
model Defect {
  severity String?
  @@base(Task, "defect")
}
`;

function works(variants: string): string {
  return `// use prisma-8

model Work {
  id   Int    @id
  type String
  @@discriminator(type)
  @@map("task")
}
${variants}
model Epic {
  scope String?
  @@base(Work, "epic")
}
`;
}

const DEFECT_OF_WORK = `
model Defect {
  severity String?
  @@base(Work, "defect")
}
`;

function shop(fields: readonly string[]): string {
  return `// use prisma-8

model Shop {
  id     Int     @id
${fields.map((field) => `  ${field.padEnd(6)} String?\n`).join('')}  @@map("Store Front")
}
`;
}

function linesOf(error: { readonly nextActions?: readonly { readonly label: string }[] }) {
  return (error.nextActions ?? []).map(({ label }) => label);
}

/** The flags at the end of a line, as a shell reads them, with `<new name>` filled in. */
function flagsOf(line: string, newName?: string): readonly string[] {
  const given = line.slice(line.lastIndexOf(': --') + 2);
  const filled = newName === undefined ? given : given.replace('<new name>', newName);
  return [...filled.matchAll(/'([^']*)'|(\S+)/g)].map(([, quoted, bare]) => quoted ?? bare ?? '');
}

withTempDir(({ createTempDir }) => {
  describe.each(COMMANDS)('Journey R1 (SQLite): a removed variant with %s', (command) => {
    it(
      'keeps its rows under the variant of the same base the contract gets first, as the rename line says',
      async () => {
        const journey = sqliteJourney(createTempDir, command);
        await start(
          journey,
          tasks(BUG),
          `INSERT INTO "task" (id, type, severity, scope) VALUES (1, 'bug', 'high', NULL), (2, 'epic', NULL, 'big');`,
          'R1.01',
        );
        await emit(journey, tasks('', ISSUE), 'R1.02');
        const rename = linesOf(await refusal(journey, [], 'R1.03')).find((line) =>
          line.includes(': --rename '),
        );
        expect(rename, 'R1.03: the new name must be a variant of the same base').toBe(
          `If the model was renamed, add it to the contract under its new name as a variant of model "Task" and run \`prisma-test contract emit\`; then keep its data: --rename 'Bug:<new name>'`,
        );

        await emit(journey, tasks(DEFECT, ISSUE), 'R1.04');
        await planAndApply(journey, flagsOf(rename ?? '', 'Defect'), 'R1.05');
        expect(
          await rows(journey, 'SELECT id, type, severity, scope FROM "task" ORDER BY id'),
          'R1.05: kept as the new variant',
        ).toEqual([
          { id: 1, type: 'defect', severity: 'high', scope: null },
          { id: 2, type: 'epic', severity: null, scope: 'big' },
        ]);
        await expectSettled(journey, 'R1.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(COMMANDS)(
    'Journey R3 (SQLite): a removed variant whose base the same change renames, with %s',
    (command) => {
      it(
        'names the base by its new name, and keeps the rows as the line says',
        async () => {
          const journey = sqliteJourney(createTempDir, command);
          await start(
            journey,
            tasks(BUG),
            `INSERT INTO "task" (id, type, severity, scope) VALUES (1, 'bug', 'high', NULL), (2, 'epic', NULL, 'big');`,
            'R3.01',
          );
          await emit(journey, works(''), 'R3.02');
          const rename = linesOf(await refusal(journey, ['--rename', 'Task:Work'], 'R3.03')).find(
            (line) => line.includes(': --rename '),
          );
          expect(rename, 'R3.03: the base as the contract names it now').toBe(
            `If the model was renamed, add it to the contract under its new name as a variant of model "Work" and run \`prisma-test contract emit\`; then keep its data: --rename 'Bug:<new name>'`,
          );

          await emit(journey, works(DEFECT_OF_WORK), 'R3.04');
          await planAndApply(
            journey,
            ['--rename', 'Task:Work', ...flagsOf(rename ?? '', 'Defect')],
            'R3.05',
          );
          expect(
            await rows(journey, 'SELECT id, type, severity, scope FROM "task" ORDER BY id'),
            'R3.05: kept as the new variant of Work',
          ).toEqual([
            { id: 1, type: 'defect', severity: 'high', scope: null },
            { id: 2, type: 'epic', severity: null, scope: 'big' },
          ]);
          await expectSettled(journey, 'R3.06');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(COMMANDS)(
    'Journey R4 (SQLite): a removed variant whose base the same change removes, with %s',
    (command) => {
      it(
        'gives no model to add, and its rows go with those of the base, as the error says',
        async () => {
          const journey = sqliteJourney(createTempDir, command);
          await start(
            journey,
            tasks(BUG),
            `INSERT INTO "task" (id, type, severity, scope) VALUES (1, 'bug', 'high', NULL), (2, 'epic', NULL, 'big'), (3, 'bug', NULL, NULL);`,
            'R4.01',
          );
          await emit(journey, `// use prisma-8\n${ISSUE}`, 'R4.02');
          const error = await refusal(journey, ['--rename', 'Bug:Nope'], 'R4.03');
          expect(
            { summary: error.summary, lines: linesOf(error) },
            'R4.03: no model to add',
          ).toEqual({
            summary: 'The contract has no model "Nope" to rename "Bug" to.',
            lines: [
              'Model "Bug" cannot be renamed on its own: it is a variant of model "Task", which this change removes too, and its rows are rows of model "Task", so they are kept or deleted with them. Leave out this rename.',
            ],
          });

          const base = await refusal(journey, [], 'R4.04');
          expect(
            { summary: base.summary, lines: linesOf(base) },
            'R4.04: asked about the base',
          ).toEqual({
            summary: 'Removing model "Task" would delete its data.',
            lines: [
              'If the model was renamed to "Issue", keep its data: --rename Task:Issue',
              'If its data can go: --delete Task',
            ],
          });
          const renameBase = flagsOf(linesOf(base)[0] ?? '');
          const deletes = linesOf(await refusal(journey, renameBase, 'R4.05'))
            .filter((line) => line.includes(': --delete '))
            .flatMap((line) => flagsOf(line));
          expect(deletes, 'R4.05: the values the rename of the base leaves out').toEqual([
            '--delete',
            'Epic.scope',
            '--delete',
            'Issue.type',
          ]);
          await planAndApply(journey, [...renameBase, ...deletes], 'R4.06');
          expect(
            await rows(journey, 'SELECT id, severity FROM "issue" ORDER BY id'),
            'R4.06: the rows of the variant are kept with those of the base',
          ).toEqual([
            { id: 1, severity: 'high' },
            { id: 2, severity: null },
            { id: 3, severity: null },
          ]);
          await expectSettled(journey, 'R4.07');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(COMMANDS)(
    'Journey R5 (SQLite): a removed variant with a table of its own whose base the same change removes, with %s',
    (command) => {
      it(
        'keeps its rows under the model the contract gets first, as the rename line says',
        async () => {
          const journey = sqliteJourney(createTempDir, command);
          await start(
            journey,
            tasks(BUG_OWN_TABLE),
            `INSERT INTO "task" (id, type, scope) VALUES (1, 'bug', NULL), (2, 'epic', 'big'); INSERT INTO "bug" (id, severity) VALUES (1, 'high');`,
            'R5.01',
          );
          await emit(journey, `// use prisma-8\n${ISSUE}`, 'R5.02');
          const rename = linesOf(await refusal(journey, [], 'R5.03')).find((line) =>
            line.includes("--rename 'Bug:"),
          );
          expect(rename, 'R5.03: a model to add, and no base it must be a variant of').toBe(
            `If model "Bug" was renamed, add it to the contract under its new name and run \`prisma-test contract emit\`; then keep its data: --rename 'Bug:<new name>'`,
          );

          await emit(journey, `// use prisma-8\n${ISSUE}${DEFECT_OWN_MODEL}`, 'R5.04');
          const renameBug = flagsOf(rename ?? '', 'Defect');
          const deletes = linesOf(await refusal(journey, renameBug, 'R5.05'))
            .filter((line) => line.includes(': --delete '))
            .flatMap((line) => flagsOf(line));
          expect(deletes, 'R5.05: the base is asked about on its own').toEqual([
            '--delete',
            'Task',
          ]);
          await planAndApply(journey, [...renameBug, ...deletes], 'R5.06');
          expect(
            await rows(journey, 'SELECT id, severity FROM "defect" ORDER BY id'),
            'R5.06: the rows of the variant are kept under the new model',
          ).toEqual([{ id: 1, severity: 'high' }]);
          await expectSettled(journey, 'R5.07');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(COMMANDS)(
    'Journey R2 (SQLite): a --rename to the name another field holds, with %s',
    (command) => {
      it(
        'gives the field that name in two steps, as the error says',
        async () => {
          const journey = sqliteJourney(createTempDir, command);
          await start(
            journey,
            shop(['name', 'legacy']),
            `INSERT INTO "Store Front" (id, name, legacy) VALUES (1, 'a', 'old1'), (2, 'b', 'old2');`,
            'R2.01',
          );
          await emit(journey, shop(['title', 'name']), 'R2.02');
          const error = await refusal(journey, ['--rename', 'Shop.legacy:Shop.name'], 'R2.03');
          expect({ summary: error.summary, lines: linesOf(error) }, 'R2.03: two steps').toEqual({
            summary:
              'The contract had field "Shop.name" before this change too, so one change cannot make it the new name of "Shop.legacy".',
            lines: [
              'If field "Shop.legacy" was renamed to "Shop.title", use --rename Shop.legacy:Shop.title in place of --rename Shop.legacy:Shop.name',
              'If "Shop.legacy" is to take the name "Shop.name" from the field that has it now, do it in two steps. First, in the contract, give field "Shop.name" its new name or remove it, and keep "Shop.legacy" as it was; run `prisma-test contract emit`, and run this command again. Then rename "Shop.legacy" to "Shop.name" in the contract, run `prisma-test contract emit`, and run this command again with --rename Shop.legacy:Shop.name.',
            ],
          });

          await emit(journey, shop(['title', 'legacy']), 'R2.04');
          const first = linesOf(await refusal(journey, [], 'R2.05')).find((line) =>
            line.includes(': --rename '),
          );
          expect(first, 'R2.05: the first step says how to keep the values of "name"').toBe(
            'If the field was renamed to "title", keep its values: --rename Shop.name:Shop.title',
          );
          await planAndApply(journey, flagsOf(first ?? ''), 'R2.06');

          await emit(journey, shop(['title', 'name']), 'R2.07');
          await planAndApply(journey, ['--rename', 'Shop.legacy:Shop.name'], 'R2.08');
          expect(
            await rows(journey, 'SELECT id, title, name FROM "Store Front" ORDER BY id'),
            'R2.08: both kept',
          ).toEqual([
            { id: 1, title: 'a', name: 'old1' },
            { id: 2, title: 'b', name: 'old2' },
          ]);
          await expectSettled(journey, 'R2.09');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );
});
