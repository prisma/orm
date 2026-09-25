import { existsSync } from 'node:fs';
import { expandContractInputs, ormConfigSection } from '@internal/config-loader';
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
import { defineOrmCommand } from '../define-command';
import { baseDirFor } from '../migration/paths';
import { normalizeError } from '../normalize-error';
import { emittedJsonPathFor, filePathKey } from './paths';

interface PrintDocument {
  readonly ok: true;
  readonly summary: string;
  readonly target: { readonly familyId: string; readonly id: string };
  /** The file the PSL was written to, or the PSL itself when no --output was given. */
  readonly psl: { readonly path: string } | { readonly text: string };
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

function sourceSettingsClause(policy: string | undefined): string {
  return policy === undefined
    ? ''
    : `, through a PSL source that sets defaultControlPolicy: '${policy}'`;
}

function switchToPrintedActions(
  document: PrintDocument,
  emittedFilesMove: EmittedFilesMove | undefined,
): readonly NextAction[] {
  const policyClause = sourceSettingsClause(document.defaultControlPolicy);
  const emit = runCommandAction('Emit the printed contract', '{bin} contract emit');
  if (!('path' in document.psl)) {
    return [
      chooseAction(
        `Write the PSL to a file with --output <path>, then point contract in prisma.config.ts at that file${policyClause}`,
      ),
      emit,
    ];
  }
  const path = document.psl.path;
  return [
    chooseAction(`Point contract in prisma.config.ts at ${path}${policyClause}`),
    ...(emittedFilesMove === undefined
      ? []
      : [
          chooseAction(
            `With contract: './${path}' and no output in prisma.config.ts, contract emit writes ${emittedFilesMove.after.json} and ${emittedFilesMove.after.dts}, not ${emittedFilesMove.before.json} and ${emittedFilesMove.before.dts}`,
          ),
        ]),
    emit,
  ];
}

function defaultControlPolicyWarning(policy: string): string {
  return `The contract's default control policy is '${policy}', and a PSL file cannot carry it. Set defaultControlPolicy: '${policy}' on the PSL source in prisma.config.ts. Without it, the emitted contract has no default control policy, and everything that sets no control policy of its own is treated as managed.`;
}

/** The lines of `text`, without the empty line after its final newline. */
function linesOf(text: string): readonly string[] {
  return text.replace(/\n$/, '').split('\n');
}

function printPresentations(
  document: PrintDocument,
  emittedFilesMove: EmittedFilesMove | undefined,
): Presentations {
  return {
    stdout: () => ('text' in document.psl ? linesOf(document.psl.text) : []),
    next: () => switchToPrintedActions(document, emittedFilesMove),
    human: (): readonly Block[] =>
      'path' in document.psl
        ? [
            {
              kind: 'summary',
              status: 'ok',
              text: [
                { text: 'Contract written to ' },
                { text: document.psl.path, tone: 'identifier' },
              ],
            },
          ]
        : [
            { kind: 'summary', status: 'ok', text: [{ text: 'Contract printed as Prisma 8 PSL' }] },
            { kind: 'drawing', lines: linesOf(document.psl.text) },
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
  readonly configPath: string;
  readonly emittedJsonPath: string | undefined;
}): Promise<CliStructuredError | undefined> {
  const { cwd } = inputs;
  const output = relative(cwd, inputs.outputPath);
  const outputKey = await filePathKey(inputs.outputPath);

  for (const input of await expandContractInputs(inputs.sourceInputs)) {
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

  const { configPath } = inputs;
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
      summary: 'Print the configured contract as Prisma 8 PSL',
      description:
        'Loads the contract from contract.source in your config, whatever kind\n' +
        'of source that is, and prints it as Prisma 8 PSL, or writes it to the\n' +
        'file --output names. Emitting that PSL produces the same contract: same\n' +
        'hashes, same domain. If the contract holds something PSL cannot\n' +
        'express, the command refuses, names it, and prints nothing. A pipe\n' +
        'receives the JSON result unless you pass --format human. The command\n' +
        'does not change your config: point it at the written file, then run\n' +
        '`contract emit`. An existing file at the --output path is overwritten,\n' +
        'with a warning.',
      examples: [
        'contract print',
        'contract print --format human > ./src/prisma/contract.prisma',
        'contract print --output ./src/prisma/contract.prisma',
        'contract print --json',
      ],
    },
    args: {
      flags: {
        output: flag.string({
          brief: 'Write the PSL to this file instead of standard output',
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

      const outputPath =
        args.flags.output === undefined ? undefined : resolve(ctx.cwd, args.flags.output);
      if (outputPath !== undefined) {
        const refusal = await outputPathRefusal({
          cwd: ctx.cwd,
          outputPath,
          sourceInputs,
          configPath: resolve(baseDirFor(ctx.config), 'prisma.config.ts'),
          emittedJsonPath,
        });
        if (refusal !== undefined) {
          return notOk(normalizeError(refusal));
        }
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

      if (outputPath !== undefined) {
        if (existsSync(outputPath)) {
          ctx.report({
            kind: 'message',
            severity: 'warn',
            text: `Overwriting existing file: ${relative(ctx.cwd, outputPath)}`,
          });
        }
        await publishTextArtifact({
          path: outputPath,
          content: printed.psl,
          publicationToken: String(process.hrtime.bigint()),
        });
      }

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
        psl:
          outputPath === undefined
            ? { text: printed.psl }
            : { path: relative(ctx.cwd, outputPath) },
        source: sourcePaths,
        ...ifDefined('defaultControlPolicy', defaultControlPolicy),
        timings: { total: Date.now() - startedAt },
      };

      return ok(
        ctx.present(
          { data: document },
          printPresentations(
            document,
            outputPath === undefined
              ? undefined
              : emittedFilesMoveFor({ cwd: ctx.cwd, outputPath, emittedJsonPath }),
          ),
        ),
      );
    },
  });
}

export const contractPrintCommand = createContractPrintCommand({ printPsl: printPslFromAst });
