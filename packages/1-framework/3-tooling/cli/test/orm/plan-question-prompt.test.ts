import { asNamespaceId } from '@internal/contract/types';
import { ok } from '@internal/utils/result';
import type { PromptSurface, StatementSurface } from '@prisma/cli-engine';
import { CliStructuredError } from '@prisma/cli-engine/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  askPlanQuestions,
  type PlannedQuestions,
  type PlanQuestion,
} from '../../src/control-api/statements/plan-questions';
import { promptPlanQuestions } from '../../src/orm/plan-question-prompt';
import { contractOf } from '../control-api/statements/statement-fixtures';

function question(subject: string, namespace?: string): PlanQuestion {
  return {
    question: `Drop ${subject}?`,
    subject,
    ...(namespace === undefined
      ? {}
      : {
          removedNamespace: namespace,
          namespaceAnswer: (verb: string, text: string) =>
            verb === 'delete' && text === namespace
              ? ('delete' as const)
              : verb === 'rename' && text.startsWith(`${namespace}:`)
                ? ('rename' as const)
                : undefined,
        }),
    verbs: ['delete'],
    forms: {},
    validate: () => undefined,
  };
}

function surfaces(deletes: readonly string[]) {
  let remaining = deletes.map((text) => ({ verb: 'delete', text, values: [text] }));
  const statements: StatementSurface = {
    take: vi.fn((verb: string) => {
      const taken = remaining.filter((value) => value.verb === verb);
      remaining = remaining.filter((value) => value.verb !== verb);
      return taken;
    }) as StatementSurface['take'],
    values: () => remaining,
  };
  const asked: string[][] = [];
  const prompt = {
    statements: vi.fn(async (questions: readonly { readonly subject: string }[]) => {
      asked.push(questions.map(({ subject }) => subject));
      return questions.map(({ subject }) => ({ verb: 'delete', text: subject, values: [subject] }));
    }),
  } as unknown as PromptSurface;
  return { statements, prompt, asked };
}

const invoice = question('billing.Invoice', 'billing');
const receipt = question('billing.Receipt', 'billing');
const user = question('app.User', 'app');

describe('a plan question asked through the engine', () => {
  it('answers every question of a namespace a --delete names, and asks the engine the rest', async () => {
    const { statements, prompt, asked } = surfaces(['billing']);

    const answers = await promptPlanQuestions(prompt, statements)([invoice, user, receipt]);

    expect(answers).toEqual([
      { verb: 'delete', text: 'billing.Invoice' },
      { verb: 'delete', text: 'app.User' },
      { verb: 'delete', text: 'billing.Receipt' },
    ]);
    expect(asked).toEqual([['app.User'], []]);
  });

  it('answers a --delete of a subject given beside a namespace --delete', async () => {
    const { statements, prompt, asked } = surfaces(['billing', 'app.User']);

    const answers = await promptPlanQuestions(prompt, statements)([invoice, user]);

    expect(answers.map((answer) => answer?.text)).toEqual(['billing.Invoice', 'app.User']);
    expect(asked).toEqual([[]]);
  });

  it('leaves every --delete to the engine when none names a namespace of the questions', async () => {
    const { statements, prompt, asked } = surfaces(['billing.Invoice']);

    await promptPlanQuestions(prompt, statements)([invoice, user]);

    expect(statements.take).not.toHaveBeenCalled();
    expect(asked).toEqual([['billing.Invoice'], ['app.User'], []]);
  });

  it('refuses a --delete that answers nothing beside a namespace --delete, as the engine refuses an unused flag', async () => {
    const { statements, prompt } = surfaces(['billing', 'nope']);

    await expect(promptPlanQuestions(prompt, statements)([invoice])).rejects.toMatchObject({
      code: 'CLI.CONSENT_UNUSED',
      message: '--delete nope was given but nothing in this run asked about nope.',
      why: 'The run asked about billing.Invoice.',
      meta: { unused: [{ verb: 'delete', values: ['nope'] }], asked: ['billing.Invoice'] },
    });
  });

  it('answers a subject --delete and the namespace --delete beside it the same way in either order', async () => {
    for (const order of [
      ['billing', 'billing.Invoice'],
      ['billing.Invoice', 'billing'],
    ]) {
      const { statements, prompt } = surfaces(order);

      const answers = await promptPlanQuestions(prompt, statements)([invoice, receipt]);

      expect(answers.map((answer) => answer?.text)).toEqual(['billing.Invoice', 'billing.Receipt']);
    }
  });

  it('says a namespace --delete answered nothing new when other flags answered every question of it', async () => {
    const { statements, prompt } = surfaces(['billing.Invoice', 'billing']);

    await expect(promptPlanQuestions(prompt, statements)([invoice])).rejects.toMatchObject({
      code: 'CLI.CONSENT_UNUSED',
      message:
        '--delete billing was given, but every question about namespace "billing" was already answered by another flag.',
      nextActions: [{ kind: 'user-choice', label: 'Give one flag per question.' }],
    });
  });
});

describe('a namespace answer typed at the prompt', () => {
  function typing(answerFor: (subject: string) => { verb: string; text: string }) {
    const asked: string[][] = [];
    const statements: StatementSurface = {
      take: vi.fn(() => []) as StatementSurface['take'],
      values: () => [],
    };
    const prompt = {
      statements: vi.fn(async (questions: readonly { readonly subject: string }[]) => {
        asked.push(questions.map(({ subject }) => subject));
        return questions.map(({ subject }) => ({ ...answerFor(subject), values: [] }));
      }),
    } as unknown as PromptSurface;
    return { statements, prompt, asked };
  }

  it('answers the rest of the namespace with a delete of it, without asking them', async () => {
    const { statements, prompt, asked } = typing((subject) =>
      subject === 'billing.Invoice'
        ? { verb: 'delete', text: 'billing' }
        : { verb: 'delete', text: subject },
    );

    const answers = await promptPlanQuestions(prompt, statements)([invoice, user, receipt]);

    expect(answers).toEqual([
      { verb: 'delete', text: 'billing' },
      { verb: 'delete', text: 'app.User' },
      { verb: 'delete', text: 'billing' },
    ]);
    expect(asked).toEqual([['billing.Invoice'], ['app.User'], []]);
  });

  it('answers only the question a namespace rename was typed at, and leaves the rest of the namespace open', async () => {
    const { statements, prompt, asked } = typing(() => ({
      verb: 'rename',
      text: 'billing:finance',
    }));

    const answers = await promptPlanQuestions(prompt, statements)([invoice, receipt]);

    expect(answers).toEqual([{ verb: 'rename', text: 'billing:finance' }, undefined]);
    expect(asked).toEqual([['billing.Invoice'], []]);
  });

  it('lets the engine refuse every question still unanswered at once when nobody can answer', async () => {
    const asked: string[][] = [];
    const statements: StatementSurface = {
      take: vi.fn(() => []) as StatementSurface['take'],
      values: () => [],
    };
    const prompt = {
      statements: vi.fn(async (questions: readonly { readonly subject: string }[]) => {
        asked.push(questions.map(({ subject }) => subject));
        throw Object.assign(new Error('needs a statement'), {
          code: 'CLI.CONSENT_REQUIRED',
          unanswered: questions.map(({ subject }) => subject),
        });
      }),
    } as unknown as PromptSurface;

    await expect(
      promptPlanQuestions(prompt, statements)([invoice, user, receipt]),
    ).rejects.toMatchObject({
      code: 'CLI.CONSENT_REQUIRED',
      unanswered: ['billing.Invoice', 'app.User', 'billing.Receipt'],
    });
    expect(asked).toEqual([
      ['billing.Invoice'],
      ['billing.Invoice', 'app.User', 'billing.Receipt'],
    ]);
  });
});

describe("whether a typed answer is the namespace's own", () => {
  it('is what the question says, not what the text looks like', async () => {
    const notTheNamespace = (subject: string): PlanQuestion => ({
      ...question(subject, 'billing'),
      verbs: ['rename', 'delete'],
      namespaceAnswer: () => undefined,
    });
    const asked: string[][] = [];
    const statements: StatementSurface = {
      take: vi.fn(() => []) as StatementSurface['take'],
      values: () => [],
    };
    const prompt = {
      statements: vi.fn(async (questions: readonly { readonly subject: string }[]) => {
        asked.push(questions.map(({ subject }) => subject));
        return questions.map(() => ({ verb: 'rename', text: 'billing:finance', values: [] }));
      }),
    } as unknown as PromptSurface;

    await promptPlanQuestions(
      prompt,
      statements,
    )([notTheNamespace('billing.Invoice'), notTheNamespace('billing.Receipt')]);

    expect(asked).toEqual([['billing.Invoice'], ['billing.Receipt'], []]);
  });
});

describe('a namespace rename typed at the prompt, then planned again', () => {
  const billing = asNamespaceId('billing');
  const origin = contractOf({
    app: { models: { User: {} } },
    billing: { models: { Receipt: {}, Invoice: { fields: ['id', 'note'] } } },
  });
  const destination = contractOf({
    app: { models: { User: {} } },
    finance: { models: { Receipt: {}, Invoice: { fields: ['id', 'note'] } } },
  });
  const dropReceipt = {
    operationIndex: 0,
    label: 'Drop table "Receipt"',
    loss: 'drop' as const,
    subject: { kind: 'model' as const, namespaceId: billing, model: 'Receipt' },
  };
  const retypeNote = {
    operationIndex: 1,
    label: 'Alter type of "Invoice"."note" to int4',
    loss: 'typeChange' as const,
    subject: { kind: 'field' as const, namespaceId: billing, model: 'Invoice', field: 'note' },
  };

  it('asks the questions the rename leaves, and never answers a question with a verb it does not accept', async () => {
    const asked: string[] = [];
    const prompt = {
      statements: vi.fn(
        async (
          questions: readonly { readonly subject: string; readonly verbs: readonly string[] }[],
        ) => {
          asked.push(...questions.map(({ subject }) => subject));
          return questions.map(({ subject }) =>
            subject === 'billing.Receipt'
              ? { verb: 'rename', text: 'billing:finance', values: [] }
              : { verb: 'delete', text: subject, values: [] },
          );
        },
      ),
    } as unknown as PromptSurface;
    const statements: StatementSurface = {
      take: vi.fn(() => []) as StatementSurface['take'],
      values: () => [],
    };
    const namespaces = { removed: ['billing'], added: ['finance'] };
    const first: PlannedQuestions = {
      dataLoss: [dropReceipt, retypeNote],
      accessChanges: [],
      namespaces,
    };
    const second: PlannedQuestions = {
      dataLoss: [retypeNote],
      accessChanges: [],
      namespaces: { removed: [], added: [] },
    };

    const outcome = await askPlanQuestions({
      plan: first,
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      destination,
      answer: promptPlanQuestions(prompt, statements),
      replan: async (planned) => ok(planned.length === 0 ? first : second),
    });

    expect(outcome.ok && outcome.value.statements).toEqual([
      { verb: 'rename', text: 'billing:finance' },
    ]);
    expect(outcome.ok && outcome.value.consented.map(({ text }) => text)).toEqual([
      'finance.Invoice.note',
    ]);
    expect(asked).toEqual(['billing.Receipt', 'finance.Invoice.note']);
  });

  it('asks again about a model of the namespace that also changed its name', async () => {
    const renamedOrigin = contractOf({
      app: { models: { User: {} } },
      billing: { models: { Invoice: {}, Receipt: {} } },
    });
    const renamedDestination = contractOf({
      app: { models: { User: {} } },
      finance: { models: { Bill: {}, Receipt: {} } },
    });
    const drop = (model: string, operationIndex: number) => ({
      operationIndex,
      label: `Drop table "${model}"`,
      loss: 'drop' as const,
      subject: { kind: 'model' as const, namespaceId: billing, model },
    });
    const first: PlannedQuestions = {
      dataLoss: [drop('Invoice', 0), drop('Receipt', 1)],
      accessChanges: [],
      namespaces: { removed: ['billing'], added: ['finance'] },
    };
    const asked: string[] = [];
    const prompt = {
      statements: vi.fn(async (questions: readonly { readonly subject: string }[]) => {
        asked.push(...questions.map(({ subject }) => subject));
        return questions.map(() =>
          asked.length === 1
            ? { verb: 'rename', text: 'billing:finance', values: [] }
            : { verb: 'rename', text: 'billing.Invoice:finance.Bill', values: [] },
        );
      }),
    } as unknown as PromptSurface;
    const statements: StatementSurface = {
      take: vi.fn(() => []) as StatementSurface['take'],
      values: () => [],
    };

    const outcome = await askPlanQuestions({
      plan: first,
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin: renamedOrigin,
      originKnown: true,
      destination: renamedDestination,
      answer: promptPlanQuestions(prompt, statements),
      replan: async (planned) =>
        ok(
          planned.length === 1
            ? { dataLoss: [drop('Invoice', 0)], accessChanges: [] }
            : { dataLoss: [], accessChanges: [] },
        ),
    });

    expect(outcome.ok && outcome.value.statements.map(({ text }) => text)).toEqual([
      'billing:finance',
      'billing.Invoice:finance.Bill',
    ]);
    expect(asked).toEqual(['billing.Invoice', 'billing.Invoice']);
  });
});

describe('a refusal to answer a question that names ways to keep the data', () => {
  it('leads its next actions with those ways, and names them once', async () => {
    const way = 'To keep it, plan the change with `prisma migration plan`.';
    const kept: PlanQuestion = {
      ...question('Status.DONE'),
      question: `Remove value "done" would lose enum value "Status.DONE". ${way}`,
      keepDataWays: [way],
    };
    const prompt = {
      statements: vi.fn(async () => {
        throw new CliStructuredError('CLI.CONSENT_REQUIRED', '"Status.DONE" needs a statement.', {
          why: kept.question,
          nextActions: [
            { kind: 'user-choice', label: 'Run the command again with --delete Status.DONE' },
          ],
          meta: { unanswered: [{ subject: 'Status.DONE', verbs: ['delete'] }] },
        });
      }),
    } as unknown as PromptSurface;
    const statements: StatementSurface = {
      take: vi.fn(() => []) as StatementSurface['take'],
      values: () => [],
    };

    await expect(promptPlanQuestions(prompt, statements)([kept])).rejects.toMatchObject({
      code: 'CLI.CONSENT_REQUIRED',
      message: '"Status.DONE" needs a statement.',
      why: 'Remove value "done" would lose enum value "Status.DONE".',
      nextActions: [
        { kind: 'user-choice', label: way },
        { kind: 'user-choice', label: 'Run the command again with --delete Status.DONE' },
      ],
      meta: { unanswered: [{ subject: 'Status.DONE', verbs: ['delete'] }] },
    });
  });
});
