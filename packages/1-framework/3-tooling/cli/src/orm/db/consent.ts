import { CliStructuredError } from '@prisma/cli-engine/protocol';
import type { DestructivePlanOperation } from '../../control-api/types';

/**
 * A token nobody can type is not consent: an empty one makes the engine's
 * type-to-confirm accept a bare Enter, and `--confirm ""` grant outright.
 */
export function errorConsentTokenUnresolved(targetId: string): CliStructuredError {
  return new CliStructuredError(
    'CLI.CONSENT_TOKEN_UNRESOLVED',
    'The database this run would change has no name to confirm.',
    {
      why: `The connected database reports no name, and the target id "${targetId}" yields none either, so the consent prompt has nothing to ask you to type and the destructive operations cannot be authorised.`,
      nextActions: [
        {
          kind: 'user-choice',
          label:
            'Name the database in `db.connection` (or pass `--db <url>`) and run `{bin} db update` again.',
        },
      ],
    },
  );
}

/** A prompt that names nothing cannot be consented to knowingly. */
export function errorConsentOperationsMissing(): CliStructuredError {
  return new CliStructuredError(
    'CLI.CONSENT_OPERATIONS_MISSING',
    'The plan was refused as destructive but named no operations to confirm.',
    {
      why: 'The consent prompt has to list what is about to be destroyed, and the refusal carried no operations to list.',
      nextActions: [
        {
          kind: 'run-command',
          label: 'Preview the plan',
          command: '{bin} db update --dry-run',
        },
      ],
    },
  );
}

/** The question the user answers before anything is dropped. */
export function destructiveConsentQuestion(
  operations: readonly DestructivePlanOperation[],
  token: string,
): string {
  const listed = operations.map((operation) => `  - ${operation.label}`).join('\n');
  return [
    `Apply ${operations.length} destructive operation(s) to ${token}? Data they remove cannot be recovered:`,
    listed,
  ].join('\n');
}
