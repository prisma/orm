import { asNamespaceId } from '@internal/contract/types';
import { ok } from '@internal/utils/result';
import type { PromptSurface, StatementSurface } from '@prisma/cli-engine';
import { describe, expect, it, vi } from 'vitest';
import {
  askPlanQuestions,
  type PlannedQuestions,
} from '../../src/control-api/statements/plan-questions';
import { promptPlanQuestions } from '../../src/orm/plan-question-prompt';
import { askedAbout, textsOf } from '../control-api/statements/plan-question-fixtures';
import { contractOf } from '../control-api/statements/statement-fixtures';

const billing = asNamespaceId('billing');
const hierarchy = {
  models: {
    Task: { fields: ['id', 'type'], discriminator: 'type', variants: { bug: 'Bug' } },
    Bug: { fields: ['id', 'severity'], base: 'Task' },
  },
};
const origin = contractOf({ public: { models: {} }, billing: hierarchy });
const destination = contractOf({ public: { models: {} }, finance: hierarchy });
const namespaces = { removed: ['billing'], added: ['finance'] };
const ON_ITS_OWN =
  'Model "billing.Bug" cannot be renamed on its own: it is a variant of model "billing.Task", which this change removes too, and its rows are rows of model "billing.Task", so they are kept or deleted with them.';
const NAMESPACE_LINES = [
  'If the data of everything in namespace "billing" can go: --delete billing',
  'If namespace "billing" was renamed to "finance", keep its data: --rename billing:finance',
];
const BUG_DELETE = 'If the data of model "billing.Bug" can go: --delete billing.Bug';
const TASK_LINES = [
  'If model "billing.Task" was renamed to "finance.Task", keep its data: --rename billing.Task:finance.Task',
  'If the data of model "billing.Task" can go: --delete billing.Task',
];
const headline = (model: string) =>
  `This change would delete the data of model "billing.${model}".`;
const DROP = 'The operation of the plan that does this: Drop table "billing"."task".';
const FACT = 'The contract no longer has namespace "billing".';
const loss = (model: string) =>
  ({
    label: 'Drop table "billing"."task"',
    subject: { kind: 'model', namespaceId: billing, model },
  }) as const;
const plan = (...models: readonly string[]): PlannedQuestions => ({
  dataLoss: models.map((model) => ({ operationIndex: 0, loss: 'drop', ...loss(model) })),
  accessChanges: [],
  temporaryValues: [],
  namespaces,
});

describe('a variant stored in its base table, in a namespace the change removes with its base', () => {
  it('takes the rename of its namespace from an answerQuestions callback, and plans again with it', async () => {
    const replans: unknown[] = [];
    const result = await askPlanQuestions({
      plan: plan('Bug', 'Task'),
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination,
      answer: async (questions) =>
        questions.map(({ subject }) =>
          subject === 'billing.Bug' ? { verb: 'rename', text: 'billing:finance' } : undefined,
        ),
      replan: async (statements) => {
        replans.push(statements);
        return ok({ dataLoss: [], accessChanges: [], temporaryValues: [] });
      },
    });

    expect({ ok: result.ok, replans }).toEqual({
      ok: true,
      replans: [[{ verb: 'rename', text: 'billing:finance' }]],
    });
  });

  it('gives the lines of its namespace in the refusal whichever question comes first', async () => {
    const refusals = await Promise.all(
      [
        ['Bug', 'Task'],
        ['Task', 'Bug'],
      ].map(async (order) => {
        const asked = await askedAbout({
          origin,
          destination,
          losses: order.map(loss),
          namespaces,
        });
        return { verbs: asked.map(({ verbs }) => verbs), refusal: textsOf(asked).refusal };
      }),
    );

    expect(refusals).toEqual([
      {
        verbs: [
          ['rename', 'delete'],
          ['rename', 'delete'],
        ],
        refusal: {
          summary: 'This change would lose data: model "billing.Bug", model "billing.Task".',
          why: `${headline('Bug')}\n${FACT}\n${DROP}\n\n${headline('Task')}\n${DROP}`,
          nextActions: [ON_ITS_OWN, ...NAMESPACE_LINES, BUG_DELETE, ...TASK_LINES],
        },
      },
      {
        verbs: [
          ['rename', 'delete'],
          ['rename', 'delete'],
        ],
        refusal: {
          summary: 'This change would lose data: model "billing.Task", model "billing.Bug".',
          why: `${headline('Task')}\n${FACT}\n${DROP}\n\n${headline('Bug')}\n${DROP}`,
          nextActions: [ON_ITS_OWN, ...NAMESPACE_LINES, ...TASK_LINES, BUG_DELETE],
        },
      },
    ]);
  });

  it('is asked at the prompt with the rename of its namespace, which it takes', async () => {
    const asked: unknown[] = [];
    const statements: StatementSurface = {
      take: vi.fn(() => []) as StatementSurface['take'],
      values: () => [],
    };
    const prompt = {
      statements: vi.fn(
        async (
          questions: readonly {
            readonly question: string;
            readonly verbs: readonly string[];
            readonly forms: unknown;
            readonly validate: (verb: 'rename', text: string) => string | undefined;
          }[],
        ) => {
          asked.push(
            ...questions.map(({ question, verbs, forms, validate }) => ({
              question,
              verbs,
              forms,
              typed: validate('rename', 'billing:finance'),
            })),
          );
          return questions.map(() => ({ verb: 'rename', text: 'billing:finance', values: [] }));
        },
      ),
    } as unknown as PromptSurface;
    const [bug] = await askedAbout({ origin, destination, losses: [loss('Bug')], namespaces });

    const answers = await promptPlanQuestions(prompt, statements)(bug === undefined ? [] : [bug]);

    expect({ asked, answers }).toEqual({
      asked: [
        {
          question: [
            headline('Bug'),
            FACT,
            DROP,
            ON_ITS_OWN,
            'delete billing lets the data of every model and field of namespace "billing" go; rename billing:finance keeps the data of namespace "billing" under namespace "finance"; delete lets its data go.',
          ].join('\n'),
          verbs: ['rename', 'delete'],
          forms: { rename: 'billing:finance' },
          typed: undefined,
        },
      ],
      answers: [{ verb: 'rename', text: 'billing:finance' }],
    });
  });
});
