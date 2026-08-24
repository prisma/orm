import type { VerifyDatabaseResult } from '@internal/framework-components/control';
import {
  VERIFY_CODE_HASH_MISMATCH,
  VERIFY_CODE_MARKER_MISSING,
  VERIFY_CODE_TARGET_MISMATCH,
} from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import { isInternalError } from '@internal/utils/internal-error';
import type { Block, Presentations } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import type { Diagnostic, NextAction, Result } from '@prisma/cli-engine/protocol';
import { CliStructuredError, notOk, ok } from '@prisma/cli-engine/protocol';
import { createControlClient } from '../../control-api/client';
import type { DbVerifyMode } from '../../control-api/types';
import {
  errorHashMismatch,
  errorMarkerMissing,
  errorRuntime,
  errorTargetMismatch,
} from '../../utils/cli-errors';
import {
  type CombinedVerifyResult,
  combineVerifyResults,
} from '../../utils/combine-verify-results';
import { closeQuietly, maskConnectionUrl } from '../../utils/command-helpers';
import type { DbVerifyReport } from '../../utils/formatters/verify';
import { runCommandAction } from '../../utils/next-actions';
import { ormConfigSection } from '../config-section';
import { defineOrmCommand } from '../define-command';
import { dbFlag } from '../flags';
import { migrationsDirFor } from '../migration/paths';
import { normalizeError } from '../normalize-error';
import { controlProgressReporter } from '../progress';
import {
  readEmittedContract,
  requireVerifyConnection,
  schemaFindingBlocks,
  schemaVerdictDiagnostic,
  verificationThrow,
} from './verification';

/**
 * Verification ran and the database does not match the contract. The run did
 * the job it was asked to do, so this is a completed settlement carrying
 * diagnostics rather than an error.
 */
const FINDINGS_EXIT_CODE = 4;

/**
 * The verify document, which reports a failed verdict in the same shape.
 * `unclaimed` is absent on a run that never looked for unclaimed elements —
 * an empty array there would read as "none found".
 */
type DbVerifyDocument = DbVerifyReport & {
  readonly ok: boolean;
};

/** The schema-verify document `--schema-only` and the drift branch report. */
type SchemaVerifyDocument = CombinedVerifyResult['result'] & {
  readonly unclaimed: readonly string[];
};

const PUSH_THE_CONTRACT = runCommandAction('Push the contract to the database', '{bin} db update');
const RECONCILE_BY_HAND: NextAction = {
  kind: 'user-choice',
  label: 'Or reconcile the differences by hand and verify again',
};

function errorInvalidVerifyMode(options: {
  readonly why: string;
  readonly choose: string;
}): CliStructuredError {
  return new CliStructuredError('CLI.INVALID_VERIFY_MODE', 'Invalid verify mode', {
    why: options.why,
    nextActions: [{ kind: 'user-choice', label: options.choose }],
    docsUrl: 'https://pris.ly/db-verify',
  });
}

function resolveMode(flags: {
  readonly markerOnly: boolean;
  readonly schemaOnly: boolean;
  readonly strict: boolean;
}): Result<DbVerifyMode, CliStructuredError> {
  if (flags.markerOnly && flags.schemaOnly) {
    return notOk(
      errorInvalidVerifyMode({
        why: '`--marker-only` and `--schema-only` cannot be used together',
        choose:
          'Choose one mode: omit both to check the marker and schema, use `--marker-only` to check only the marker, or use `--schema-only` to check only the live schema.',
      }),
    );
  }
  if (flags.markerOnly && flags.strict) {
    return notOk(
      errorInvalidVerifyMode({
        why: '`--strict` requires schema verification, but `--marker-only` skips it',
        choose:
          'Remove `--strict`, or use `db verify` / `db verify --schema-only` when you want to check the live schema in strict mode.',
      }),
    );
  }
  if (flags.schemaOnly) {
    return ok('schema-only');
  }
  return ok(flags.markerOnly ? 'marker-only' : 'full');
}

function modeLabel(mode: DbVerifyMode, strict: boolean): string {
  if (mode === 'marker-only') {
    return 'marker only';
  }
  const strictness = strict ? 'strict' : 'tolerant';
  return mode === 'schema-only'
    ? `schema only (${strictness})`
    : `full (marker + schema, ${strictness})`;
}

function invocation(mode: DbVerifyMode, strict: boolean): string {
  return [
    'db verify',
    ...(mode === 'marker-only' ? ['--marker-only'] : []),
    ...(mode === 'schema-only' ? ['--schema-only'] : []),
    ...(strict ? ['--strict'] : []),
  ].join(' ');
}

/** The marker verdict as a finding, keeping the code the commander raised. */
function markerFindingDiagnostic(result: VerifyDatabaseResult): Diagnostic {
  const { ok: _ok, ...diagnostic } = normalizeError(markerFindingError(result)).toEnvelope();
  return diagnostic;
}

/**
 * The aggregate verifier's per-space marker drift as a finding on a completed
 * run, keeping the `MIGRATION.CONTRACT_SPACE_VIOLATION` envelope it was
 * raised with.
 */
function markerDriftDiagnostic(drift: unknown): Diagnostic {
  const { ok: _ok, ...diagnostic } = normalizeError(drift).toEnvelope();
  return diagnostic;
}

function markerFindingError(result: VerifyDatabaseResult) {
  if (result.code === VERIFY_CODE_MARKER_MISSING) {
    return errorMarkerMissing();
  }
  if (result.code === VERIFY_CODE_HASH_MISMATCH) {
    const storageMatch = result.marker?.storageHash === result.contract.storageHash;
    if (!storageMatch) {
      return errorHashMismatch({
        why: 'Contract storageHash does not match database marker',
        expected: result.contract.storageHash,
        ...ifDefined('actual', result.marker?.storageHash),
      });
    }
    const profileMatch =
      !result.contract.profileHash || result.marker?.profileHash === result.contract.profileHash;
    return errorHashMismatch({
      why: profileMatch
        ? 'Contract hash does not match database marker'
        : 'Contract profileHash does not match database marker',
      ...ifDefined('expected', result.contract.profileHash),
      ...ifDefined('actual', result.marker?.profileHash),
    });
  }
  if (result.code === VERIFY_CODE_TARGET_MISMATCH) {
    return errorTargetMismatch(result.target.expected, result.target.actual ?? 'unknown');
  }
  return errorRuntime('CONTRACT.VERIFY_FAILED', result.summary, {
    why: 'Verification failed',
    fix: 'Check contract and database state',
  });
}

function verifyDocument(inputs: {
  readonly ok: boolean;
  readonly mode: Extract<DbVerifyMode, 'full' | 'marker-only'>;
  readonly summary: string;
  readonly verified: VerifyDatabaseResult;
  readonly schema: DbVerifyReport['schema'];
  readonly schemaVerification: 'performed' | 'skipped';
  readonly unclaimed: readonly string[] | undefined;
  readonly warning: string | undefined;
  readonly elapsed: number;
}): DbVerifyDocument {
  return {
    ok: inputs.ok,
    summary: inputs.summary,
    mode: inputs.mode,
    contract: inputs.verified.contract,
    ...ifDefined('marker', inputs.verified.marker),
    target: inputs.verified.target,
    ...ifDefined('missingCodecs', inputs.verified.missingCodecs),
    ...ifDefined('codecCoverageSkipped', inputs.verified.codecCoverageSkipped),
    ...ifDefined('schema', inputs.schema),
    ...ifDefined('unclaimed', inputs.unclaimed),
    ...ifDefined('warning', inputs.warning),
    meta: {
      ...(inputs.verified.meta ?? {}),
      schemaVerification: inputs.schemaVerification,
    },
    timings: { total: inputs.elapsed },
  };
}

function schemaSummary(combined: CombinedVerifyResult): NonNullable<DbVerifyReport['schema']> {
  return {
    summary: combined.result.summary,
    strict: combined.result.meta?.strict ?? false,
    warnings: (combined.result.schema.warnings?.issues ?? []).map((issue) => issue.path.join('/')),
  };
}

function headerBlock(inputs: {
  readonly contractPath: string;
  readonly mode: DbVerifyMode;
  readonly strict: boolean;
  readonly database: string;
}): Block {
  return {
    kind: 'fields',
    rail: true,
    rows: [
      { label: 'contract', value: inputs.contractPath },
      { label: 'mode', value: modeLabel(inputs.mode, inputs.strict) },
      { label: 'database', value: inputs.database },
    ],
  };
}

function verifyPresentations(inputs: {
  readonly document: DbVerifyDocument;
  readonly header: Block;
}): Presentations {
  const document = inputs.document;
  const warnings = document.schema?.warnings ?? [];
  const unclaimed = document.unclaimed ?? [];
  return {
    stdout: () => [],
    next: () => [],
    human: (): readonly Block[] => [
      inputs.header,
      { kind: 'summary', status: document.ok ? 'ok' : 'error', text: document.summary },
      ...(document.ok
        ? [
            {
              kind: 'fields' as const,
              rows: [
                { label: 'storageHash', value: document.contract.storageHash },
                ...(document.contract.profileHash === undefined
                  ? []
                  : [{ label: 'profileHash', value: document.contract.profileHash }]),
              ],
            },
          ]
        : []),
      ...(warnings.length === 0 && unclaimed.length === 0
        ? []
        : [
            {
              kind: 'tree' as const,
              roots: [
                ...(warnings.length === 0
                  ? []
                  : [
                      {
                        label: 'Schema warnings',
                        status: 'warn' as const,
                        children: warnings.map((message) => ({
                          label: message,
                          status: 'warn' as const,
                        })),
                      },
                    ]),
                ...(unclaimed.length === 0
                  ? []
                  : [
                      {
                        label: 'Unclaimed elements (declared by no contract)',
                        status: 'warn' as const,
                        children: unclaimed.map((name) => ({
                          label: name,
                          status: 'warn' as const,
                        })),
                      },
                    ]),
              ],
            },
          ]),
      ...(document.warning === undefined
        ? []
        : [{ kind: 'summary' as const, status: 'warn' as const, text: document.warning }]),
    ],
    json: () => document,
  };
}

function schemaPresentations(inputs: {
  readonly document: SchemaVerifyDocument;
  readonly header: Block;
  readonly strict: boolean;
}): Presentations {
  return {
    stdout: () => [],
    next: () => [],
    human: (): readonly Block[] => [
      inputs.header,
      ...schemaFindingBlocks({
        result: inputs.document,
        unclaimed: inputs.document.unclaimed,
        strict: inputs.strict,
      }),
      {
        kind: 'summary',
        status: inputs.document.ok ? 'ok' : 'error',
        text: inputs.document.summary,
      },
    ],
    json: () => inputs.document,
  };
}

/**
 * One diagnostic per contract space whose live schema does not satisfy its
 * contract, plus the combined verdict when only the unclaimed list failed it.
 */
function driftDiagnostics(inputs: {
  readonly perSpace: ReadonlyMap<string, CombinedVerifyResult['result']>;
  readonly combined: CombinedVerifyResult;
}): readonly Diagnostic[] {
  const perSpace = [...inputs.perSpace]
    .filter(([, result]) => !result.ok)
    .map(([space, result]) =>
      schemaVerdictDiagnostic({
        result,
        space,
        nextActions: [PUSH_THE_CONTRACT, RECONCILE_BY_HAND],
      }),
    );
  if (perSpace.length > 0) {
    return perSpace;
  }
  return [
    schemaVerdictDiagnostic({
      result: inputs.combined.result,
      space: undefined,
      nextActions: [
        {
          kind: 'user-choice',
          label: 'Declare the unclaimed elements in a contract, or drop them from the database',
        },
      ],
    }),
  ];
}

/**
 * Builds the command with its control-client factory injected, so tests mount
 * the same tree over a fake client instead of mocking the client module.
 */
export function createDbVerifyCommand(
  createClient: typeof createControlClient = createControlClient,
) {
  return defineOrmCommand({
    help: {
      summary: 'Check whether the database marker and live schema match your contract',
      description:
        'Verifies the database marker first, then checks the database schema\n' +
        'matches your contract. Use `--marker-only` for marker-only verification,\n' +
        '`--schema-only` to skip marker checks and inspect only the live schema,\n' +
        'and `--strict` to fail if the database includes elements not present in\n' +
        'the contract.\n' +
        'Exit codes: 0 = the database matches the contract, 2 = the check could\n' +
        'not run (conflicting mode flags, no emitted contract, unreachable\n' +
        'database), 4 = drift or a marker finding.',
      examples: [
        'db verify',
        'db verify --db $DATABASE_URL',
        'db verify --strict',
        'db verify --schema-only',
        'db verify --marker-only',
        'db verify --json',
      ],
    },
    args: {
      flags: {
        db: dbFlag,
        markerOnly: flag.boolean({
          brief: 'Skip schema verification and only check the database marker',
        }),
        schemaOnly: flag.boolean({
          brief:
            'Skip marker verification and only check whether the live schema satisfies the contract',
        }),
        strict: flag.boolean({
          brief: 'Treat schema elements not present in the contract as an error',
        }),
      },
    },
    needs: { config: ormConfigSection },
    exitCodes: { 4: 'verification found drift or marker findings' },
    handler: async (args, ctx) => {
      const strict = args.flags.strict;
      const resolved = resolveMode({
        markerOnly: args.flags.markerOnly,
        schemaOnly: args.flags.schemaOnly,
        strict,
      });
      if (!resolved.ok) {
        return notOk(resolved.failure);
      }
      const mode = resolved.value;
      const commandInvocation = invocation(mode, strict);

      const emitted = await readEmittedContract({
        config: ctx.config,
        cwd: ctx.cwd,
        commandName: commandInvocation,
      });
      if (!emitted.ok) {
        return notOk(emitted.failure);
      }

      const connection = requireVerifyConnection({
        config: ctx.config,
        db: args.flags.db,
        invocation: commandInvocation,
      });
      if (!connection.ok) {
        return notOk(connection.failure);
      }
      const dbConnection = connection.value;

      const header = headerBlock({
        contractPath: emitted.value.displayPath,
        mode,
        strict,
        database: maskConnectionUrl(dbConnection),
      });
      const migrationsDir = migrationsDirFor(ctx.config, ctx.cwd);
      const client = createClient({
        family: ctx.config.family,
        target: ctx.config.target,
        adapter: ctx.config.adapter,
        ...ifDefined('driver', ctx.config.driver),
        extensions: ctx.config.extensions ?? [],
      });
      const onProgress = controlProgressReporter(ctx.report);
      const startedAt = Date.now();

      try {
        if (mode === 'schema-only') {
          await client.connect(dbConnection);
          const aggregate = await client.dbVerify({
            contract: emitted.value.contract,
            migrationsDir,
            strict,
            skipSchema: false,
            skipMarker: true,
            onProgress,
          });
          if (!aggregate.ok) {
            return notOk(normalizeError(aggregate.failure));
          }
          const combined = combineVerifyResults(
            aggregate.value.schemaResults,
            aggregate.value.appSpaceId,
            strict,
            aggregate.value.unclaimed,
          );
          const document: SchemaVerifyDocument = {
            ...combined.result,
            unclaimed: combined.unclaimed,
          };
          return ok(
            ctx.present(
              {
                data: document,
                exitCode: combined.result.ok ? 0 : FINDINGS_EXIT_CODE,
                diagnostics: combined.result.ok
                  ? []
                  : driftDiagnostics({ perSpace: aggregate.value.schemaResults, combined }),
              },
              schemaPresentations({ document, header, strict }),
            ),
          );
        }

        // The single-contract marker check and the aggregate verifier cover
        // different failure lanes, so full mode runs both, as it does today.
        const verified = await client.verify({
          contract: emitted.value.contract,
          connection: dbConnection,
          onProgress,
        });
        if (!verified.ok) {
          // The marker verdict returns before the aggregate verifier runs, so
          // neither the live schema nor the unclaimed list was looked at — even
          // in full mode.
          const document = verifyDocument({
            ok: false,
            mode,
            summary: verified.summary,
            verified,
            schema: undefined,
            schemaVerification: 'skipped',
            unclaimed: undefined,
            warning: undefined,
            elapsed: Date.now() - startedAt,
          });
          return ok(
            ctx.present(
              {
                data: document,
                exitCode: FINDINGS_EXIT_CODE,
                diagnostics: [markerFindingDiagnostic(verified)],
              },
              verifyPresentations({ document, header }),
            ),
          );
        }

        const aggregate = await client.dbVerify({
          contract: emitted.value.contract,
          migrationsDir,
          strict,
          skipSchema: mode === 'marker-only',
          skipMarker: false,
          onProgress,
        });
        if (!aggregate.ok) {
          return notOk(normalizeError(aggregate.failure));
        }

        // Per-space marker drift is the verdict of a check that ran to
        // completion, so it settles at exit 4 next to the single-contract
        // marker findings — including under --marker-only, whose whole job
        // is that check.
        const drift = aggregate.value.markerDrift;
        if (drift !== null) {
          // Full mode ran the schema check before the drift verdict, so the
          // document carries its outcome; --marker-only never ran it and
          // reports the same absence as the marker branch above.
          const driftCombined =
            mode === 'marker-only'
              ? undefined
              : combineVerifyResults(
                  aggregate.value.schemaResults,
                  aggregate.value.appSpaceId,
                  strict,
                  aggregate.value.unclaimed,
                );
          const document = verifyDocument({
            ok: false,
            mode,
            summary: normalizeError(drift).message,
            verified,
            schema: driftCombined === undefined ? undefined : schemaSummary(driftCombined),
            schemaVerification: driftCombined === undefined ? 'skipped' : 'performed',
            unclaimed: driftCombined?.unclaimed,
            warning: undefined,
            elapsed: Date.now() - startedAt,
          });
          return ok(
            ctx.present(
              {
                data: document,
                exitCode: FINDINGS_EXIT_CODE,
                diagnostics: [
                  markerDriftDiagnostic(drift),
                  ...(driftCombined !== undefined && !driftCombined.result.ok
                    ? driftDiagnostics({
                        perSpace: aggregate.value.schemaResults,
                        combined: driftCombined,
                      })
                    : []),
                ],
              },
              verifyPresentations({ document, header }),
            ),
          );
        }

        if (mode === 'marker-only') {
          const document = verifyDocument({
            ok: true,
            mode,
            summary: 'Database marker matches contract',
            verified,
            schema: undefined,
            schemaVerification: 'skipped',
            unclaimed: undefined,
            warning: 'Schema verification skipped because --marker-only was provided',
            elapsed: Date.now() - startedAt,
          });
          return ok(
            ctx.present({ data: document, exitCode: 0 }, verifyPresentations({ document, header })),
          );
        }

        const combined = combineVerifyResults(
          aggregate.value.schemaResults,
          aggregate.value.appSpaceId,
          strict,
          aggregate.value.unclaimed,
        );
        if (!combined.result.ok) {
          const document: SchemaVerifyDocument = {
            ...combined.result,
            unclaimed: combined.unclaimed,
          };
          return ok(
            ctx.present(
              {
                data: document,
                exitCode: FINDINGS_EXIT_CODE,
                diagnostics: driftDiagnostics({
                  perSpace: aggregate.value.schemaResults,
                  combined,
                }),
              },
              schemaPresentations({ document, header, strict }),
            ),
          );
        }

        const document = verifyDocument({
          ok: true,
          mode,
          summary: 'Database marker and schema match contract',
          verified,
          schema: schemaSummary(combined),
          schemaVerification: 'performed',
          unclaimed: combined.unclaimed,
          warning: undefined,
          elapsed: Date.now() - startedAt,
        });
        return ok(
          ctx.present({ data: document, exitCode: 0 }, verifyPresentations({ document, header })),
        );
      } catch (error) {
        if (isInternalError(error)) {
          throw error;
        }
        return notOk(
          verificationThrow({ error, invocation: commandInvocation, connection: dbConnection }),
        );
      } finally {
        await closeQuietly(client);
      }
    },
  });
}

export const dbVerifyCommand = createDbVerifyCommand();
