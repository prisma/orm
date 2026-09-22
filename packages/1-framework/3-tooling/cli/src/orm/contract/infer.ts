import { existsSync } from 'node:fs';
import { ormConfigSection } from '@internal/config-loader';
import { printPsl as printPslFromAst } from '@internal/psl-printer';
import { ifDefined } from '@internal/utils/defined';
import type { Block, Presentations } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { relative } from 'pathe';
import { createControlClient as createDefaultControlClient } from '../../control-api/client';
import type { ControlClient, ControlClientOptions } from '../../control-api/types';
import {
  CliStructuredError,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorRuntime,
  errorUnexpected,
} from '../../utils/cli-errors';
import { closeQuietly, maskConnectionUrl, sanitizeErrorMessage } from '../../utils/command-helpers';
import { publishTextArtifact } from '../../utils/publish-text-artifact';
import { defineOrmCommand } from '../define-command';
import { dbFlag } from '../flags';
import { normalizeError } from '../normalize-error';
import { controlProgressReporter } from '../progress';
import { inferredContractPathFor } from './paths';

interface InferDocument {
  readonly ok: true;
  readonly summary: string;
  readonly target: { readonly familyId: string; readonly id: string };
  readonly psl: { readonly path: string };
  readonly meta: { readonly dbUrl?: string };
  readonly timings: { readonly total: number };
}

function inferPresentations(inputs: {
  readonly document: InferDocument;
  readonly database: string | undefined;
}): Presentations {
  const { document, database } = inputs;
  return {
    stdout: () => [],
    next: () => [],
    human: (): readonly Block[] => [
      ...(database === undefined
        ? []
        : [
            {
              kind: 'fields' as const,
              rail: true,
              rows: [{ label: 'database', value: database }],
            },
          ]),
      {
        kind: 'summary',
        status: 'ok',
        text: [{ text: 'Contract written to ' }, { text: document.psl.path, tone: 'identifier' }],
      },
    ],
    json: () => document,
  };
}

/** What `contract infer` uses of the control client; doubles implement just this. */
export type InferControlClient = Pick<
  ControlClient,
  'introspect' | 'inferPslContract' | 'getPslBlockDescriptors' | 'close'
>;

export interface ContractInferCommandDeps {
  readonly createControlClient: (options: ControlClientOptions) => InferControlClient;
  readonly printPsl: typeof printPslFromAst;
}

export function createContractInferCommand({
  createControlClient,
  printPsl,
}: ContractInferCommandDeps) {
  return defineOrmCommand({
    help: {
      summary: 'Infer a PSL contract from the live database schema',
      description:
        'Reads the live database schema and writes an inferred PSL contract to\n' +
        'disk. This command stops at contract.prisma; follow it with\n' +
        '`contract emit` and `db sign` as separate steps. An existing file at the\n' +
        'output path is overwritten, with a warning.',
      examples: [
        'contract infer --db $DATABASE_URL',
        'contract infer --db $DATABASE_URL --output ./src/prisma/contract.prisma',
        'contract infer --json',
      ],
    },
    args: {
      flags: {
        db: dbFlag,
        output: flag.string({
          brief: 'Write the inferred PSL contract to the specified path',
          placeholder: 'path',
        }),
      },
    },
    needs: { config: ormConfigSection },
    handler: async (args, ctx) => {
      const startedAt = Date.now();
      const dbConnection = args.flags.db ?? ctx.config.db?.connection;
      if (dbConnection === undefined) {
        return notOk(
          normalizeError(
            errorDatabaseConnectionRequired({
              why: 'Database connection is required for contract infer (set db.connection in prisma.config.ts, or pass --db <url>)',
              commandName: 'contract infer',
              missingFlags: ['--db'],
            }),
          ),
        );
      }
      if (ctx.config.driver === undefined) {
        return notOk(
          normalizeError(
            errorDriverRequired({ why: 'Config.driver is required for contract infer' }),
          ),
        );
      }

      const client = createControlClient({
        family: ctx.config.family,
        target: ctx.config.target,
        adapter: ctx.config.adapter,
        driver: ctx.config.driver,
        extensions: ctx.config.extensions ?? [],
      });

      let pslContent: string;
      try {
        const schema = await client.introspect({
          connection: dbConnection,
          onProgress: controlProgressReporter(ctx.report),
        });
        const pslContractAst = client.inferPslContract(schema);
        if (pslContractAst === undefined) {
          return notOk(
            normalizeError(
              errorRuntime(
                'CONTRACT.INFER_UNSUPPORTED',
                'contract infer is not supported for this family',
                {
                  why: 'The configured family does not implement the PslContractInferCapable capability, so an inferred PSL contract cannot be produced from the live database schema.',
                  // biome-ignore lint/plugin/no-family-vocabulary: names a family on purpose — this is user-facing guidance about which family to switch to, not a framework type
                  fix: 'Use a family that supports contract inference (e.g. SQL/Postgres).',
                },
              ),
            ),
          );
        }
        pslContent = printPsl(pslContractAst, {
          pslBlockDescriptors: client.getPslBlockDescriptors(),
        });
      } catch (error) {
        if (CliStructuredError.is(error)) {
          return notOk(normalizeError(error));
        }
        const safeMessage = sanitizeErrorMessage(
          error instanceof Error ? error.message : String(error),
          typeof dbConnection === 'string' ? dbConnection : undefined,
        );
        return notOk(
          normalizeError(
            errorUnexpected(safeMessage, {
              why: `Unexpected error during contract infer: ${safeMessage}`,
            }),
          ),
        );
      } finally {
        await closeQuietly(client);
      }

      const outputPath = inferredContractPathFor({
        config: ctx.config,
        cwd: ctx.cwd,
        output: args.flags.output,
      });
      const displayPath = relative(ctx.cwd, outputPath);
      if (existsSync(outputPath)) {
        ctx.report({
          kind: 'message',
          severity: 'warn',
          text: `Overwriting existing file: ${displayPath}`,
        });
      }
      await publishTextArtifact({
        path: outputPath,
        content: pslContent,
        publicationToken: String(process.hrtime.bigint()),
      });

      const database =
        typeof dbConnection === 'string' ? maskConnectionUrl(dbConnection) : undefined;
      const document: InferDocument = {
        ok: true,
        summary: 'Contract inferred successfully',
        target: { familyId: ctx.config.family.familyId, id: ctx.config.target.targetId },
        psl: { path: displayPath },
        meta: { ...ifDefined('dbUrl', database) },
        timings: { total: Date.now() - startedAt },
      };

      return ok(ctx.present({ data: document }, inferPresentations({ document, database })));
    },
  });
}

export const contractInferCommand = createContractInferCommand({
  createControlClient: createDefaultControlClient,
  printPsl: printPslFromAst,
});
