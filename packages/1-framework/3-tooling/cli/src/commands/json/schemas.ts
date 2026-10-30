import {
  ACCESS_WIDENING_LEVELS,
  CHANGE_STRATEGIES,
  DATA_LOSS_LEVELS,
} from '@internal/framework-components/control';
import { type } from 'arktype';

export const migrationEntrySchema = type({
  name: 'string',
  hash: 'string',
  fromContract: 'string | null',
  toContract: 'string',
  operationCount: 'number',
  createdAt: 'string',
  refs: 'string[]',
  providedInvariants: 'string[]',
});

export type MigrationEntry = typeof migrationEntrySchema.infer;

export const contractRefSchema = type({
  hash: 'string',
  refs: 'string[]',
});

export type ContractRef = typeof contractRefSchema.infer;

export const successEnvelopeBaseSchema = type({
  ok: 'true',
  summary: 'string',
});

export type SuccessEnvelopeBase = typeof successEnvelopeBaseSchema.infer;

export const migrationSpaceListEntrySchema = type({
  space: 'string',
  migrations: migrationEntrySchema.array(),
});

export type MigrationSpaceListEntry = typeof migrationSpaceListEntrySchema.infer;

export const migrationListResultSchema = successEnvelopeBaseSchema.and(
  type({
    spaces: migrationSpaceListEntrySchema.array(),
  }),
);

export type MigrationListResult = typeof migrationListResultSchema.infer;

export const graphMigrationSchema = type({
  name: 'string',
  hash: 'string',
  fromContract: 'string | null',
  toContract: 'string',
});

export type GraphMigration = typeof graphMigrationSchema.infer;

export const migrationSpaceGraphEntrySchema = type({
  space: 'string',
  contracts: contractRefSchema.array(),
  migrations: graphMigrationSchema.array(),
});

export type MigrationSpaceGraphEntry = typeof migrationSpaceGraphEntrySchema.infer;

export const migrationGraphJsonResultSchema = successEnvelopeBaseSchema.and(
  type({
    spaces: migrationSpaceGraphEntrySchema.array(),
  }),
);

export type MigrationGraphJsonResult = typeof migrationGraphJsonResultSchema.infer;

export const migrationStatusEntrySchema = migrationEntrySchema.and(
  type({
    status: '"applied" | "pending" | null',
  }),
);

export type MigrationStatusEntry = typeof migrationStatusEntrySchema.infer;

const contractUnreadableDiagnosticSchema = type({
  code: '"CONTRACT.UNREADABLE"',
  severity: '"warn" | "info"',
  message: 'string',
  hints: 'string[]',
});

const markerNotInHistoryDiagnosticSchema = type({
  code: '"MIGRATION.MARKER_NOT_IN_HISTORY"',
  severity: '"warn" | "info"',
  message: 'string',
  hints: 'string[]',
});

const markerPoliciesUnreadableDiagnosticSchema = type({
  code: '"CONTRACT.MARKER_ROW_CORRUPT"',
  severity: '"warn" | "info"',
  message: 'string',
  hints: 'string[]',
});

const missingInvariantsDiagnosticSchema = type({
  code: '"MIGRATION.MISSING_INVARIANTS"',
  severity: '"warn" | "info"',
  'ref?': 'string',
  invariants: 'string[]',
  message: 'string',
});

export const statusDiagnosticSchema = contractUnreadableDiagnosticSchema
  .or(markerNotInHistoryDiagnosticSchema)
  .or(markerPoliciesUnreadableDiagnosticSchema)
  .or(missingInvariantsDiagnosticSchema);

export type StatusDiagnosticJson = typeof statusDiagnosticSchema.infer;

export const migrationStatusSpaceSchema = type({
  space: 'string',
  currentContract: 'string | null',
  targetContract: 'string',
  migrations: migrationStatusEntrySchema.array(),
});

export type MigrationStatusSpace = typeof migrationStatusSpaceSchema.infer;

const changeStrategies = type.enumerated(...CHANGE_STRATEGIES).array();
const dataLossLevel = type.enumerated(...DATA_LOSS_LEVELS);
const accessWideningLevel = type.enumerated(...ACCESS_WIDENING_LEVELS);

const policyDifferenceSchema = type({
  setting: '"change"',
  declared: changeStrategies,
  inForce: changeStrategies,
})
  .or({ setting: '"dataProtection.dataLoss"', declared: dataLossLevel, inForce: dataLossLevel })
  .or({
    setting: '"dataProtection.accessWidening"',
    declared: accessWideningLevel,
    inForce: accessWideningLevel,
  });

export const migrationStatusJsonResultSchema = successEnvelopeBaseSchema.and(
  type({
    spaces: migrationStatusSpaceSchema.array(),
    diagnostics: statusDiagnosticSchema.array(),
    'policyDifferences?': policyDifferenceSchema.array(),
  }),
);

export type MigrationStatusResult = typeof migrationStatusJsonResultSchema.infer;

export const ledgerRecordSchema = type({
  space: 'string',
  name: 'string',
  hash: 'string',
  fromContract: 'string | null',
  toContract: 'string',
  appliedAt: 'string',
  operationCount: 'number',
});

export type LedgerRecord = typeof ledgerRecordSchema.infer;

export const migrationLogResultSchema = successEnvelopeBaseSchema.and(
  type({
    records: ledgerRecordSchema.array(),
  }),
);

export type MigrationLogResult = typeof migrationLogResultSchema.infer;

export const showOperationSchema = type({
  id: 'string',
  label: 'string',
  operationClass: 'string',
});

export type ShowOperation = typeof showOperationSchema.infer;

export const showPreviewStatementSchema = type({
  text: 'string',
  language: 'string',
});

export const showMigrationSchema = type({
  space: 'string',
  name: 'string',
  hash: 'string',
  fromContract: 'string | null',
  toContract: 'string',
  createdAt: 'string',
  operations: showOperationSchema.array(),
  preview: type({
    statements: showPreviewStatementSchema.array(),
  }),
});

export type ShowMigration = typeof showMigrationSchema.infer;

export const migrationShowResultSchema = successEnvelopeBaseSchema.and(
  type({
    migration: showMigrationSchema,
  }),
);

export type MigrationShowResult = typeof migrationShowResultSchema.infer;

/**
 * The engine's `NextAction`, restated as the published shape of this CLI's own
 * `--json` documents. It is not imported from the engine because these schemas
 * ARE the wire contract — a change here is a change users see. The engine's
 * plural `commands` form is absent because nothing here emits one.
 */
export const nextActionSchema = type({
  kind: '"run-command" | "open-url" | "user-choice" | "edit-file" | "done"',
  label: 'string',
  'command?': 'string',
  'url?': 'string',
  'reason?': 'string',
});

export type NextActionJson = typeof nextActionSchema.infer;

export const checkFailureSchema = type({
  space: 'string',
  code: 'string',
  where: 'string',
  why: 'string',
  nextActions: nextActionSchema.array(),
});

export type CheckFailure = typeof checkFailureSchema.infer;

export const migrationCheckResultSchema = type({
  ok: 'boolean',
  failures: checkFailureSchema.array(),
  summary: 'string',
});

export type MigrationCheckResult = typeof migrationCheckResultSchema.infer;
