import { asNamespaceId } from '@internal/contract/types';
import type { CliStructuredError } from '@internal/errors/control';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { questionText } from '../../../src/control-api/statements/plan-question-text';
import {
  askPlanQuestions,
  ORIGIN_SNAPSHOT_RECOVERY,
  type PlannedDataLoss,
  type PlannedQuestions,
  type PlannedSubject,
  type PlanQuestion,
} from '../../../src/control-api/statements/plan-questions';
import { contractOf } from './statement-fixtures';

const origin = contractOf({ app: { models: { T: { fields: ['id', 'ratio'] } } } });
const destination = contractOf({ app: { models: { T: { fields: ['id', 'ratio2'] } } } });
const ratio: PlannedSubject['subject'] = {
  kind: 'field',
  namespaceId: asNamespaceId('app'),
  model: 'T',
  field: 'ratio',
};

function planWith(
  ...losses: readonly {
    label: string;
    operationIndex: number;
    loss?: PlannedDataLoss['loss'];
  }[]
): PlannedQuestions {
  return {
    dataLoss: losses.map((loss) => ({ loss: 'drop', ...loss, subject: ratio })),
    accessChanges: [],
    temporaryValues: [],
  };
}

const dropRatio = { label: 'Drop column "ratio" from "T"', operationIndex: 1 };
const convertRatio = {
  label: 'Alter type of "T"."ratio2" to int4',
  operationIndex: 1,
  loss: 'typeChange',
} as const;

function run(replanned: PlannedQuestions, typed: readonly (readonly string[])[]) {
  const asked: (readonly string[])[] = [];
  let round = 0;
  return {
    asked,
    result: askPlanQuestions({
      plan: planWith(dropRatio),
      askAccess: false,
      canConvert: true,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination,
      answer: async (questions: readonly PlanQuestion[]) => {
        asked.push(questions.map((each) => questionText(each)));
        const answers = typed[round] ?? [];
        round += 1;
        return answers.map((answer) => {
          const [verb, text] = answer.split(' ');
          return { verb: verb === 'rename' ? 'rename' : 'delete', text: text ?? '' } as const;
        });
      },
      replan: async () => ok(replanned),
    }),
  };
}

describe('a rename typed at the prompt', () => {
  it('resolves its loss when the operation asked about is gone, and asks about a new loss on the same field', async () => {
    const { asked, result } = run(planWith(convertRatio), [
      ['rename T.ratio:T.ratio2'],
      ['delete T.ratio'],
    ]);

    expect((await result).ok).toBe(true);
    expect(asked).toEqual([
      [
        'Removing field "T.ratio" would delete its values.\nThe operation of the plan that does this: Drop column "ratio" from "T".\nrename keeps the values under the new name; delete lets them go.',
      ],
      [
        'Changing the type of field "T.ratio" can change or lose its values.\nThe operation of the plan that does this: Alter type of "T"."ratio2" to int4.\nconvert writes a conversion for you to fill in; delete lets the database cast the values, which can change or lose some.',
      ],
    ]);
  });

  it('fails when the operation asked about is still in the plan', async () => {
    const { result } = run(planWith(dropRatio), [['rename T.ratio:T.ratio2']]);

    const outcome = await result;
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.failure).toMatchObject({
      code: 'MIGRATION.STATEMENT_DID_NOT_RESOLVE_LOSS',
    });
  });
});

describe('questions about storage when the origin contract is unknown', () => {
  it('give the steps that store the snapshot once, on the first such question', async () => {
    const asked: string[] = [];
    const storage = (name: string, operationIndex: number) => ({
      operationIndex,
      label: `Drop table ${name}`,
      subject: { kind: 'storage', name } as const,
      loss: 'drop' as const,
    });
    await askPlanQuestions({
      plan: {
        dataLoss: [storage('Legacy', 0), storage('Profile', 1)],
        accessChanges: [],
        temporaryValues: [],
      },
      askAccess: false,
      canConvert: true,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: false,
      destination,
      answer: async (questions) => {
        asked.push(...questions.map((each) => questionText(each)));
        return questions.map(({ subject }) => ({ verb: 'delete', text: subject }));
      },
      replan: async () => ok({ dataLoss: [], accessChanges: [], temporaryValues: [] }),
    });

    expect(asked).toEqual([
      `This change would delete the data in "Legacy", named by its storage name because the contract before this change is not known.\nThe operation of the plan that does this: Drop table Legacy.\n${ORIGIN_SNAPSHOT_RECOVERY.join('\n')}\ndelete lets the data go.`,
      'This change would delete the data in "Profile", named by its storage name because the contract before this change is not known.\nThe operation of the plan that does this: Drop table Profile.\ndelete lets the data go.',
    ]);
    expect(ORIGIN_SNAPSHOT_RECOVERY.map((line) => line.slice(0, 2))).toEqual([
      'If',
      '1.',
      '2.',
      '3.',
    ]);
    expect(ORIGIN_SNAPSHOT_RECOVERY.join('\n')).toContain('--dry-run');
    expect(ORIGIN_SNAPSHOT_RECOVERY.join('\n')).toContain(
      '`{bin} db update --advance-ref <name> --dry-run`',
    );
    expect(ORIGIN_SNAPSHOT_RECOVERY.join('\n')).toContain(
      'with the same `--db` as this command if it has one',
    );
  });
});

describe('questions about access', () => {
  it('name a model the plan moves by its new name, as a field of it is named', async () => {
    const from = contractOf({
      billing: { models: { Invoice: { fields: ['id', 'number'] } } },
      app: { models: { User: {} } },
    });
    const to = contractOf({
      finance: { models: { Invoice: { fields: ['id'] } } },
      app: { models: { User: {} } },
    });
    const invoice = {
      kind: 'model',
      namespaceId: asNamespaceId('billing'),
      model: 'Invoice',
    } as const;
    const subjects: string[] = [];

    await askPlanQuestions({
      plan: {
        dataLoss: [
          {
            operationIndex: 1,
            label: 'Drop column "number" from "Invoice"',
            loss: 'drop',
            subject: { ...invoice, kind: 'field', field: 'number' },
          },
        ],
        accessChanges: [
          {
            operationIndex: 0,
            label: 'Drop RLS policy "r" on "Invoice"',
            subject: invoice,
            widens: false,
          },
        ],
        temporaryValues: [],
      },
      askAccess: true,
      canConvert: false,
      statements: [{ verb: 'rename', text: 'billing.Invoice:finance.Invoice' }],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin: from,
      originKnown: true,
      destination: to,
      answer: async (questions) => {
        subjects.push(...questions.map(({ subject }) => subject));
        return questions.map(({ subject, verbs }) => ({
          verb: verbs.includes('allow') ? 'allow' : 'delete',
          text: subject,
        }));
      },
      replan: async () => ok({ dataLoss: [], accessChanges: [], temporaryValues: [] }),
    });

    expect(subjects).toEqual(['finance.Invoice.number', 'finance.Invoice']);
  });

  it('ask once per model, and say access would widen when one of its operations widens it', async () => {
    const user = { kind: 'model', namespaceId: asNamespaceId('app'), model: 'T' } as const;
    const asked: string[] = [];
    const result = await askPlanQuestions({
      plan: {
        dataLoss: [],
        accessChanges: [
          {
            operationIndex: 0,
            label: 'Drop RLS policy "readers" on "T"',
            subject: user,
            widens: false,
          },
          {
            operationIndex: 1,
            label: 'Disable row-level security on "T"',
            subject: user,
            widens: true,
          },
        ],
        temporaryValues: [],
      },
      askAccess: true,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination,
      answer: async (questions) => {
        asked.push(...questions.map((each) => questionText(each)));
        return questions.map(({ subject }) => ({ verb: 'allow', text: subject }));
      },
      replan: async () => ok({ dataLoss: [], accessChanges: [], temporaryValues: [] }),
    });

    expect(asked).toEqual([
      'Access to the data of "T" would widen.\nThe operations of the plan that do this:\n- Drop RLS policy "readers" on "T"\n- Disable row-level security on "T"\nallow lets the plan make these changes.',
    ]);
    expect(
      result.ok &&
        result.value.consented.map(({ verb, text, operationIndex }) => ({
          verb,
          text,
          operationIndex,
        })),
    ).toEqual([
      { verb: 'allow', text: 'T', operationIndex: 0 },
      { verb: 'allow', text: 'T', operationIndex: 1 },
    ]);
  });
});

describe('allow statements given as pre-answers', () => {
  const t = { kind: 'model', namespaceId: asNamespaceId('app'), model: 'T' } as const;
  const plan = {
    dataLoss: [],
    accessChanges: [
      { operationIndex: 0, label: 'Drop RLS policy "readers" on "T"', subject: t, widens: false },
      { operationIndex: 1, label: 'Disable row-level security on "T"', subject: t, widens: true },
    ],
    temporaryValues: [],
  };
  const ask = (preAnswers: readonly { verb: 'allow'; text: string }[]) => {
    const asked: string[] = [];
    const result = askPlanQuestions({
      plan,
      askAccess: true,
      canConvert: false,
      statements: [],
      preAnswers,
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination,
      answer: async (questions) => {
        asked.push(...questions.map((each) => questionText(each)));
        return questions.map(({ subject }) => ({ verb: 'allow', text: subject }));
      },
      replan: async () => ok({ dataLoss: [], accessChanges: [], temporaryValues: [] }),
    });
    return { asked, result };
  };

  it('answer every access change of their model with one flag, each at its position', async () => {
    const { asked, result } = ask([{ verb: 'allow', text: 'T' }]);

    const outcome = await result;
    expect({
      asked,
      consented:
        outcome.ok &&
        outcome.value.consented.map(({ verb, text, operationIndex }) => ({
          verb,
          text,
          operationIndex,
        })),
    }).toEqual({
      asked: [],
      consented: [
        { verb: 'allow', text: 'T', operationIndex: 0 },
        { verb: 'allow', text: 'T', operationIndex: 1 },
      ],
    });
  });

  it('refuse a second allow of the same model, saying the first already allowed it', async () => {
    const { result } = ask([
      { verb: 'allow', text: 'T' },
      { verb: 'allow', text: 'T' },
    ]);

    const outcome = await result;
    const failure = !outcome.ok ? (outcome.failure as CliStructuredError) : undefined;
    expect({
      code: failure?.code,
      summary: failure?.message,
      why: failure?.why,
      nextActions: failure?.nextActions,
      meta: failure?.meta,
    }).toEqual({
      code: 'CLI.CONSENT_UNUSED',
      summary: '--allow T was given, but the question about T was already answered by --allow T.',
      why: 'The run asked about T.',
      nextActions: [{ kind: 'user-choice', label: 'Give one flag per question.' }],
      meta: { unused: [{ verb: 'allow', values: ['T'] }], asked: ['T'] },
    });
  });
});

describe('an access change consented before a typed rename', () => {
  it('is asked once, and reported at its position in the new plan', async () => {
    const t = { kind: 'model', namespaceId: asNamespaceId('app'), model: 'T' } as const;
    const policyDrop = { label: 'Drop RLS policy "readers" on "T"', subject: t, widens: false };
    let rounds = 0;
    const result = await askPlanQuestions({
      plan: {
        dataLoss: [{ ...dropRatio, operationIndex: 0, subject: ratio, loss: 'drop' }],
        accessChanges: [{ ...policyDrop, operationIndex: 1 }],
        temporaryValues: [],
      },
      askAccess: true,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination,
      answer: async (questions) => {
        rounds += 1;
        return questions.map(({ subject, verbs }) =>
          verbs.includes('allow')
            ? { verb: 'allow', text: subject }
            : { verb: 'rename', text: 'T.ratio:T.ratio2' },
        );
      },
      replan: async () =>
        ok({
          dataLoss: [],
          accessChanges: [{ ...policyDrop, operationIndex: 3 }],
          temporaryValues: [],
        }),
    });

    expect(rounds).toBe(1);
    expect(
      result.ok &&
        result.value.consented.map(({ verb, operationIndex }) => ({ verb, operationIndex })),
    ).toEqual([{ verb: 'allow', operationIndex: 3 }]);
  });
});

describe('a convert typed at the prompt', () => {
  const typed = {
    label: 'Alter type of "T"."ratio" to int4',
    operationIndex: 0,
    loss: 'typeChange',
  } as const;
  const typedOrigin = contractOf({
    app: { models: { T: { fields: ['id', 'ratio'] } } },
  });
  const typedDestination = contractOf({
    app: {
      models: { T: { fields: ['id', 'ratio'], fieldTypes: { ratio: { codecId: 'test/int@1' } } } },
    },
  });

  function ask(replanned: PlannedQuestions) {
    const replans: (readonly unknown[])[] = [];
    const result = askPlanQuestions({
      plan: planWith(typed),
      askAccess: false,
      canConvert: true,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin: typedOrigin,
      originKnown: true,
      destination: typedDestination,
      answer: async (questions) =>
        questions.map(() => ({ verb: 'convert', text: 'T.ratio' }) as const),
      replan: async (statements) => {
        replans.push(statements);
        return ok(replanned);
      },
    });
    return { replans, result };
  }

  it('plans again with the convert, and returns it among the statements', async () => {
    const { replans, result } = ask({ dataLoss: [], accessChanges: [], temporaryValues: [] });

    const outcome = await result;
    expect({ replans, statements: outcome.ok && outcome.value.statements }).toEqual({
      replans: [[{ verb: 'convert', text: 'T.ratio' }]],
      statements: [{ verb: 'convert', text: 'T.ratio' }],
    });
  });

  it('fails when the type change it answered is still in the plan', async () => {
    const outcome = await ask(planWith(typed)).result;

    expect(!outcome.ok && outcome.failure).toMatchObject({
      code: 'MIGRATION.STATEMENT_DID_NOT_RESOLVE_LOSS',
      message: '"--convert T.ratio" does not keep the data of "T.ratio"',
    });
  });
});

describe('a delete that answers a type change', () => {
  it('is recorded as answering a type change', async () => {
    const result = await askPlanQuestions({
      plan: planWith(convertRatio),
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [{ verb: 'delete', text: 'T.ratio' }],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination,
      answer: async () => [],
      replan: async () => ok({ dataLoss: [], accessChanges: [], temporaryValues: [] }),
    });

    expect(result.ok && result.value.consented.map(({ verb, loss }) => ({ verb, loss }))).toEqual([
      { verb: 'delete', loss: 'typeChange' },
    ]);
  });
});

describe('consentAll', () => {
  it('asks nothing, and tells the answerer which subjects it answered without asking', async () => {
    const calls: unknown[][] = [];
    const result = await askPlanQuestions({
      plan: planWith(dropRatio),
      askAccess: true,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: true, allow: false },
      origin,
      originKnown: true,
      destination,
      answer: async (...args) => {
        calls.push(args);
        return [];
      },
      replan: async () => ok(planWith()),
    });

    expect({ ok: result.ok, calls }).toEqual({
      ok: true,
      calls: [[[], [{ verb: 'delete', subject: 'T.ratio' }]]],
    });
  });
});
