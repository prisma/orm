import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { resolveStatements } from '../../../src/control-api/statements/resolve-statements';
import { askedAbout, textsOf } from './plan-question-fixtures';
import { contractOf, failureShape } from './statement-fixtures';

const app = asNamespaceId('app');

const origin = contractOf({
  app: {
    models: {
      Task: {
        fields: ['id', 'type'],
        discriminator: 'type',
        variants: { bug: 'Bug', epic: 'Epic' },
      },
      Bug: { fields: ['id', 'severity'], base: 'Task' },
      Epic: { fields: ['id', 'scope'], base: 'Task' },
      Audit: { fields: ['id'] },
    },
  },
});
const destination = contractOf({
  app: { models: { Issue: { fields: ['id', 'severity'] }, Audit: { fields: ['id'] } } },
});

function renamed(text: string) {
  return failureShape(
    resolveStatements({
      statements: [{ verb: 'rename', text }],
      origin: { kind: 'contract', contract: origin },
      destination,
    }),
  );
}

const ON_ITS_OWN =
  'Model "Bug" cannot be renamed on its own: it is a variant of model "Task", which this change removes too, and its rows are rows of model "Task", so they are kept or deleted with them.';

describe('a removed variant whose base the change removes too', () => {
  it('is asked about with no rename, and says its rows go with those of its base', async () => {
    const [question] = await askedAbout({
      origin,
      destination,
      losses: [
        {
          label: 'Delete the rows of variant "Bug"',
          subject: { kind: 'model', namespaceId: app, model: 'Bug' },
        },
      ],
    });

    expect({
      verbs: question?.verbs,
      ...textsOf(question === undefined ? [] : [question]),
      typed: question?.validate('rename', 'Bug:Nope'),
    }).toEqual({
      verbs: ['delete'],
      prompts: [
        `Removing model "Bug" would delete its data.\nThe operation of the plan that does this: Delete the rows of variant "Bug".\n${ON_ITS_OWN}\ndelete lets its data go.`,
      ],
      refusal: {
        summary: 'Removing model "Bug" would delete its data.',
        why: 'The operation of the plan that does this: Delete the rows of variant "Bug".',
        nextActions: [ON_ITS_OWN, 'If its data can go: --delete Bug'],
      },
      typed: `the contract has no model "Nope" to rename "Bug" to. ${ON_ITS_OWN} Leave out this rename.`,
    });
  });

  it('gives no model to add for a --rename to a name the contract does not have, or had before', () => {
    expect({ missing: renamed('Bug:Nope'), hadBefore: renamed('Bug:Audit') }).toEqual({
      missing: {
        code: 'MIGRATION.STATEMENT_UNRESOLVED',
        summary: 'The contract has no model "Nope" to rename "Bug" to.',
        nextActions: [`${ON_ITS_OWN} Leave out this rename.`],
        meta: { statement: 'Bug:Nope', verb: 'rename' },
      },
      hadBefore: {
        code: 'MIGRATION.STATEMENT_UNRESOLVED',
        summary:
          'The contract had model "Audit" before this change too, so one change cannot make it the new name of "Bug".',
        nextActions: [`${ON_ITS_OWN} Leave out this rename.`],
        meta: { statement: 'Bug:Audit', verb: 'rename' },
      },
    });
  });

  it('says so for a field of the variant in place of a rename of the variant', async () => {
    const [question] = await askedAbout({
      origin,
      destination,
      losses: [
        {
          label: 'Drop column "severity" from "task"',
          subject: { kind: 'field', namespaceId: app, model: 'Bug', field: 'severity' },
        },
      ],
    });

    expect(textsOf(question === undefined ? [] : [question])).toEqual({
      prompts: [
        `This change would delete the values of field "Bug.severity".\nThe operation of the plan that does this: Drop column "severity" from "task".\n${ON_ITS_OWN}\ndelete lets the values go.`,
      ],
      refusal: {
        summary: 'This change would delete the values of field "Bug.severity".',
        why: 'The operation of the plan that does this: Drop column "severity" from "task".',
        nextActions: [ON_ITS_OWN, 'If the values can go: --delete Bug.severity'],
      },
    });
  });
});

describe('a removed variant with a table of its own whose base the change removes too', () => {
  const ownTable = contractOf({
    app: {
      models: {
        Task: {
          fields: ['id', 'type'],
          discriminator: 'type',
          variants: { bug: 'Bug', epic: 'Epic' },
          storage: { table: 'task' },
        },
        Bug: { fields: ['id', 'severity'], base: 'Task', storage: { table: 'bug' } },
        Epic: { fields: ['id', 'scope'], base: 'Task', storage: { table: 'task' } },
        Audit: { fields: ['id'], storage: { table: 'audit' } },
      },
    },
  });
  const resolve = (text: string) =>
    failureShape(
      resolveStatements({
        statements: [{ verb: 'rename', text }],
        origin: { kind: 'contract', contract: ownTable },
        destination,
      }),
    );

  it('is offered a rename to a model the contract gets first, naming no base', async () => {
    const [question] = await askedAbout({
      origin: ownTable,
      destination,
      losses: [
        {
          label: 'Drop table "bug"',
          subject: { kind: 'model', namespaceId: app, model: 'Bug' },
        },
      ],
    });

    expect({
      verbs: question?.verbs,
      ...textsOf(question === undefined ? [] : [question]),
      typed: question?.validate('rename', 'Bug:Nope'),
    }).toEqual({
      verbs: ['rename', 'delete'],
      prompts: [
        'Removing model "Bug" would delete its data.\nThe operation of the plan that does this: Drop table "bug".\nrename works only once the contract has the model under its new name: stop this command, add it to the contract, run `prisma contract emit`, and run this command again; delete lets its data go.',
      ],
      refusal: {
        summary: 'Removing model "Bug" would delete its data.',
        why: 'The operation of the plan that does this: Drop table "bug".',
        nextActions: [
          "If the model was renamed, add it to the contract under its new name and run `{bin} contract emit`; then keep its data: --rename 'Bug:<new name>'",
          'If its data can go: --delete Bug',
        ],
      },
      typed:
        'the contract has no model "Nope" to rename "Bug" to. If model "Bug" was renamed to "Nope", stop this command, add model "Nope" to the contract, run `{bin} contract emit`, and run this command again.',
    });
  });

  it('says to add the model for a --rename to a name the contract does not have, and gives the two steps for one it had before', () => {
    expect({ missing: resolve('Bug:Nope'), hadBefore: resolve('Bug:Audit') }).toEqual({
      missing: {
        code: 'MIGRATION.STATEMENT_UNRESOLVED',
        summary: 'The contract has no model "Nope" to rename "Bug" to.',
        nextActions: [
          'If model "Bug" was renamed to "Nope", add model "Nope" to the contract, run `{bin} contract emit`, and run this command again.',
        ],
        meta: { statement: 'Bug:Nope', verb: 'rename' },
      },
      hadBefore: {
        code: 'MIGRATION.STATEMENT_UNRESOLVED',
        summary:
          'The contract had model "Audit" before this change too, so one change cannot make it the new name of "Bug".',
        nextActions: [
          'If "Bug" is to take the name "Audit" from the model that has it now, do it in two steps. First, in the contract, give model "Audit" its new name or remove it, and keep "Bug" as it was; run `{bin} contract emit`, and run this command again without --rename Bug:Audit. Then rename "Bug" to "Audit" in the contract, run `{bin} contract emit`, and run this command again with --rename Bug:Audit.',
        ],
        meta: { statement: 'Bug:Audit', verb: 'rename' },
      },
    });
  });

  it('gives the rename of the variant for a field of the variant', async () => {
    const [question] = await askedAbout({
      origin: ownTable,
      destination,
      losses: [
        {
          label: 'Drop column "severity" from "bug"',
          subject: { kind: 'field', namespaceId: app, model: 'Bug', field: 'severity' },
        },
      ],
    });

    expect(textsOf(question === undefined ? [] : [question])).toEqual({
      prompts: [
        'This change would delete the values of field "Bug.severity".\nThe operation of the plan that does this: Drop column "severity" from "bug".\nIf model "Bug" was renamed, stop this command, add it to the contract under its new name, run `prisma contract emit`, and run this command again with --rename \'Bug:<new name>\'.\ndelete lets the values go.',
      ],
      refusal: {
        summary: 'This change would delete the values of field "Bug.severity".',
        why: 'The operation of the plan that does this: Drop column "severity" from "bug".',
        nextActions: [
          'If model "Bug" was renamed, add it to the contract under its new name and run `{bin} contract emit`; then say so first: --rename \'Bug:<new name>\'',
          'If the values can go: --delete Bug.severity',
        ],
      },
    });
  });
});
