import { asNamespaceId } from '@internal/contract/types';
import type { PromptSurface, StatementSurface } from '@prisma/cli-engine';
import { CliStructuredError } from '@prisma/cli-engine/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  accessChangeQuestion,
  planQuestion,
} from '../../src/control-api/statements/plan-questions';
import { promptPlanQuestions } from '../../src/orm/plan-question-prompt';
import { contractOf } from '../control-api/statements/statement-fixtures';
import { question } from './fixtures/plan-question';

function refusing(meta: Record<string, unknown>, summary = 'refused') {
  const prompt = {
    statements: vi.fn(async () => {
      throw new CliStructuredError('CLI.CONSENT_REQUIRED', summary, {
        why: 'the engine says why',
        nextActions: [{ kind: 'user-choice', label: 'the engine says what to run' }],
        meta,
      });
    }),
  } as unknown as PromptSurface;
  const statements: StatementSurface = {
    take: vi.fn(() => []) as StatementSurface['take'],
    values: () => [],
  };
  return promptPlanQuestions(prompt, statements);
}

function refusalOf(error: unknown) {
  const { code, message, why, nextActions, meta } = error as CliStructuredError;
  return { code, message, why, nextActions, meta };
}

describe('a refusal to answer', () => {
  it('leads its next actions with the ways to keep the data, and leaves them out of why', async () => {
    const way = 'To keep it, plan the change with `prisma migration plan`.';
    const kept = planQuestion({ ...question('Status.DONE'), keepDataWays: [way] });
    const meta = { unanswered: [{ subject: 'Status.DONE', verbs: ['delete'] }] };

    const error = await refusing(meta)([kept]).catch((caught: unknown) => caught);

    expect(refusalOf(error)).toEqual({
      code: 'CLI.CONSENT_REQUIRED',
      message: 'Removing model "Status.DONE" would delete its data.',
      why: 'The plan would run: Drop Status.DONE.',
      nextActions: [
        { kind: 'user-choice', label: way },
        { kind: 'user-choice', label: 'If its data can go: --delete Status.DONE' },
      ],
      meta,
    });
  });

  it('counts several open questions, opens each paragraph of why with its headline, and names each subject in its answers', async () => {
    const meta = {
      unanswered: [
        { subject: 'Bug', verbs: ['delete'] },
        { subject: 'Task', verbs: ['delete'] },
      ],
    };

    const error = await refusing(meta)([question('Bug'), question('Task')]).catch(
      (caught: unknown) => caught,
    );

    expect(refusalOf(error)).toEqual({
      code: 'CLI.CONSENT_REQUIRED',
      message: 'This change needs 2 answers: "Bug", "Task".',
      why: [
        'Removing model "Bug" would delete its data.',
        'The plan would run: Drop Bug.',
        'Removing model "Task" would delete its data.',
        'The plan would run: Drop Task.',
      ].join('\n'),
      nextActions: [
        { kind: 'user-choice', label: 'If the data of model "Bug" can go: --delete Bug' },
        { kind: 'user-choice', label: 'If the data of model "Task" can go: --delete Task' },
      ],
      meta,
    });
  });

  it('leaves out the questions the flags answered', async () => {
    const meta = { unanswered: [{ subject: 'Task', verbs: ['delete'] }] };

    const error = await refusing(meta)([question('Bug'), question('Task')]).catch(
      (caught: unknown) => caught,
    );

    expect(refusalOf(error)).toEqual({
      code: 'CLI.CONSENT_REQUIRED',
      message: 'Removing model "Task" would delete its data.',
      why: 'The plan would run: Drop Task.',
      nextActions: [{ kind: 'user-choice', label: 'If its data can go: --delete Task' }],
      meta,
    });
  });
});

describe('a refusal to answer two access changes of one model', () => {
  const access = (label: string) =>
    accessChangeQuestion(
      {
        operationIndex: 0,
        label,
        widens: true,
        subject: { kind: 'model', namespaceId: asNamespaceId('app'), model: 'User' },
      },
      { origin: contractOf({ app: { models: { User: {} } } }), statements: [] },
    );

  it('gives the --allow once per change, in one next action', async () => {
    const meta = {
      unanswered: [
        { subject: 'User', verbs: ['allow'] },
        { subject: 'User', verbs: ['allow'] },
      ],
    };

    const error = await refusing(
      meta,
      'refused, which --yes cannot give',
    )([
      access('Disable row-level security on "user"'),
      access('Drop policy "readers" on "user"'),
    ]).catch((caught: unknown) => caught);

    expect(refusalOf(error)).toEqual({
      code: 'CLI.CONSENT_REQUIRED',
      message: 'This change needs 2 answers about "User".',
      why: [
        'This change would widen who can read and write the data of "User".',
        'The plan would run: Disable row-level security on "user".',
        'This change would widen who can read and write the data of "User".',
        'The plan would run: Drop policy "readers" on "user".',
        '--yes does not answer this: it would change access.',
      ].join('\n'),
      nextActions: [
        {
          kind: 'user-choice',
          label: 'To allow both changes to "User", one flag each: --allow User --allow User',
        },
      ],
      meta,
    });
  });

  it('names only the change still open when a flag answered the other', async () => {
    const meta = { unanswered: [{ subject: 'User', verbs: ['allow'] }] };

    const error = await refusing(meta)([
      access('Disable row-level security on "user"'),
      access('Drop policy "readers" on "user"'),
    ]).catch((caught: unknown) => caught);

    expect(refusalOf(error)).toEqual({
      code: 'CLI.CONSENT_REQUIRED',
      meta,
      message: 'This change would widen who can read and write the data of "User".',
      why: 'The plan would run: Drop policy "readers" on "user".',
      nextActions: [{ kind: 'user-choice', label: 'To allow it: --allow User' }],
    });
  });
});
