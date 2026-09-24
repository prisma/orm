import { existsSync } from 'node:fs';
import { printPsl as printPslFromAst } from '@internal/psl-printer';
import { ifDefined } from '@internal/utils/defined';
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
import { pslOutputPathFor } from './paths';

interface PrintDocument {
  readonly ok: true;
  readonly summary: string;
  readonly target: { readonly familyId: string; readonly id: string };
  readonly psl: { readonly path: string };
  readonly source: readonly string[];
  /**
   * The contract's default control policy. A PSL file cannot carry it; the
   * config sets it on the PSL source, or the emitted contract loses it.
   */
  readonly defaultControlPolicy?: string;
  readonly timings: { readonly total: number };
}

/** Switching the config to the written file: emitting it produces the same contract. */
function switchToPrintedActions(document: PrintDocument): readonly NextAction[] {
  const policy = document.defaultControlPolicy;
  return [
    chooseAction(
      policy === undefined
        ? `Point contract in prisma.config.ts at ${document.psl.path}`
        : `Point contract in prisma.config.ts at ${document.psl.path}, with defaultControlPolicy '${policy}' on its source`,
    ),
    runCommandAction('Emit the printed contract', '{bin} contract emit'),
  ];
}

function defaultControlPolicyOf(contract: unknown): string | undefined {
  if (typeof contract !== 'object' || contract === null) return undefined;
  const policy = Reflect.get(contract, 'defaultControlPolicy');
  return typeof policy === 'string' ? policy : undefined;
}

function printPresentations(document: PrintDocument): Presentations {
  return {
    stdout: () => [],
    next: () => switchToPrintedActions(document),
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

/** What `contract print` uses of the control client; doubles implement just this. */
export type PrintControlClient = Pick<
  ControlClient,
  'printPslContract' | 'getPslBlockDescriptors' | 'close'
>;

export interface ContractPrintCommandDeps {
  readonly createControlClient: (options: ControlClientOptions) => PrintControlClient;
  readonly printPsl: typeof printPslFromAst;
}

function printHeaderComment(sourcePaths: readonly string[]): string {
  const origin = sourcePaths.length === 0 ? '' : ` from ${sourcePaths.join(', ')}`;
  return `// use prisma-8\n// Printed${origin} by \`prisma contract print\`.`;
}

/**
 * The contract source input the output path would be written over: the one it
 * names, or the directory of source files it sits inside. `undefined` when the
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

export function createContractPrintCommand({
  createControlClient,
  printPsl,
}: ContractPrintCommandDeps) {
  return defineOrmCommand({
    help: {
      summary: 'Write the configured contract as Prisma 8 PSL',
      description:
        'Loads the contract from contract.source in your config, whatever kind\n' +
        'of source that is, and writes it as a Prisma 8 PSL file. Emitting that\n' +
        'file produces the same contract: same hashes, same domain. If the\n' +
        'contract holds something PSL cannot express, the command refuses,\n' +
        'names it, and writes nothing. The command only writes the PSL file;\n' +
        'switch the config to it, then run `contract emit`. An existing file at\n' +
        'the output path is overwritten, with a warning.',
      examples: [
        'contract print',
        'contract print --output ./src/prisma/contract.prisma',
        'contract print --json',
      ],
    },
    args: {
      flags: {
        output: flag.string({
          brief: 'Write the printed PSL contract to the specified path',
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
              why: 'Config.contract.source is required for contract print. Define contract in your config so the command has a source to print.',
            }),
          ),
        );
      }
      const sourceInputs = contractConfig.source.inputs ?? [];
      const sourcePaths = sourceInputs.map((input) => relative(ctx.cwd, input));

      const outputPath = pslOutputPathFor({
        config: ctx.config,
        cwd: ctx.cwd,
        output: args.flags.output,
      });
      const displayPath = relative(ctx.cwd, outputPath);
      const sourceInput = sourceInputCovering({
        inputs: sourceInputs,
        cwd: ctx.cwd,
        outputPath,
      });
      if (sourceInput !== undefined) {
        return notOk(
          normalizeError(
            errorRuntime(
              'CONTRACT.PRINT_OUTPUT_IS_SOURCE',
              'contract print would write over its own contract source',
              {
                why: `The output path ${displayPath} is the contract source ${relative(ctx.cwd, sourceInput)}, or sits inside it, so printing would destroy the source it reads.`,
                fix: 'Pick another --output path, outside the source files the config names.',
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
      let defaultControlPolicy: string | undefined;
      try {
        const { stack, contract } = await loadContractSource({
          config: ctx.config,
          contractConfig,
          signal: ctx.signal,
        });
        defaultControlPolicy = defaultControlPolicyOf(contract);
        const pslContractAst = client.printPslContract(contract);
        if (pslContractAst === undefined) {
          return notOk(
            normalizeError(
              errorRuntime(
                'CONTRACT.PRINT_UNSUPPORTED',
                'contract print is not supported for this family',
                {
                  why: 'The configured family cannot print a contract as PSL, so nothing was written.',
                  fix: 'Use a family and target that can print a contract as PSL.',
                },
              ),
            ),
          );
        }
        pslContent = printPsl(pslContractAst, {
          pslBlockDescriptors: client.getPslBlockDescriptors(),
          codecLookup: stack.codecLookup,
          headerComment: printHeaderComment(sourcePaths),
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

      const document: PrintDocument = {
        ok: true,
        summary: 'Contract printed successfully',
        target: { familyId: ctx.config.family.familyId, id: ctx.config.target.targetId },
        psl: { path: displayPath },
        source: sourcePaths,
        ...ifDefined('defaultControlPolicy', defaultControlPolicy),
        timings: { total: Date.now() - startedAt },
      };

      return ok(ctx.present({ data: document }, printPresentations(document)));
    },
  });
}

export const contractPrintCommand = createContractPrintCommand({
  createControlClient: createDefaultControlClient,
  printPsl: printPslFromAst,
});
