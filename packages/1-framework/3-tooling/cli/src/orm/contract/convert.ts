import { existsSync } from 'node:fs';
import { printPsl as printPslFromAst } from '@internal/psl-printer';
import type { Block, Presentations } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import type { NextAction } from '@prisma/cli-engine/protocol';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { relative, resolve } from 'pathe';
import { createControlClient as createDefaultControlClient } from '../../control-api/client';
import { loadContractSource } from '../../control-api/operations/load-contract-source';
import type { ControlClient, ControlClientOptions } from '../../control-api/types';
import { errorContractConfigMissing, errorRuntime } from '../../utils/cli-errors';
import { closeQuietly } from '../../utils/command-helpers';
import { chooseAction, runCommandAction } from '../../utils/next-actions';
import { publishTextArtifact } from '../../utils/publish-text-artifact';
import { ormConfigSection } from '../config-section';
import { defineOrmCommand } from '../define-command';
import { normalizeError } from '../normalize-error';
import { inferredContractPathFor } from './paths';

interface ConvertDocument {
  readonly ok: true;
  readonly summary: string;
  readonly target: { readonly familyId: string; readonly id: string };
  readonly psl: { readonly path: string };
  readonly source: string;
  readonly timings: { readonly total: number };
}

/**
 * The routine that carries a converted contract onto the database Prisma 7
 * built: point the config at the written file, emit, plan a baseline, sign,
 * then point the `db` ref at the baseline.
 */
function cutoverActions(writtenPath: string): readonly NextAction[] {
  return [
    chooseAction(`Point contract in prisma.config.ts at ${writtenPath}`),
    runCommandAction('Emit the converted contract', '{bin} contract emit'),
    runCommandAction('Plan the baseline migration', '{bin} migration plan --name baseline'),
    runCommandAction('Sign the database', '{bin} db sign'),
    runCommandAction(
      'Point the db ref at the baseline migration',
      '{bin} migration ref set db <timestamp>_baseline',
    ),
  ];
}

function convertPresentations(document: ConvertDocument): Presentations {
  return {
    stdout: () => [],
    next: () => cutoverActions(document.psl.path),
    human: (): readonly Block[] => [
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
  readonly printPsl: typeof printPslFromAst;
}

function convertHeaderComment(schemaPath: string): string {
  return `// use prisma-8\n// Converted from ${schemaPath} by \`prisma contract convert\`.`;
}

/**
 * The contract source input the output path would be written over: the one it
 * names, or the directory of schema files it sits inside. `undefined` when the
 * output path touches no input.
 */
function sourceInputCovering(inputs: {
  readonly inputs: readonly string[];
  readonly cwd: string;
  readonly outputPath: string;
}): string | undefined {
  return inputs.inputs.find((input) => {
    const resolved = resolve(inputs.cwd, input);
    return (
      resolved === inputs.outputPath ||
      inputs.outputPath.startsWith(`${resolved.replace(/\/$/, '')}/`)
    );
  });
}

export function createContractConvertCommand({
  createControlClient,
  printPsl,
}: ContractConvertCommandDeps) {
  return defineOrmCommand({
    help: {
      summary: 'Convert a Prisma 7 schema into a Prisma 8 PSL contract',
      description:
        'Reads the Prisma 7 schema the config names as the contract source and\n' +
        'writes the Prisma 8 PSL that produces the same contract. The command\n' +
        'stops at contract.prisma; switch the config to the written file, then\n' +
        'run `contract emit` and the rest of the cutover. An existing file at the\n' +
        'output path is overwritten, with a warning.',
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
      if (contractConfig?.source === undefined) {
        return notOk(
          normalizeError(
            errorContractConfigMissing({
              why: 'Config.contract.source is required for contract convert. Define it in your config: contract: prisma7Schema("./schema.prisma")',
            }),
          ),
        );
      }
      if (contractConfig.source.format !== 'prisma7') {
        return notOk(
          normalizeError(
            errorRuntime(
              'CONTRACT.CONVERT_SOURCE_NOT_PRISMA7',
              'contract convert applies only to a Prisma 7 source',
              {
                why: `The configured contract source has format "${contractConfig.source.format ?? 'unspecified'}", and there is nothing to convert: the contract is already authored the Prisma 8 way.`,
                fix: 'Point contract at prisma7Schema("./schema.prisma") to convert a Prisma 7 schema.',
                meta: { format: contractConfig.source.format ?? null },
              },
            ),
          ),
        );
      }

      const schemaInput = contractConfig.source.inputs?.[0];
      if (schemaInput === undefined) {
        return notOk(
          normalizeError(
            errorContractConfigMissing({
              why: 'The Prisma 7 contract source names no schema file, so there is nothing to convert.',
            }),
          ),
        );
      }
      const schemaPath = relative(ctx.cwd, schemaInput);

      const outputPath = inferredContractPathFor({
        config: ctx.config,
        cwd: ctx.cwd,
        output: args.flags.output,
      });
      const displayPath = relative(ctx.cwd, outputPath);
      const sourceInput = sourceInputCovering({
        inputs: contractConfig.source.inputs ?? [],
        cwd: ctx.cwd,
        outputPath,
      });
      if (sourceInput !== undefined) {
        return notOk(
          normalizeError(
            errorRuntime(
              'CONTRACT.CONVERT_OUTPUT_IS_SOURCE',
              'contract convert would write over the schema it reads',
              {
                why: `The output path ${displayPath} is the contract source ${relative(ctx.cwd, sourceInput)}, or sits inside it, so converting would destroy the Prisma 7 schema.`,
                fix: 'Pick another --output path, outside the Prisma 7 schema the config names.',
                meta: { output: displayPath, source: relative(ctx.cwd, sourceInput) },
              },
            ),
          ),
        );
      }

      const client = createControlClient({
        family: ctx.config.family,
        target: ctx.config.target,
        adapter: ctx.config.adapter,
        ...(ctx.config.driver === undefined ? {} : { driver: ctx.config.driver }),
        extensions: ctx.config.extensions ?? [],
      });

      let pslContent: string;
      try {
        const { stack, contract } = await loadContractSource({
          config: ctx.config,
          contractConfig,
          signal: ctx.signal,
        });
        const pslContractAst = client.printPslContract(contract);
        if (pslContractAst === undefined) {
          return notOk(
            normalizeError(
              errorRuntime(
                'CONTRACT.CONVERT_UNSUPPORTED',
                'contract convert is not supported for this target',
                {
                  why: 'The configured target does not implement the PslContractPrintCapable capability, so the loaded contract cannot be written as Prisma 8 PSL.',
                  // biome-ignore lint/plugin/no-family-vocabulary: names a target on purpose — this is user-facing guidance about which target can convert, not a framework type
                  fix: 'Use a target that supports contract conversion (Postgres today).',
                },
              ),
            ),
          );
        }
        pslContent = printPsl(pslContractAst, {
          pslBlockDescriptors: client.getPslBlockDescriptors(),
          codecLookup: stack.codecLookup,
          headerComment: convertHeaderComment(schemaPath),
        });
      } catch (error) {
        return notOk(normalizeError(error));
      } finally {
        await closeQuietly(client);
      }
      ctx.signal.throwIfAborted();

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

      const document: ConvertDocument = {
        ok: true,
        summary: 'Contract converted successfully',
        target: { familyId: ctx.config.family.familyId, id: ctx.config.target.targetId },
        psl: { path: displayPath },
        source: schemaPath,
        timings: { total: Date.now() - startedAt },
      };

      return ok(ctx.present({ data: document }, convertPresentations(document)));
    },
  });
}

export const contractConvertCommand = createContractConvertCommand({
  createControlClient: createDefaultControlClient,
  printPsl: printPslFromAst,
});
