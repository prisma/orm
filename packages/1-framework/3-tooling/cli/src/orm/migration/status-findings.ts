import { ifDefined } from '@internal/utils/defined';
import type { Diagnostic } from '@prisma/cli-engine/protocol';
import type { StatusDiagnosticJson } from '../../commands/json/schemas';
import { runCommandAction } from '../../utils/next-actions';

/**
 * One condition `migration status` found while still delivering its full
 * answer. Each is recorded twice: in the `--json` document's `diagnostics`
 * array, whose shape is the published contract, and as an engine diagnostic on
 * the completed envelope.
 *
 * All three are `warn` — the run answered the question the user asked and
 * flags something to look at. That is also what keeps exit 0 legal: the engine
 * refuses a severity-`error` diagnostic on a run that exits 0.
 */
export interface StatusFinding {
  readonly document: StatusDiagnosticJson;
  readonly diagnostic: Diagnostic;
}

const EMIT_CONTRACT = runCommandAction('Regenerate the contract', '{bin} contract emit');

export function contractUnreadableFinding(reason: string): StatusFinding {
  const message = `Could not read contract: ${reason}`;
  return {
    document: {
      code: 'CONTRACT.UNREADABLE',
      severity: 'warn',
      message,
      hints: ["Run '{bin} contract emit' to generate a valid contract"],
    },
    diagnostic: {
      code: 'CONTRACT.UNREADABLE',
      severity: 'warn',
      summary: message,
      why: 'The status tree falls back to the on-disk migration graph when the emitted contract cannot be read.',
      nextActions: [EMIT_CONTRACT],
    },
  };
}

export function markerNotInHistoryFinding(space: string): StatusFinding {
  const message = `Database was updated outside the migration system (marker for space "${space}" does not match any migration)`;
  const hints = [
    "Run '{bin} db sign' to overwrite the marker if the database already matches the contract",
    "Run '{bin} db update' to push the current contract to the database",
  ];
  return {
    document: { code: 'MIGRATION.MARKER_NOT_IN_HISTORY', severity: 'warn', message, hints },
    diagnostic: {
      code: 'MIGRATION.MARKER_NOT_IN_HISTORY',
      severity: 'warn',
      summary: message,
      why: 'The marker the database carries names no contract in the on-disk migration graph.',
      meta: { space },
      nextActions: [
        runCommandAction(
          'Overwrite the marker if the database already matches the contract',
          '{bin} db sign',
        ),
        runCommandAction('Or push the current contract to the database', '{bin} db update'),
      ],
    },
  };
}

export function missingInvariantsFinding(inputs: {
  readonly missing: readonly string[];
  readonly refName: string | undefined;
}): StatusFinding {
  const message = `missing invariant(s): ${inputs.missing.join(', ')}`;
  return {
    document: {
      code: 'MIGRATION.MISSING_INVARIANTS',
      severity: 'warn',
      ...ifDefined('ref', inputs.refName),
      invariants: [...inputs.missing],
      message,
    },
    diagnostic: {
      code: 'MIGRATION.MISSING_INVARIANTS',
      severity: 'warn',
      summary: message,
      why:
        inputs.refName === undefined
          ? 'The database marker does not carry every invariant the target requires.'
          : `The database marker does not carry every invariant \`${inputs.refName}\` requires.`,
      nextActions: [runCommandAction('Apply the migrations that provide them', '{bin} db migrate')],
      meta: { invariants: [...inputs.missing], ...ifDefined('ref', inputs.refName) },
    },
  };
}
