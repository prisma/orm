import { existsSync } from 'node:fs';
import { getEmittedArtifactPaths } from '@internal/emitter';
import type { CliStructuredError } from '@internal/errors/control';
import { printPsl as printPslFromAst } from '@internal/psl-printer';
import { ifDefined } from '@internal/utils/defined';
import type { Block, Presentations } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import type { NextAction } from '@prisma/cli-engine/protocol';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { relative, resolve } from 'pathe';
import {
  type ContractPrintResult,
  executeContractPrint,
} from '../../control-api/operations/contract-print';
import { errorContractConfigMissing, errorRuntime } from '../../utils/cli-errors';
import { chooseAction, runCommandAction } from '../../utils/next-actions';
import { publishTextArtifact } from '../../utils/publish-text-artifact';
import { ormConfigSection } from '../config-section';
import { defineOrmCommand } from '../define-command';
import { projectConfigPathFor } from '../migration/paths';
import { normalizeError } from '../normalize-error';
import { emittedJsonPathFor, filePathKey, pslOutputPathFor } from './paths';

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

/** The emitted files `contract emit` writes now, and after the config switches to the printed file. */
interface EmittedFilesMove {
  readonly before: { readonly json: string; readonly dts: string };
  readonly after: { readonly json: string; readonly dts: string };
}

function switchToPrintedActions(
  document: PrintDocument,
  emittedFilesMove: EmittedFilesMove | undefined,
): readonly NextAction[] {
  const path = document.psl.path;
  const policy = document.defaultControlPolicy;
  return [
    chooseAction(
      policy === undefined
        ? `Point contract in prisma.config.ts at ${path}`
        : `Point contract in prisma.config.ts at ${path}, through a PSL source that sets defaultControlPolicy: '${policy}'`,
    ),
    ...(emittedFilesMove === undefined
      ? []
      : [
          chooseAction(
            `With contract: './${path}' and no output in prisma.config.ts, contract emit writes ${emittedFilesMove.after.json} and ${emittedFilesMove.after.dts}, not ${emittedFilesMove.before.json} and ${emittedFilesMove.before.dts}`,
          ),
        ]),
    runCommandAction('Emit the printed contract', '{bin} contract emit'),
  ];
}

function defaultControlPolicyWarning(policy: string): string {
  return `The contract's default control policy is '${policy}', and a PSL file cannot carry it. Set defaultControlPolicy: '${policy}' on the PSL source in prisma.config.ts. Without it, the emitted contract has no default control policy, and everything that sets no control policy of its own is treated as managed.`;
}

function printPresentations(
  document: PrintDocument,
  emittedFilesMove: EmittedFilesMove | undefined,
): Presentations {
  return {
    stdout: () => [],
    next: () => switchToPrintedActions(document, emittedFilesMove),
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

export interface ContractPrintCommandDeps {
  readonly printPsl: typeof printPslFromAst;
}

function printDescription(sourcePaths: readonly string[]): string {
  const origin = sourcePaths.length === 0 ? '' : ` from ${sourcePaths.join(', ')}`;
  return `Printed${origin} by \`prisma contract print\`.`;
}

async function isSameFile(outputKey: string, path: string): Promise<boolean> {
  return outputKey === (await filePathKey(path));
}

async function isSameFileOrInside(outputKey: string, path: string): Promise<boolean> {
  const key = await filePathKey(path);
  return outputKey === key || outputKey.startsWith(`${key.replace(/\/$/, '')}/`);
}

/**
 * The refusal for an output path that would write over a file the project
 * needs: a contract source input, or a file inside a directory of inputs; the
 * config file; or a file `contract emit` writes. `undefined` when the path
 * touches none of them.
 */
async function outputPathRefusal(inputs: {
  readonly cwd: string;
  readonly outputPath: string;
  readonly sourceInputs: readonly string[];
  readonly emittedJsonPath: string | undefined;
}): Promise<CliStructuredError | undefined> {
  const { cwd } = inputs;
  const output = relative(cwd, inputs.outputPath);
  const outputKey = await filePathKey(inputs.outputPath);

  for (const input of inputs.sourceInputs) {
    if (await isSameFileOrInside(outputKey, resolve(cwd, input))) {
      const source = relative(cwd, resolve(cwd, input));
      return errorRuntime(
        'CONTRACT.PRINT_OUTPUT_IS_SOURCE',
        'contract print would write over its own contract source',
        {
          why: `The output path ${output} is the contract source ${source}, or sits inside it, so printing would destroy the source it reads.`,
          fix: 'Pick another --output path, outside the source files the config names.',
          meta: { output, source },
        },
      );
    }
  }

  const configPath = projectConfigPathFor(cwd);
  if (await isSameFile(outputKey, configPath)) {
    const file = relative(cwd, configPath);
    return errorRuntime(
      'CONTRACT.PRINT_OUTPUT_IS_PROJECT_FILE',
      'contract print would write over the config file',
      {
        why: `The output path ${output} is ${file}, the file the CLI reads its config from unless --config names another.`,
        fix: 'Pick another --output path.',
        meta: { output, file },
      },
    );
  }

  if (inputs.emittedJsonPath === undefined) {
    return undefined;
  }
  const emitted = getEmittedArtifactPaths(inputs.emittedJsonPath);
  for (const emittedPath of [emitted.jsonPath, emitted.dtsPath]) {
    if (await isSameFile(outputKey, emittedPath)) {
      const file = relative(cwd, emittedPath);
      return errorRuntime(
        'CONTRACT.PRINT_OUTPUT_IS_PROJECT_FILE',
        'contract print would write over an emitted contract file',
        {
          why: `The output path ${output} is ${file}, a file contract emit writes, so the next contract emit would write over the printed PSL.`,
          fix: 'Pick another --output path.',
          meta: { output, file },
        },
      );
    }
  }
  return undefined;
}

function emittedFilesMoveFor(inputs: {
  readonly cwd: string;
  readonly outputPath: string;
  readonly emittedJsonPath: string | undefined;
}): EmittedFilesMove | undefined {
  if (inputs.emittedJsonPath === undefined) {
    return undefined;
  }
  const before = getEmittedArtifactPaths(inputs.emittedJsonPath);
  const after = getEmittedArtifactPaths(emittedJsonPathFor(inputs.outputPath));
  if (after.jsonPath === before.jsonPath) {
    return undefined;
  }
  return {
    before: {
      json: relative(inputs.cwd, before.jsonPath),
      dts: relative(inputs.cwd, before.dtsPath),
    },
    after: { json: relative(inputs.cwd, after.jsonPath), dts: relative(inputs.cwd, after.dtsPath) },
  };
}

export function createContractPrintCommand({ printPsl }: ContractPrintCommandDeps) {
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
      const emittedJsonPath =
        contractConfig.output === undefined ? undefined : resolve(ctx.cwd, contractConfig.output);

      const outputPath = pslOutputPathFor({
        config: ctx.config,
        cwd: ctx.cwd,
        output: args.flags.output,
      });
      const displayPath = relative(ctx.cwd, outputPath);
      const refusal = await outputPathRefusal({
        cwd: ctx.cwd,
        outputPath,
        sourceInputs,
        emittedJsonPath,
      });
      if (refusal !== undefined) {
        return notOk(normalizeError(refusal));
      }

      let printed: ContractPrintResult;
      try {
        printed = await executeContractPrint(
          {
            config: ctx.config,
            contractConfig,
            description: printDescription(sourcePaths),
            signal: ctx.signal,
          },
          { printPsl },
        );
      } catch (error) {
        return notOk(normalizeError(error));
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
        content: printed.psl,
        publicationToken: String(process.hrtime.bigint()),
      });

      const { defaultControlPolicy } = printed.sourceSettings;
      if (defaultControlPolicy !== undefined) {
        ctx.report({
          kind: 'message',
          severity: 'warn',
          text: defaultControlPolicyWarning(defaultControlPolicy),
        });
      }

      const document: PrintDocument = {
        ok: true,
        summary: 'Contract printed successfully',
        target: { familyId: ctx.config.family.familyId, id: ctx.config.target.targetId },
        psl: { path: displayPath },
        source: sourcePaths,
        ...ifDefined('defaultControlPolicy', defaultControlPolicy),
        timings: { total: Date.now() - startedAt },
      };

      return ok(
        ctx.present(
          { data: document },
          printPresentations(
            document,
            emittedFilesMoveFor({ cwd: ctx.cwd, outputPath, emittedJsonPath }),
          ),
        ),
      );
    },
  });
}

export const contractPrintCommand = createContractPrintCommand({ printPsl: printPslFromAst });
