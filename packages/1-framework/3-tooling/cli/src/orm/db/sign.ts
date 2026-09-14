import type {
  SignDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import { readRef } from '@internal/migration-tools/refs';
import { ifDefined } from '@internal/utils/defined';
import { InternalError, isInternalError } from '@internal/utils/internal-error';
import type { Block, Presentations, Span } from '@prisma/cli-engine';
import { flag, positional } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { createControlClient } from '../../control-api/client';
import { resolveContractRefToSnapshot } from '../../control-api/operations/contract-snapshot-resolution';
import {
  advanceRefSafely,
  type ContractIR,
  preflightRefAdvancement,
} from '../../control-api/operations/ref-advancement';
import { errorAdvanceRefArgConflict, errorContractArgConflict } from '../../utils/cli-errors';
import { closeQuietly, maskConnectionUrl } from '../../utils/command-helpers';
import { runCommandAction } from '../../utils/next-actions';
import { ormConfigSection } from '../config-section';
import { defineOrmCommand } from '../define-command';
import { dbFlag } from '../flags';
import {
  appRefsDirFor,
  displayPath,
  migrationsDirFor,
  projectConfigPathFor,
} from '../migration/paths';
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
 * Verification ran and refused the signature. The command completed — it
 * answered the question "may this database be signed?" — so the refusal is a
 * diagnostic on a completed envelope rather than an error.
 */
const FINDINGS_EXIT_CODE = 4;

/** The config file this bin reads; the handler is not told which one was loaded. */
const CONFIG_DISPLAY_PATH = 'prisma.config.ts';

/**
 * The refusal document. `schemaVerify` never evaluates unclaimed elements, so
 * the document carries no `unclaimed` key at all — `db verify` reports the
 * same absence when the check did not run, and an empty array would read as
 * "evaluated, none found".
 */
type SchemaVerifyDocument = VerifyDatabaseSchemaResult;

/**
 * The ref a signature checkpoints. Unlike `db init` / `db update`, `--db` does
 * not suppress the write: signing does not touch the schema, and adoption is
 * normally done against the real database via `--db`. Only `--no-advance-ref`
 * suppresses it.
 */
const DEFAULT_ADVANCE_REF = 'db';

interface AdvancedRef {
  readonly name: string;
  readonly hash: string;
  readonly previousHash: string | undefined;
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

interface DbSignDocument extends SignDatabaseResult {
  readonly advancedRef: { readonly name: string; readonly hash: string } | null;
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

function advancedRefSpans(advanced: AdvancedRef): readonly Span[] {
  return [
    { text: `Advanced ref "${advanced.name}" → ` },
    { text: advanced.hash, tone: 'identifier' },
    ...(advanced.previousHash === undefined
      ? []
      : [
          { text: ' (was ', tone: 'muted' as const },
          { text: advanced.previousHash, tone: 'identifier' as const },
          { text: ')', tone: 'muted' as const },
        ]),
  ];
}

function refOutcomeBlock(advanced: AdvancedRef | null): Block {
  return advanced === null
    ? {
        kind: 'summary',
        status: 'info',
        tone: 'muted',
        text: `Left ref "${DEFAULT_ADVANCE_REF}" untouched (--no-advance-ref)`,
      }
    : { kind: 'summary', status: 'ok', text: advancedRefSpans(advanced) };
}

function signPresentations(inputs: {
  readonly document: DbSignDocument;
  readonly advanced: AdvancedRef | null;
  readonly header: Block;
}): Presentations {
  const marker = inputs.document.marker;
  return {
    stdout: () => [],
    next: () => [],
    human: (): readonly Block[] => [
      inputs.header,
      { kind: 'summary', status: 'ok', text: 'Database signed' },
      {
        kind: 'fields',
        rows: [
          {
            label: 'from',
            value:
              marker.previous?.storageHash === undefined
                ? [{ text: 'none', tone: 'muted' }]
                : [{ text: marker.previous.storageHash, tone: 'identifier' }],
          },
          {
            label: 'to',
            value: [{ text: inputs.document.contract.storageHash, tone: 'identifier' }],
          },
        ],
      },
      refOutcomeBlock(inputs.advanced),
    ],
    json: () => inputs.document,
  };
}

function refusedPresentations(inputs: {
  readonly document: SchemaVerifyDocument;
  readonly header: Block;
}): Presentations {
  return {
    stdout: () => [],
    next: () => [],
    human: (): readonly Block[] => [
      inputs.header,
      ...schemaFindingBlocks({ result: inputs.document, unclaimed: [], strict: false }),
      { kind: 'summary', status: 'error', text: inputs.document.summary },
    ],
    json: () => inputs.document,
  };
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
        'Verifies that your database schema satisfies the emitted contract, and if\n' +
        'so, writes or updates the database signature. The signature records that\n' +
        'this database instance is aligned with a specific contract version.\n' +
        'Idempotent. After signing, the db ref in the checkout is advanced to the\n' +
        'signed contract; pass --no-advance-ref to sign without touching any ref,\n' +
        'which is what a CI or deployment pipeline usually wants.\n' +
        'Exit codes: 0 = signed, 2 = the command could not run (unresolvable\n' +
        'contract reference, no emitted contract, unreachable database),\n' +
        '4 = schema verification failed and no signature was written.',
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
          brief: 'Contract reference (hash, prefix, ref name, or migration dir name)',
          placeholder: 'contract',
        }),
      },
      flags: {
        db: dbFlag,
        contract: flag.string({
          brief:
            'Contract reference (hash, prefix, ref name, migration dir name, <dir>^, or ./path)',
          placeholder: 'contract',
        }),
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
    exitCodes: { 4: 'schema verification failed; no signature was written' },
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

      const migrationsDir = migrationsDirFor(ctx.config, ctx.cwd);
      let contractInput: unknown = emitted.value.contract;
      let signedSource: SignedContractSource;
      if (contractRef !== undefined) {
        const resolvedRef = await resolveContractRefToSnapshot({
          config: ctx.config,
          migrationsDir,
          refInput: contractRef,
          contractPathAbsolute: emitted.value.path,
          fallbackToEmitted: true,
        });
        if (!resolvedRef.ok) {
          return notOk(normalizeError(resolvedRef.failure));
        }
        contractInput = resolvedRef.value.contractJson;
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
          configPath: projectConfigPathFor(ctx.cwd),
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
        invocation: 'db sign',
      });
      if (!connection.ok) {
        return notOk(connection.failure);
      }
      const dbConnection = connection.value;

      const header = headerBlock({
        contract: contractRef ?? emitted.value.displayPath,
        database: maskConnectionUrl(dbConnection),
      });
      const onProgress = controlProgressReporter(ctx.report);

      try {
        const verified = await client.schemaVerify({
          contract: contractInput,
          strict: false,
          connection: dbConnection,
          onProgress,
        });
        if (!verified.ok) {
          const document: SchemaVerifyDocument = verified;
          return ok(
            ctx.present(
              {
                data: document,
                exitCode: FINDINGS_EXIT_CODE,
                diagnostics: [
                  schemaVerdictDiagnostic({
                    result: verified,
                    space: undefined,
                    nextActions: [
                      runCommandAction(
                        'Bring the database up to the contract, then sign again',
                        '{bin} db update',
                      ),
                    ],
                  }),
                ],
              },
              refusedPresentations({ document, header }),
            ),
          );
        }

        const signed = await client.sign({
          contract: contractInput,
          contractPath: displayPath(emitted.value.path, ctx.cwd),
          configPath: CONFIG_DISPLAY_PATH,
          onProgress,
        });
        // The control contract says a family either writes the marker or throws,
        // so a returned `ok: false` is a family breaking that contract rather
        // than anything the user did.
        if (!signed.ok) {
          throw new InternalError(
            `The family returned a sign result that did not sign: ${signed.summary}`,
          );
        }

        if (advancement === null) {
          const document: DbSignDocument = { ...signed, advancedRef: null };
          return ok(
            ctx.present(
              { data: document, exitCode: 0 },
              signPresentations({ document, advanced: null, header }),
            ),
          );
        }

        const refsDir = appRefsDirFor(ctx.config, ctx.cwd);
        const previousHash = await previousRefHash(refsDir, advancement.name);
        const advanced = await advanceRefSafely({
          refsDir,
          migrationsDir,
          name: advancement.name,
          hash: signed.contract.storageHash,
          contractIR: advancement.contractIR,
        });
        if (!advanced.ok) {
          return notOk(normalizeError(advanced.failure));
        }

        const document: DbSignDocument = { ...signed, advancedRef: advanced.value };
        return ok(
          ctx.present(
            { data: document, exitCode: 0 },
            signPresentations({
              document,
              advanced: { ...advanced.value, previousHash },
              header,
            }),
          ),
        );
      } catch (error) {
        if (isInternalError(error)) {
          throw error;
        }
        return notOk(verificationThrow({ error, invocation: 'db sign', connection: dbConnection }));
      } finally {
        await closeQuietly(client);
      }
    },
  });
}

export const dbSignCommand = createDbSignCommand();
