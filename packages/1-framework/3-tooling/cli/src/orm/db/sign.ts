import type {
  SignDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import { InternalError, isInternalError } from '@internal/utils/internal-error';
import type { Block, Presentations } from '@prisma/cli-engine';
import { flag, positional } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { createControlClient } from '../../control-api/client';
import { resolveContractRefToSnapshot } from '../../control-api/operations/contract-snapshot-resolution';
import { errorContractArgConflict } from '../../utils/cli-errors';
import { closeQuietly, maskConnectionUrl } from '../../utils/command-helpers';
import { runCommandAction } from '../../utils/next-actions';
import { ormConfigSection } from '../config-section';
import { defineOrmCommand } from '../define-command';
import { dbFlag } from '../flags';
import { displayPath, migrationsDirFor } from '../migration/paths';
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

function signPresentations(inputs: {
  readonly document: SignDatabaseResult;
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
        'so, writes or updates the database signature. Idempotent and safe to run\n' +
        'in CI or a deployment pipeline. The signature records that this database\n' +
        'instance is aligned with a specific contract version.\n' +
        'Exit codes: 0 = signed, 2 = the command could not run (unresolvable\n' +
        'contract reference, no emitted contract, unreachable database),\n' +
        '4 = schema verification failed and no signature was written.',
      examples: [
        'db sign',
        'db sign --db $DATABASE_URL',
        'db sign production --db $DATABASE_URL',
        'db sign --contract production --db $DATABASE_URL',
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

      const emitted = await readEmittedContract({
        config: ctx.config,
        cwd: ctx.cwd,
        commandName: 'db sign',
      });
      if (!emitted.ok) {
        return notOk(emitted.failure);
      }

      let contractInput: unknown = emitted.value.contract;
      if (contractRef !== undefined) {
        const resolvedRef = await resolveContractRefToSnapshot({
          config: ctx.config,
          migrationsDir: migrationsDirFor(ctx.config, ctx.cwd),
          refInput: contractRef,
          contractPathAbsolute: emitted.value.path,
          fallbackToEmitted: true,
        });
        if (!resolvedRef.ok) {
          return notOk(normalizeError(resolvedRef.failure));
        }
        contractInput = resolvedRef.value.contractJson;
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
      const client = createClient({
        family: ctx.config.family,
        target: ctx.config.target,
        adapter: ctx.config.adapter,
        ...ifDefined('driver', ctx.config.driver),
        extensions: ctx.config.extensions ?? [],
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
        return ok(
          ctx.present(
            { data: signed, exitCode: 0 },
            signPresentations({ document: signed, header }),
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
