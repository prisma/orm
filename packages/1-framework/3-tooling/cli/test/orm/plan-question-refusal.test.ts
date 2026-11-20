import { asNamespaceId } from '@internal/contract/types';
import { InternalError } from '@internal/utils/internal-error';
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
      why: 'The operation of the plan that does this: Drop Status.DONE.',
      nextActions: [
        { kind: 'user-choice', label: way },
        { kind: 'user-choice', label: 'If its data can go: --delete Status.DONE' },
      ],
      meta,
    });
  });

  it('lists what several open questions would do, opens each paragraph of why with its headline, and names each subject in its answers', async () => {
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
      message: 'This change would lose data: model "Bug", model "Task".',
      why: [
        'Removing model "Bug" would delete its data.',
        'The operation of the plan that does this: Drop Bug.',
        '',
        'Removing model "Task" would delete its data.',
        'The operation of the plan that does this: Drop Task.',
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
      why: 'The operation of the plan that does this: Drop Task.',
      nextActions: [{ kind: 'user-choice', label: 'If its data can go: --delete Task' }],
      meta,
    });
  });
});

describe('a refusal about access changes', () => {
  const userAccess = (operationIndex: number, label: string) => ({
    operationIndex,
    label,
    widens: true,
    subject: { kind: 'model', namespaceId: asNamespaceId('app'), model: 'User' } as const,
  });
  const contracts = { origin: contractOf({ app: { models: { User: {} } } }), statements: [] };

  it('gives one --allow for every access change of a model', async () => {
    const meta = { unanswered: [{ subject: 'User', verbs: ['allow'] }] };

    const error = await refusing(
      meta,
      'refused, which --yes cannot give',
    )([
      accessChangeQuestion(
        [
          userAccess(0, 'Disable row-level security on "user"'),
          userAccess(1, 'Drop policy "readers" on "user"'),
        ],
        contracts,
      ),
    ]).catch((caught: unknown) => caught);

    expect(refusalOf(error)).toEqual({
      code: 'CLI.CONSENT_REQUIRED',
      message: 'Access to the data of "User" would widen.',
      why: [
        'The operations of the plan that do this:',
        '- Disable row-level security on "user"',
        '- Drop policy "readers" on "user"',
        '',
        '--yes does not allow this: it would change who can read and write data.',
      ].join('\n'),
      nextActions: [{ kind: 'user-choice', label: 'To allow both changes: --allow User' }],
      meta,
    });
  });

  it('says data would be lost and access would change when both are open', async () => {
    const meta = {
      unanswered: [
        { subject: 'Bug', verbs: ['delete'] },
        { subject: 'User', verbs: ['allow'] },
      ],
    };

    const error = await refusing(meta)([
      question('Bug'),
      accessChangeQuestion([userAccess(1, 'Disable row-level security on "user"')], contracts),
    ]).catch((caught: unknown) => caught);

    expect(refusalOf(error)).toEqual({
      code: 'CLI.CONSENT_REQUIRED',
      message: 'This change would lose data and change access: model "Bug", "User".',
      why: [
        'Removing model "Bug" would delete its data.',
        'The operation of the plan that does this: Drop Bug.',
        '',
        'Access to the data of "User" would widen.',
        'The operation of the plan that does this: Disable row-level security on "user".',
      ].join('\n'),
      nextActions: [
        { kind: 'user-choice', label: 'If the data of model "Bug" can go: --delete Bug' },
        { kind: 'user-choice', label: 'To allow the change to "User": --allow User' },
      ],
      meta,
    });
  });

  it('describes the question still open when another question has the same subject', async () => {
    const meta = { unanswered: [{ subject: 'User', verbs: ['delete'] }] };

    const error = await refusing(meta)([
      question('User'),
      accessChangeQuestion([userAccess(1, 'Disable row-level security on "user"')], contracts),
    ]).catch((caught: unknown) => caught);

    expect(refusalOf(error)).toEqual({
      code: 'CLI.CONSENT_REQUIRED',
      message: 'Removing model "User" would delete its data.',
      why: 'The operation of the plan that does this: Drop User.',
      nextActions: [{ kind: 'user-choice', label: 'If its data can go: --delete User' }],
      meta,
    });
  });

  it('fails as a defect when the engine lists a question the CLI did not ask', async () => {
    const meta = { unanswered: [{ subject: 'Nope', verbs: ['delete'] }] };

    const error = await refusing(meta)([question('Bug')]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InternalError);
  });
});
