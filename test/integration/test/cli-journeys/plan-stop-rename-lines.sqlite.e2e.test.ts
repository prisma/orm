/**
 * The rename lines `migration plan` and `db update` print for a removed variant and for a rename to a name another field holds work when a careful reader follows them (SQLite).
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

const DEFECT = `
model Defect {
  severity String?
  @@base(Task, "defect")
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
