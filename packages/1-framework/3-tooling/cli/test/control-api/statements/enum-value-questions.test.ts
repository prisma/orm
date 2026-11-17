import { asNamespaceId } from '@internal/contract/types';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import {
  askPlanQuestions,
  consentDescription,
  type PlannedQuestions,
  type PlanQuestion,
} from '../../../src/control-api/statements/plan-questions';
import { contractOf } from './statement-fixtures';

const origin = contractOf({
  app: { models: { Task: { fields: ['status'] } }, enums: { Status: ['OPEN', 'ARCHIVED'] } },
});
const destination = contractOf({
  app: { models: { Task: { fields: ['status'] } }, enums: { Status: ['OPEN', 'RETIRED'] } },
});
const archived = {
  kind: 'enumValue',
  namespaceId: asNamespaceId('app'),
  enum: 'Status',
  member: 'ARCHIVED',
} as const;
const plan: PlannedQuestions = {
  dataLoss: [
    {
      operationIndex: 0,
      label: 'Change values in "Task"."status"',
      loss: 'drop',
      subject: archived,
    },
  ],
  accessChanges: [],
  temporaryValues: [],
};

async function questionsOf(statements: readonly { verb: 'rename'; text: string }[] = []) {
  const asked: PlanQuestion[] = [];
  await askPlanQuestions({
    plan,
    askAccess: false,
    canConvert: false,
    statements,
    preAnswers: [],
    consentAll: { delete: false, allow: false },
    origin,
    originKnown: true,
    destination,
    answer: async (batch) => {
      asked.push(...batch);
      return batch.map(({ subject }) => ({ verb: 'delete', text: subject }));
    },
    replan: async () => ok({ dataLoss: [], accessChanges: [], temporaryValues: [] }),
  });
  return asked;
}

describe('a question about an enum value', () => {
  it('names the value through its enum, and offers to rename it to the one new member, or delete it', async () => {
    const [question] = await questionsOf();

    expect(question).toMatchObject({
      subject: 'Status.ARCHIVED',
      question:
        'Change values in "Task"."status" would lose enum value "Status.ARCHIVED" from the data that holds it.',
      verbs: ['rename', 'delete'],
      forms: { rename: 'Status.ARCHIVED:Status.RETIRED' },
    });
    expect(question?.validate('delete', 'Status.ARCHIVED')).toBeUndefined();
    expect(question?.validate('rename', 'Status.ARCHIVED:Status.RETIRED')).toBeUndefined();
  });

  it('asks once about a value that several columns and paths inside JSON lose, and names every operation', async () => {
    const asked: PlanQuestion[] = [];
    await askPlanQuestions({
      plan: {
        dataLoss: [
          {
            operationIndex: 0,
            label: 'Remove value "archived" from column "status" of "task"',
            loss: 'drop',
            subject: archived,
          },
          {
            operationIndex: 1,
            label: 'Remove value "archived" from column "tags" of "note"',
            loss: 'drop',
            subject: archived,
          },
          {
            operationIndex: 2,
            label:
              'Remove value "archived" at path "$[*].meta.status" in column "visits" of "ticket"',
            loss: 'drop',
            subject: archived,
          },
        ],
        accessChanges: [],
        temporaryValues: [],
      },
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination,
      answer: async (batch) => {
        asked.push(...batch);
        return batch.map(({ subject }) => ({ verb: 'delete', text: subject }));
      },
      replan: async () => ok({ dataLoss: [], accessChanges: [], temporaryValues: [] }),
    });

    expect(asked.map(({ subject, question }) => ({ subject, question }))).toEqual([
      {
        subject: 'Status.ARCHIVED',
        question:
          'These operations would lose enum value "Status.ARCHIVED" from the data that holds it:\n- Remove value "archived" from column "status" of "task"\n- Remove value "archived" from column "tags" of "note"\n- Remove value "archived" at path "$[*].meta.status" in column "visits" of "ticket"',
      },
    ]);
  });

  it('offers only delete for a value whose member keeps its name, with one advice that covers every column', async () => {
    const changed = contractOf({
      app: { models: { Task: { fields: ['status'] } }, enums: { Status: ['OPEN', 'ARCHIVED'] } },
    });
    const edit = (column: string) => ({
      remove: `this.removeStoredValue({ column: "${column}" })`,
      replaceWith: `this.replaceStoredValue({ column: "${column}" })`,
    });
    const asked: PlanQuestion[] = [];
    await askPlanQuestions({
      plan: {
        dataLoss: [
          {
            operationIndex: 0,
            label: 'Remove value "archived"',
            loss: 'drop',
            subject: archived,
            keepDataEdit: edit('status'),
          },
          {
            operationIndex: 1,
            label: 'Remove value "archived"',
            loss: 'drop',
            subject: archived,
            keepDataEdit: edit('tags'),
          },
        ],
        accessChanges: [],
        temporaryValues: [],
      },
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination: changed,
      keepDataEditAdvice: ({ text: subject }, edits) => ({
        lead: 'Delete loses it.',
        ways: [
          `Keep ${subject}: ${edits.map(({ remove, replaceWith }) => `${remove} -> ${replaceWith}`).join('; ')}.`,
        ],
      }),
      answer: async (batch) => {
        asked.push(...batch);
        return batch.map(({ subject }) => ({ verb: 'delete', text: subject }));
      },
      replan: async () => ok({ dataLoss: [], accessChanges: [], temporaryValues: [] }),
    });

    expect(asked).toMatchObject([
      {
        verbs: ['delete'],
        question:
          'Remove value "archived" would lose enum value "Status.ARCHIVED" from the data that holds it. Delete loses it. Keep Status.ARCHIVED: this.removeStoredValue({ column: "status" }) -> this.replaceStoredValue({ column: "status" }); this.removeStoredValue({ column: "tags" }) -> this.replaceStoredValue({ column: "tags" }).',
        keepDataWays: [
          'Keep Status.ARCHIVED: this.removeStoredValue({ column: "status" }) -> this.replaceStoredValue({ column: "status" }); this.removeStoredValue({ column: "tags" }) -> this.replaceStoredValue({ column: "tags" }).',
        ],
      },
    ]);
  });

  it('asks the command how to keep the data of every member that keeps its name, with or without an edit, naming them in question order', async () => {
    const withOld = contractOf({
      app: {
        models: { Task: { fields: ['status'] } },
        enums: { Status: ['OPEN', 'ARCHIVED', 'OLD'] },
      },
    });
    const kept = contractOf({
      app: {
        models: { Task: { fields: ['status'] } },
        enums: { Status: ['OPEN', 'ARCHIVED', 'RETIRED'] },
      },
    });
    const member = (name: string) => ({ ...archived, member: name });
    const asked: PlanQuestion[] = [];
    await askPlanQuestions({
      plan: {
        dataLoss: [
          { operationIndex: 0, label: 'Remove value "archived"', loss: 'drop', subject: archived },
          {
            operationIndex: 1,
            label: 'Remove value "open"',
            loss: 'drop',
            subject: member('OPEN'),
            keepDataEdit: { remove: 'remove open', replaceWith: 'replace open' },
          },
          { operationIndex: 2, label: 'Remove value "old"', loss: 'drop', subject: member('OLD') },
        ],
        accessChanges: [],
        temporaryValues: [],
      },
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin: withOld,
      originKnown: true,
      destination: kept,
      keepDataEditAdvice: ({ text: subject }, edits, subjects) => ({
        lead: undefined,
        ways: [
          `Keep ${subject} with ${edits.length} edits among ${subjects.map(({ text }) => text).join(', ')}.`,
        ],
      }),
      answer: async (batch) => {
        asked.push(...batch);
        return batch.map(({ subject }) => ({ verb: 'delete', text: subject }));
      },
      replan: async () => ok({ dataLoss: [], accessChanges: [], temporaryValues: [] }),
    });

    expect(asked.map(({ subject, keepDataWays }) => ({ subject, keepDataWays }))).toEqual([
      {
        subject: 'Status.ARCHIVED',
        keepDataWays: ['Keep Status.ARCHIVED with 0 edits among Status.ARCHIVED, Status.OPEN.'],
      },
      {
        subject: 'Status.OPEN',
        keepDataWays: ['Keep Status.OPEN with 1 edits among Status.ARCHIVED, Status.OPEN.'],
      },
      { subject: 'Status.OLD', keepDataWays: undefined },
    ]);
  });

  it('is described as an enum value when answered', () => {
    expect(consentDescription('delete', archived, 'Status.ARCHIVED', 'drop')).toBe(
      'delete enum value "Status.ARCHIVED"',
    );
  });

  it('names a value of an enum in a renamed namespace through the new namespace, with a rename that resolves', async () => {
    const billing = contractOf({
      app: { models: { Task: {} } },
      billing: { enums: { Status: ['OPEN', 'ARCHIVED'] } },
    });
    const finance = contractOf({
      app: { models: { Task: {} } },
      finance: { enums: { Status: ['OPEN', 'RETIRED'] } },
    });
    const subject = { ...archived, namespaceId: asNamespaceId('billing') };
    const asked: PlanQuestion[] = [];

    await askPlanQuestions({
      plan: {
        dataLoss: [{ operationIndex: 0, label: 'Change values', loss: 'drop', subject }],
        accessChanges: [],
        temporaryValues: [],
      },
      askAccess: false,
      canConvert: false,
      statements: [{ verb: 'rename', text: 'billing:finance' }],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin: billing,
      originKnown: true,
      destination: finance,
      answer: async (batch) => {
        asked.push(...batch);
        return batch.map(({ subject: text }) => ({ verb: 'delete', text }));
      },
      replan: async () => ok({ dataLoss: [], accessChanges: [], temporaryValues: [] }),
    });

    expect(asked[0]).toMatchObject({
      subject: 'finance.Status.ARCHIVED',
      forms: { rename: 'finance.Status.ARCHIVED:finance.Status.RETIRED' },
    });
    expect(
      asked[0]?.validate('rename', 'finance.Status.ARCHIVED:finance.Status.RETIRED'),
    ).toBeUndefined();
  });
});

describe("an enum member's planner advice beside the command's own route", () => {
  const withValues = (members: Readonly<Record<string, string>>) => {
    const contract = contractOf({
      app: { models: { Task: { fields: ['status'] } }, enums: { Status: Object.keys(members) } },
    });
    const app = contract.domain.namespaces['app'];
    const status = app?.enum?.['Status'];
    if (app === undefined || status === undefined) throw new Error('Expected enum Status');
    return {
      ...contract,
      domain: {
        ...contract.domain,
        namespaces: {
          app: {
            ...app,
            enum: {
              Status: {
                ...status,
                members: Object.entries(members).map(([name, value]) => ({ name, value })),
              },
            },
          },
        },
      },
    };
  };
  const member = (name: string) => ({ ...archived, member: name });
  const BEFORE = withValues({ ACTIVE: 'active', ARCHIVED: 'archived' });

  async function waysOf(
    destination: ReturnType<typeof withValues>,
    members: readonly string[],
    commandWays: readonly string[],
  ) {
    const asked: PlanQuestion[] = [];
    await askPlanQuestions({
      plan: {
        dataLoss: members.map((name, index) => ({
          operationIndex: index,
          label: `Remove value of ${name}`,
          loss: 'drop' as const,
          subject: member(name),
          keepDataAdvice: `Planner advice for ${name}.`,
        })),
        accessChanges: [],
        temporaryValues: [],
      },
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin: BEFORE,
      originKnown: true,
      destination,
      keepDataEditAdvice: () => ({ lead: undefined, ways: commandWays }),
      answer: async (batch) => {
        asked.push(...batch);
        return batch.map(({ subject }) => ({ verb: 'delete', text: subject }));
      },
      replan: async () => ok({ dataLoss: [], accessChanges: [], temporaryValues: [] }),
    });
    return asked.map(({ subject, question }) => ({
      subject,
      planner: question.includes('Planner advice'),
    }));
  }

  it('leaves out the planner advice for members that swap stored values when the command gives its own route', async () => {
    const swapped = withValues({ ACTIVE: 'archived', ARCHIVED: 'active' });
    expect({
      commandRoute: await waysOf(swapped, ['ACTIVE', 'ARCHIVED'], ['Two runs.']),
      noCommandRoute: await waysOf(swapped, ['ACTIVE', 'ARCHIVED'], []),
    }).toEqual({
      commandRoute: [
        { subject: 'Status.ACTIVE', planner: false },
        { subject: 'Status.ARCHIVED', planner: false },
      ],
      noCommandRoute: [
        { subject: 'Status.ACTIVE', planner: true },
        { subject: 'Status.ARCHIVED', planner: true },
      ],
    });
  });

  it('keeps the planner advice for a member that takes the stored value of a member the destination no longer has', async () => {
    expect(
      await waysOf(
        withValues({ ACTIVE: 'archived', RETIRED: 'retired' }),
        ['ACTIVE'],
        ['Two runs.'],
      ),
    ).toEqual([{ subject: 'Status.ACTIVE', planner: true }]);
  });
});
