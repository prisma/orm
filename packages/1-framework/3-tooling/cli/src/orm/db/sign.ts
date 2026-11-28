import type { PrismaConfig } from '@internal/config/config-types';
import { ormConfigSection } from '@internal/config-loader';
import type { Contract } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  createControlStack,
  sameMarkerHashes,
  type VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import { advanceRef, readRef } from '@internal/migration-tools/refs';
import { spaceMigrationDirectory, spaceRefsDirectory } from '@internal/migration-tools/spaces';
import { ifDefined } from '@internal/utils/defined';
import { notOk as notOkResult, ok as okResult, type Result } from '@internal/utils/result';
import type { Block, Presentations, Span, Text, TreeNode } from '@prisma/cli-engine';
import { flag, positional } from '@prisma/cli-engine';
import type { Diagnostic } from '@prisma/cli-engine/protocol';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { dirname, relative } from 'pathe';
import { createControlClient } from '../../control-api/client';
import { readFailureReportedAsItself } from '../../control-api/operations/caught-errors';
import { resolveContractRefToSnapshot } from '../../control-api/operations/contract-snapshot-resolution';
import type { DbSignSpaceOutcome } from '../../control-api/operations/db-sign';
import {
  advanceRefSafely,
  type ContractIR,
  preflightRefAdvancement,
} from '../../control-api/operations/ref-advancement';
import { shellQuoted } from '../../control-api/statements/statement-flag';
import {
  type CliStructuredError,
  errorAdvanceRefArgConflict,
  errorContractArgConflict,
  errorContractValidationFailed,
  errorSignRefsNotWritten,
  type UnwrittenRef,
} from '../../utils/cli-errors';
import { closeQuietly, maskConnectionUrl } from '../../utils/command-helpers';
import { RECORDED_CONTRACT_REF_FORMS } from '../../utils/contract-ref-forms';
import { contractValidationMeta } from '../../utils/contract-validation-meta';
import { type SnapshotHead, snapshotRewriteAt } from '../../utils/next-actions';
import { type CliInvocation, cliCommand, cliInvocation } from '../../utils/printed-command';
import { dataLine } from '../data-lines';
import { defineOrmCommand } from '../define-command';
import { dbFlag } from '../flags';
import { appRefsDirFor, migrationsDirFor } from '../migration/paths';
import { normalizeError } from '../normalize-error';
import { controlProgressReporter } from '../progress';
import {
  databaseRefusedInRun,
  databaseRefusedWhy,
  driftIssues,
  includesDatabaseCapabilitiesNotProvided,
  issueNodes,
  readEmittedContract,
  requireVerifyConnection,
  schemaDriftNextActions,
  schemaVerdictDiagnostic,
  verificationThrow,
} from './verification';

/**
 * Verification ran and refused the signature. The command completed — it
 * answered the question "may this database be signed?" — so the refusal is a
 * diagnostic on a completed envelope rather than an error.
 */
const FINDINGS_EXIT_CODE = 4;

/**
 * The ref a signature checkpoints. Unlike `db init` / `db update`, `--db` does
 * not suppress the write: signing does not touch the schema, and adoption is
 * normally done against the real database via `--db`. Only `--no-advance-ref`
 * suppresses it.
 */
const DEFAULT_ADVANCE_REF = 'db';

const CONTRACT_REF_BRIEF = `Contract reference (${RECORDED_CONTRACT_REF_FORMS})`;

interface AdvancedRef {
  readonly space: string;
  readonly name: string;
  readonly hash: string;
}

const NO_PREVIOUS_HASH_CODES: ReadonlySet<string> = new Set([
  'MIGRATION.UNKNOWN_REF',
  'MIGRATION.INVALID_REF_FILE',
  'MIGRATION.INVALID_REF_NAME',
]);

/**
 * The hash the ref held before the signature, read from that one ref file so a
 * corrupt sibling cannot fail a signature already written.
 */
async function previousRefHash(refsDir: string, name: string): Promise<string | undefined> {
  try {
    return (await readRef(refsDir, name)).hash;
  } catch (error) {
    if (MigrationToolsError.is(error) && NO_PREVIOUS_HASH_CODES.has(error.code)) {
      return undefined;
    }
    throw error;
  }
}

interface DbSignDocument {
  readonly ok: boolean;
  readonly summary: string;
  readonly spaces: readonly DbSignSpaceOutcome[];
  readonly advancedRefs: readonly AdvancedRef[];
}

/** The contract that was signed, as the bytes the snapshot store keeps. */
interface SignedContractSource {
  readonly json: Record<string, unknown>;
  readonly jsonPath: string;
}

function headerBlock(inputs: { readonly contract: string; readonly database: string }): Block {
  return {
    kind: 'fields',
    rail: true,
    rows: [
      { label: 'contract', value: inputs.contract },
      { label: 'database', value: inputs.database },
    ],
  };
}

function hashSpans(hash: string, previousHash: string | undefined): readonly Span[] {
  return [
    { text: hash, tone: 'identifier' },
    ...(previousHash === undefined
      ? []
      : [
          { text: ' (was ', tone: 'muted' as const },
          { text: previousHash, tone: 'identifier' as const },
          { text: ')', tone: 'muted' as const },
        ]),
  ];
}

function spaceNode(outcome: DbSignSpaceOutcome): TreeNode {
  switch (outcome.status) {
    case 'created':
      return {
        label: [
          { text: `${outcome.space}: signed ` },
          { text: outcome.contract.storageHash, tone: 'identifier' },
          { text: ' (no marker before)', tone: 'muted' },
        ],
        status: 'ok',
      };
    case 'updated':
      return {
        label: [
          { text: `${outcome.space}: signed ` },
          ...hashSpans(outcome.contract.storageHash, outcome.previous.storageHash),
        ],
        status: 'ok',
      };
    case 'unchanged':
      return {
        label: [
          { text: `${outcome.space}: unchanged, already signed with ` },
          { text: outcome.contract.storageHash, tone: 'identifier' },
        ],
        status: 'ok',
      };
    case 'failed':
      return {
        label: `${outcome.space}: not signed, ${verificationFailure(outcome.schema)}`,
        status: 'error',
        children: issueNodes(driftIssues(outcome.schema.schema.issues), 'error'),
      };
    case 'missing-invariants':
      return {
        label: `${outcome.space}: not signed, its marker does not record invariants its head ref requires${outcome.schema === undefined ? '' : `, and ${verificationFailure(outcome.schema)}`}`,
        status: 'error',
        children: [
          ...outcome.missingInvariants.map(
            (id): TreeNode => ({ label: `missing invariant: ${id}`, status: 'error' }),
          ),
          ...(outcome.schema === undefined
            ? []
            : issueNodes(driftIssues(outcome.schema.schema.issues), 'error')),
        ],
      };
    case 'conflict':
      return {
        label: `${outcome.space}: not signed, its marker changed after the schema was verified`,
        status: 'error',
        children: [
          {
            label: `marker when verified: ${outcome.expected?.storageHash ?? 'none'}`,
            status: 'error',
          },
          {
            label: `marker now: ${outcome.found?.storageHash ?? 'none'}`,
            status: 'error',
          },
        ],
      };
  }
}

function isSigned(outcome: DbSignSpaceOutcome): boolean {
  return (
    outcome.status === 'created' || outcome.status === 'updated' || outcome.status === 'unchanged'
  );
}

function quotedList(spaces: readonly DbSignSpaceOutcome[]): string {
  return spaces.map((outcome) => `"${outcome.space}"`).join(', ');
}

/** Why a space's verification failed, as a clause: the database lacks capabilities, or its schema does not match. The refusal's own text is in the space's diagnostic. */
function verificationFailure(schema: VerifyDatabaseSchemaResult): string {
  return includesDatabaseCapabilitiesNotProvided(schema.schema.issues)
    ? 'the database does not provide what its contract requires'
    : 'the schema does not satisfy its contract';
}

function failedSchemaOf(outcome: DbSignSpaceOutcome): VerifyDatabaseSchemaResult | undefined {
  if (outcome.status === 'failed') return outcome.schema;
  if (outcome.status === 'missing-invariants') return outcome.schema;
  return undefined;
}

function refusedForDatabaseCapabilities(outcome: DbSignSpaceOutcome): boolean {
  const schema = failedSchemaOf(outcome);
  return schema !== undefined && includesDatabaseCapabilitiesNotProvided(schema.schema.issues);
}

function failsSchema(outcome: DbSignSpaceOutcome): boolean {
  return failedSchemaOf(outcome) !== undefined && !refusedForDatabaseCapabilities(outcome);
}

function signSummary(spaces: readonly DbSignSpaceOutcome[]): string {
  const failed = spaces.filter(failsSchema);
  const lacking = spaces.filter(refusedForDatabaseCapabilities);
  const conflicts = spaces.filter((outcome) => outcome.status === 'conflict');
  const refused = spaces.filter((outcome) => outcome.status === 'missing-invariants');
  if (
    failed.length === 0 &&
    lacking.length === 0 &&
    conflicts.length === 0 &&
    refused.length === 0
  ) {
    return 'Database signed';
  }
  const signed = spaces.filter(isSigned);
  const problems = [
    ...(refused.length === 0
      ? []
      : [
          `${refused.length === 1 ? 'space' : 'spaces'} ${quotedList(refused)} ${refused.length === 1 ? 'requires invariants its marker does' : 'require invariants their markers do'} not record`,
        ]),
    ...(lacking.length === 0
      ? []
      : [
          `the database does not provide what the contract requires for ${lacking.length === 1 ? 'space' : 'spaces'} ${quotedList(lacking)}`,
        ]),
    ...(failed.length === 0
      ? []
      : [
          `Database schema does not satisfy contract for ${failed.length === 1 ? 'space' : 'spaces'} ${quotedList(failed)}`,
        ]),
    ...(conflicts.length === 0
      ? []
      : [
          `${conflicts.length === 1 ? 'marker of space' : 'markers of spaces'} ${quotedList(conflicts)} changed while db sign ran`,
        ]),
  ].join('; ');
  const signedText = signed.length === 0 ? 'signed nothing' : `signed ${quotedList(signed)}`;
  return `${problems.charAt(0).toUpperCase()}${problems.slice(1)}; ${signedText}`;
}

/** The arguments of `db sign` that change what it signs or where, which a re-run repeats. */
function signRerunArgs(args: {
  readonly contractRef: string | undefined;
  readonly advanceRef: string | undefined;
  readonly noAdvanceRef: boolean;
}): readonly string[] {
  return [
    ...(args.contractRef === undefined ? [] : ['--contract', shellQuoted(args.contractRef)]),
    ...(args.advanceRef === undefined ? [] : ['--advance-ref', shellQuoted(args.advanceRef)]),
    ...(args.noAdvanceRef ? ['--no-advance-ref'] : []),
  ];
}

/** The `db sign` command that runs this one again, with the arguments the user gave. */
function rerunCommand(invocation: CliInvocation): string {
  return cliCommand(invocation, 'db sign', invocation.rerunArgs ?? []);
}

function markerConflictDiagnostic(
  outcome: Extract<DbSignSpaceOutcome, { readonly status: 'conflict' }>,
  rerun: string,
): Diagnostic {
  const { expected, found } = outcome;
  const changedBack = expected !== null && sameMarkerHashes(found, expected);
  return {
    code: 'MIGRATION.MARKER_CAS_FAILURE',
    severity: 'error',
    summary: `Marker of space "${outcome.space}" changed while db sign ran`,
    why: changedBack
      ? 'Another process changed the marker and changed it back while db sign was writing it, so db sign did not sign the space.'
      : `Another process, such as migrate, changed the marker from ${expected?.storageHash ?? 'no marker'} to ${found?.storageHash ?? 'no marker'} after db sign read it, so db sign did not sign the space.`,
    nextActions: [
      {
        kind: 'run-command',
        label: 'Sign again once the other process has finished',
        command: rerun,
      },
    ],
    meta: {
      reason: changedBack ? 'markerChanged' : 'storageHash',
      space: outcome.space,
      expectedStorageHash: expected?.storageHash ?? null,
      foundStorageHash: found?.storageHash ?? null,
      destinationStorageHash: outcome.contract.storageHash,
    },
  };
}

function missingInvariantsDiagnostic(
  outcome: Extract<DbSignSpaceOutcome, { readonly status: 'missing-invariants' }>,
  inputs: { readonly migrate: string; readonly databaseRefused: boolean },
): Diagnostic {
  const missing = outcome.missingInvariants.map((id) => `"${id}"`).join(', ');
  const required =
    outcome.missingInvariants.length === 1
      ? `the invariant ${missing}, which the database marker does not record`
      : `the invariants ${missing}, which the database marker does not record`;
  const refusal = inputs.databaseRefused
    ? databaseRefusedWhy(refusedForDatabaseCapabilities(outcome) ? 'its contract' : 'another space')
    : undefined;
  return {
    code: 'MIGRATION.SIGN_INVARIANTS_MISSING',
    severity: 'error',
    summary: `Space "${outcome.space}" requires invariants its marker does not record`,
    why: `The head ref of space "${outcome.space}" requires ${required}. An invariant records that a migration ran, and \`db sign\` never runs migrations, so it did not sign this space.${refusal === undefined ? '' : ` ${refusal}`}`,
    nextActions:
      refusal === undefined
        ? [
            {
              kind: 'run-command',
              label: 'Run the migrations that provide the invariants, then sign again',
              command: inputs.migrate,
            },
          ]
        : [],
    meta: { space: outcome.space, missingInvariants: outcome.missingInvariants },
  };
}

function advancedRefSpans(
  advanced: AdvancedRef & { readonly previousHash: string | undefined },
): Text {
  const subject =
    advanced.space === APP_SPACE_ID
      ? `Advanced ref "${advanced.name}" → `
      : `Advanced ref "${advanced.name}" of space "${advanced.space}" → `;
  return [{ text: subject }, ...hashSpans(advanced.hash, advanced.previousHash)];
}

function signPresentations(inputs: {
  readonly document: DbSignDocument;
  readonly advanced:
    | readonly (AdvancedRef & { readonly previousHash: string | undefined })[]
    | null;
  readonly header: Block;
}): Presentations {
  const { document } = inputs;
  return {
    stdout: () =>
      document.spaces.map((space) =>
        dataLine([space.space, space.status, space.contract.storageHash]),
      ),
    next: () => [],
    human: (): readonly Block[] => [
      inputs.header,
      { kind: 'tree', roots: document.spaces.map(spaceNode) },
      { kind: 'summary', status: document.ok ? 'ok' : 'error', text: document.summary },
      ...(inputs.advanced === null
        ? [
            {
              kind: 'summary' as const,
              status: 'info' as const,
              tone: 'muted' as const,
              text: `Left ref "${DEFAULT_ADVANCE_REF}" untouched (--no-advance-ref)`,
            },
          ]
        : inputs.advanced.map((advanced) => ({
            kind: 'summary' as const,
            status: 'ok' as const,
            text: advancedRefSpans(advanced),
          }))),
    ],
    json: () => document,
  };
}

function hydrateContract(
  config: PrismaConfig,
  json: unknown,
  path: string,
  snapshot:
    | { readonly head: SnapshotHead | undefined; readonly invocation: CliInvocation }
    | undefined,
): Result<Contract, CliStructuredError> {
  try {
    return okResult(config.family.create(createControlStack(config)).deserializeContract(json));
  } catch (error) {
    const asItself = readFailureReportedAsItself(error, path);
    if (asItself !== undefined) return notOkResult(asItself);
    return notOkResult(
      errorContractValidationFailed(
        `Contract at ${path} failed to deserialize: ${error instanceof Error ? error.message : String(error)}`,
        {
          where: { path },
          meta: contractValidationMeta(error),
          ...(snapshot === undefined
            ? {}
            : {
                artifact: 'snapshot' as const,
                ...(snapshot.head === undefined
                  ? {}
                  : {
                      rewrittenBy: snapshotRewriteAt(
                        snapshot.head,
                        relative(process.cwd(), dirname(path)),
                        snapshot.invocation,
                      ),
                    }),
              }),
        },
      ),
    );
  }
}

/**
 * Writes the named ref of an extension space. Its contract snapshot is already in the store: the aggregate read the space's contract from it.
 */
async function advanceExtensionRef(args: {
  readonly migrationsDir: string;
  readonly space: string;
  readonly name: string;
  readonly hash: string;
}): Promise<Result<void, CliStructuredError>> {
  const refsDir = spaceRefsDirectory(spaceMigrationDirectory(args.migrationsDir, args.space));
  try {
    await advanceRef(refsDir, args.name, args.hash);
    return okResult(undefined);
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOkResult(error);
    }
    throw error;
  }
}

/**
 * Writes one signed space's ref, and the app space's contract snapshot, after the markers are written. Any failure is returned as its message, so one ref that cannot be written does not stop the others.
 */
async function advanceSignedSpaceRef(args: {
  readonly migrationsDir: string;
  readonly appRefsDir: string;
  readonly space: string;
  readonly name: string;
  readonly hash: string;
  readonly contractIR: ContractIR;
}): Promise<Result<string | undefined, { readonly reason: string; readonly cause: unknown }>> {
  const isApp = args.space === APP_SPACE_ID;
  const refsDir = isApp
    ? args.appRefsDir
    : spaceRefsDirectory(spaceMigrationDirectory(args.migrationsDir, args.space));
  try {
    const previousHash = await previousRefHash(refsDir, args.name);
    const written = isApp
      ? await advanceRefSafely({
          refsDir,
          migrationsDir: args.migrationsDir,
          name: args.name,
          hash: args.hash,
          contractIR: args.contractIR,
        })
      : await advanceExtensionRef({
          migrationsDir: args.migrationsDir,
          space: args.space,
          name: args.name,
          hash: args.hash,
        });
    return written.ok
      ? okResult(previousHash)
      : notOkResult({ reason: written.failure.message, cause: written.failure });
  } catch (error) {
    return notOkResult({
      reason: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }
}

/**
 * Builds the command with its control-client factory injected, so tests mount
 * the same tree over a fake client instead of mocking the client module.
 */
export function createDbSignCommand(
  createClient: typeof createControlClient = createControlClient,
) {
  return defineOrmCommand({
    help: {
      summary: 'Sign the database with your contract so you can safely run queries',
      description:
        'Verifies that your database schema satisfies the emitted contract and the\n' +
        'contract of every extension that ships one, and writes or updates the\n' +
        'signature of each that does. A signature records that this database\n' +
        'instance is aligned with a specific contract version.\n' +
        'Idempotent. After signing, the db ref of each signed space is advanced to\n' +
        'its contract; pass --no-advance-ref to sign without touching any ref,\n' +
        'which is what a CI or deployment pipeline usually wants.\n' +
        'Exit codes: 0 = signed, 2 = the command could not run (unresolvable\n' +
        'contract reference, no emitted contract, unreachable database), or it\n' +
        'signed the database but could not write every ref,\n' +
        '4 = schema verification failed for a space,\n' +
        'or its marker changed while db sign ran; its signature was not written.\n' +
        'Also 4 when a space requires invariants its marker does not record;\n' +
        'its signature is not written, and db migrate provides them.',
      examples: [
        'db sign',
        'db sign --db $DATABASE_URL',
        'db sign production --db $DATABASE_URL',
        'db sign --contract production --db $DATABASE_URL',
        'db sign --db $DATABASE_URL --advance-ref production',
        'db sign --db $DATABASE_URL --no-advance-ref',
      ],
    },
    args: {
      positionals: {
        contract: positional.optionalString({
          brief: CONTRACT_REF_BRIEF,
          placeholder: 'contract',
        }),
      },
      flags: {
        db: dbFlag,
        contract: flag.string({ brief: CONTRACT_REF_BRIEF, placeholder: 'contract' }),
        advanceRef: flag.string({
          brief: 'Advance the named ref to the post-command contract hash',
          placeholder: 'name',
        }),
        noAdvanceRef: flag.boolean({
          brief: 'Sign without advancing any ref (no ref file or snapshot is written)',
        }),
      },
    },
    needs: { config: ormConfigSection },
    exitCodes: {
      4: 'schema verification failed for a space, its marker changed while db sign ran, or it requires invariants its marker does not record; its signature was not written',
    },
    handler: async (args, ctx) => {
      const positionalContract = args.positionals.contract;
      const flagContract = args.flags.contract;
      if (positionalContract !== undefined && flagContract !== undefined) {
        return notOk(
          normalizeError(
            errorContractArgConflict({ positional: positionalContract, flag: flagContract }),
          ),
        );
      }
      const contractRef = positionalContract ?? flagContract;
      if (args.flags.noAdvanceRef && args.flags.advanceRef !== undefined) {
        return notOk(
          normalizeError(errorAdvanceRefArgConflict({ advanceRef: args.flags.advanceRef })),
        );
      }

      const emitted = await readEmittedContract({
        config: ctx.config,
        cwd: ctx.cwd,
        commandName: 'db sign',
      });
      if (!emitted.ok) {
        return notOk(emitted.failure);
      }

      const migrationsDir = migrationsDirFor(ctx.config);
      let contract: Contract = emitted.value.contract;
      let signedSource: SignedContractSource;
      if (contractRef !== undefined) {
        const resolvedRef = await resolveContractRefToSnapshot({
          config: ctx.config,
          migrationsDir,
          refInput: contractRef,
          argument: 'the contract argument',
          contractPathAbsolute: emitted.value.path,
          fallbackToEmitted: true,
        });
        if (!resolvedRef.ok) {
          return notOk(normalizeError(resolvedRef.failure));
        }
        const hydrated = hydrateContract(
          ctx.config,
          resolvedRef.value.contractJson,
          resolvedRef.value.contractJsonPath,
          resolvedRef.value.source === 'snapshot'
            ? {
                head:
                  resolvedRef.value.hash === emitted.value.contract.storage.storageHash
                    ? {
                        spaceId: APP_SPACE_ID,
                        reachedByMigration: true,
                      }
                    : undefined,
                invocation: cliInvocation(ctx, args.flags.db),
              }
            : undefined,
        );
        if (!hydrated.ok) {
          return notOk(normalizeError(hydrated.failure));
        }
        contract = hydrated.value;
        signedSource = {
          json: resolvedRef.value.contractJson,
          jsonPath: resolvedRef.value.contractJsonPath,
        };
      } else {
        signedSource = { json: emitted.value.json, jsonPath: emitted.value.path };
      }

      const client = createClient({
        family: ctx.config.family,
        target: ctx.config.target,
        adapter: ctx.config.adapter,
        ...ifDefined('driver', ctx.config.driver),
        extensions: ctx.config.extensions ?? [],
      });

      const refName = args.flags.noAdvanceRef
        ? null
        : (args.flags.advanceRef ?? DEFAULT_ADVANCE_REF);
      let advancement: { readonly name: string; readonly contractIR: ContractIR } | null = null;
      if (refName !== null) {
        const preflight = await preflightRefAdvancement({
          name: refName,
          contractJson: signedSource.json,
          contractJsonPath: signedSource.jsonPath,
          config: ctx.config,
          client,
        });
        if (!preflight.ok) {
          return notOk(normalizeError(preflight.failure));
        }
        advancement = { name: refName, contractIR: preflight.value };
      }

      const connection = requireVerifyConnection({
        config: ctx.config,
        db: args.flags.db,
        commandLine: 'db sign',
      });
      if (!connection.ok) {
        return notOk(connection.failure);
      }
      const dbConnection = connection.value;
      const invocation: CliInvocation = {
        ...cliInvocation(ctx, args.flags.db),
        rerunArgs: signRerunArgs({
          contractRef,
          advanceRef: args.flags.advanceRef,
          noAdvanceRef: args.flags.noAdvanceRef,
        }),
      };
      const rerun = rerunCommand(invocation);

      const header = headerBlock({
        contract: contractRef ?? emitted.value.displayPath,
        database: maskConnectionUrl(dbConnection),
      });

      try {
        const signed = await client.dbSign({
          contract,
          migrationsDir,
          invocation,
          connection: dbConnection,
          onProgress: controlProgressReporter(ctx.report),
        });
        if (!signed.ok) {
          return notOk(normalizeError(signed.failure));
        }
        const spaces = signed.value.spaces;

        const advanced: (AdvancedRef & { readonly previousHash: string | undefined })[] = [];
        const unwritten: (UnwrittenRef & { readonly cause: unknown })[] = [];
        if (advancement !== null) {
          for (const outcome of spaces) {
            if (!isSigned(outcome)) continue;
            const ref = {
              space: outcome.space,
              name: advancement.name,
              hash: outcome.contract.storageHash,
            };
            const written = await advanceSignedSpaceRef({
              ...ref,
              migrationsDir,
              appRefsDir: appRefsDirFor(ctx.config),
              contractIR: advancement.contractIR,
            });
            if (written.ok) {
              advanced.push({ ...ref, previousHash: written.value });
            } else {
              unwritten.push({ ...ref, ...written.failure });
            }
          }
        }
        const migrate = cliCommand(cliInvocation(ctx, args.flags.db), 'db migrate');
        const databaseRefused = databaseRefusedInRun(
          spaces.map((outcome) => failedSchemaOf(outcome)?.schema.issues ?? []),
        );
        const verdictDiagnostic = (space: string, schema: VerifyDatabaseSchemaResult) =>
          schemaVerdictDiagnostic({
            result: schema,
            space,
            databaseRefused,
            nextActions: schemaDriftNextActions({
              verb: 'sign',
              contractRef,
              issues: schema.schema.issues,
              databaseRefused,
            }),
          });
        const diagnostics: Diagnostic[] = spaces.flatMap((outcome) => {
          switch (outcome.status) {
            case 'failed':
              return [verdictDiagnostic(outcome.space, outcome.schema)];
            case 'conflict':
              return [markerConflictDiagnostic(outcome, rerun)];
            case 'missing-invariants':
              return [
                missingInvariantsDiagnostic(outcome, { migrate, databaseRefused }),
                ...(outcome.schema === undefined
                  ? []
                  : [verdictDiagnostic(outcome.space, outcome.schema)]),
              ];
            default:
              return [];
          }
        });
        if (unwritten.length > 0) {
          return notOk(
            normalizeError(
              errorSignRefsNotWritten({
                signedSpaces: spaces.filter(isSigned).map((outcome) => outcome.space),
                failedSpaces: spaces
                  .filter((outcome) => outcome.status === 'failed' && failsSchema(outcome))
                  .map((outcome) => outcome.space),
                lackingSpaces: spaces
                  .filter(refusedForDatabaseCapabilities)
                  .map((outcome) => outcome.space),
                conflictSpaces: spaces
                  .filter((outcome) => outcome.status === 'conflict')
                  .map((outcome) => outcome.space),
                refusedSpaces: spaces.flatMap((outcome) =>
                  outcome.status === 'missing-invariants'
                    ? [{ space: outcome.space, missingInvariants: outcome.missingInvariants }]
                    : [],
                ),
                unwrittenRefs: unwritten.map(({ space, name, hash, reason }) => ({
                  space,
                  name,
                  hash,
                  reason,
                })),
                advancedRefs: advanced.map(({ space, name, hash }) => ({ space, name, hash })),
                rerunCommand: rerun,
                migrateCommand: databaseRefused ? undefined : migrate,
                diagnostics,
                cause: unwritten[0]?.cause,
              }),
            ),
          );
        }

        const unsigned = spaces.filter((outcome) => !isSigned(outcome));
        const document: DbSignDocument = {
          ok: unsigned.length === 0,
          summary: signSummary(spaces),
          spaces,
          advancedRefs: advanced.map(({ space, name, hash }) => ({ space, name, hash })),
        };
        return ok(
          ctx.present(
            {
              data: document,
              exitCode: unsigned.length === 0 ? 0 : FINDINGS_EXIT_CODE,
              ...(diagnostics.length === 0 ? {} : { diagnostics }),
            },
            signPresentations({
              document,
              advanced: advancement === null ? null : advanced,
              header,
            }),
          ),
        );
      } catch (error) {
        return notOk(
          verificationThrow({ error, commandLine: 'db sign', connection: dbConnection }),
        );
      } finally {
        await closeQuietly(client);
      }
    },
  });
}
