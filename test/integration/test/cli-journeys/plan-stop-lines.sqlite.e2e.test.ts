/**
 * Every line `migration plan` and `db update` print when a change would lose data works when a careful reader follows it (SQLite).
 *
 * Each journey makes one change that stops the command, reads the refusal, and does what one printed line says, through `migration plan` and `db migrate`, and through `db update`. A line that gives the flag with a placeholder is followed by putting the new name in the contract where the line says the contract must have it, and in place of the placeholder. A line that says to remove a flag is followed by leaving that flag out. Each journey then checks the data the line said it would keep or let go.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { timeouts } from '../utils/journey-test-helpers';
import {
  COMMANDS,
  type Command,
  columnNames,
  emit,
  expectSettled,
  planAndApply,
  refusal,
  rows,
  run,
  type StoredNameJourney,
  sqliteJourney,
  start,
  tableNames,
} from '../utils/stored-name-journeys';

interface Shape {
  readonly legacy?: string | undefined;
  readonly archived?: boolean;
  readonly retired?: boolean;
  readonly age?: string;
  readonly bug?: string | undefined;
  readonly task?: boolean;
}

function contract(shape: Shape = {}): string {
  const { legacy = 'legacy', archived = true, retired = false, age = 'String?' } = shape;
  const bug = 'bug' in shape ? shape.bug : 'Bug';
  return `// use prisma-8

enum Status {
  @@type("sqlite/text@1")
  ACTIVE = "active"
${archived ? '  ARCHIVED = "archived"\n' : ''}${retired ? '  RETIRED = "retired"\n' : ''}}

model Shop {
  id     Int     @id
  name   String
${legacy
  .split(' ')
  .filter((field) => field !== '')
  .map((field) => `  ${field} String?\n`)
  .join('')}  status Status?
  age    ${age}
  @@map("Store Front")
}
${
  bug === undefined
    ? ''
    : `
model ${bug} {
  id    Int    @id
  title String
  @@map("${bug.toLowerCase()}")
}
`
}${
  shape.task === false
    ? ''
    : `
model Task {
  id    Int    @id
  title String
  @@map("task")
}
`
}`;
}

const SEED = `INSERT INTO "Store Front" (id, name, legacy, status, age) VALUES (1, 'a', 'old1', 'active', '42'), (2, 'b', 'old2', 'archived', '7');
INSERT INTO "bug" (id, title) VALUES (1, 'b1');
INSERT INTO "task" (id, title) VALUES (1, 't1');`;

/** The labels of the refusal's next actions. */
function linesOf(error: { readonly nextActions?: readonly { readonly label: string }[] }) {
  return (error.nextActions ?? []).map(({ label }) => label);
}

/** The line that gives `flag`, which must exist. */
function lineWith(lines: readonly string[], flag: string): string {
  const line = lines.find((each) => each.includes(`: ${flag} `));
  expect(line, `a line that gives ${flag} in:\n${lines.join('\n')}`).toBeDefined();
  return line ?? '';
}

/** The flags a line gives, as a shell reads them, with `<new name>` filled in. */
function flagsOf(line: string, newName?: string): readonly string[] {
  const given = line.slice(line.lastIndexOf(': --') + 2);
  const filled = newName === undefined ? given : given.replace('<new name>', newName);
  return [...filled.matchAll(/'([^']*)'|(\S+)/g)].map(([, quoted, bare]) => quoted ?? bare ?? '');
}

async function startShop(createTempDir: () => string, command: Command, label: string) {
  const journey = sqliteJourney(createTempDir, command);
  await start(journey, contract(), SEED, label);
  return journey;
}

async function shops(journey: StoredNameJourney) {
  return rows(journey, 'SELECT * FROM "Store Front" ORDER BY id');
}

withTempDir(({ createTempDir }) => {
  describe.each(COMMANDS)('Journey L1 (SQLite): a removed field with %s', (command) => {
    it(
      'keeps the values under the name the contract gets first, as the rename line says',
      async () => {
        const journey = await startShop(createTempDir, command, 'L1.01');
        await emit(journey, contract({ legacy: '' }), 'L1.02');
        const lines = linesOf(await refusal(journey, [], 'L1.03'));
        const rename = lineWith(lines, '--rename');
        expect(rename, 'L1.03: the contract must have the field first').toBe(
          `If the field was renamed, add it to the contract under its new name and run \`prisma-test contract emit\`; then keep its values: --rename 'Shop.legacy:Shop.<new name>'`,
        );

        await emit(journey, contract({ legacy: 'rating' }), 'L1.04');
        await planAndApply(journey, flagsOf(rename, 'rating'), 'L1.05');
        expect(
          (await shops(journey)).map(({ rating }) => rating),
          'L1.05: kept',
        ).toEqual(['old1', 'old2']);
        await expectSettled(journey, 'L1.06');
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'drops the column, as the delete line says',
      async () => {
        const journey = await startShop(createTempDir, command, 'L1.11');
        await emit(journey, contract({ legacy: '' }), 'L1.12');
        const lines = linesOf(await refusal(journey, [], 'L1.13'));

        await planAndApply(journey, flagsOf(lineWith(lines, '--delete')), 'L1.14');
        expect(await columnNames(journey, 'Store Front'), 'L1.14: gone').toEqual([
          'age',
          'id',
          'name',
          'status',
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(COMMANDS)(
    'Journey L2 (SQLite): a removed field when the contract adds two with %s',
    (command) => {
      it(
        'keeps the values under the name put in place of the placeholder',
        async () => {
          const journey = await startShop(createTempDir, command, 'L2.01');
          await emit(journey, contract({ legacy: 'rating score' }), 'L2.02');
          const rename = lineWith(linesOf(await refusal(journey, [], 'L2.03')), '--rename');
          expect(rename, 'L2.03: the names the field can have').toBe(
            `If the field was renamed to "rating" or "score", put that name in place of <new name> to keep its values: --rename 'Shop.legacy:Shop.<new name>'`,
          );

          await planAndApply(journey, flagsOf(rename, 'score'), 'L2.04');
          expect(
            (await shops(journey)).map(({ score, rating }) => ({ score, rating })),
            'L2.04: kept under the chosen name',
          ).toEqual([
            { score: 'old1', rating: null },
            { score: 'old2', rating: null },
          ]);
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(COMMANDS)('Journey L3 (SQLite): a removed model with %s', (command) => {
    it(
      'keeps the rows under the model the contract gets first, or drops them, as each line says',
      async () => {
        const kept = await startShop(createTempDir, command, 'L3.01');
        await emit(kept, contract({ bug: undefined }), 'L3.02');
        const lines = linesOf(await refusal(kept, [], 'L3.03'));
        const rename = lineWith(lines, '--rename');
        expect(rename, 'L3.03: the contract must have the model first').toBe(
          `If the model was renamed, add it to the contract under its new name and run \`prisma-test contract emit\`; then keep its data: --rename 'Bug:<new name>'`,
        );
        await emit(kept, contract({ bug: 'Issue' }), 'L3.04');
        await planAndApply(kept, flagsOf(rename, 'Issue'), 'L3.05');
        expect(await rows(kept, 'SELECT * FROM "issue"'), 'L3.05: kept').toEqual([
          { id: 1, title: 'b1' },
        ]);

        const dropped = await startShop(createTempDir, command, 'L3.11');
        await emit(dropped, contract({ bug: undefined }), 'L3.12');
        await planAndApply(dropped, flagsOf(lineWith(lines, '--delete')), 'L3.13');
        expect(await tableNames(dropped), 'L3.13: dropped').toEqual(['Store Front', 'task']);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(COMMANDS)('Journey L4 (SQLite): a removed enum value with %s', (command) => {
    it(
      'keeps the value under the member the contract gets first, or clears it, as each line says',
      async () => {
        const kept = await startShop(createTempDir, command, 'L4.01');
        await emit(kept, contract({ archived: false }), 'L4.02');
        const lines = linesOf(await refusal(kept, [], 'L4.03'));
        const rename = lineWith(lines, '--rename');
        expect(rename, 'L4.03: the contract must have the member first').toBe(
          `If the enum value was renamed, add it to the contract under its new name and run \`prisma-test contract emit\`; then keep it in the data: --rename 'Status.ARCHIVED:Status.<new name>'`,
        );
        await emit(kept, contract({ archived: false, retired: true }), 'L4.04');
        await planAndApply(kept, flagsOf(rename, 'RETIRED'), 'L4.05');
        expect(
          (await shops(kept)).map(({ status }) => status),
          'L4.05: kept',
        ).toEqual(['active', 'retired']);

        const cleared = await startShop(createTempDir, command, 'L4.11');
        await emit(cleared, contract({ archived: false }), 'L4.12');
        await planAndApply(cleared, flagsOf(lineWith(lines, '--delete')), 'L4.13');
        expect(
          (await shops(cleared)).map(({ status }) => status),
          'L4.13: cleared',
        ).toEqual(['active', null]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(COMMANDS)('Journey L5 (SQLite): a type change with %s', (command) => {
    it(
      'plans a conversion to fill in, or casts the values, as each line says',
      async () => {
        const journey = await startShop(createTempDir, command, 'L5.01');
        await emit(journey, contract({ age: 'Int?' }), 'L5.02');
        const lines = linesOf(await refusal(journey, [], 'L5.03'));
        if (command === 'migration plan') {
          const converted = await run(journey, flagsOf(lineWith(lines, '--convert')));
          expect(converted.exitCode, `L5.04: ${converted.stderr}`).toBe(0);
          const again = await startShop(createTempDir, command, 'L5.05');
          await emit(again, contract({ age: 'Int?' }), 'L5.06');
          await planAndApply(again, flagsOf(lineWith(lines, '--delete')), 'L5.07');
          expect(
            (await shops(again)).map(({ age }) => age),
            'L5.07: cast',
          ).toEqual([42, 7]);
        } else {
          expect(
            lines.some((line) => line.includes('--convert')),
            'L5.04: no conversion',
          ).toBe(false);
          await planAndApply(journey, flagsOf(lineWith(lines, '--delete')), 'L5.07');
          expect(
            (await shops(journey)).map(({ age }) => age),
            'L5.07: cast',
          ).toEqual([42, 7]);
        }
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(COMMANDS)('Journey L6 (SQLite): two removed models with %s', (command) => {
    it(
      'drops both once every delete line is followed',
      async () => {
        const journey = await startShop(createTempDir, command, 'L6.01');
        await emit(journey, contract({ bug: undefined, task: false }), 'L6.02');
        const error = await refusal(journey, [], 'L6.03');
        expect(error.summary, 'L6.03: what the change would do').toBe(
          'This change would lose data: model "Bug", model "Task".',
        );
        const deletes = linesOf(error)
          .filter((line) => line.includes(': --delete '))
          .flatMap((line) => flagsOf(line));

        await planAndApply(journey, deletes, 'L6.04');
        expect(await tableNames(journey), 'L6.04: dropped').toEqual(['Store Front']);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(COMMANDS)(
    'Journey L7 (SQLite): a flag that did nothing, and --yes, with %s',
    (command) => {
      it(
        'applies once the flag the output says to remove is gone and the printed flag is given',
        async () => {
          const journey = await startShop(createTempDir, command, 'L7.01');
          await emit(journey, contract({ bug: undefined }), 'L7.02');
          const lines = linesOf(await refusal(journey, ['--delete', 'Nope'], 'L7.03'));
          expect(lines[0], 'L7.03: remove the flag').toBe(
            'Remove --delete Nope: nothing in this change is called that.',
          );
          const withYes = await refusal(journey, ['--yes'], 'L7.04');
          expect(withYes.why, 'L7.04: --yes does not allow it').toBe(
            'The operation of the plan that does this: Drop table "bug".\n\n--yes does not allow this: it would delete data.',
          );

          await planAndApply(journey, ['--yes', ...flagsOf(lineWith(lines, '--delete'))], 'L7.05');
          expect(await tableNames(journey), 'L7.05: dropped').toEqual(['Store Front', 'task']);
        },
        timeouts.spinUpPpgDev,
      );
    },
  );
});
