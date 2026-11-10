import { asNamespaceId } from '@internal/contract/types';
import { ok } from '@internal/utils/result';
import type { PromptSurface, StatementSurface } from '@prisma/cli-engine';
import { describe, expect, it, vi } from 'vitest';
import {
  askPlanQuestions,
  type PlannedQuestions,
  refuseUnusedConsents,
} from '../../../src/control-api/statements/plan-questions';
import { promptPlanQuestions } from '../../../src/orm/plan-question-prompt';
import { contractOf } from './statement-fixtures';

const origin = contractOf({
  app: { models: { User: {} } },
  billing: { models: { Invoice: {}, Receipt: {} } },
});
const destination = contractOf({ app: { models: { User: {} } } });

const dropModel = (model: string, operationIndex: number) => ({
  operationIndex,
  label: `Drop table "${model.toLowerCase()}"`,
  loss: 'drop' as const,
  subject: { kind: 'model' as const, namespaceId: asNamespaceId('billing'), model },
});

const plan: PlannedQuestions = {
  dataLoss: [dropModel('Invoice', 0), dropModel('Receipt', 1)],
  accessChanges: [],
  namespaces: { removed: ['billing'], added: [] },
};

function ask(preAnswers: readonly { verb: 'delete'; text: string }[]) {
  const asked: string[] = [];
  return {
    asked,
    result: askPlanQuestions({
      plan,
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers,
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination,
      answer: async (questions) => {
        asked.push(...questions.map(({ subject }) => subject));
        return questions.map(({ subject }) => ({ verb: 'delete', text: subject }));
      },
      replan: async () => ok(plan),
    }),
  };
}

describe('--delete with a namespace of the origin contract', () => {
  it('answers the question about every model of the namespace, each reported by its model', async () => {
    const { asked, result } = ask([{ verb: 'delete', text: 'billing' }]);

    const outcome = await result;
    expect(asked).toEqual([]);
    expect(
      outcome.ok && outcome.value.consented.map(({ verb, text }) => `${verb} ${text}`),
    ).toEqual(['delete billing.Invoice', 'delete billing.Receipt']);
  });

  it('is refused as unused when no question is about the namespace', async () => {
    const { result } = ask([{ verb: 'delete', text: 'ledger' }]);

    const outcome = await result;
    expect(!outcome.ok && outcome.failure).toMatchObject({
      code: 'MIGRATION.STATEMENT_ANSWERS_NO_QUESTION',
    });
  });

  it('counts as used on a dry run', () => {
    expect(
      refuseUnusedConsents({
        plan,
        statements: [{ verb: 'delete', text: 'billing' }],
        contracts: { origin, destination, statements: [] },
      }).ok,
    ).toBe(true);
  });

  it('says once, on the first question about the removed namespace, that --delete of it answers them all', async () => {
    const questions: string[] = [];
    await askPlanQuestions({
      plan,
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination,
      answer: async (batch) => {
        questions.push(...batch.map(({ question }) => question));
        return batch.map(({ subject }) => ({ verb: 'delete', text: subject }));
      },
      replan: async () => ok(plan),
    });

    expect(questions).toEqual([
      'Drop table "invoice" would lose the data of model "billing.Invoice".\n--delete billing answers this question and every other about a model or field of namespace "billing", which the destination contract no longer has.',
      'Drop table "receipt" would lose the data of model "billing.Receipt".',
    ]);
  });

  async function firstQuestion(
    to: ReturnType<typeof contractOf>,
    added: readonly string[],
  ): Promise<string | undefined> {
    const questions: string[] = [];
    const withAdded = { ...plan, namespaces: { removed: ['billing'], added } };
    await askPlanQuestions({
      plan: withAdded,
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination: to,
      answer: async (batch) => {
        questions.push(...batch.map(({ question }) => question));
        return batch.map(({ subject }) => ({ verb: 'delete', text: subject }));
      },
      replan: async () => ok(withAdded),
    });
    return questions[0];
  }

  it('offers a rename to the one namespace the destination adds', async () => {
    const renamed = contractOf({
      app: { models: { User: {} } },
      finance: { models: { Invoice: {}, Receipt: {} } },
    });

    expect(await firstQuestion(renamed, ['finance'])).toBe(
      'Drop table "invoice" would lose the data of model "billing.Invoice".\n--delete billing answers this question and every other about a model or field of namespace "billing", which the destination contract no longer has.\nIf namespace "billing" was renamed, --rename billing:finance renames it instead.',
    );
  });

  it('offers a rename to each namespace the destination adds when it adds several', async () => {
    const renamed = contractOf({
      app: { models: { User: {} } },
      finance: { models: { Invoice: {} } },
      ledger: { models: { Receipt: {} } },
    });

    expect(await firstQuestion(renamed, ['finance', 'ledger'])).toBe(
      'Drop table "invoice" would lose the data of model "billing.Invoice".\n--delete billing answers this question and every other about a model or field of namespace "billing", which the destination contract no longer has.\nIf namespace "billing" was renamed, --rename billing:<new namespace> renames it instead, where <new namespace> is finance or ledger.',
    );
  });

  it('does not answer a question about a namespace the destination still has', async () => {
    const kept = contractOf({
      app: { models: { User: { fields: ['id'] } } },
      billing: { models: { Invoice: {}, Receipt: {} } },
    });
    const nickname = {
      operationIndex: 0,
      label: 'Drop column "nickname" from "User"',
      loss: 'drop' as const,
      subject: {
        kind: 'field' as const,
        namespaceId: asNamespaceId('app'),
        model: 'User',
        field: 'nickname',
      },
    };
    const keptPlan: PlannedQuestions = { dataLoss: [nickname], accessChanges: [] };
    const asked: string[] = [];

    const outcome = await askPlanQuestions({
      plan: keptPlan,
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [{ verb: 'delete', text: 'app' }],
      consentAll: { delete: false, allow: false },
      origin: contractOf({
        app: { models: { User: { fields: ['id', 'nickname'] } } },
        billing: { models: { Invoice: {}, Receipt: {} } },
      }),
      originKnown: true,
      destination: kept,
      answer: async (questions) => {
        asked.push(...questions.map(({ subject }) => subject));
        return questions.map(({ subject }) => ({ verb: 'delete', text: subject }));
      },
      replan: async () => ok(keptPlan),
    });

    expect(asked).toEqual(['app.User.nickname']);
    expect(!outcome.ok && outcome.failure).toMatchObject({
      code: 'MIGRATION.STATEMENT_ANSWERS_NO_QUESTION',
    });
  });
});

describe('a namespace answer typed at the prompt', () => {
  const finance = contractOf({
    app: { models: { User: {} } },
    finance: { models: { Invoice: {}, Receipt: {} } },
  });

  it('accepts delete of the removed namespace for each of its questions', async () => {
    const outcome = await askPlanQuestions({
      plan,
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination,
      answer: async (batch) => {
        for (const question of batch)
          expect(question.validate('delete', 'billing')).toBeUndefined();
        return batch.map(() => ({ verb: 'delete', text: 'billing' }));
      },
      replan: async () => ok(plan),
    });

    expect(
      outcome.ok && outcome.value.consented.map(({ verb, text }) => `${verb} ${text}`),
    ).toEqual(['delete billing.Invoice', 'delete billing.Receipt']);
  });

  it('accepts a rename of the removed namespace, and plans it once', async () => {
    const replanned: (readonly string[])[] = [];
    const outcome = await askPlanQuestions({
      plan,
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination: finance,
      answer: async (batch) => {
        for (const question of batch) {
          expect(question.validate('rename', 'billing:finance')).toBeUndefined();
        }
        return batch.map(() => ({ verb: 'rename', text: 'billing:finance' }));
      },
      replan: async (statements) => {
        replanned.push(statements.map(({ verb, text }) => `${verb} ${text}`));
        return ok({ dataLoss: [], accessChanges: [] });
      },
    });

    expect(outcome.ok).toBe(true);
    expect(replanned).toEqual([['rename billing:finance']]);
  });
});

describe('a namespace rename answered at one question', () => {
  const renamedWithBill = contractOf({
    app: { models: { User: {} } },
    finance: { models: { Bill: {}, Receipt: {} } },
  });

  it('plans the rename, then asks again about a model of the namespace that changed its name', async () => {
    const replanned: string[][] = [];
    const rounds: string[][] = [];
    const left: PlannedQuestions = {
      dataLoss: [dropModel('Invoice', 0)],
      accessChanges: [],
      namespaces: { removed: ['billing'], added: ['finance'] },
    };
    const outcome = await askPlanQuestions({
      plan,
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination: renamedWithBill,
      answer: async (batch) => {
        rounds.push(batch.map(({ subject }) => subject));
        return batch.map(({ subject }) =>
          subject === 'billing.Receipt'
            ? { verb: 'rename', text: 'billing:finance' }
            : rounds.length === 1
              ? undefined
              : { verb: 'rename', text: 'billing.Invoice:finance.Bill' },
        );
      },
      replan: async (statements) => {
        replanned.push(statements.map(({ text }) => text));
        return ok(statements.length === 1 ? left : { dataLoss: [], accessChanges: [] });
      },
    });

    expect(outcome.ok).toBe(true);
    expect(rounds).toEqual([['billing.Invoice', 'billing.Receipt'], ['billing.Invoice']]);
    expect(replanned).toEqual([
      ['billing:finance'],
      ['billing:finance', 'billing.Invoice:finance.Bill'],
    ]);
  });
});

describe('a field of a model in a namespace the run renames', () => {
  it('is named through the new namespace, and may be renamed there', async () => {
    const from = contractOf({
      app: { models: { User: {} } },
      billing: { models: { Invoice: { fields: ['id', 'note'] } } },
    });
    const to = contractOf({
      app: { models: { User: {} } },
      finance: { models: { Invoice: { fields: ['id', 'memo'] } } },
    });
    const dropNote = {
      operationIndex: 0,
      label: 'Drop column "note" from "Invoice"',
      loss: 'drop' as const,
      subject: {
        kind: 'field' as const,
        namespaceId: asNamespaceId('billing'),
        model: 'Invoice',
        field: 'note',
      },
    };
    const notePlan: PlannedQuestions = { dataLoss: [dropNote], accessChanges: [] };
    const asked: { subject: string; verbs: readonly string[]; renames: string | undefined }[] = [];

    await askPlanQuestions({
      plan: notePlan,
      askAccess: false,
      canConvert: false,
      statements: [{ verb: 'rename', text: 'billing:finance' }],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin: from,
      originKnown: true,
      destination: to,
      answer: async (batch) => {
        asked.push(
          ...batch.map((question) => ({
            subject: question.subject,
            verbs: question.verbs,
            renames: question.validate('rename', 'finance.Invoice.note:finance.Invoice.memo'),
          })),
        );
        return batch.map(({ subject }) => ({ verb: 'delete', text: subject }));
      },
      replan: async () => ok(notePlan),
    });

    expect(asked).toEqual([
      { subject: 'finance.Invoice.note', verbs: ['rename', 'delete'], renames: undefined },
    ]);
  });
});

describe('a --delete of a subject beside a --delete of its namespace', () => {
  const flags = [
    { verb: 'delete' as const, text: 'billing' },
    { verb: 'delete' as const, text: 'billing.Invoice' },
  ];

  it('when the subject flag answered every question of the namespace, is refused the same way by a dry run and by an apply', async () => {
    const onlyInvoice: PlannedQuestions = {
      dataLoss: [dropModel('Invoice', 0)],
      accessChanges: [],
      namespaces: { removed: ['billing'], added: [] },
    };
    const dryRun = refuseUnusedConsents({
      plan: onlyInvoice,
      statements: flags,
      contracts: { origin, destination, statements: [] },
    });
    let remaining = flags.map(({ verb, text }) => ({ verb, text, values: [text] }));
    const statements: StatementSurface = {
      take: vi.fn((verb: string) => {
        const taken = remaining.filter((value) => value.verb === verb);
        remaining = remaining.filter((value) => value.verb !== verb);
        return taken;
      }) as StatementSurface['take'],
      values: () => remaining,
    };
    const prompt = { statements: vi.fn(async () => []) } as unknown as PromptSurface;
    const apply = askPlanQuestions({
      plan: onlyInvoice,
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination,
      answer: promptPlanQuestions(prompt, statements),
      replan: async () => ok(onlyInvoice),
    });

    const refusal = {
      code: 'CLI.CONSENT_UNUSED',
      message:
        '--delete billing was given, but every question about namespace "billing" was already answered by another flag.',
    };
    expect(!dryRun.ok && dryRun.failure).toMatchObject(refusal);
    await expect(apply).rejects.toMatchObject(refusal);
  });
});

describe('the namespaces the planner reports', () => {
  it('decide which namespace a question belongs to, not the contracts', async () => {
    const notRemoved: PlannedQuestions = {
      dataLoss: [dropModel('Invoice', 0), dropModel('Receipt', 1)],
      accessChanges: [],
      namespaces: { removed: [], added: [] },
    };
    const questions: string[] = [];

    const outcome = await askPlanQuestions({
      plan: notRemoved,
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [{ verb: 'delete', text: 'billing' }],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination,
      answer: async (batch) => {
        questions.push(...batch.map(({ question }) => question));
        return batch.map(({ subject }) => ({ verb: 'delete', text: subject }));
      },
      replan: async () => ok(notRemoved),
    });

    expect(questions.join('\n')).not.toContain('--delete billing answers');
    expect(!outcome.ok && outcome.failure).toMatchObject({
      code: 'MIGRATION.STATEMENT_ANSWERS_NO_QUESTION',
    });
  });
});
