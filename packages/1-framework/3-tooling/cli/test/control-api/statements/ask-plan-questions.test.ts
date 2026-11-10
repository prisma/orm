import { asNamespaceId } from '@internal/contract/types';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
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
        asked.push(questions.map(({ question }) => question));
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
      ['Drop column "ratio" from "T" would lose the values of field "T.ratio".'],
      [
        'Alter type of "T"."ratio2" to int4 would change the type of field "T.ratio" and can change or lose its values.',
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
      plan: { dataLoss: [storage('Legacy', 0), storage('Profile', 1)], accessChanges: [] },
      askAccess: false,
      canConvert: true,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: false,
      destination,
      answer: async (questions) => {
        asked.push(...questions.map(({ question }) => question));
        return questions.map(({ subject }) => ({ verb: 'delete', text: subject }));
      },
      replan: async () => ok({ dataLoss: [], accessChanges: [] }),
    });

    expect(asked).toEqual([
      `Drop table Legacy would lose the data in "Legacy", named by its storage name because the origin contract is unknown; --delete loses that data.\n${ORIGIN_SNAPSHOT_RECOVERY}`,
      'Drop table Profile would lose the data in "Profile", named by its storage name because the origin contract is unknown; --delete loses that data.',
    ]);
    expect(ORIGIN_SNAPSHOT_RECOVERY.split('\n').map((line) => line.slice(0, 2))).toEqual([
      'If',
      '1.',
      '2.',
      '3.',
    ]);
    expect(ORIGIN_SNAPSHOT_RECOVERY).toContain('--dry-run');
    expect(ORIGIN_SNAPSHOT_RECOVERY).toContain('`prisma db update --advance-ref <name> --dry-run`');
    expect(ORIGIN_SNAPSHOT_RECOVERY).toContain(
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
      replan: async () => ok({ dataLoss: [], accessChanges: [] }),
    });

    expect(subjects).toEqual(['finance.Invoice.number', 'finance.Invoice']);
  });

  it('ask once per operation, and say a policy drop changes access where disabling row-level security widens it', async () => {
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
        asked.push(...questions.map(({ question }) => question));
        return questions.map(({ subject }) => ({ verb: 'allow', text: subject }));
      },
      replan: async () => ok({ dataLoss: [], accessChanges: [] }),
    });

    expect(asked).toEqual([
      'Drop RLS policy "readers" on "T" would change who can read and write its data.',
      'Disable row-level security on "T" would widen who can read and write its data.',
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
        asked.push(...questions.map(({ question }) => question));
        return questions.map(({ subject }) => ({ verb: 'allow', text: subject }));
      },
      replan: async () => ok({ dataLoss: [], accessChanges: [] }),
    });
    return { asked, result };
  };

  it('answer one operation each, in order, and leave the rest to be asked', async () => {
    const { asked, result } = ask([{ verb: 'allow', text: 'T' }]);

    expect((await result).ok).toBe(true);
    expect(asked).toEqual([
      'Disable row-level security on "T" would widen who can read and write its data.',
    ]);
  });

  it('answer every operation when there is one per operation', async () => {
    const { asked, result } = ask([
      { verb: 'allow', text: 'T' },
      { verb: 'allow', text: 'T' },
    ]);

    expect((await result).ok).toBe(true);
    expect(asked).toEqual([]);
  });

  it('refuse an allow left over once each operation has one', async () => {
    const { result } = ask([
      { verb: 'allow', text: 'T' },
      { verb: 'allow', text: 'T' },
      { verb: 'allow', text: 'T' },
    ]);

    const outcome = await result;
    expect(!outcome.ok && outcome.failure).toMatchObject({
      code: 'MIGRATION.STATEMENT_ANSWERS_NO_QUESTION',
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
        ok({ dataLoss: [], accessChanges: [{ ...policyDrop, operationIndex: 3 }] }),
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
    const { replans, result } = ask({ dataLoss: [], accessChanges: [] });

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
      replan: async () => ok({ dataLoss: [], accessChanges: [] }),
    });

    expect(result.ok && result.value.consented.map(({ verb, loss }) => ({ verb, loss }))).toEqual([
      { verb: 'delete', loss: 'typeChange' },
    ]);
  });
});
