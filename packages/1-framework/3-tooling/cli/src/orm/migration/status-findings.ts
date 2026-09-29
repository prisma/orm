import { ifDefined } from '@internal/utils/defined';
import type { Diagnostic, NextAction } from '@prisma/cli-engine/protocol';
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

interface FindingAdvice {
  readonly hints: readonly string[];
  readonly nextActions: readonly NextAction[];
}

const MARKER_NOT_IN_HISTORY_ADVICE: FindingAdvice = {
  hints: [
    "Run '{bin} db sign' to overwrite the marker if the database already matches the contract",
    "Run '{bin} db update' to push the current contract to the database",
  ],
  nextActions: [
    runCommandAction(
      'Overwrite the marker if the database already matches the contract',
      '{bin} db sign',
    ),
    runCommandAction('Or push the current contract to the database', '{bin} db update'),
  ],
};

function hintFor(action: NextAction): string {
  return action.command === undefined ? action.label : `${action.label}: run '${action.command}'`;
}

/**
 * A marker the migration graph does not know. `ownedAdvice` replaces the advice when another tool changes the schema, since `db update` then refuses to run.
 */
export function markerNotInHistoryFinding(
  space: string,
  ownedAdvice: readonly NextAction[] | undefined,
): StatusFinding {
  const message = `Database was updated outside the migration system (marker for space "${space}" does not match any migration)`;
  const { hints, nextActions } =
    ownedAdvice === undefined
      ? MARKER_NOT_IN_HISTORY_ADVICE
      : { hints: ownedAdvice.map(hintFor), nextActions: ownedAdvice };
  return {
    document: {
      code: 'MIGRATION.MARKER_NOT_IN_HISTORY',
      severity: 'warn',
      message,
      hints: [...hints],
    },
    diagnostic: {
      code: 'MIGRATION.MARKER_NOT_IN_HISTORY',
      severity: 'warn',
      summary: message,
      why: 'The marker the database carries names no contract in the on-disk migration graph.',
      meta: { space },
      nextActions,
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
