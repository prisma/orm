import { asNamespaceId } from '@internal/contract/types';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import {
  askPlanQuestions,
  ORIGIN_SNAPSHOT_RECOVERY,
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
  ...losses: readonly { label: string; operationIndex: number }[]
): PlannedQuestions {
  return {
    dataLoss: losses.map((loss) => ({ ...loss, subject: ratio })),
    accessWidening: [],
  };
}

const dropRatio = { label: 'Drop column "ratio" from "T"', operationIndex: 1 };
const convertRatio = { label: 'Alter type of "T"."ratio2" to int4', operationIndex: 1 };

function run(replanned: PlannedQuestions, typed: readonly (readonly string[])[]) {
  const asked: (readonly string[])[] = [];
  let round = 0;
  return {
    asked,
    result: askPlanQuestions({
      plan: planWith(dropRatio),
      askAccess: false,
      renames: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      keepDataByHand: undefined,
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
      ['Alter type of "T"."ratio2" to int4 would lose the values of field "T.ratio".'],
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
    });
    await askPlanQuestions({
      plan: { dataLoss: [storage('Legacy', 0), storage('Profile', 1)], accessWidening: [] },
      askAccess: false,
      renames: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: false,
      keepDataByHand: undefined,
      destination,
      answer: async (questions) => {
        asked.push(...questions.map(({ question }) => question));
        return questions.map(({ subject }) => ({ verb: 'delete', text: subject }));
      },
      replan: async () => ok({ dataLoss: [], accessWidening: [] }),
    });

    expect(asked).toEqual([
      `Drop table Legacy would lose the data in "Legacy", named by its storage name because the origin contract is unknown; --delete loses its rows. ${ORIGIN_SNAPSHOT_RECOVERY}`,
      'Drop table Profile would lose the data in "Profile", named by its storage name because the origin contract is unknown; --delete loses its rows.',
    ]);
    expect(ORIGIN_SNAPSHOT_RECOVERY).toContain('--dry-run');
    expect(ORIGIN_SNAPSHOT_RECOVERY).toContain('`prisma db update --advance-ref <name> --dry-run`');
    expect(ORIGIN_SNAPSHOT_RECOVERY).toContain(
      'with the same `--db` as this command if it has one',
    );
  });
});

describe('questions about access', () => {
  it('ask once per operation, and say a policy drop changes access where disabling row-level security widens it', async () => {
    const user = { kind: 'model', namespaceId: asNamespaceId('app'), model: 'T' } as const;
    const asked: string[] = [];
    const result = await askPlanQuestions({
      plan: {
        dataLoss: [],
        accessWidening: [
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
      renames: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      keepDataByHand: undefined,
      destination,
      answer: async (questions) => {
        asked.push(...questions.map(({ question }) => question));
        return questions.map(({ subject }) => ({ verb: 'allow', text: subject }));
      },
      replan: async () => ok({ dataLoss: [], accessWidening: [] }),
    });

    expect(asked).toEqual([
      'Drop RLS policy "readers" on "T" would change who can read and write its rows.',
      'Disable row-level security on "T" would widen who can read and write its rows.',
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
    accessWidening: [
      { operationIndex: 0, label: 'Drop RLS policy "readers" on "T"', subject: t, widens: false },
      { operationIndex: 1, label: 'Disable row-level security on "T"', subject: t, widens: true },
    ],
  };
  const ask = (preAnswers: readonly { verb: 'allow'; text: string }[]) => {
    const asked: string[] = [];
    const result = askPlanQuestions({
      plan,
      askAccess: true,
      renames: [],
      preAnswers,
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      keepDataByHand: undefined,
      destination,
      answer: async (questions) => {
        asked.push(...questions.map(({ question }) => question));
        return questions.map(({ subject }) => ({ verb: 'allow', text: subject }));
      },
      replan: async () => ok({ dataLoss: [], accessWidening: [] }),
    });
    return { asked, result };
  };

  it('answer one operation each, in order, and leave the rest to be asked', async () => {
    const { asked, result } = ask([{ verb: 'allow', text: 'T' }]);

    expect((await result).ok).toBe(true);
    expect(asked).toEqual([
      'Disable row-level security on "T" would widen who can read and write its rows.',
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
        dataLoss: [{ ...dropRatio, operationIndex: 0, subject: ratio }],
        accessWidening: [{ ...policyDrop, operationIndex: 1 }],
      },
      askAccess: true,
      renames: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      keepDataByHand: undefined,
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
        ok({ dataLoss: [], accessWidening: [{ ...policyDrop, operationIndex: 3 }] }),
    });

    expect(rounds).toBe(1);
    expect(
      result.ok &&
        result.value.consented.map(({ verb, operationIndex }) => ({ verb, operationIndex })),
    ).toEqual([{ verb: 'allow', operationIndex: 3 }]);
  });
});

describe('questions about storage on a target that carries out no rename', () => {
  it('say how to keep the data by hand, without the steps that make a rename possible', async () => {
    const asked: string[] = [];
    await askPlanQuestions({
      plan: {
        dataLoss: [
          {
            operationIndex: 0,
            label: 'Drop collection events',
            subject: { kind: 'storage', name: 'events' },
          },
        ],
        accessWidening: [],
      },
      askAccess: false,
      renames: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: false,
      keepDataByHand: () => 'Rename the collection by hand first.',
      destination,
      answer: async (questions) => {
        asked.push(...questions.map(({ question }) => question));
        return questions.map(({ subject }) => ({ verb: 'delete', text: subject }));
      },
      replan: async () => ok({ dataLoss: [], accessWidening: [] }),
    });

    expect(asked).toEqual([
      'Drop collection events would lose the data in "events", named by its storage name because the origin contract is unknown; --delete loses its rows. Rename the collection by hand first.',
    ]);
  });
});
