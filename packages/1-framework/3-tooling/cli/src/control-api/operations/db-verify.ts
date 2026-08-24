import type { Contract } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyInstance,
  SchemaDiffIssue,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { hasSchemaSubjectClassifier } from '@internal/framework-components/control';
import {
  type AggregateContractSpace,
  collectAggregateNamespaces,
  requireHeadRef,
  type VerifierOutput,
  verifyMigration,
} from '@internal/migration-tools/aggregate';
import { castAs } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import { CliStructuredError } from '../../utils/cli-errors';
import type { OnControlProgress } from '../types';
import {
  type BuildAggregateInputs,
  buildContractSpaceAggregate,
} from './contract-space-aggregate-loader';

/**
 * Span IDs emitted via `onProgress` during the aggregate verify flow.
 * Mirrors the span identifiers used by the legacy precheck / marker-check
 * helpers so structured-output renderers and progress tests keep working.
 */
const SPAN_IDS = {
  introspect: 'introspect',
  verify: 'verify',
} as const;

/**
 * Inputs for the aggregate `db verify` operation.
 *
 * Loader → verifier pipeline. The loader (sole descriptor-import
 * boundary) builds a {@link import('@internal/migration-tools/aggregate').ContractSpaceAggregate};
 * the aggregate verifier bundles `markerCheck` + per-space `schemaCheck`
 * (each contract space verified against the full schema; extras stripped to its own view).
 * `mode: 'strict' | 'lenient'` maps directly to the user facing `--strict` flag.
 */
export interface ExecuteDbVerifyOptions<TFamilyId extends string, TTargetId extends string> {
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  readonly contract: Contract;
  readonly migrationsDir: string;
  readonly targetId: TTargetId;
  readonly extensions: ReadonlyArray<ControlExtensionDescriptor<TFamilyId, TTargetId>>;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly mode: 'strict' | 'lenient';
  readonly skipSchema: boolean;
  readonly skipMarker: boolean;
  readonly onProgress?: OnControlProgress;
}

/**
 * Result of the aggregate verify operation.
 *
 * Marker drift keeps the envelope shape the legacy
 * `runContractSpaceVerifierMarkerCheck` emitted, but rides the success value
 * as {@link ExecuteDbVerifySuccess.markerDrift}: the check ran to completion,
 * so drift is a finding for the caller to settle, not a failure to run.
 *
 * On success, the per-space verify results are returned for the CLI to
 * render. When `skipSchema` is true (`--marker-only`), the schema map
 * is empty.
 */
export interface ExecuteDbVerifySuccess {
  readonly schemaResults: ReadonlyMap<string, VerifyDatabaseSchemaResult>;
  /**
   * Live element names no contract space declares, deduplicated and reported
   * once for the whole database (never per space). Strict mode fails on a
   * non-empty list; lenient mode surfaces it informationally.
   */
  readonly unclaimed: readonly string[];
  readonly spaceOrder: readonly string[];
  readonly appSpaceId: string;
  /**
   * Per-space marker drift the verifier found — a hash mismatch, missing
   * invariants, an orphan marker row — as the violation envelope. The check
   * completed and this is its verdict, so it rides the success value: callers
   * settle it as a finding, while the failure lane stays reserved for a check
   * that could not run (loader violations, introspection failure).
   */
  readonly markerDrift: CliStructuredError | null;
}

export type ExecuteDbVerifyResult = Result<ExecuteDbVerifySuccess, CliStructuredError>;

/**
 * Loader → verifier pipeline shared by `db verify` modes (`full`,
 * `marker-only`, `schema-only`).
 *
 * 1. **Load**: build a {@link import('@internal/migration-tools/aggregate').ContractSpaceAggregate}
 *    from descriptors + on-disk on-disk artefacts. Layout / drift /
 *    integrity / disjointness violations short-circuit with a
 *    structured CLI error.
 * 2. **Read DB state**: marker rows + (when `skipSchema` is `false`)
 *    schema introspection.
 * 3. **Verify**: {@link verifyMigration} returns per-space `markerCheck` +
 *    per-space `schemaCheck` (each contract space verified against the full schema,
 *    then scoped to its own contract space). Marker drift is returned as the
 *    success value's `markerDrift` envelope for callers to settle as a
 *    finding. Verify results are returned to the caller verbatim.
 */
export async function executeDbVerify<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteDbVerifyOptions<TFamilyId, TTargetId>,
): Promise<ExecuteDbVerifyResult> {
  const { driver, familyInstance, onProgress, skipSchema, skipMarker } = options;
  const loaded = await buildContractSpaceAggregate(buildLoadInputs(options));
  if (!loaded.ok) return notOk(loaded.failure);
  const aggregate = loaded.value;

  const markersBySpaceId = await familyInstance.readAllMarkers({ driver });
  const schemaIntrospection = skipSchema
    ? null
    : await runIntrospection({
        driver,
        familyInstance,
        onProgress,
        contract: collectAggregateNamespaces(aggregate),
      });

  // The subject-granularity + entity-kind classifiers are an injected
  // capability — not every family provides one — detected the same way the
  // other optional per-family capabilities are (`hasSchemaView`, …), never
  // assumed.
  const classifySubjectGranularity = hasSchemaSubjectClassifier(familyInstance)
    ? (issue: SchemaDiffIssue) => familyInstance.classifySubjectGranularity(issue)
    : undefined;
  const classifyEntityKind = hasSchemaSubjectClassifier(familyInstance)
    ? (issue: SchemaDiffIssue) => familyInstance.classifyEntityKind(issue)
    : undefined;

  emitVerifySpan(onProgress, 'spanStart');
  const verifyResult = verifyMigration({
    aggregate,
    markersBySpaceId,
    schemaIntrospection,
    mode: options.mode,
    verifySchemaForSpace: createPerSpaceVerifier(options),
    ...ifDefined('classifySubjectGranularity', classifySubjectGranularity),
    ...ifDefined('classifyEntityKind', classifyEntityKind),
  });
  return finaliseVerifyResult({
    verifyResult,
    aggregate,
    skipMarker,
    onProgress,
    migrationsDir: options.migrationsDir,
  });
}

function buildLoadInputs<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteDbVerifyOptions<TFamilyId, TTargetId>,
): BuildAggregateInputs<TFamilyId, TTargetId> {
  return {
    targetId: options.targetId,
    migrationsDir: options.migrationsDir,
    appContract: options.contract,
    extensions: options.extensions,
    deserializeContract: (json) => options.familyInstance.deserializeContract(json),
  };
}

async function runIntrospection<TFamilyId extends string, TTargetId extends string>(args: {
  driver: ControlDriverInstance<TFamilyId, TTargetId>;
  familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  onProgress: OnControlProgress | undefined;
  contract: unknown;
}): Promise<unknown> {
  const { driver, familyInstance, onProgress, contract } = args;
  onProgress?.({
    action: 'dbVerify',
    kind: 'spanStart',
    spanId: SPAN_IDS.introspect,
    label: 'Introspecting database schema',
  });
  try {
    const result = await familyInstance.introspect({ driver, contract });
    onProgress?.({
      action: 'dbVerify',
      kind: 'spanEnd',
      spanId: SPAN_IDS.introspect,
      outcome: 'ok',
    });
    return result;
  } catch (error) {
    onProgress?.({
      action: 'dbVerify',
      kind: 'spanEnd',
      spanId: SPAN_IDS.introspect,
      outcome: 'error',
    });
    throw error;
  }
}

/**
 * Build the per-space schema callback handed to the aggregate verifier.
 * When `skipSchema` is true the callback short-circuits with a synthetic
 * `ok` result so the verifier still runs the (cheap) schemaCheck loop
 * without invoking the family's verification path.
 */
export function createPerSpaceVerifier<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteDbVerifyOptions<TFamilyId, TTargetId>,
): (
  schema: unknown,
  space: AggregateContractSpace,
  verifyMode: 'strict' | 'lenient',
) => VerifyDatabaseSchemaResult {
  const { skipSchema, familyInstance, frameworkComponents } = options;
  return (schema, space, verifyMode) => {
    if (skipSchema) return buildSkippedSchemaResult(space);
    return familyInstance.verifySchema({
      contract: space.contract(),
      // `familyInstance` is `ControlFamilyInstance<_, unknown>`, so `verifySchema`
      // takes its `TSchemaIR` as `unknown` — the introspected schema passes
      // straight through; the family narrows to its own IR node internally.
      schema,
      strict: verifyMode === 'strict',
      frameworkComponents,
    });
  };
}

function emitVerifySpan(
  onProgress: OnControlProgress | undefined,
  kind: 'spanStart' | 'spanEndOk' | 'spanEndError',
): void {
  if (kind === 'spanStart') {
    onProgress?.({
      action: 'dbVerify',
      kind: 'spanStart',
      spanId: SPAN_IDS.verify,
      label: 'Verifying contract spaces',
    });
    return;
  }
  onProgress?.({
    action: 'dbVerify',
    kind: 'spanEnd',
    spanId: SPAN_IDS.verify,
    outcome: kind === 'spanEndOk' ? 'ok' : 'error',
  });
}

/**
 * Map an {@link VerifierOutput} to the operation's
 * {@link ExecuteDbVerifyResult}, applying the `skipMarker` policy used
 * by the CLI's `--schema-only` mode.
 */
function finaliseVerifyResult(args: {
  verifyResult: VerifierOutput;
  aggregate: {
    readonly app: { readonly spaceId: string };
    readonly extensions: ReadonlyArray<{ readonly spaceId: string }>;
  };
  skipMarker: boolean;
  onProgress: OnControlProgress | undefined;
  migrationsDir: string;
}): ExecuteDbVerifyResult {
  const { verifyResult, aggregate, skipMarker, onProgress, migrationsDir } = args;
  if (!verifyResult.ok) {
    emitVerifySpan(onProgress, 'spanEndError');
    return notOk(
      new CliStructuredError(
        'MIGRATION.CONTRACT_SPACE_VIOLATION',
        'Aggregate verifier introspection failed',
        {
          why: verifyResult.failure.detail,
          fix: 'Check database connectivity and the introspection tooling.',
          docsUrl: 'https://pris.ly/contract-spaces',
        },
      ),
    );
  }
  const markerDrift = skipMarker
    ? null
    : mapMarkerCheckFailures(aggregate.app.spaceId, verifyResult.value.markerCheck, migrationsDir);
  emitVerifySpan(onProgress, markerDrift === null ? 'spanEndOk' : 'spanEndError');
  return ok({
    schemaResults: verifyResult.value.schemaCheck.perSpace,
    unclaimed: verifyResult.value.schemaCheck.unclaimed,
    spaceOrder: [aggregate.app.spaceId, ...aggregate.extensions.map((e) => e.spaceId)],
    appSpaceId: aggregate.app.spaceId,
    markerDrift,
  });
}

function buildSkippedSchemaResult(space: AggregateContractSpace): VerifyDatabaseSchemaResult {
  const contract = space.contract();
  const headRef = requireHeadRef(space);
  const profileHash = castAs<{ profileHash?: string }>(contract).profileHash;
  return {
    ok: true,
    summary: 'Schema verification skipped',
    contract: {
      storageHash: headRef.hash,
      ...(profileHash ? { profileHash } : {}),
    },
    target: { expected: contract.target },
    schema: {
      issues: [],
    },
    timings: { total: 0 },
  };
}

/**
 * Translate per-space marker check failures and orphan markers into a
 * single CLI structured error envelope. Preserves the legacy code
 * `MIGRATION.CONTRACT_SPACE_VIOLATION` (was emitted by
 * `runContractSpaceVerifierMarkerCheck`).
 */
function mapMarkerCheckFailures(
  appSpaceId: string,
  section: {
    readonly perSpace: ReadonlyMap<
      string,
      | { readonly kind: 'ok' }
      | { readonly kind: 'absent' }
      | { readonly kind: 'hashMismatch'; readonly markerHash: string; readonly expected: string }
      | { readonly kind: 'missingInvariants'; readonly missing: readonly string[] }
    >;
    readonly orphanMarkers: readonly { readonly spaceId: string; readonly row: unknown }[];
  },
  migrationsDir: string,
): CliStructuredError | null {
  const violations: Array<{
    kind: string;
    spaceId: string;
    remediation: string;
  }> = [];
  for (const [spaceId, result] of section.perSpace) {
    if (result.kind === 'ok' || result.kind === 'absent') continue;
    if (result.kind === 'hashMismatch') {
      violations.push({
        kind: 'hashMismatch',
        spaceId,
        remediation:
          spaceId === appSpaceId
            ? 'Run `{bin} db update` to advance the marker, or roll the database back to the recorded hash.'
            : `Apply on-disk migrations under \`${migrationsDir}/${spaceId}/\` to advance the marker, or remove the conflicting marker row.`,
      });
      continue;
    }
    if (result.kind === 'missingInvariants') {
      violations.push({
        kind: 'invariantsMismatch',
        spaceId,
        remediation: `Re-apply the migrations under \`${migrationsDir}/${spaceId}/\` so the marker carries invariants: ${result.missing.join(', ')}.`,
      });
    }
  }
  for (const orphan of section.orphanMarkers) {
    violations.push({
      kind: 'orphanMarker',
      spaceId: orphan.spaceId,
      remediation: `Add the corresponding extension to \`extensions\` in \`prisma.config.ts\`, or delete the orphan marker row for "${orphan.spaceId}".`,
    });
  }
  if (violations.length === 0) return null;
  const lines = violations.map((v) => `- [${v.kind}] ${v.spaceId}: ${v.remediation}`);
  const summary =
    violations.length === 1
      ? 'Contract-space verifier found a violation'
      : `Contract-space verifier found violations (${violations.length})`;
  return new CliStructuredError('MIGRATION.CONTRACT_SPACE_VIOLATION', summary, {
    why: `The on-disk \`${migrationsDir}/\` directory, the \`extensions\` declaration, and the live database marker rows are not in agreement.\n${lines.join('\n')}`,
    fix: violations[0]?.remediation ?? 'Review and reconcile the violations listed above.',
    docsUrl: 'https://pris.ly/contract-spaces',
    meta: { violations },
  });
}
