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
