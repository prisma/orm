import { existsSync } from 'node:fs';
import { printPsl as printPslFromAst } from '@internal/psl-printer';
import type { Block, Presentations } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { isAbsolute, relative } from 'pathe';
import { createControlClient as createDefaultControlClient } from '../../control-api/client';
import { resolveContractSource as resolveContractSourceOperation } from '../../control-api/operations/contract-emit';
import type { ControlClient, ControlClientOptions } from '../../control-api/types';
import { CliStructuredError, errorRuntime, errorUnexpected } from '../../utils/cli-errors';
import { closeQuietly } from '../../utils/command-helpers';
import { publishTextArtifact } from '../../utils/publish-text-artifact';
import { ormConfigSection } from '../config-section';
import { defineOrmCommand } from '../define-command';
import { normalizeError } from '../normalize-error';
import { controlProgressReporter } from '../progress';
import { inferredContractPathFor } from './paths';

const PRISMA7_SOURCE_FORMAT = 'prisma7';

interface ConvertDocument {
  readonly ok: true;
  readonly summary: string;
  readonly target: { readonly familyId: string; readonly id: string };
  readonly source: { readonly format: string; readonly input: string | undefined };
  readonly psl: { readonly path: string; readonly overwrote: boolean };
  readonly timings: { readonly total: number };
}

function convertPresentations(document: ConvertDocument): Presentations {
  return {
    stdout: () => [],
    next: () => [],
    human: (): readonly Block[] => [
      ...(document.source.input === undefined
        ? []
        : [
            {
              kind: 'fields' as const,
              rail: true,
              rows: [{ label: 'source', value: document.source.input }],
            },
          ]),
      ...(document.psl.overwrote
        ? [
            {
              kind: 'summary' as const,
              status: 'warn' as const,
              text: [
                { text: 'Overwrote existing file ' },
                { text: document.psl.path, tone: 'identifier' as const },
              ],
            },
          ]
        : []),
      {
        kind: 'summary',
        status: 'ok',
        text: [{ text: 'Contract written to ' }, { text: document.psl.path, tone: 'identifier' }],
      },
    ],
    json: () => document,
  };
}

/** What `contract convert` uses of the control client; doubles implement just this. */
export type ConvertControlClient = Pick<
  ControlClient,
  'printPslContract' | 'getPslBlockDescriptors' | 'close'
>;

export interface ContractConvertCommandDeps {
  readonly createControlClient: (options: ControlClientOptions) => ConvertControlClient;
  readonly resolveContractSource: typeof resolveContractSourceOperation;
  readonly printPsl: typeof printPslFromAst;
}

export function convertHeaderFor(input: string | undefined): string {
  const source = input ?? 'the Prisma 7 schema';
  return `// Converted from ${source} by \`prisma contract convert\`.`;
}

export function createContractConvertCommand({
  createControlClient,
  resolveContractSource,
  printPsl,
}: ContractConvertCommandDeps) {
  return defineOrmCommand({
    help: {
      summary: 'Print the configured Prisma 7 schema as a Prisma 8 PSL contract',
      description:
        'Loads the Prisma 7 schema the config points at with `prisma7Schema(...)`,\n' +
        'and writes the same contract as a Prisma 8 `contract.prisma`. Point\n' +
        '`contract:` at the written file to leave Prisma 7 behind; `contract emit`\n' +
        'then produces the identical contract. An existing file at the output path\n' +
        'is overwritten, with a warning. Offline — does not consult the database.',
      examples: [
        'contract convert',
        'contract convert --output ./src/prisma/contract.prisma',
        'contract convert --json',
      ],
    },
    args: {
      flags: {
        output: flag.string({
          brief: 'Write the converted PSL contract to the specified path',
          placeholder: 'path',
        }),
      },
    },
    needs: { config: ormConfigSection },
    handler: async (args, ctx) => {
      const startedAt = Date.now();
      const contractConfig = ctx.config.contract;
      const format = contractConfig?.source.format;
      if (contractConfig === undefined || format !== PRISMA7_SOURCE_FORMAT) {
        return notOk(
          normalizeError(
            errorRuntime(
              'CONTRACT.CONVERT_REQUIRES_PRISMA7_SOURCE',
              'contract convert applies only to a Prisma 7 schema source',
              {
                why:
                  format === undefined
                    ? 'The config has no contract source.'
                    : `The configured contract source has format "${format}"; only a source created with prisma7Schema(...) can be converted.`,
                fix: 'Point contract: at prisma7Schema("<path to schema.prisma>") in prisma.config.ts, then run contract convert again.',
                meta: { format },
              },
            ),
          ),
        );
      }
      // The config loader resolves source inputs to absolute paths; the header
      // and the document show the path as the user would write it.
      const configuredInput = contractConfig.source.inputs?.[0];
      const input =
        configuredInput !== undefined && isAbsolute(configuredInput)
          ? relative(ctx.cwd, configuredInput)
          : configuredInput;

      const client = createControlClient({
        family: ctx.config.family,
        target: ctx.config.target,
        adapter: ctx.config.adapter,
        ...(ctx.config.driver === undefined ? {} : { driver: ctx.config.driver }),
        extensions: ctx.config.extensions ?? [],
      });

      let pslContent: string;
      try {
        const { validatedContract } = await resolveContractSource({
          config: ctx.config,
          contractConfig,
          commandName: 'contract convert',
          signal: ctx.signal,
          onProgress: controlProgressReporter(ctx.report),
        });
        const ast = client.printPslContract(validatedContract.value);
        if (ast === undefined) {
          return notOk(
            normalizeError(
              errorRuntime(
                'CONTRACT.CONVERT_UNSUPPORTED',
                'contract convert is not supported for this target',
                {
                  why: 'The configured components do not implement the PslContractPrintCapable capability, so the contract cannot be printed as PSL.',
                  fix: 'Use a target package that supports contract convert.',
                  meta: { targetId: ctx.config.target.targetId },
                },
              ),
            ),
          );
        }
        pslContent = printPsl(ast, {
          header: convertHeaderFor(input),
          pslBlockDescriptors: client.getPslBlockDescriptors(),
        });
      } catch (error) {
        if (CliStructuredError.is(error)) {
          return notOk(normalizeError(error));
        }
        const message = error instanceof Error ? error.message : String(error);
        return notOk(
          normalizeError(
            errorUnexpected(message, {
              why: `Unexpected error during contract convert: ${message}`,
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
      const overwrote = existsSync(outputPath);
      await publishTextArtifact({
        path: outputPath,
        content: pslContent,
        publicationToken: String(process.hrtime.bigint()),
      });

      const document: ConvertDocument = {
        ok: true,
        summary: 'Contract converted successfully',
        target: { familyId: ctx.config.family.familyId, id: ctx.config.target.targetId },
        source: { format, input },
        psl: { path: displayPath, overwrote },
        timings: { total: Date.now() - startedAt },
      };
      return ok(ctx.present({ data: document }, convertPresentations(document)));
    },
  });
}

export const contractConvertCommand = createContractConvertCommand({
  createControlClient: createDefaultControlClient,
  resolveContractSource: resolveContractSourceOperation,
  printPsl: printPslFromAst,
});
