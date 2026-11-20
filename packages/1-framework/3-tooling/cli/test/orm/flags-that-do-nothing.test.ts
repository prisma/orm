import { asNamespaceId } from '@internal/contract/types';
import { ok } from '@internal/utils/result';
import type { PromptSurface, StatementSurface } from '@prisma/cli-engine';
import { CliStructuredError } from '@prisma/cli-engine/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  accessChangeQuestion,
  askPlanQuestions,
  type PlannedQuestions,
} from '../../src/control-api/statements/plan-questions';
import { promptPlanQuestions } from '../../src/orm/plan-question-prompt';
import { contractOf } from '../control-api/statements/statement-fixtures';
import { question } from './fixtures/plan-question';

function given(flags: readonly { readonly verb: string; readonly text: string }[]) {
  let remaining = flags.map((flag) => ({ ...flag, values: [flag.text] }));
  const statements: StatementSurface = {
    take: vi.fn((verb: string) => {
      const taken = remaining.filter((value) => value.verb === verb);
      remaining = remaining.filter((value) => value.verb !== verb);
      return taken;
    }) as StatementSurface['take'],
    values: () => remaining,
  };
  return statements;
}

function shapeOf(error: unknown) {
  const { code, message, why, nextActions, meta } = error as CliStructuredError;
  return { code, message, why, nextActions, meta };
}

describe('a flag with a verb its subject does not take, beside the flag that settles it', () => {
  it('is refused before anything is asked, with the line it gets alone', async () => {
    const prompt = { statements: vi.fn(async () => []) } as unknown as PromptSurface;
    const statements = given([
      { verb: 'delete', text: 'Bug' },
      { verb: 'allow', text: 'Bug' },
    ]);

    const error = await promptPlanQuestions(
      prompt,
      statements,
    )([question('Bug')]).catch((caught: unknown) => caught);

    expect({
      asked: vi.mocked(prompt.statements).mock.calls.length,
      error: shapeOf(error),
    }).toEqual({
      asked: 0,
      error: {
        code: 'CLI.CONSENT_UNUSED',
        message: '--allow Bug does nothing in this change.',
        why: undefined,
        nextActions: [
          {
            kind: 'user-choice',
            label: 'Remove --allow Bug: this change does not change access to model "Bug".',
          },
        ],
        meta: { unused: [{ verb: 'allow', values: ['Bug'] }], asked: ['Bug'] },
      },
    });
  });

  it('gets one Remove line in a refusal, not also the line for a flag that names nothing', async () => {
    const legacy = question('Legacy', 'billing');
    const prompt = {
      statements: vi.fn(async () => {
        throw new CliStructuredError('CLI.CONSENT_REQUIRED', 'refused', {
          meta: {
            unanswered: [{ subject: 'Legacy', verbs: ['delete'] }],
            unmatched: [{ verb: 'allow', values: ['Legacy'] }],
          },
        });
      }),
    } as unknown as PromptSurface;

    const error = await promptPlanQuestions(
      prompt,
      given([{ verb: 'allow', text: 'Legacy' }]),
    )([legacy]).catch((caught: unknown) => caught);

    expect(shapeOf(error).nextActions?.map(({ label }) => label)).toEqual([
      'Remove --allow Legacy: this change does not change access to model "Legacy".',
      'If its data can go: --delete Legacy',
    ]);
  });
});

describe('a second --allow of one model through the control API', () => {
  it('is refused before answerQuestions is called, whatever else is open', async () => {
    const t = { kind: 'model', namespaceId: asNamespaceId('app'), model: 'T' } as const;
    const gone = { kind: 'model', namespaceId: asNamespaceId('app'), model: 'Gone' } as const;
    const plan: PlannedQuestions = {
      dataLoss: [{ operationIndex: 0, label: 'Drop table "Gone"', subject: gone, loss: 'drop' }],
      accessChanges: [
        { operationIndex: 1, label: 'Disable row-level security on "T"', subject: t, widens: true },
      ],
      temporaryValues: [],
    };
    const answer = vi.fn(async () => []);

    const result = await askPlanQuestions({
      plan,
      askAccess: true,
      canConvert: false,
      statements: [],
      preAnswers: [
        { verb: 'allow', text: 'T' },
        { verb: 'allow', text: 'T' },
      ],
      consentAll: { delete: false, allow: false },
      origin: contractOf({ app: { models: { T: {}, Gone: {} } } }),
      originKnown: true,
      destination: contractOf({ app: { models: { T: {} } } }),
      answer,
      replan: async () => ok(plan),
    });

    expect({
      called: answer.mock.calls.length,
      error: result.ok ? undefined : shapeOf(result.failure),
    }).toEqual({
      called: 0,
      error: {
        code: 'CLI.CONSENT_UNUSED',
        message: '--allow T is given twice, and one is enough.',
        why: undefined,
        nextActions: [{ kind: 'user-choice', label: 'Remove one --allow T.' }],
        meta: { unused: [{ verb: 'allow', values: ['T'] }], asked: ['Gone', 'T'] },
      },
    });
  });
});

describe('an access change in a list of several subjects', () => {
  it('names its model as a data change does', () => {
    const user = { kind: 'model', namespaceId: asNamespaceId('app'), model: 'User' } as const;
    const asked = accessChangeQuestion(
      [
        {
          operationIndex: 0,
          label: 'Disable row-level security on "user"',
          subject: user,
          widens: true,
        },
      ],
      { origin: contractOf({ app: { models: { User: {} } } }), statements: [] },
    );

    expect({
      subjectInList: asked.subjectInList,
      meaningNamingSubject: asked.answers.map(({ meaningNamingSubject }) => meaningNamingSubject),
    }).toEqual({
      subjectInList: 'model "User"',
      meaningNamingSubject: ['To allow the change to model "User"'],
    });
  });
});
