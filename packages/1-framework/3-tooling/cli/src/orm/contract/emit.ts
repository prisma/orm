import { ormConfigSection } from '@internal/config-loader';
import { ifDefined } from '@internal/utils/defined';
import type { Block, Presentations } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import { ok } from '@prisma/cli-engine/protocol';
import { dirname, relative, resolve } from 'pathe';
import { executeContractEmit as executeContractEmitOperation } from '../../control-api/operations/contract-emit';
import { defineOrmCommand } from '../define-command';
import { controlProgressReporter } from '../progress';

interface EmitDocument {
  readonly ok: true;
  readonly storageHash: string;
  readonly executionHash?: string;
  readonly profileHash: string;
  readonly outDir: string;
  readonly files: { readonly json: string; readonly dts: string };
  readonly timings: { readonly total: number };
}

function hashRows(document: EmitDocument): Block {
  return {
    kind: 'fields',
    rows: [
      { label: 'storageHash', value: [{ text: document.storageHash, tone: 'identifier' }] },
      ...(document.executionHash === undefined
        ? []
        : [
            {
              label: 'executionHash',
              value: [{ text: document.executionHash, tone: 'identifier' as const }],
            },
          ]),
      { label: 'profileHash', value: [{ text: document.profileHash, tone: 'identifier' }] },
    ],
  };
}

function emitPresentations(inputs: {
  readonly document: EmitDocument;
  readonly cwd: string;
}): Presentations {
  const { document, cwd } = inputs;
  return {
    next: () => [],
    human: (): readonly Block[] => [
      {
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'contract', value: relative(cwd, document.files.json) },
          { label: 'types', value: relative(cwd, document.files.dts) },
        ],
      },
      { kind: 'summary', status: 'ok', text: 'Emitted contract.json and contract.d.ts' },
      hashRows(document),
    ],
    stdout: () => [document.files.json, document.files.dts],
    json: () => document,
  };
}

export interface ContractEmitCommandDeps {
  readonly executeContractEmit: typeof executeContractEmitOperation;
}

export function createContractEmitCommand({ executeContractEmit }: ContractEmitCommandDeps) {
  return defineOrmCommand({
    help: {
      summary: 'Emit your contract artifacts',
      description:
        'Reads your contract source (TypeScript or Prisma schema) and emits\n' +
        'contract.json and contract.d.ts. The contract.json contains the canonical\n' +
        'contract structure, and contract.d.ts provides TypeScript types for\n' +
        'type-safe query building. Offline — does not consult the database.',
      examples: [
        'contract emit',
        'contract emit --output-path ./generated',
        'contract emit --json',
      ],
    },
    args: {
      flags: {
        outputPath: flag.string({
          brief: 'Directory to write contract.json and contract.d.ts into',
          placeholder: 'dir',
        }),
      },
    },
    needs: { config: ormConfigSection },
    handler: async (args, ctx) => {
      const startedAt = Date.now();
      const outputPath =
        args.flags.outputPath === undefined ? undefined : resolve(ctx.cwd, args.flags.outputPath);

      const result = await executeContractEmit({
        config: ctx.config,
        cwd: ctx.cwd,
        onProgress: controlProgressReporter(ctx.report),
        signal: ctx.signal,
        ...ifDefined('outputPath', outputPath),
      });

      if (result.validationWarning !== undefined) {
        ctx.report({ kind: 'message', severity: 'warn', text: result.validationWarning });
      }

      const document: EmitDocument = {
        ok: true,
        storageHash: result.storageHash,
        ...ifDefined('executionHash', result.executionHash),
        profileHash: result.profileHash,
        outDir: dirname(result.files.json),
        files: result.files,
        timings: { total: Date.now() - startedAt },
      };
      ctx.report({
        kind: 'message',
        severity: 'verbose',
        text: `Total time: ${document.timings.total}ms`,
      });

      return ok(ctx.present({ data: document }, emitPresentations({ document, cwd: ctx.cwd })));
    },
  });
}

export const contractEmitCommand = createContractEmitCommand({
  executeContractEmit: executeContractEmitOperation,
});
